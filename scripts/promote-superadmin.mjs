#!/usr/bin/env node
// One-time manual step (v4.0 plan D9): create/promote the KITCO superadmin account.
// Reads identity from env — never hardcode the email or password in source.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SECRET_KEY=... SUPERADMIN_EMAIL=bharat@kgroups.co.in \
//     node scripts/promote-superadmin.mjs
//
// If the auth user does not exist yet, it is created with a generated temporary
// password (printed once, must_change_password=true). If it already exists, only
// the app_users role mapping is created/updated.

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const { SUPABASE_URL, SUPABASE_SECRET_KEY, SUPERADMIN_EMAIL } = process.env;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !SUPERADMIN_EMAIL) {
  console.error("SUPABASE_URL, SUPABASE_SECRET_KEY and SUPERADMIN_EMAIL are required");
  process.exit(1);
}

const client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

function generateTempPassword() {
  return `Kv-${randomBytes(9).toString("base64url")}`;
}

async function findAuthUserByEmail(email) {
  const target = email.trim().toLowerCase();
  let page = 1;
  for (;;) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === target);
    if (match) return match;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

async function main() {
  const email = SUPERADMIN_EMAIL.trim().toLowerCase();

  const { data: org, error: orgError } = await client.from("organisations").select("id").limit(1).single();
  if (orgError || !org) throw new Error(`Could not resolve the pilot organisation: ${orgError?.message ?? "none found"}`);

  let authUserId = (await findAuthUserByEmail(email))?.id ?? null;
  let tempPassword = null;

  if (!authUserId) {
    tempPassword = generateTempPassword();
    const { data, error } = await client.auth.admin.createUser({ email, password: tempPassword, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message ?? "unknown error"}`);
    authUserId = data.user.id;
  }

  const { error: upsertError } = await client
    .from("app_users")
    .upsert(
      { organisation_id: org.id, dealer_id: null, auth_user_id: authUserId, app_role: "SUPERADMIN", must_change_password: Boolean(tempPassword), status: "ACTIVE" },
      { onConflict: "auth_user_id" },
    );
  if (upsertError) throw new Error(`app_users upsert failed: ${upsertError.message}`);

  console.log(`SUPERADMIN ready: ${email} (auth_user_id ${authUserId})`);
  if (tempPassword) {
    console.log(`Temporary password (share securely, shown once): ${tempPassword}`);
  } else {
    console.log("Existing auth user promoted to SUPERADMIN; password unchanged.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
