import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertAccountTransition, type AccountState } from "../account-state";
import type { AppRole } from "../middleware/auth";
import type { LoginIdentity, LoginIdentityResolver } from "../routes/login";
import type { OtpChallengeStore, StoredOtpChallenge } from "./otp-service";

interface DealerRow {
  id: string;
  organisation_id: string;
  code: string;
  account_state: AccountState | null;
  activation_status: string;
  master_email: string | null;
  pilot_email: string | null;
  secondary_email: string | null;
  first_login_at: string | null;
}

const DEALER_COLUMNS = "id,organisation_id,code,account_state,activation_status,master_email,pilot_email,secondary_email,first_login_at";

/** Where a dealer's one-time code goes, in the same precedence Phase 2's issuance used
 *  when it chose which address the credentials were sent to. 58 of the 136 live dealers
 *  have none of these; they cannot be credentialed at all and are parked at
 *  CREDENTIALS_PENDING (V5_AUTH_FLOW.md §8), so they never reach this function. */
function otpEmail(dealer: DealerRow): string | null {
  return dealer.pilot_email ?? dealer.master_email ?? dealer.secondary_email ?? null;
}

interface AppUserRow {
  auth_user_id: string;
  organisation_id: string;
  dealer_id: string | null;
  app_role: AppRole;
  status: string;
  must_change_password: boolean;
}

const APP_USER_COLUMNS = "auth_user_id,organisation_id,dealer_id,app_role,status,must_change_password";

export class SupabaseLoginIdentityResolver implements LoginIdentityResolver {
  /** Password checks need a client that is not the caller's admin client: signing in
   *  writes a session onto whichever client performs it, and the admin client is shared
   *  by every request in this isolate. Built once, lazily, with persistSession off. */
  private passwordClient: SupabaseClient | null = null;

  constructor(
    private readonly client: SupabaseClient,
    private readonly url: string,
    private readonly key: string,
  ) {}

  async resolve(identifier: string): Promise<LoginIdentity | null> {
    const value = identifier.trim().toLowerCase();
    if (!value) return null;
    // Dealer Code first, the registered email as an alias for it (§8). `dealers` is
    // unique on (organisation_id, code), so a code resolves without any client-supplied
    // organisation. ilike is only a coarse filter here -- LIKE metacharacters are
    // stripped from the pattern and every candidate is then compared exactly in JS, so
    // a wildcard cannot widen the match into somebody else's account.
    const pattern = value.replaceAll(/[%_*,()]/gu, "");
    if (!pattern) return null;

    const { data: byCode } = await this.client.from("dealers").select(DEALER_COLUMNS).ilike("code", pattern).limit(20);
    const codeMatches = ((byCode as DealerRow[] | null) ?? []).filter((row) => row.code?.toLowerCase() === value);
    // Two dealers sharing a code across organisations would make this ambiguous, and
    // guessing which one the caller meant is how a tenant boundary gets crossed.
    if (codeMatches.length === 1) return this.forDealer(codeMatches[0]!);
    if (codeMatches.length > 1) return null;

    if (!value.includes("@")) return null;
    const { data: byEmail } = await this.client
      .from("dealers")
      .select(DEALER_COLUMNS)
      .or(`pilot_email.ilike.${pattern},master_email.ilike.${pattern},secondary_email.ilike.${pattern}`)
      .limit(20);
    const emailMatches = ((byEmail as DealerRow[] | null) ?? [])
      .filter((row) => [row.pilot_email, row.master_email, row.secondary_email].some((address) => address?.toLowerCase() === value));
    if (emailMatches.length === 1) return this.forDealer(emailMatches[0]!);
    if (emailMatches.length > 1) return null;

    // Admins have no dealer record, so they always arrive by email (§3).
    const authUserId = await this.findAuthUserIdByEmail(value);
    return authUserId ? this.byAuthUserId(authUserId) : null;
  }

  async byAuthUserId(authUserId: string): Promise<LoginIdentity | null> {
    const { data, error } = await this.client.from("app_users").select(APP_USER_COLUMNS).eq("auth_user_id", authUserId).maybeSingle();
    if (error || !data) return null;
    const user = data as AppUserRow;
    if (user.status !== "ACTIVE") return null;
    if (!user.dealer_id) {
      const email = await this.emailOfAuthUser(authUserId);
      if (!email) return null;
      return {
        authUserId, dealerId: null, organisationId: user.organisation_id, email, authEmail: email, role: user.app_role,
        accountState: null, mustChangePassword: user.must_change_password === true, firstLoginAt: null,
      };
    }
    // Self-scoped by the organisation on the membership row, never one supplied by a
    // caller: the Worker holds the service-role key and RLS is not the boundary here.
    const { data: dealer, error: dealerError } = await this.client
      .from("dealers").select(DEALER_COLUMNS)
      .eq("id", user.dealer_id).eq("organisation_id", user.organisation_id).maybeSingle();
    if (dealerError || !dealer) return null;
    return this.forDealer(dealer as DealerRow, user);
  }

