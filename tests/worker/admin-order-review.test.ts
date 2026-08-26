import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { InMemoryCommerceRepository } from "../../worker/repository";
import { SupabaseCommerceRepository } from "../../worker/supabase-commerce-repository";
import { admin, dealerA, repository } from "./fixtures";

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

const orderReviewRow = {
  id: "order-1", organisation_id: "org-1", dealer_id: "dealer-a", status: "SUBMITTED", order_number: "KIT-2608-00001",
  bill_to_snapshot: { name: "VLCO Sports", gstin: "GST1", city: "Patna", state: "Bihar" },
  ship_to_snapshot: { name: "VLCO Sports", gstin: "GST1", city: "Patna", state: "Bihar" },
  ordering_dealer_snapshot: { name: "VLCO Sports", gstin: "GST1", city: "Patna", state: "Bihar" },
  dealer_po_number: "PO-42", delivery_preference: "ASAP", requested_delivery_date: null, estimated_delivery_date: null,
  order_versions: [{
    version_no: 1,
    order_lines: [{
      id: "line-1",
      product_colourways: { article_no: "NK-101", colour: "Black", product_families: { name: "Air Max", brands: { name: "Nike" } } },
      order_line_sizes: [{
        id: "size-1", size_values: { label: "7" },
        order_line_decisions: { ordered_qty: 6, approved_qty: 4, credit_review_qty: 2, rejected_qty: 0, pending_qty: 0, credit_review_reason: "Exposure limit", rejection_reason: null },
      }],
    }],
  }],
};

function client(from: ReturnType<typeof vi.fn>) {
  return { from, rpc: vi.fn(), auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: null } })) } } } as unknown as SupabaseClient;
}

