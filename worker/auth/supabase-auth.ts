import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivationStore, DealerRecord } from "../routes/activation";
import type { AuthenticatedPasswordResult, PasswordAuthenticator } from "../routes/login";
import type { OtpChallengeStore, StoredOtpChallenge } from "./otp-service";

interface DealerRow {
  id: string;
  organisation_id: string;
  name: string;
  city: string | null;
  master_email: string | null;
  pilot_email: string | null;
  pilot_email_source: "MASTER" | "SELF_DECLARED_PILOT" | null;
  activation_status: string;
}

function dealerRecord(row: DealerRow, authUserId: string | null): DealerRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    city: row.city,
    masterEmail: row.master_email,
    pilotEmail: row.pilot_email,
    pilotEmailSource: row.pilot_email_source,
    activationStatus: row.activation_status,
    authUserId,
  };
}

export class SupabaseActivationStore implements ActivationStore {
  constructor(private readonly client: SupabaseClient) {}

  async search(query: string): Promise<DealerRecord[]> {
    const escaped = query.replace(/[%_*,()]/gu, "");
    if (escaped.length < 3) return [];
    const { data, error } = await this.client
      .from("dealers")
      .select("id,organisation_id,name,city,master_email,pilot_email,pilot_email_source,activation_status")
      .ilike("name", `%${escaped}%`)
      .eq("activation_status", "UNACTIVATED")
      .limit(10);
    if (error) throw new Error("DEALER_LOOKUP_FAILED");
    return (data as DealerRow[]).map((row) => dealerRecord(row, null));
  }

  async get(id: string): Promise<DealerRecord | null> {
    const { data, error } = await this.client
      .from("dealers")
      .select("id,organisation_id,name,city,master_email,pilot_email,pilot_email_source,activation_status")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error("DEALER_LOOKUP_FAILED");
    if (!data) return null;
    const { data: user, error: userError } = await this.client
      .from("app_users")
      .select("auth_user_id")
      .eq("dealer_id", id)
      .limit(1)
      .maybeSingle();
    if (userError) throw new Error("DEALER_LOOKUP_FAILED");
    return dealerRecord(data as DealerRow, (user?.auth_user_id as string | undefined) ?? null);
  }

  async begin(id: string, pilotEmail: string, source: "MASTER" | "SELF_DECLARED_PILOT" = "SELF_DECLARED_PILOT"): Promise<boolean> {
    const { data, error } = await this.client
      .from("dealers")
      .update({ pilot_email: pilotEmail, pilot_email_source: source, activation_status: "EMAIL_OTP_PENDING" })
      .eq("id", id)
      .eq("activation_status", "UNACTIVATED")
      .is("activated_at", null)
      .select("id");
    if (error) throw new Error("ACTIVATION_CLAIM_FAILED");
    return data.length === 1;
  }

  async release(id: string, pilotEmail: string | null, source: "MASTER" | "SELF_DECLARED_PILOT" | null): Promise<void> {
    const { error } = await this.client
      .from("dealers")
      .update({ pilot_email: pilotEmail, pilot_email_source: source, activation_status: "UNACTIVATED" })
      .eq("id", id)
      .eq("activation_status", "EMAIL_OTP_PENDING")
      .is("activated_at", null);
    if (error) throw new Error("ACTIVATION_RELEASE_FAILED");
  }

  async activate(id: string, authUserId: string): Promise<boolean> {
    const dealer = await this.get(id);
    if (!dealer || dealer.authUserId || dealer.activationStatus !== "EMAIL_OTP_PENDING") return false;
    const now = new Date().toISOString();
    const { data, error } = await this.client
      .from("dealers")
      .update({ activation_status: "ACTIVE", activated_at: now })
      .eq("id", id)
      .eq("activation_status", "EMAIL_OTP_PENDING")
      .is("activated_at", null)
      .select("id");
    if (error || data.length !== 1) return false;
    const { error: mappingError } = await this.client.from("app_users").insert({
      organisation_id: dealer.organisationId,
      dealer_id: id,
      auth_user_id: authUserId,
      app_role: "DEALER",
    });
    if (mappingError) {
      await this.client.from("dealers").update({ activation_status: "EMAIL_OTP_PENDING", activated_at: null }).eq("id", id).eq("activated_at", now);
      throw new Error("ACTIVATION_MAPPING_FAILED");
    }
    return true;
  }
}