  private async forDealer(dealer: DealerRow, known?: AppUserRow): Promise<LoginIdentity | null> {
    const email = otpEmail(dealer);
    if (!email) return null;
    let user = known;
    if (!user) {
      const { data } = await this.client.from("app_users").select(APP_USER_COLUMNS)
        .eq("organisation_id", dealer.organisation_id).eq("dealer_id", dealer.id).eq("app_role", "DEALER")
        .limit(1).maybeSingle();
      user = (data as AppUserRow | null) ?? undefined;
    }
    if (!user || user.status !== "ACTIVE") return null;
    // The dealer's OTP address and the auth user's actual email are two different
    // facts that happen to start out equal (issueCredentials sets both from the same
    // value) and can drift apart the moment either one is edited afterward. Fetching
    // the real one here, always, is what stops that drift from silently breaking
    // password sign-in.
    const authEmail = await this.emailOfAuthUser(user.auth_user_id);
    if (!authEmail) return null;
    return {
      authUserId: user.auth_user_id,
      dealerId: dealer.id,
      organisationId: dealer.organisation_id,
      email: email.toLowerCase(),
      authEmail,
      role: "DEALER",
      accountState: dealer.account_state,
      mustChangePassword: user.must_change_password === true,
      firstLoginAt: dealer.first_login_at,
    };
  }

  /** Supabase Auth is the only password store (§6). A failure here is never told apart
   *  from an unknown identifier by the caller, and the password is neither logged nor
   *  returned; the tokens this mints are discarded because KITCO issues its own sealed
   *  session cookie. */
  async verifyPassword(identity: LoginIdentity, password: string): Promise<boolean> {
    this.passwordClient ??= createClient(this.url, this.key, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const { data, error } = await this.passwordClient.auth.signInWithPassword({ email: identity.authEmail, password });
    if (error || !data.user) return false;
    await this.passwordClient.auth.signOut({ scope: "local" }).catch(() => undefined);
    return data.user.id === identity.authUserId;
  }

  async setPassword(identity: LoginIdentity, password: string): Promise<void> {
    const { error } = await this.client.auth.admin.updateUserById(identity.authUserId, { password });
    if (error) throw new Error("PASSWORD_UPDATE_FAILED");
    const { error: flagError } = await this.client.from("app_users")
      .update({ must_change_password: false })
      .eq("auth_user_id", identity.authUserId).eq("organisation_id", identity.organisationId);
    if (flagError) throw new Error("PASSWORD_UPDATE_FAILED");
  }

  async moveAccountState(identity: LoginIdentity, to: AccountState): Promise<void> {
    if (!identity.dealerId) return;
    const state = assertAccountTransition(identity.accountState, to);
    const now = new Date().toISOString();
    const { error } = await this.client.from("dealers").update({ account_state: state, updated_at: now })
      .eq("id", identity.dealerId).eq("organisation_id", identity.organisationId);
    if (error) throw new Error("ACCOUNT_STATE_UPDATE_FAILED");
    await this.audit(identity, to === "OTP_PENDING" ? "OTP_ISSUED" : to === "PASSWORD_CHANGE_REQUIRED" ? "PASSWORD_CHANGE_REQUIRED" : to === "ACTIVE" ? "DEALER_ACTIVATED" : "FIRST_LOGIN_STARTED", {
      fields: ["account_state"], from: identity.accountState, to: state,
    });
    identity.accountState = state;
  }

  async stampLogin(identity: LoginIdentity, first: boolean): Promise<void> {
    if (!identity.dealerId) return;
    const now = new Date().toISOString();
    const { error } = await this.client.from("dealers")
      .update(first ? { first_login_at: now, last_login_at: now, updated_at: now } : { last_login_at: now, updated_at: now })
      .eq("id", identity.dealerId).eq("organisation_id", identity.organisationId);
    if (error) throw new Error("LOGIN_STAMP_FAILED");
    await this.audit(identity, "LOGIN_SUCCEEDED", { fields: first ? ["first_login_at", "last_login_at"] : ["last_login_at"] });
  }

  /** Field names and outcomes. Never a password, never a code, never an address (§6). */
  private async audit(identity: LoginIdentity, eventType: string, evidence: Record<string, unknown>): Promise<void> {
    await this.client.from("audit_events").insert({
      organisation_id: identity.organisationId,
      dealer_id: identity.dealerId,
      actor_auth_user_id: identity.authUserId,
      event_type: eventType,
      entity_type: "dealer",
      entity_id: identity.dealerId,
      correlation_id: crypto.randomUUID(),
      evidence,
    });
  }

  private async emailOfAuthUser(authUserId: string): Promise<string | null> {
    const { data, error } = await this.client.auth.admin.getUserById(authUserId);
    if (error || !data.user?.email) return null;
    return data.user.email.toLowerCase();
  }

  private async findAuthUserIdByEmail(email: string): Promise<string | null> {
    for (let page = 1; ; page += 1) {
      const { data, error } = await this.client.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return null;
      const match = data.users.find((user) => user.email?.toLowerCase() === email);
      if (match) return match.id;
      if (data.users.length < 200) return null;
    }
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

  async findLatest(organisationId: string, dealerId: string | null, purpose: StoredOtpChallenge["purpose"]): Promise<StoredOtpChallenge | null> {
    let query = this.client
      .from("otp_challenges")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq("purpose", purpose);
    query = dealerId === null ? query.is("dealer_id", null) : query.eq("dealer_id", dealerId);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
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