describe("SupabaseCommerceRepository v5 order review", () => {
  it("reads order_line_decisions (not the legacy allocations pipeline) into articles/totals, self-scoped by organisation_id", async () => {
    const from = vi.fn((table: string) => {
      if (table === "orders") return chain({ data: orderReviewRow, error: null });
      if (table === "audit_events") return chain({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    const repo = new SupabaseCommerceRepository(client(from));

    const review = await repo.getOrderReview(admin, "order-1");

    expect(review?.totals).toEqual({ ordered: 6, approved: 4, creditReview: 2, rejected: 0, pending: 0 });
    expect(review?.articles).toEqual([{
      orderLineId: "line-1", articleNo: "NK-101", colour: "Black", familyName: "Air Max", brand: "Nike",
      sizes: [{ orderLineId: "line-1", size: "7", orderedQty: 6, approvedQty: 4, creditReviewQty: 2, rejectedQty: 0, pendingQty: 0, creditReviewReason: "Exposure limit", rejectionReason: null }],
    }]);
    expect(review?.billTo).toEqual({ name: "VLCO Sports", gstin: "GST1", city: "Patna", state: "Bihar", dealerId: undefined, code: undefined, addressLine1: undefined, pinCode: undefined });
    expect(review?.dealerPoNumber).toBe("PO-42");

    const orderQuery = from.mock.results.find((_call, index) => from.mock.calls[index]![0] === "orders")!.value as { eq: ReturnType<typeof vi.fn> };
    expect(orderQuery.eq).toHaveBeenCalledWith("organisation_id", "org-1");
  });

  it("rejects a non-admin session before ever querying the database", async () => {
    const from = vi.fn(() => { throw new Error("must not query for a non-admin session"); });
    const repo = new SupabaseCommerceRepository(client(from));
    await expect(repo.getOrderReview(dealerA, "order-1")).rejects.toThrow("Administrator access is required");
  });

  it("decideOrderLineV5 calls the v5 RPC with the caller's own organisation_id (never a client-supplied one) and reloads the review", async () => {
    const rpc = vi.fn(async () => ({ data: { order_id: "order-1" }, error: null }));
    const from = vi.fn((table: string) => {
      if (table === "orders") return chain({ data: orderReviewRow, error: null });
      if (table === "audit_events") return chain({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    const supabase = { from, rpc, auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: null } })) } } } as unknown as SupabaseClient;
    const repo = new SupabaseCommerceRepository(supabase);

    await repo.decideOrderLineV5(admin, {
      orderId: "order-1", orderLineId: "line-1", size: "7",
      approvedQty: 4, creditReviewQty: 2, rejectedQty: 0, creditReviewReason: "Exposure limit", rejectionReason: null,
    }, "corr-1");

    expect(rpc).toHaveBeenCalledWith("decide_kitco_order_line_v5", expect.objectContaining({
      p_organisation_id: "org-1", p_order_id: "order-1", p_order_line_id: "line-1", p_size_label: "7",
      p_approved_qty: 4, p_credit_review_qty: 2, p_rejected_qty: 0, p_credit_review_reason: "Exposure limit", p_correlation_id: "corr-1",
    }));
  });

  it("surfaces the RPC's specific 'credit review reason required' error rather than a generic failure", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "a credit review reason is required when placing pairs under credit review" } }));
    const supabase = { from: vi.fn(), rpc } as unknown as SupabaseClient;
    const repo = new SupabaseCommerceRepository(supabase);
    await expect(repo.decideOrderLineV5(admin, {
      orderId: "order-1", orderLineId: "line-1", size: "7", approvedQty: 0, creditReviewQty: 2, rejectedQty: 0, creditReviewReason: null, rejectionReason: null,
    }, "corr-1")).rejects.toThrow("A credit review reason is required when placing pairs under credit review.");
  });

  it("approveEntireOrder and rejectEntireOrder call their own atomic RPCs, not decide_kitco_order_line_v5 in a loop", async () => {
    const rpc = vi.fn(async () => ({ data: { order_id: "order-1" }, error: null }));
    const from = vi.fn((table: string) => {
      if (table === "orders") return chain({ data: orderReviewRow, error: null });
      if (table === "audit_events") return chain({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });
    const supabase = { from, rpc, auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: null } })) } } } as unknown as SupabaseClient;
    const repo = new SupabaseCommerceRepository(supabase);

    await repo.approveEntireOrder(admin, "order-1", "corr-2");
    expect(rpc).toHaveBeenCalledWith("approve_entire_kitco_order", expect.objectContaining({ p_organisation_id: "org-1", p_order_id: "order-1", p_correlation_id: "corr-2" }));

    await repo.rejectEntireOrder(admin, "order-1", "Dealer over credit limit", "corr-3");
    expect(rpc).toHaveBeenCalledWith("reject_entire_kitco_order", expect.objectContaining({ p_organisation_id: "org-1", p_order_id: "order-1", p_reason: "Dealer over credit limit", p_correlation_id: "corr-3" }));

    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("InMemoryCommerceRepository v5 order review (used by route-level tests elsewhere)", () => {
  it("starts every size fully pending, and a per-line decision reconciles ordered = approved + credit_review + rejected + pending", async () => {
    const repo = repository() as InMemoryCommerceRepository;
    await repo.saveDraft(dealerA, { offeringId: "offer-1", quantities: { "7": 6 }, retailValueMinor: 60000 }, "corr-draft");
    const { order } = await repo.submitOrder(dealerA, {
      idempotencyKey: "idem-1", otpChallengeId: "otp-order-a", otpDigest: "digest-ok", now: "2026-08-25T00:00:00Z", correlationId: "corr-submit",
      billToDealerId: "dealer-a", shipToDealerId: "dealer-a", shipToLocationId: null, dealerPoNumber: null, deliveryPreference: "ASAP", requestedDeliveryDate: null,
    });

    const initial = await repo.getOrderReview(admin, order.id);
    expect(initial?.totals).toEqual({ ordered: 6, approved: 0, creditReview: 0, rejected: 0, pending: 6 });

    const lineId = initial!.articles[0]!.orderLineId;
    const decided = await repo.decideOrderLineV5(admin, {
      orderId: order.id, orderLineId: lineId, size: "7", approvedQty: 4, creditReviewQty: 2, rejectedQty: 0,
      creditReviewReason: "Exposure limit", rejectionReason: null,
    }, "corr-decide");
    expect(decided.totals).toEqual({ ordered: 6, approved: 4, creditReview: 2, rejected: 0, pending: 0 });
    expect(decided.status).toBe("CREDIT_REVIEW");
  });

  it("approveEntireOrder approves only what's still pending, in one atomic call, leaving an existing credit review decision untouched", async () => {
    const repo = repository() as InMemoryCommerceRepository;
    await repo.saveDraft(dealerA, { offeringId: "offer-1", quantities: { "7": 6 }, retailValueMinor: 60000 }, "corr-draft");
    const { order } = await repo.submitOrder(dealerA, {
      idempotencyKey: "idem-2", otpChallengeId: "otp-order-a", otpDigest: "digest-ok", now: "2026-08-25T00:00:00Z", correlationId: "corr-submit-2",
      billToDealerId: "dealer-a", shipToDealerId: "dealer-a", shipToLocationId: null, dealerPoNumber: null, deliveryPreference: "ASAP", requestedDeliveryDate: null,
    });
    const initial = await repo.getOrderReview(admin, order.id);
    const lineId = initial!.articles[0]!.orderLineId;
    await repo.decideOrderLineV5(admin, { orderId: order.id, orderLineId: lineId, size: "7", approvedQty: 0, creditReviewQty: 2, rejectedQty: 0, creditReviewReason: "Exposure limit", rejectionReason: null }, "corr-decide");

    const approved = await repo.approveEntireOrder(admin, order.id, "corr-approve-all");
    expect(approved.totals).toEqual({ ordered: 6, approved: 4, creditReview: 2, rejected: 0, pending: 0 });
    expect(approved.status).toBe("CREDIT_REVIEW");
  });

  it("rejectEntireOrder requires a reason and rejects only the still-pending quantity", async () => {
    const repo = repository() as InMemoryCommerceRepository;
    await repo.saveDraft(dealerA, { offeringId: "offer-1", quantities: { "7": 6 }, retailValueMinor: 60000 }, "corr-draft");
    const { order } = await repo.submitOrder(dealerA, {
      idempotencyKey: "idem-3", otpChallengeId: "otp-order-a", otpDigest: "digest-ok", now: "2026-08-25T00:00:00Z", correlationId: "corr-submit-3",
      billToDealerId: "dealer-a", shipToDealerId: "dealer-a", shipToLocationId: null, dealerPoNumber: null, deliveryPreference: "ASAP", requestedDeliveryDate: null,
    });
    await expect(repo.rejectEntireOrder(admin, order.id, "", "corr-reject")).rejects.toThrow("A rejection reason is required.");

    const rejected = await repo.rejectEntireOrder(admin, order.id, "Dealer over credit limit", "corr-reject-2");
    expect(rejected.totals).toEqual({ ordered: 6, approved: 0, creditReview: 0, rejected: 6, pending: 0 });
    expect(rejected.status).toBe("REJECTED");
  });
});
