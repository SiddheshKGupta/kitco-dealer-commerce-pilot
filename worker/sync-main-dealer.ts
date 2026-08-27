import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "./middleware/errors";

/** `dealers.is_main_dealer` and `dealer_groups.primary_dealer_id` are the same fact
 *  stored twice and nothing in the schema keeps them agreeing, so do it here: exactly
 *  one main dealer per group, mirrored onto the group row. Both writes are checked --
 *  a silent failure on either would leave the two sources of truth disagreeing with
 *  nothing surfacing it.
 *
 *  Shared by every store that can name a group's main dealer (admin console dealer
 *  create/import, dealer-group assignment) -- previously two byte-for-byte copies. */
export async function syncMainDealer(client: SupabaseClient, organisationId: string, groupId: string, dealerId: string): Promise<void> {
  const { error: clearError } = await client.from("dealers").update({ is_main_dealer: false })
    .eq("organisation_id", organisationId).eq("dealer_group_id", groupId).neq("id", dealerId);
  if (clearError) throw new ApiError(502, "DEALER_GROUP_MAIN_DEALER_SYNC_FAILED", "The group's main dealer could not be updated");

  const { error: setError } = await client.from("dealer_groups").update({ primary_dealer_id: dealerId })
    .eq("id", groupId).eq("organisation_id", organisationId);
  if (setError) throw new ApiError(502, "DEALER_GROUP_MAIN_DEALER_SYNC_FAILED", "The group's main dealer could not be updated");
}