export class SupabasePasswordAuthenticator implements PasswordAuthenticator {
  constructor(private readonly client: SupabaseClient) {}

  async authenticate(email: string, password: string): Promise<AuthenticatedPasswordResult | null> {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error || !data.user || !data.session) return null;
    const { data: mapping, error: mappingError } = await this.client
      .from("app_users")
      .select("dealer_id,organisation_id")
      .eq("auth_user_id", data.user.id)
      .eq("app_role", "DEALER")
      .maybeSingle();
    if (mappingError || !mapping?.dealer_id) return null;
    return {
      authUserId: data.user.id,
      dealerId: mapping.dealer_id as string,
      organisationId: mapping.organisation_id as string,
      email,
      accessToken: data.session.access_token,
    };
  }

  async createUser(email: string, password: string): Promise<{ authUserId: string }> {
    const { data, error } = await this.client.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error("AUTH_USER_CREATION_FAILED");
    return { authUserId: data.user.id };
  }
}

interface OtpRow {
  id: string;
  organisation_id: string;
  dealer_id: string;
  auth_user_id: string | null;
  purpose: StoredOtpChallenge["purpose"];
  code_hash: string;
  expires_at: string;
  attempts: number;
  max_attempts: number;
  consumed_at: string | null;
  correlation_id: string;
  provider_delivery_id: string | null;
  created_at: string;
}

function fromOtpRow(row: OtpRow): StoredOtpChallenge {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    dealerId: row.dealer_id,
    authUserId: row.auth_user_id,
    purpose: row.purpose,
    codeHash: row.code_hash,
    expiresAt: row.expires_at,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    consumedAt: row.consumed_at,
    correlationId: row.correlation_id,
    providerDeliveryId: row.provider_delivery_id,
    createdAt: row.created_at,
  };
}

function toOtpRow(challenge: StoredOtpChallenge) {
  return {
    id: challenge.id,
    organisation_id: challenge.organisationId,
    dealer_id: challenge.dealerId,
    auth_user_id: challenge.authUserId,
    purpose: challenge.purpose,
    code_hash: challenge.codeHash,
    expires_at: challenge.expiresAt,
    attempts: challenge.attempts,
    max_attempts: challenge.maxAttempts,
    consumed_at: challenge.consumedAt,
    correlation_id: challenge.correlationId,
    provider_delivery_id: challenge.providerDeliveryId,
    created_at: challenge.createdAt,
  };
}

export class SupabaseOtpChallengeStore implements OtpChallengeStore {
  constructor(private readonly client: SupabaseClient) {}

  async create(challenge: StoredOtpChallenge): Promise<void> {
    const { error } = await this.client.from("otp_challenges").insert(toOtpRow(challenge));
    if (error) throw new Error("OTP_STORAGE_FAILED");
  }

  async get(id: string): Promise<StoredOtpChallenge | null> {
    const { data, error } = await this.client.from("otp_challenges").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error("OTP_STORAGE_FAILED");
    return data ? fromOtpRow(data as OtpRow) : null;
  }

  async findLatest(organisationId: string, dealerId: string, purpose: StoredOtpChallenge["purpose"]): Promise<StoredOtpChallenge | null> {
    const { data, error } = await this.client
      .from("otp_challenges")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq("dealer_id", dealerId)
      .eq("purpose", purpose)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("OTP_STORAGE_FAILED");
    return data ? fromOtpRow(data as OtpRow) : null;
  }

  async update(challenge: StoredOtpChallenge, expectedAttempts?: number): Promise<boolean> {
    let query = this.client.from("otp_challenges").update(toOtpRow(challenge)).eq("id", challenge.id);
    if (expectedAttempts !== undefined) query = query.eq("attempts", expectedAttempts).is("consumed_at", null);
    const { data, error } = await query.select("id");
    if (error) throw new Error("OTP_STORAGE_FAILED");
    return data.length === 1;
  }
}
