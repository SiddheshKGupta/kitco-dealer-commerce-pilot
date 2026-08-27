import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./middleware/errors";

/** Resolves a GSTIN to a `gst_registrations` row, reusing the existing one. Several
 *  dealers legitimately share a GSTIN: Indian GST issues one GSTIN per PAN per state,
 *  covering a principal place of business plus unlimited additional places, so a
 *  group's outlets in one state all operate under the same registration. The
 *  registration is therefore stored once and pointed at, never copied onto each dealer.
 *
 *  verification_status stays UNVERIFIED: no GST provider is wired yet, and a
 *  self-declared number must never be presented as GST-verified.
 *
 *  Shared by every store that resolves a GSTIN (dealer applications, admin console,
 *  dealer self-service profile) -- previously three near-identical copies that had
 *  quietly diverged on normalisation. */
export async function resolveGstRegistration(client: SupabaseClient, organisationId: string, gstin: string): Promise<string> {
  const normalised = gstin.trim().toUpperCase().replaceAll(/\s+/g, "");

  const { data: existing, error: findError } = await client
    .from("gst_registrations").select("id").eq("organisation_id", organisationId).eq("gstin", normalised).maybeSingle();
  if (findError) throw new ApiError(502, "GST_LOOKUP_FAILED", "That GST number could not be checked");
  if (existing) return String(existing.id);

  const { data: created, error: insertError } = await client
    .from("gst_registrations")
    .insert({ organisation_id: organisationId, gstin: normalised, verification_status: "UNVERIFIED" })
    .select("id").maybeSingle();
  // A concurrent save for the same GSTIN loses the insert race; re-read instead of
  // failing, since the winner's row is exactly what we wanted.
  if (insertError?.code === "23505") {
    const { data: raced } = await client
      .from("gst_registrations").select("id").eq("organisation_id", organisationId).eq("gstin", normalised).maybeSingle();
    if (raced) return String(raced.id);
  }
  if (insertError || !created) throw new ApiError(502, "GST_SAVE_FAILED", "That GST number could not be saved");
  return String(created.id);
}
