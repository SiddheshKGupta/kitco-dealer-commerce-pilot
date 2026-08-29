import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../worker/middleware/errors";
import { SupabaseCommerceRepository } from "../../worker/supabase-commerce-repository";
import { admin } from "./fixtures";

const order = {
  id: "order-1", orderNumber: "KIT-2608-00001", organisationId: "org-1", dealerId: "dealer-a", status: "APPROVED" as const,
  versions: [{ version: 1, status: "SUBMITTED" as const, retailValueMinor: 40000, lines: [] }], allocations: [],
};

describe("production admin persistence", () => {
  it("approves through the atomic server function and reloads the canonical order", async () => {
    const rpc = vi.fn(async () => ({ data: { order_id: "order-1" }, error: null }));
    const repo = new SupabaseCommerceRepository({ rpc } as unknown as SupabaseClient);
    vi.spyOn(repo, "findOrder").mockResolvedValue(order);

    await expect(repo.approveOrder(admin, "order-1", "corr-approve")).resolves.toEqual(order);
    expect(rpc).toHaveBeenCalledWith("approve_kitco_order", expect.objectContaining({
      p_organisation_id: "org-1", p_actor_auth_user_id: "admin-1", p_order_id: "order-1", p_correlation_id: "corr-approve",
    }));
  });

  it("persists scoped partial holds and dispatches through atomic server functions", async () => {
    const rpc = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const repo = new SupabaseCommerceRepository({ rpc } as unknown as SupabaseClient);
    vi.spyOn(repo, "findOrder").mockResolvedValue(order);

    await repo.applyHold(admin, { orderId: "order-1", orderLineId: "line-1", size: "7", pairs: 2, reason: "Credit review" }, "corr-hold");
    await repo.createDispatch(admin, { orderId: "order-1", orderLineId: "line-1", size: "7", pairs: 1, dealerLocationId: "location-1" }, "corr-dispatch");

    expect(rpc).toHaveBeenNthCalledWith(1, "apply_kitco_credit_hold", expect.objectContaining({ p_pairs: 2, p_reason: "Credit review", p_size_label: "7" }));
    expect(rpc).toHaveBeenNthCalledWith(2, "create_kitco_dispatch", expect.objectContaining({ p_pairs: 1, p_dealer_location_id: "location-1", p_size_label: "7" }));
  });

  describe("fulfilment RPC error mapping", () => {
    // The RPCs (supabase/migrations/20260813184500_admin_fulfilment_rpc.sql,
    // 20260815120000_partial_order_line_decisions.sql) raise real, specific Postgres error
    // text for these cases -- fail() maps them to a specific ApiError code+message instead of
    // one generic "operation could not be completed" for every failure.
    const cases: Array<[string, string, string]> = [
      ["dispatch exceeds available pending quantity for this size", "DISPATCH_EXCEEDS_PENDING", "This dispatch would exceed the pairs still pending for this size."],
      ["hold exceeds available pending quantity for this size", "HOLD_EXCEEDS_PENDING", "This hold would exceed the pairs still pending for this size."],
      ["dealer location required when more than one active Ship-To exists", "SHIP_TO_REQUIRED", "This dealer has more than one active Ship-To location -- choose one before dispatching."],
      ["approved plus held pairs cannot exceed the 6 ordered", "DECISION_EXCEEDS_ORDERED", "Approved plus held pairs can't exceed what the dealer ordered for this size."],
      ["approved pairs cannot drop below the 2 pairs already dispatched", "APPROVED_BELOW_DISPATCHED", "Approved pairs can't drop below what's already been dispatched for this size."],
      ["order decisions are closed for status REJECTED", "ORDER_DECISIONS_CLOSED", "This order can no longer be decided."],
      ["a valid hold reason is required when holding pairs", "HOLD_REASON_REQUIRED", "A hold reason is required when holding pairs."],
    ];

    it.each(cases)("maps %j to code %j with a specific message", async (pgMessage, expectedCode, expectedMessage) => {
      const rpc = vi.fn(async () => ({ data: null, error: { message: pgMessage } }));
      const repo = new SupabaseCommerceRepository({ rpc } as unknown as SupabaseClient);

      await expect(repo.createDispatch(admin, { orderId: "order-1", orderLineId: "line-1", size: "7", pairs: 1 }, "corr-x"))
        .rejects.toMatchObject({ code: expectedCode, message: expectedMessage, status: 422 });
    });

    it("falls back to a generic error when the RPC failure doesn't match a known pattern", async () => {
      const rpc = vi.fn(async () => ({ data: null, error: { message: "connection reset by peer" } }));
      const repo = new SupabaseCommerceRepository({ rpc } as unknown as SupabaseClient);

      await expect(repo.createDispatch(admin, { orderId: "order-1", orderLineId: "line-1", size: "7", pairs: 1 }, "corr-x"))
        .rejects.toMatchObject({ code: "DISPATCH_FAILED", status: 409 });
    });

    it("is a real ApiError instance carrying the mapped status", async () => {
      const rpc = vi.fn(async () => ({ data: null, error: { message: "dispatch exceeds available pending quantity" } }));
      const repo = new SupabaseCommerceRepository({ rpc } as unknown as SupabaseClient);

      await expect(repo.createDispatch(admin, { orderId: "order-1", orderLineId: "line-1", size: "7", pairs: 1 }, "corr-x")).rejects.toBeInstanceOf(ApiError);
    });
  });
});
