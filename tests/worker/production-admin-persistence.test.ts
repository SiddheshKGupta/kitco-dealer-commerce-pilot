import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
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

    await repo.applyHold(admin, { orderId: "order-1", orderLineId: "line-1", size: "7", pairs: 2, reason: "Credit review" }, "corr-hold");
    await repo.createDispatch(admin, { orderId: "order-1", orderLineId: "line-1", size: "7", pairs: 1, dealerLocationId: "location-1" }, "corr-dispatch");

    expect(rpc).toHaveBeenNthCalledWith(1, "apply_kitco_credit_hold", expect.objectContaining({ p_pairs: 2, p_reason: "Credit review", p_size_label: "7" }));
    expect(rpc).toHaveBeenNthCalledWith(2, "create_kitco_dispatch", expect.objectContaining({ p_pairs: 1, p_dealer_location_id: "location-1", p_size_label: "7" }));
  });

  it("decides a line+size through the atomic decision function and reloads the canonical order", async () => {
    const rpc = vi.fn(async () => ({ data: { order_status: "PARTIALLY_APPROVED" }, error: null }));
    const repo = new SupabaseCommerceRepository({ rpc } as unknown as SupabaseClient);
    vi.spyOn(repo, "findOrder").mockResolvedValue(order);

    await expect(repo.decideOrderLine(admin, { orderId: "order-1", orderLineId: "line-1", size: "7", approvedPairs: 4, heldPairs: 2, holdReason: "STOCK_REVIEW" }, "corr-decide")).resolves.toEqual(order);
    expect(rpc).toHaveBeenCalledWith("decide_kitco_order_line", expect.objectContaining({
      p_organisation_id: "org-1", p_order_id: "order-1", p_order_line_id: "line-1", p_size_label: "7",
      p_approved_pairs: 4, p_held_pairs: 2, p_hold_reason: "STOCK_REVIEW", p_correlation_id: "corr-decide",
    }));
  });
});
