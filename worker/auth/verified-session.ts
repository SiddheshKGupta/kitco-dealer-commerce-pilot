import type { SupabaseClient } from "@supabase/supabase-js";
import { isAdminRole, type AppRole, type SessionVerifier } from "../middleware/auth";
import type { SessionService } from "./session";

interface AppUserRow {
  auth_user_id: string;
  organisation_id: string;
  dealer_id: string | null;
  app_role: AppRole;
  status: string;
}

interface DealerRow {
  id: string;
  organisation_id: string;
  activation_status: string;
  pilot_email: string | null;
}

/** Revalidates every encrypted application session against current app membership state.
 *  There is no Supabase Auth session/password involved -- OTP is the only factor, so the
 *  encrypted cookie itself (1h sliding idle expiry, refreshed by CommerceAppDependencies'
 *  refreshSessionCookie on every authenticated request) plus a fresh app_users/dealers
 *  status check on every request is the full trust boundary. */
export function createVerifiedSessionVerifier(client: SupabaseClient, sessions: SessionService): SessionVerifier {
  return async (request) => {
    const sealed = sessions.readCookie(request.headers.get("cookie") ?? undefined, "kitco_session");
    const session = sealed ? await sessions.openApplication(sealed) : null;
    if (!session) return null;

    const { data: mapping, error: mappingError } = await client
      .from("app_users")
      .select("auth_user_id,organisation_id,dealer_id,app_role,status")
      .eq("auth_user_id", session.authUserId)
      .maybeSingle();
    if (mappingError || !mapping) return null;
    const appUser = mapping as AppUserRow;
    if (appUser.organisation_id !== session.organisationId || appUser.dealer_id !== session.dealerId) return null;
    if (appUser.status !== "ACTIVE") return null;

    if (isAdminRole(appUser.app_role)) {
      return appUser.dealer_id === null
        ? { userId: appUser.auth_user_id, organisationId: appUser.organisation_id, dealerId: null, role: appUser.app_role, email: session.email }
        : null;
    }
    if (!appUser.dealer_id) return null;
    const { data: dealer, error: dealerError } = await client
      .from("dealers")
      .select("id,organisation_id,activation_status,pilot_email")
      .eq("id", appUser.dealer_id)
      .eq("organisation_id", appUser.organisation_id)
      .maybeSingle();
    if (dealerError || !dealer) return null;
    const current = dealer as DealerRow;
    if (current.activation_status !== "ACTIVE") return null;

    return {
      userId: appUser.auth_user_id,
      organisationId: appUser.organisation_id,
      dealerId: appUser.dealer_id,
      role: "DEALER",
      email: current.pilot_email ?? session.email,
    };
  };
}
