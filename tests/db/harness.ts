// Production integration harness — real Postgres, real migrations, real triggers, real RLS.
//
// WHY THIS EXISTS
// The v4 P0 (partial approval never worked in production, not once) passed 233
// tests because every one of them ran against InMemoryCommerceRepository. The
// standing rule that produced:
//
//     No mocked implementation is evidence that a database workflow works.
//
// Nothing in this directory may import a fixture, a fake or a repository double.
//
// SAFETY
// The target database holds live pilot data (3 real orders, 136 real dealers).
// Every probe runs inside a PL/pgSQL DO block that ends by deliberately RAISE-ing
// an exception carrying its results. The raise aborts the transaction, so the
// scaffolding never commits; the message is the assertion payload. This is the
// same self-aborting pattern used to diagnose the P0
// (docs/plan/V5_EXECUTION_PLAN.md §3.3).
//
// TRANSPORT
// A DO block is not reachable through PostgREST: SUPABASE_SECRET_KEY only exposes
// table CRUD and pre-declared RPCs, never arbitrary SQL. Since cleanup-by-DELETE
// is also impossible here (order_lines / order_line_sizes / audit_events carry
// BEFORE DELETE triggers that raise 55000), the self-aborting transaction is the
// only safe option, and raw SQL is therefore mandatory. The Management API is the
// one raw-SQL channel reachable over HTTPS with no new dependency.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEV_VARS = fileURLToPath(new URL("../../.dev.vars", import.meta.url));

/** process.env first, then .dev.vars if it happens to be present. */
function readCredential(name: string): string | undefined {
  const fromEnv = process.env[name];
  if (fromEnv) return fromEnv;

  let contents: string;
  try {
    contents = readFileSync(DEV_VARS, "utf8");
  } catch {
    return undefined;
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match?.[1] === name) return match[2].trim().replace(/^["']|["']$/g, "") || undefined;
  }
  return undefined;
}

export const PROJECT_ID = readCredential("SUPABASE_PROJECT_ID") ?? "lvbgpgsgotadoneyrtyt";
const ACCESS_TOKEN = readCredential("SUPABASE_ACCESS_TOKEN");

export const hasCredentials = Boolean(ACCESS_TOKEN);

export const SKIP_REASON = [
  "tests/db needs a Supabase personal access token to reach real Postgres.",
  "Set SUPABASE_ACCESS_TOKEN (sbp_...) in the environment or in .dev.vars, then rerun `npm run test:db`.",
  "Create one at https://supabase.com/dashboard/account/tokens.",
  "SUPABASE_SECRET_KEY is deliberately NOT enough: PostgREST cannot execute the",
  "self-aborting DO block these tests depend on to leave live pilot data untouched.",
  `Target project: ${PROJECT_ID}.`
].join("\n  ");

export interface SqlResult {
  ok: boolean;
  rows: Record<string, unknown>[];
  /** Raw server error text when ok is false — probes deliberately land here. */
  error: string;
}

export async function execSql(query: string): Promise<SqlResult> {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query })
    }
  );

  const body = await response.text();
  if (!response.ok) return { ok: false, rows: [], error: body };

  try {
    const parsed = JSON.parse(body);
    return { ok: true, rows: Array.isArray(parsed) ? parsed : [parsed], error: "" };
  } catch {
    return { ok: true, rows: [], error: "" };
  }
}

/**
 * Run a self-aborting probe and return the payload it raised.
 *
 * `body` is PL/pgSQL appended after the scaffold; it appends findings to `v_out`.
 * The wrapper raises `PROBE >> <v_out>`, which rolls the whole transaction back.
 */
