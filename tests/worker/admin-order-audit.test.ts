import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseCommerceRepository } from "../../worker/supabase-commerce-repository";
import { admin, dealerA } from "./fixtures";

function chain(result: unknown) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "not", "order", "limit", "in", "is"]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn(async () => result);
  query.single = vi.fn(async () => result);
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}

const orderRow = {
  id: "order-1", organisation_id: "org-1", dealer_id: "dealer-a", status: "PARTIALLY_APPROVED",
  order_number: "KIT-2608-00001", submitted_at: "2026-08-01T09:00:00Z",
  dealers: { name: "VLCO Sports", city: "Patna", state: "Bihar" },
  order_versions: [{
    version_no: 1, version_status: "SUBMITTED", retail_value_minor: 40000,
    order_lines: [{
      id: "order-1:offer-1", commercial_offering_id: "offer-1", mrp_minor: 10000, approved_quantity_pairs: 4,
      product_colourways: { article_no: "NK-101", colour: "Black", product_families: { name: "Air Max", brands: { name: "Nike" } } },
      order_line_sizes: [{ ordered_quantity_pairs: 4, approved_quantity_pairs: 3, size_values: { label: "7" }, dispatch_lines: [], hold_allocations: [] }],
    }],
  }],
};

const auditRows = [
  {
    event_type: "ORDER_SUBMITTED", entity_id: "order-1", correlation_id: "corr-submit",
    evidence: { version: 1 }, occurred_at: "2026-08-01T09:00:00Z", actor_auth_user_id: "user-dealer",
  },
  {
    event_type: "ORDER_LINE_DECIDED", entity_id: "line-size-1", correlation_id: "corr-decide",
    evidence: { order_id: "order-1", approved_pairs: 3, held_pairs: 1, size: "7", hold_reason: "STOCK_REVIEW" },
    occurred_at: "2026-08-02T09:00:00Z", actor_auth_user_id: "user-admin",
  },
];

function client(from: ReturnType<typeof vi.fn>) {
  const getUserById = vi.fn(async (id: string) => ({
    data: { user: id === "user-admin" ? { email: "admin@example.com" } : id === "user-dealer" ? { email: "dealer@example.com" } : null },
  }));
  return { from, auth: { admin: { getUserById } } } as unknown as SupabaseClient;
}

describe("SupabaseCommerceRepository order audit", () => {
  it("populates OrderRecord.audit with humanized actions, plain-language detail, and resolved actor emails", async () => {
    const from = vi.fn((table: string) => {
      if (table === "orders") return chain({ data: orderRow, error: null });
      if (table === "audit_events") return chain({ data: auditRows, error: null });
      throw new Error(`unexpected table ${table}`);
    });
    const repo = new SupabaseCommerceRepository(client(from));

    const order = await repo.findOrder(admin, "order-1");

    expect(order?.audit).toEqual([
      { correlationId: "corr-submit", action: "Order submitted", detail: "Submitted as version 1", occurredAt: "2026-08-01T09:00:00Z", actorEmail: "dealer@example.com" },
      { correlationId: "corr-decide", action: "Order line decided", detail: "Approved 3, held 1 of size 7 (Stock review)", occurredAt: "2026-08-02T09:00:00Z", actorEmail: "admin@example.com" },
    ]);

    const auditQuery = from.mock.results.find((call, index) => from.mock.calls[index]![0] === "audit_events")!.value as { or: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn> };
    expect(auditQuery.eq).toHaveBeenCalledWith("organisation_id", "org-1");
    expect(auditQuery.or).toHaveBeenCalledWith("entity_id.in.(order-1),evidence->>order_id.in.(order-1)");
  });

  it("batch-resolves audit for every order in one query when listing orders, instead of one lookup per order", async () => {
    const secondOrderRow = { ...orderRow, id: "order-2" };
    const from = vi.fn((table: string) => {
      if (table === "orders") return chain({ data: [orderRow, secondOrderRow], error: null });
      if (table === "audit_events") return chain({ data: auditRows, error: null });
      throw new Error(`unexpected table ${table}`);
    });
    const repo = new SupabaseCommerceRepository(client(from));

    const orders = await repo.listOrders(admin);

    const auditCalls = from.mock.calls.filter(([table]) => table === "audit_events");
    expect(auditCalls).toHaveLength(1);
    const auditQuery = from.mock.results.find((call, index) => from.mock.calls[index]![0] === "audit_events")!.value as { or: ReturnType<typeof vi.fn> };
    expect(auditQuery.or).toHaveBeenCalledWith("entity_id.in.(order-1,order-2),evidence->>order_id.in.(order-1,order-2)");
    expect(orders[0]!.audit).toHaveLength(2);
    expect(orders[1]!.audit).toEqual([]);
  });

  it("falls back to (unknown) when an actor has no resolvable email, and omits an empty detail line", async () => {
    const from = vi.fn((table: string) => {
      if (table === "orders") return chain({ data: orderRow, error: null });
      if (table === "audit_events") return chain({
        data: [{ event_type: "SOME_FUTURE_EVENT", entity_id: "order-1", correlation_id: "corr-x", evidence: {}, occurred_at: "2026-08-03T00:00:00Z", actor_auth_user_id: "user-ghost" }],
        error: null,
      });
      throw new Error(`unexpected table ${table}`);
    });
    const repo = new SupabaseCommerceRepository(client(from));

    const order = await repo.findOrder(admin, "order-1");

    expect(order?.audit).toEqual([
      { correlationId: "corr-x", action: "Some future event", detail: "", occurredAt: "2026-08-03T00:00:00Z", actorEmail: "(unknown)" },
    ]);
  });

  it("never attaches the audit trail for a dealer session -- findOrder/listOrders are shared with the dealer-facing routes, which forward the whole record", async () => {
    const dealerOrderRow = { ...orderRow, dealer_id: dealerA.dealerId };
    const from = vi.fn((table: string) => {
      if (table === "orders") return chain({ data: dealerOrderRow, error: null });
      if (table === "audit_events") throw new Error("audit_events must not be queried for a dealer session");
      throw new Error(`unexpected table ${table}`);
    });
    const repo = new SupabaseCommerceRepository(client(from));

    const order = await repo.findOrder(dealerA, "order-1");

    expect(order?.audit).toBeUndefined();
    expect(from).not.toHaveBeenCalledWith("audit_events");
  });
});
