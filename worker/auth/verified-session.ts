import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdminRole, type AppRole, type SessionVerifier } from "../middleware/auth";
import type { SessionService } from "./session";

interface AppUserRow {
  auth_user_id: string;
  organisation_id: string;
  dealer_id: string | null;
  app_role: AppRole;
  status: string;
  must_change_password: boolean;
}

interface DealerRow {
  id: string;
  organisation_id: string;
  activation_status: string;
  account_state: string | null;
  pilot_email: string | null;
}

/** A dealer may trade when their account is ACTIVE. account_state is the v5 machine but
 *  is still null for every dealer nothing has moved onto it, so a dealer judged only by
 *  v4's activation_status keeps working exactly as before -- this widens the gate, it
 *  does not perform the Phase 8 cutover that retires activation_status. Same precedence
 *  SupabaseDealerGroups.isSelectableDealer already uses, so the two never disagree.
 *  An explicit SUSPENDED or DISABLED therefore always wins over a stale v4 ACTIVE. */
function isActiveDealer(row: DealerRow): boolean {
  return row.account_state ? row.account_state === "ACTIVE" : row.activation_status === "ACTIVE";
}

/** Revalidates every encrypted application session against current app membership state.
 *  The encrypted cookie (1h sliding idle expiry, refreshed by CommerceAppDependencies'
 *  refreshSessionCookie on every authenticated request) plus a fresh app_users/dealers
 *  status check on every request is the full trust boundary; the Supabase Auth session
 *  minted while checking the password is discarded and never reaches the browser. */
export function createVerifiedSessionVerifier(client: SupabaseClient, sessions: SessionService): SessionVerifier {
  return async (request) => {
    const sealed = sessions.readCookie(request.headers.get("cookie") ?? undefined, "kitco_session");
    const session = sealed ? await sessions.openApplication(sealed) : null;
    if (!session) return null;

    const { data: mapping, error: mappingError } = await client
      .from("app_users")
      .select("auth_user_id,organisation_id,dealer_id,app_role,status,must_change_password")
      .eq("auth_user_id", session.authUserId)
      .maybeSingle();
    if (mappingError || !mapping) return null;
    const appUser = mapping as AppUserRow;
    if (appUser.organisation_id !== session.organisationId || appUser.dealer_id !== session.dealerId) return null;
    if (appUser.status !== "ACTIVE") return null;
    // V5_AUTH_FLOW.md §2 step 4: until the issued password is replaced, this session
    // reaches /api/login/password and nothing else. That endpoint opens the cookie
    // itself rather than going through this verifier, so the wall holds here for every
    // other route without needing a per-route allowlist to be kept correct.
    if (appUser.must_change_password === true) return null;

    if (isAdminRole(appUser.app_role)) {
      return appUser.dealer_id === null
        ? { userId: appUser.auth_user_id, organisationId: appUser.organisation_id, dealerId: null, role: appUser.app_role, email: session.email }
        : null;
    }
    if (!appUser.dealer_id) return null;
    const { data: dealer, error: dealerError } = await client
      .from("dealers")
      .select("id,organisation_id,activation_status,account_state,pilot_email")
      .eq("id", appUser.dealer_id)
      .eq("organisation_id", appUser.organisation_id)
      .maybeSingle();
    if (dealerError || !dealer) return null;
    const current = dealer as DealerRow;
    if (!isActiveDealer(current)) return null;

    return {
      userId: appUser.auth_user_id,
      organisationId: appUser.organisation_id,
      dealerId: appUser.dealer_id,
      role: "DEALER",
      email: current.pilot_email ?? session.email,
    };
  };
}
