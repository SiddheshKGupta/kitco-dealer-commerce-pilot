// Production integration suite — every assertion here runs against real Postgres.
//
// Read tests/db/README.md before changing anything in this file. The two rules
// that matter:
//   1. No mocks. If it does not touch the database, it does not belong here.
//   2. Nothing may commit. Every workflow probe self-aborts; the final test
//      re-reads the row counts and fails if anything moved.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import {
  SCAFFOLD_DECLARE,
  SCAFFOLD_DRAFT,
  SCAFFOLD_SYNTHETIC,
  SKIP_REASON,
  SNAPSHOT_SQL,
  execSql,
  fields,
  hasCredentials,
  probe
} from "./harness";

if (!hasCredentials) console.warn(`\n[tests/db] SKIPPED\n  ${SKIP_REASON}\n`);

const live = describe.skipIf(!hasCredentials);

let baseline: Record<string, unknown> = {};

beforeAll(async () => {
  const snapshot = await execSql(SNAPSHOT_SQL);
  expect(snapshot.ok, `could not reach the database: ${snapshot.error}`).toBe(true);
  baseline = snapshot.rows[0];
});

// ---------------------------------------------------------------------------
// 1. Schema / RPC contract.
//
// The test that would have caught the P0. For every RPC the worker calls, prove
// it can actually write every table it claims to write, under production
// triggers and RLS — rather than trusting that it can.
//
// 55000 means an immutability trigger blocked a write the RPC needs.
// 42501 means RLS or a role check blocked it despite valid privileged args.
// Any other SQLSTATE means the RPC reached its own business rules, which is a
// pass: the plumbing works.
// ---------------------------------------------------------------------------
live("RPC contract against production triggers and RLS", () => {
  const REPOSITORY = fileURLToPath(
    new URL("../../worker/supabase-commerce-repository.ts", import.meta.url)
  );

  /** Every RPC name the worker actually calls. */
  const calledByWorker = [
    ...readFileSync(REPOSITORY, "utf8").matchAll(/\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/gi)
  ].map((match) => match[1]);

  const PROBED = [
    "submit_kitco_order",
    "approve_kitco_order",
    "create_kitco_dispatch",
    "apply_kitco_credit_hold",
    "decide_kitco_order_line",
    "decide_kitco_order_line_v5",
    "approve_entire_kitco_order",
    "reject_entire_kitco_order"
  ];

  it("probes every RPC the worker calls", () => {
    expect(new Set(calledByWorker).size).toBeGreaterThan(0);
    const unprobed = [...new Set(calledByWorker)].filter((name) => !PROBED.includes(name));
    expect(
      unprobed,
      `worker/supabase-commerce-repository.ts calls RPCs this suite never exercises: ${unprobed.join(", ")}. Add them below — an unprobed RPC is exactly how the v4 P0 shipped.`
    ).toEqual([]);
  });

  it("runs the whole order lifecycle through the real RPCs", async () => {
    const payload = await probe(
      SCAFFOLD_DECLARE,
      `${SCAFFOLD_DRAFT}

  begin
    v_res := public.submit_kitco_order(v_org, v_dealer, v_dealer_auth,
               'probe-' || gen_random_uuid(), v_otp, now(), gen_random_uuid()::text);
    v_order := (v_res->>'order_id')::uuid;
    select ol.id into v_line from public.order_lines ol
      join public.order_versions ov on ov.id = ol.order_version_id
      where ov.order_id = v_order limit 1;
    select count(*) into v_audit from public.order_line_decisions where order_id = v_order;
    v_out := v_out || format('submit_kitco_order=OK created:%s decisions:%s | ',
                             v_res->>'created', v_audit);
  exception when others then
    v_out := v_out || format('submit_kitco_order=RAISED[%s: %s] | ', SQLSTATE, SQLERRM); end;

  begin
    v_res := public.approve_kitco_order(v_org, v_admin, v_order, now(), gen_random_uuid()::text);
    v_out := v_out || format('approve_kitco_order=OK changed:%s | ', v_res->>'changed');
  exception when others then
    v_out := v_out || format('approve_kitco_order=RAISED[%s: %s] | ', SQLSTATE, SQLERRM); end;

  begin
    v_res := public.create_kitco_dispatch(v_org, v_admin, v_order, v_line, v_label, 1,
               v_loc, now(), gen_random_uuid()::text);
    v_out := v_out || format('create_kitco_dispatch=OK dispatch:%s | ',
                             (v_res->>'dispatch_id') is not null);
  exception when others then
    v_out := v_out || format('create_kitco_dispatch=RAISED[%s: %s] | ', SQLSTATE, SQLERRM); end;

  begin
    v_res := public.apply_kitco_credit_hold(v_org, v_admin, v_order, v_line, v_label, 1,
               'CREDIT_HOLD', now(), gen_random_uuid()::text);
    v_out := v_out || 'apply_kitco_credit_hold=OK | ';
  exception when others then
    v_out := v_out || format('apply_kitco_credit_hold=RAISED[%s: %s] | ', SQLSTATE, SQLERRM); end;

  begin
    v_res := public.decide_kitco_order_line_v5(v_org, v_admin, v_order, v_line, v_label,
               v_qty, 0, 0, null, null, now(), gen_random_uuid()::text);
    v_out := v_out || format('decide_kitco_order_line_v5=OK pending:%s | ', v_res->>'pending_qty');
  exception when others then
    v_out := v_out || format('decide_kitco_order_line_v5=RAISED[%s: %s] | ', SQLSTATE, SQLERRM); end;

  begin
    v_res := public.decide_kitco_order_line(v_org, v_admin, v_order, v_line, v_label,
               v_qty, 0, null, now(), gen_random_uuid()::text);
    v_out := v_out || 'decide_kitco_order_line=OK | ';
  exception when others then
    v_out := v_out || format('decide_kitco_order_line=RAISED[%s: %s] | ', SQLSTATE, SQLERRM); end;
`
    );

    const result = fields(payload);

    // submit_kitco_order writes orders, order_versions, order_lines,
    // order_line_sizes and audit_events — the immutable tables. If this passes,
    // the append path is intact.
    expect(result.submit_kitco_order, payload).toMatch(/^OK created:t/);
    expect(result.approve_kitco_order, payload).toMatch(/^OK/);
    expect(result.create_kitco_dispatch, payload).toBe("OK dispatch:t");
    expect(result.apply_kitco_credit_hold, payload).toBe("OK");

    for (const [name, outcome] of Object.entries(result)) {
      expect(
        outcome,
        `${name} was blocked by an immutability trigger (55000). The RPC tries to write a table it is not allowed to write — this is the exact shape of the v4 P0. Full probe: ${payload}`
      ).not.toMatch(/RAISED\[55000/);
      expect(
        outcome,
        `${name} was blocked by RLS or a role check (42501) despite valid privileged arguments. Full probe: ${payload}`
      ).not.toMatch(/RAISED\[42501/);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The v5 decision workflow.
// ---------------------------------------------------------------------------
live("v5 order line decisions", () => {
  it("splits one line+size three ways and keeps the invariant", async () => {
    const payload = await probe(
      SCAFFOLD_DECLARE,
      `${SCAFFOLD_SYNTHETIC}

  v_res := public.decide_kitco_order_line_v5(v_org, v_admin, v_order, v_line, v_l1,
             7, 2, 1, 'credit probe', 'reject probe', now(), gen_random_uuid()::text);

  select ordered_qty, approved_qty, credit_review_qty, rejected_qty, pending_qty into v_d
  from public.order_line_decisions where order_line_size_id = v_ols;

  select status into v_status from public.orders where id = v_order;
  select count(*) into v_audit from public.audit_events
  where event_type = 'ORDER_LINE_DECIDED' and evidence->>'order_id' = v_order::text;

  v_out := format('ordered=%s | approved=%s | credit=%s | rejected=%s | pending=%s'
                  ' | invariant=%s | rpc_pending=%s | status=%s | audit=%s',
    v_d.ordered_qty, v_d.approved_qty, v_d.credit_review_qty, v_d.rejected_qty, v_d.pending_qty,
    (v_d.ordered_qty = v_d.approved_qty + v_d.credit_review_qty + v_d.rejected_qty + v_d.pending_qty),
    v_res->>'pending_qty', v_status, v_audit);
`
    );

    const result = fields(payload);
    expect(result, payload).toMatchObject({
      ordered: "10",
      approved: "7",
      credit: "2",
      rejected: "1",
      // generated column: ordered - (7 + 2 + 1)
      pending: "0",
      invariant: "t",
      rpc_pending: "0"
    });
    // Size 2 (20 pairs) is untouched, so the order as a whole is still in review.
    expect(result.status).toBe("UNDER_REVIEW");
    // One audit row per decision.
    expect(result.audit).toBe("1");
  });

  it("regression guard: decide_kitco_order_line_v5 never raises 55000", async () => {
    // The exact P0. v4's decide_kitco_order_line UPDATEs order_line_sizes, which
    // carries a BEFORE UPDATE trigger that raises unconditionally. v5 writes to
    // order_line_decisions instead and must never touch the immutable submission.
    const payload = await probe(
      SCAFFOLD_DECLARE,
      `${SCAFFOLD_SYNTHETIC}

  begin
    v_res := public.decide_kitco_order_line_v5(v_org, v_admin, v_order, v_line, v_l1,
               5, 3, 2, 'credit', 'reject', now(), gen_random_uuid()::text);
    v_out := 'v5=OK';
  exception when others then v_out := format('v5=RAISED[%s: %s]', SQLSTATE, SQLERRM); end;
`
    );
    expect(payload).toBe("v5=OK");
  });

  it("approve_entire approves only PENDING and preserves credit-review and rejected", async () => {
    const payload = await probe(
      SCAFFOLD_DECLARE,
      `${SCAFFOLD_SYNTHETIC}

  -- size 1: 7 approved, 2 credit review, 1 rejected. size 2: 20 still pending.
  perform public.decide_kitco_order_line_v5(v_org, v_admin, v_order, v_line, v_l1,
            7, 2, 1, 'credit probe', 'reject probe', now(), gen_random_uuid()::text);

  v_res := public.approve_entire_kitco_order(v_org, v_admin, v_order, now(), gen_random_uuid()::text);

  select sum(ordered_qty) o, sum(approved_qty) a, sum(credit_review_qty) c,
         sum(rejected_qty) r, sum(pending_qty) p
  into v_tot from public.order_line_decisions where order_id = v_order;
  select status into v_status from public.orders where id = v_order;
  select count(*) into v_audit from public.audit_events
  where event_type = 'ORDER_APPROVED_IN_FULL' and entity_id = v_order;

  v_out := format('lines=%s | pairs=%s | ordered=%s | approved=%s | credit=%s | rejected=%s'
                  ' | pending=%s | reconciles=%s | status=%s | audit=%s',
    v_res->>'lines_affected', v_res->>'pairs_approved',
    v_tot.o, v_tot.a, v_tot.c, v_tot.r, v_tot.p,
    (v_tot.o = v_tot.a + v_tot.c + v_tot.r + v_tot.p), v_status, v_audit);
`
    );

    const result = fields(payload);
    expect(result, payload).toMatchObject({
      // Only size 2's 20 pending pairs move — one line affected, not two.
      lines: "1",
      // Guards the generated-column bug fixed in 20260824120000: totals must be
      // read BEFORE the update, or this reports 0.
      pairs: "20",
      ordered: "30",
      approved: "27",
      // Untouched by the bulk action.
      credit: "2",
      rejected: "1",
      pending: "0",
      reconciles: "t",
      audit: "1"
    });
    // Fully decided with credit-review outstanding: CREDIT_REVIEW outranks
    // PARTIALLY_APPROVED, because it is the state a human must act on.
    expect(result.status).toBe("CREDIT_REVIEW");
  });

  it("reject_entire demands a reason and rejects only remaining pending", async () => {
    const payload = await probe(
      SCAFFOLD_DECLARE,
      `${SCAFFOLD_SYNTHETIC}

  begin
    v_res := public.reject_entire_kitco_order(v_org, v_admin, v_order, '   ', now(),
               gen_random_uuid()::text);
    v_out := v_out || 'blank_reason=ACCEPTED | ';
  exception when others then
    v_out := v_out || format('blank_reason=REFUSED[%s] | ', SQLSTATE); end;

  perform public.decide_kitco_order_line_v5(v_org, v_admin, v_order, v_line, v_l1,
            4, 2, 0, 'credit probe', null, now(), gen_random_uuid()::text);

  v_res := public.reject_entire_kitco_order(v_org, v_admin, v_order, 'Season closed', now(),
             gen_random_uuid()::text);

  select sum(ordered_qty) o, sum(approved_qty) a, sum(credit_review_qty) c,
         sum(rejected_qty) r, sum(pending_qty) p
  into v_tot from public.order_line_decisions where order_id = v_order;

  v_out := v_out || format('lines=%s | pairs=%s | approved=%s | credit=%s | rejected=%s'
                           ' | pending=%s | status=%s',
    v_res->>'lines_affected', v_res->>'pairs_rejected',
    v_tot.a, v_tot.c, v_tot.r, v_tot.p, v_res->>'order_status');
`
    );

    const result = fields(payload);
    expect(result.blank_reason, payload).toBe("REFUSED[22023]");
    expect(result, payload).toMatchObject({
      // size 1 had 4 pending left (10 - 4 - 2), size 2 had 20.
      lines: "2",
      pairs: "24",
      approved: "4",
      // Neither approved nor credit-review quantity is reversed.
      credit: "2",
      rejected: "24",
      pending: "0"
    });
    expect(result.status).toBe("CREDIT_REVIEW");
  });
});

// ---------------------------------------------------------------------------
// 3. Immutability. These triggers are what make the dealer's submission
//    evidence rather than a mutable record. A future migration must never
//    silently drop them.
// ---------------------------------------------------------------------------
live("immutable submission evidence", () => {
  it("still blocks direct UPDATE and DELETE on the submitted order", async () => {
    const payload = await probe(
      SCAFFOLD_DECLARE,
      `${SCAFFOLD_SYNTHETIC}

  begin
    update public.order_line_sizes set approved_quantity_pairs = 1 where id = v_ols;
    v_out := v_out || 'order_line_sizes_update=ALLOWED | ';
  exception when others then
    v_out := v_out || format('order_line_sizes_update=BLOCKED[%s] | ', SQLSTATE); end;

  begin
    update public.order_lines set approved_quantity_pairs = 1 where id = v_line;
    v_out := v_out || 'order_lines_update=ALLOWED | ';
  exception when others then
    v_out := v_out || format('order_lines_update=BLOCKED[%s] | ', SQLSTATE); end;

  begin
    update public.order_versions set retail_value_minor = 1 where id = v_version;
    v_out := v_out || 'order_versions_update=ALLOWED | ';
  exception when others then
    v_out := v_out || format('order_versions_update=BLOCKED[%s] | ', SQLSTATE); end;

  begin
    delete from public.order_line_sizes where id = v_ols;
    v_out := v_out || 'order_line_sizes_delete=ALLOWED | ';
  exception when others then
    v_out := v_out || format('order_line_sizes_delete=BLOCKED[%s] | ', SQLSTATE); end;
`
    );

    expect(fields(payload), payload).toEqual({
      order_line_sizes_update: "BLOCKED[55000]",
      order_lines_update: "BLOCKED[55000]",
      order_versions_update: "BLOCKED[55000]",
      order_line_sizes_delete: "BLOCKED[55000]"
    });
  });
});

// ---------------------------------------------------------------------------
// 4. RLS. `enable` alone leaves the table open to its owner; v5 tables must also
//    `force`, so even the owning role is subject to policy.
// ---------------------------------------------------------------------------
live("v5 tables have RLS enabled and forced", () => {
  it("reports rowsecurity and forcerowsecurity on all four", async () => {
    const result = await execSql(`select c.relname as table_name,
       c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
       (select count(*) from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in
  ('dealer_groups', 'gst_registrations', 'dealer_group_membership_requests', 'order_line_decisions')
order by 1;`);

    expect(result.ok, result.error).toBe(true);
    expect(result.rows).toHaveLength(4);
    for (const row of result.rows) {
      expect(row.enabled, `${row.table_name} does not have RLS enabled`).toBe(true);
      expect(row.forced, `${row.table_name} does not have RLS forced`).toBe(true);
      expect(Number(row.policies), `${row.table_name} has RLS on but no policy`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Nothing committed. This runs last and is the reason the suite is safe to
//    point at a database holding live pilot data.
// ---------------------------------------------------------------------------
live("the database is exactly as the suite found it", () => {
  it("matches the row counts snapshotted at suite start", async () => {
    const after = await execSql(SNAPSHOT_SQL);
    expect(after.ok, after.error).toBe(true);
    expect(
      after.rows[0],
      "A probe COMMITTED. Live pilot data may have been modified — inspect before running anything else."
    ).toEqual(baseline);
  });
});