export async function probe(declarations: string, body: string): Promise<string> {
  const sql = `do $probe$
declare
${declarations}
begin
${body}
  raise exception 'PROBE >> %', v_out;
end $probe$;`;

  const result = await execSql(sql);

  if (result.ok) {
    throw new Error(
      `Probe did not raise. That means the transaction COMMITTED and may have written to the live database. SQL:\n${sql}`
    );
  }

  const payload = /PROBE >> ([\s\S]*?)(?:\\nCONTEXT:|\nCONTEXT:|"}|$)/.exec(result.error);
  if (!payload) {
    throw new Error(`Probe failed before reaching its assertions:\n${result.error}`);
  }
  return payload[1].trim();
}

/** Row counts that must be identical before and after the suite. */
export const SNAPSHOT_SQL = `select
  (select count(*) from public.orders) as orders,
  (select count(*) from public.order_line_decisions) as order_line_decisions,
  (select count(*) from public.audit_events) as audit_events,
  (select count(*) from public.dealers) as dealers,
  (select count(*) from public.order_lines) as order_lines,
  (select count(*) from public.order_line_sizes) as order_line_sizes,
  (select count(*) from public.order_versions) as order_versions,
  (select count(*) from public.dispatches) as dispatches,
  (select count(*) from public.holds) as holds,
  (select count(*) from public.draft_orders) as draft_orders,
  (select count(*) from public.otp_challenges) as otp_challenges,
  (select string_agg(order_number || '=' || status, ' ' order by order_number) from public.orders) as pilot_orders;`;

// ---------------------------------------------------------------- scaffolding
//
// Two scaffolds, because the tests need two different starting points:
//
//  SCAFFOLD_SYNTHETIC — an order built by direct INSERT, so ordered quantities
//    are exact (10 and 20) and the decision arithmetic is checkable by hand.
//  SCAFFOLD_SUBMITTED — an order created by submit_kitco_order itself, which is
//    the only way to prove that RPC can still write the immutable tables.
//
// Both reuse existing organisation / dealer / offering rows rather than creating
// them. Nothing commits, so reuse is free and keeps the scaffold small.

export const SCAFFOLD_DECLARE = `  v_org uuid; v_dealer uuid; v_admin uuid; v_dealer_auth uuid;
  v_offering uuid; v_colourway uuid; v_mrp bigint;
  v_order uuid; v_version uuid; v_line uuid; v_ols uuid;
  v_sv1 uuid; v_sv2 uuid; v_l1 text; v_l2 text;
  v_sv uuid; v_label text; v_moq int; v_mult int; v_qty int;
  v_otp uuid; v_draft uuid; v_dline uuid; v_loc uuid;
  v_res jsonb; v_d record; v_tot record; v_status text; v_audit int; v_fin text;
  v_out text := '';`;

/** Actors and catalogue rows shared by both scaffolds. */
const SEED = `  select au.organisation_id, au.dealer_id, au.auth_user_id into v_org, v_dealer, v_dealer_auth
  from public.app_users au join public.dealers d on d.id = au.dealer_id
  where au.app_role = 'DEALER' and d.activation_status = 'ACTIVE' limit 1;

  select auth_user_id into v_admin from public.app_users
  where organisation_id = v_org and app_role = 'ADMIN' and status = 'ACTIVE' limit 1;

  if v_org is null or v_admin is null then
    raise exception 'PROBE >> SEED_MISSING org=% admin=%', v_org is not null, v_admin is not null;
  end if;

  select id into v_loc from public.dealer_locations where dealer_id = v_dealer and active limit 1;

  select co.id, co.product_colourway_id, co.mrp_minor, psv.size_value_id, sv.label,
         co.moq_pairs, co.order_multiple
  into v_offering, v_colourway, v_mrp, v_sv, v_label, v_moq, v_mult
  from public.commercial_offerings co
  join public.product_colourways pc on pc.id = co.product_colourway_id and pc.published_at is not null
  join public.product_size_values psv on psv.product_colourway_id = pc.id and psv.enabled
  join public.size_values sv on sv.id = psv.size_value_id
  where co.organisation_id = v_org and co.published_at is not null
    and (co.opens_at is null or co.opens_at <= now())
    and (co.closes_at is null or co.closes_at >= now())
  limit 1;`;

/**
 * A SUBMITTED order with one line and two sizes: 10 pairs and 20 pairs.
 * order_line_sizes' AFTER INSERT trigger scaffolds the order_line_decisions rows.
 */
export const SCAFFOLD_SYNTHETIC = `${SEED}

  select sv.id, sv.label into v_sv1, v_l1
  from public.size_values sv join public.order_line_sizes ols on ols.size_value_id = sv.id limit 1;
  select sv.id, sv.label into v_sv2, v_l2
  from public.size_values sv join public.order_line_sizes ols on ols.size_value_id = sv.id
  where sv.id <> v_sv1 limit 1;

  insert into public.orders (organisation_id, dealer_id, order_number, status,
                             current_version_no, idempotency_key, submitted_at)
  values (v_org, v_dealer, 'PROBE-' || gen_random_uuid(), 'SUBMITTED', 1,
          'probe-' || gen_random_uuid(), now())
  returning id into v_order;

  insert into public.order_versions (organisation_id, order_id, version_no, version_status,
                                     retail_value_minor, currency_code, created_by)
  values (v_org, v_order, 1, 'SUBMITTED', 100000, 'INR', v_admin)
  returning id into v_version;

  insert into public.order_lines (organisation_id, order_version_id, commercial_offering_id,
                                  product_colourway_id, mrp_minor, approved_quantity_pairs)
  values (v_org, v_version, v_offering, v_colourway, v_mrp, 30)
  returning id into v_line;

  insert into public.order_line_sizes (organisation_id, order_line_id, size_value_id,
                                       ordered_quantity_pairs, approved_quantity_pairs)
  values (v_org, v_line, v_sv1, 10, 10) returning id into v_ols;
  insert into public.order_line_sizes (organisation_id, order_line_id, size_value_id,
                                       ordered_quantity_pairs, approved_quantity_pairs)
  values (v_org, v_line, v_sv2, 20, 20);`;

/** A consumed OTP challenge plus a draft order, ready for submit_kitco_order. */
export const SCAFFOLD_DRAFT = `${SEED}

  v_qty := greatest(v_moq, v_mult) * 6;
  if v_qty % v_mult <> 0 then v_qty := v_qty + (v_mult - v_qty % v_mult); end if;

  insert into public.otp_challenges (organisation_id, dealer_id, auth_user_id, purpose,
                                     code_hash, expires_at, consumed_at, correlation_id)
  values (v_org, v_dealer, v_dealer_auth, 'ORDER_SUBMISSION', 'probe',
          now() + interval '10 minutes', now() - interval '1 minute', gen_random_uuid())
  returning id into v_otp;

  insert into public.draft_orders (organisation_id, dealer_id)
  values (v_org, v_dealer) returning id into v_draft;

  insert into public.draft_order_lines (organisation_id, draft_order_id, commercial_offering_id)
  values (v_org, v_draft, v_offering) returning id into v_dline;

  insert into public.draft_order_line_sizes (organisation_id, draft_order_line_id,
                                             size_value_id, quantity_pairs)
  values (v_org, v_dline, v_sv, v_qty);`;

/** Parse `key=value | key=value` probe output into a lookup. */
export function fields(payload: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of payload.split("|")) {
    const match = /^\s*([\w.]+)\s*=\s*([\s\S]*?)\s*$/.exec(part);
    if (match) out[match[1]] = match[2];
  }
  return out;
}
