import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseLoginIdentityResolver } from "../../worker/auth/supabase-auth";

type Row = Record<string, any>;

const APP_USER: Row = {
  auth_user_id: "auth-1", organisation_id: "org-1", dealer_id: "dealer-1",
  app_role: "DEALER", status: "ACTIVE", must_change_password: false,
};

const DEALER: Row = {
  id: "dealer-1", organisation_id: "org-1", code: "BIHAR-0001",
  account_state: "ACTIVE", activation_status: "ACTIVE",
  master_email: "master@bihar-0001.test", pilot_email: "pilot@bihar-0001.test",
  secondary_email: null, first_login_at: "2026-08-01T00:00:00.000Z",
};

/** A dealer's OTP address (pilot_email here) was edited after the auth user was
 *  created, so auth.users.email is now a different address entirely -- this is
 *  exactly VLCO's shape in production, and the case that broke password sign-in. */
function makeClient(authUsersEmail: string | null) {
  const from = (table: string) => {
    if (table === "app_users") {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: APP_USER, error: null }) }) }) };
    }
    if (table === "dealers") {
      return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: DEALER, error: null }) }) }) }) };
    }
    throw new Error(`unexpected table ${table}`);
  };
  const client = {
    from,
    auth: { admin: { getUserById: async () => ({ data: { user: authUsersEmail ? { email: authUsersEmail } : null }, error: null }) } },
  } as unknown as SupabaseClient;
  return new SupabaseLoginIdentityResolver(client, "https://example.test", "service-role-key");
}

describe("SupabaseLoginIdentityResolver -- OTP address vs. the Supabase Auth email", () => {
  it("keeps the dealer's OTP address and the real auth email as two separate facts", async () => {
    // A dealer's chosen OTP address (pilot_email) and the address their Supabase Auth
    // account was actually created under can drift apart the moment either is edited.
    // Conflating them broke every password sign-in for an affected dealer with no way
    // to tell from the error that the password was actually correct: production had
    // 3 dealer logins in total, and 2 already carried this exact mismatch.
    const identity = await makeClient("original-signup-address@example.test").byAuthUserId("auth-1");

    expect(identity?.email).toBe("pilot@bihar-0001.test");
    expect(identity?.authEmail).toBe("original-signup-address@example.test");
  });

  it("fails closed rather than falling back to the OTP address when the auth user has no resolvable email", async () => {
    const identity = await makeClient(null).byAuthUserId("auth-1");
    expect(identity).toBeNull();
  });
});
