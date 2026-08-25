import type { SupabaseClient } from "@supabase/supabase-js";
import type { DealerProfile } from "../src/domain/dealer-profile";
import type { SessionIdentity } from "./middleware/auth";
import { ApiError } from "./middleware/errors";

type Row = Record<string, any>;

export interface DealerProfileUpdate {
  gstin?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  city?: string;
  state?: string;
  pinCode?: string;
  contactPerson?: string;
  mobile?: string;
  secondaryEmail?: string | null;
}

export interface DealerProfileRecord extends DealerProfile {
  dealerId: string;
  dealerCode: string;
  displayName: string | null;
  legalName: string | null;
  /** Present only once a GST registration is attached. */
  gstVerificationStatus: string | null;
}

export interface DealerProfileStore {
  get(session: SessionIdentity): Promise<DealerProfileRecord>;
  update(session: SessionIdentity, input: DealerProfileUpdate, correlationId: string): Promise<DealerProfileRecord>;
  setStorefrontPhoto(session: SessionIdentity, objectKey: string, correlationId: string): Promise<DealerProfileRecord>;
}

function toRecord(row: Row): DealerProfileRecord {
  const registration = Array.isArray(row.gst_registrations) ? row.gst_registrations[0] : row.gst_registrations;
  return {
    dealerId: String(row.id),
    dealerCode: String(row.code),
    displayName: row.display_name ?? null,
    legalName: row.legal_name ?? null,
    gstin: registration?.gstin ?? null,
    gstVerificationStatus: registration?.verification_status ?? null,
    addressLine1: row.address_line1 ?? null,
    addressLine2: row.address_line2 ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    pinCode: row.pin_code ?? null,
    mobile: row.mobile ?? null,
    contactPerson: row.contact_person ?? null,
    secondaryEmail: row.secondary_email ?? null,
    storefrontPhotoKey: row.storefront_photo_key ?? null,
  };
}

const PROFILE_SELECT = `
  id,code,display_name,legal_name,address_line1,address_line2,city,state,pin_code,
  mobile,contact_person,secondary_email,storefront_photo_key,gst_registration_id,
  gst_registrations(gstin,verification_status)`;

export class SupabaseDealerProfileStore implements DealerProfileStore {
  constructor(private readonly client: SupabaseClient) {}

  private requireDealer(session: SessionIdentity): string {
    if (session.role !== "DEALER" || !session.dealerId) {
      throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    }
    return session.dealerId;
  }

  private async audit(session: SessionIdentity, correlationId: string, eventType: string, evidence: Record<string, unknown>) {
    await this.client.from("audit_events").insert({
      organisation_id: session.organisationId,
      dealer_id: session.dealerId,
      actor_auth_user_id: session.userId,
      event_type: eventType,
      entity_type: "dealer",
      entity_id: session.dealerId,
      correlation_id: correlationId,
      evidence,
    });
  }

  private async load(session: SessionIdentity, dealerId: string): Promise<DealerProfileRecord> {
    const { data, error } = await this.client
      .from("dealers")
      .select(PROFILE_SELECT)
      .eq("id", dealerId)
      .eq("organisation_id", session.organisationId)
      .maybeSingle();
    if (error) throw new ApiError(502, "PROFILE_LOAD_FAILED", "Your profile could not be loaded");
    if (!data) throw new ApiError(404, "DEALER_NOT_FOUND", "Dealer not found");
    return toRecord(data as Row);
  }

  async get(session: SessionIdentity): Promise<DealerProfileRecord> {
    return this.load(session, this.requireDealer(session));
  }

