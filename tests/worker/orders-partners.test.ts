import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createCommerceApp } from "../../worker/app";
import { SupabaseDealerGroups } from "../../worker/supabase-dealer-groups";
import { dealerA, headers, repository, verifier } from "./fixtures";

/** Phase 4 wiring smoke test: does POST /api/orders/submit actually call
 *  resolveOrderPartners and let its 403/proof drive the outcome, rather than
 *  trusting whatever billToDealerId/shipToDealerId the browser sent? The
 *  resolver itself (SupabaseDealerGroups) already has 28 tests in
 *  dealer-groups.test.ts -- this file is deliberately not re-testing its
 *  validation semantics, only that the order route is actually wired to it.
 *
 *  Minimal in-memory PostgREST double, copied down from dealer-groups.test.ts's
 *  FakeDb/FakeQuery rather than importing it, so this file doesn't reach into
 *  another suite's internals. */
type Row = Record<string, any>;
type Filter = { op: "eq" | "in"; column: string; value: any };

class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  private filters: Filter[] = [];
  constructor(private readonly rows: Row[]) {}
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push({ op: "eq", column, value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ op: "in", column, value }); return this; }
  order() { return this; }
  // Only ever called for audit_events, fire-and-forget: resolveOrderPartners audits a
  // rejection but nothing here asserts on it, so accepting anything is enough.
  insert() { return Promise.resolve({ data: null, error: null }); }
  private matching() {
    return this.rows.filter((row) => this.filters.every((filter) =>
      filter.op === "eq" ? row[filter.column] === filter.value : (filter.value as unknown[]).includes(row[filter.column])));
  }
  maybeSingle() { const found = this.matching(); return Promise.resolve({ data: found[0] ?? null, error: null }); }
  then<R1, R2>(onFulfilled?: ((value: { data: any; error: any }) => R1 | PromiseLike<R1>) | null, onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null) {
    return Promise.resolve({ data: this.matching(), error: null }).then(onFulfilled, onRejected);
  }
}

function fakeClient(tables: Record<string, Row[]>): SupabaseClient {
  return { from: (table: string) => new FakeQuery(tables[table] ?? []) } as unknown as SupabaseClient;
}

const ACTIVE = { activation_status: "ACTIVE", account_state: null, is_main_dealer: false };

function groupStore(tables: Record<string, Row[]>) {
  return new SupabaseDealerGroups(fakeClient(tables));
}

async function putValidDraft(app: ReturnType<typeof createCommerceApp>) {
  const response = await app.request("/api/drafts/current", {
    method: "PUT", headers: headers("a"),
    body: JSON.stringify({ offeringId: "offer-1", quantities: { "7": 4, "8": 2 } }),
  });
  expect(response.status).toBe(200);
}

describe("POST /api/orders/submit -- partner-function wiring", () => {
  it("submits with dealerGroups wired but the dealer ungrouped -- behaves exactly like v4", async () => {
    const dealerGroups = groupStore({
      dealers: [{ id: "dealer-a", organisation_id: "org-1", dealer_group_id: null, ...ACTIVE }],
    });
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA }), dealerGroups });
    await putValidDraft(app);

    const response = await app.request("/api/orders/submit", {
      method: "POST", headers: { ...headers("a"), "idempotency-key": "idem-solo" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }),
    });
    expect(response.status).toBe(201);
  });

  it("rejects a Bill-To dealer outside the ordering dealer's group with 403, never reaching the repository", async () => {
    const dealerGroups = groupStore({
      dealer_groups: [{ id: "grp-1", organisation_id: "org-1", status: "ACTIVE" }],
      dealers: [
        { id: "dealer-a", organisation_id: "org-1", dealer_group_id: "grp-1", ...ACTIVE },
        { id: "dealer-outsider", organisation_id: "org-1", dealer_group_id: "grp-2", ...ACTIVE },
      ],
    });
    const repo = repository();
    const app = createCommerceApp({ repository: repo, verifySession: verifier({ a: dealerA }), dealerGroups });
    await putValidDraft(app);

    const response = await app.request("/api/orders/submit", {
      method: "POST", headers: { ...headers("a"), "idempotency-key": "idem-outsider" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok", billToDealerId: "dealer-outsider" }),
    });
    expect(response.status).toBe(403);
    expect(await repo.getDraft(dealerA)).not.toEqual([]); // draft untouched -- nothing was submitted
  });

  it("never spends the OTP challenge when the partner selection is rejected -- a dealer who fixes their Bill-To can still use the same code", async () => {
    // Regression for a real bug: verifyOrderOtp used to run before resolveOrderPartners,
    // so a rejected Bill-To/Ship-To burned a valid, already-emailed OTP for nothing --
    // the dealer's only recourse was requesting a brand new code from scratch.
    const dealerGroups = groupStore({
      dealer_groups: [{ id: "grp-1", organisation_id: "org-1", status: "ACTIVE" }],
      dealers: [
        { id: "dealer-a", organisation_id: "org-1", dealer_group_id: "grp-1", ...ACTIVE },
        { id: "dealer-outsider", organisation_id: "org-1", dealer_group_id: "grp-2", ...ACTIVE },
      ],
    });
    const verifyOrderOtp = vi.fn(async () => undefined);
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA }), dealerGroups, verifyOrderOtp });
    await putValidDraft(app);

    const response = await app.request("/api/orders/submit", {
      method: "POST", headers: { ...headers("a"), "idempotency-key": "idem-outsider-otp" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpCode: "482901", billToDealerId: "dealer-outsider" }),
    });
    expect(response.status).toBe(403);
    expect(verifyOrderOtp).not.toHaveBeenCalled();
  });

  it("accepts a sibling in the same active group as Bill-To/Ship-To", async () => {
    const dealerGroups = groupStore({
      dealer_groups: [{ id: "grp-1", organisation_id: "org-1", status: "ACTIVE" }],
      dealers: [
        { id: "dealer-a", organisation_id: "org-1", dealer_group_id: "grp-1", ...ACTIVE },
        { id: "dealer-sibling", organisation_id: "org-1", dealer_group_id: "grp-1", ...ACTIVE },
      ],
    });
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA }), dealerGroups });
    await putValidDraft(app);

    const response = await app.request("/api/orders/submit", {
      method: "POST", headers: { ...headers("a"), "idempotency-key": "idem-sibling" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok", billToDealerId: "dealer-sibling", shipToDealerId: "dealer-sibling" }),
    });
    expect(response.status).toBe(201);
  });

  it("requires a requested delivery date when the preference is REQUESTED_DATE", async () => {
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA }) });
    await putValidDraft(app);

    const response = await app.request("/api/orders/submit", {
      method: "POST", headers: { ...headers("a"), "idempotency-key": "idem-date" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok", deliveryPreference: "REQUESTED_DATE" }),
    });
    expect(response.status).toBe(400);
  });

  it("defaults to ASAP delivery and submits fine with no dealerGroups store wired at all", async () => {
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA }) });
    await putValidDraft(app);

    const response = await app.request("/api/orders/submit", {
      method: "POST", headers: { ...headers("a"), "idempotency-key": "idem-no-store" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }),
    });
    expect(response.status).toBe(201);
  });
});