  /** Resolves a GSTIN to a gst_registrations row, reusing the existing record when
   *  one already exists for this organisation.
   *
   *  Several dealers legitimately share one GSTIN: Indian GST issues one GSTIN per
   *  PAN per state, covering a principal place of business plus unlimited
   *  additional places, so a group's outlets in one state all operate under the
   *  same registration. The registration is therefore stored once and pointed at,
   *  never copied onto each dealer.
   *
   *  verification_status stays UNVERIFIED: no GST provider is configured yet, and
   *  a self-declared number must never be presented as GST-verified. */
  private async resolveGstRegistration(session: SessionIdentity, gstin: string): Promise<string> {
    const normalised = gstin.trim().toUpperCase().replaceAll(/\s+/g, "");

    const { data: existing, error: findError } = await this.client
      .from("gst_registrations")
      .select("id")
      .eq("organisation_id", session.organisationId)
      .eq("gstin", normalised)
      .maybeSingle();
    if (findError) throw new ApiError(502, "GST_LOOKUP_FAILED", "That GST number could not be checked");
    if (existing) return String(existing.id);

    const { data: created, error: insertError } = await this.client
      .from("gst_registrations")
      .insert({
        organisation_id: session.organisationId,
        gstin: normalised,
        verification_status: "UNVERIFIED",
      })
      .select("id")
      .maybeSingle();
    // A concurrent save for the same GSTIN loses the insert race; re-read instead
    // of failing, since the winner's row is exactly what we wanted.
    if (insertError?.code === "23505") {
      const { data: raced } = await this.client
        .from("gst_registrations")
        .select("id")
        .eq("organisation_id", session.organisationId)
        .eq("gstin", normalised)
        .maybeSingle();
      if (raced) return String(raced.id);
    }
    if (insertError || !created) throw new ApiError(502, "GST_SAVE_FAILED", "That GST number could not be saved");
    return String(created.id);
  }

  async update(session: SessionIdentity, input: DealerProfileUpdate, correlationId: string): Promise<DealerProfileRecord> {
    const dealerId = this.requireDealer(session);
    const before = await this.load(session, dealerId);

    const patch: Row = {};
    if (input.addressLine1 !== undefined) patch.address_line1 = input.addressLine1;
    if (input.addressLine2 !== undefined) patch.address_line2 = input.addressLine2;
    if (input.city !== undefined) patch.city = input.city;
    if (input.state !== undefined) patch.state = input.state;
    if (input.pinCode !== undefined) patch.pin_code = input.pinCode;
    if (input.contactPerson !== undefined) patch.contact_person = input.contactPerson;
    if (input.mobile !== undefined) patch.mobile = input.mobile;
    if (input.secondaryEmail !== undefined) patch.secondary_email = input.secondaryEmail;
    if (input.gstin !== undefined) {
      patch.gst_registration_id = await this.resolveGstRegistration(session, input.gstin);
    }

    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString();
      const { error } = await this.client
        .from("dealers")
        .update(patch)
        .eq("id", dealerId)
        .eq("organisation_id", session.organisationId);
      if (error) throw new ApiError(502, "PROFILE_SAVE_FAILED", "Your profile could not be saved");
    }

    const after = await this.load(session, dealerId);
    // Record which fields moved, never the values -- this is dealer PII and the
    // audit log is read by KITCO staff.
    const changed = (Object.keys(patch) as string[]).filter((key) => key !== "updated_at");
    await this.audit(session, correlationId, "DEALER_PROFILE_UPDATED", {
      fields: changed,
      gstinAttached: before.gstin !== after.gstin,
    });
    return after;
  }

  async setStorefrontPhoto(session: SessionIdentity, objectKey: string, correlationId: string): Promise<DealerProfileRecord> {
    const dealerId = this.requireDealer(session);
    const { error } = await this.client
      .from("dealers")
      .update({ storefront_photo_key: objectKey, updated_at: new Date().toISOString() })
      .eq("id", dealerId)
      .eq("organisation_id", session.organisationId);
    if (error) throw new ApiError(502, "PHOTO_SAVE_FAILED", "That photo could not be saved");
    await this.audit(session, correlationId, "DEALER_STOREFRONT_PHOTO_UPDATED", { objectKey });
    return this.load(session, dealerId);
  }
}
