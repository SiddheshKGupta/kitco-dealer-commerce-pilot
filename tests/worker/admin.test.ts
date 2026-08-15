import { describe, expect, it } from "vitest";
import { createCommerceApp } from "../../worker/app";
import { admin, dealerA, headers, repository, verifier } from "./fixtures";

describe("admin order routes", () => {
  it("approves, appends an immutable revision, holds by size, and dispatches only available pairs", async () => {
    const repo = repository();
    const app = createCommerceApp({ repository: repo, verifySession: verifier({ a: dealerA, admin }) });
    await app.request("/api/drafts/current", {
      method: "PUT", headers: headers("a"),
      body: JSON.stringify({ offeringId: "offer-1", quantities: { "7": 4 } }),
    });
    const submitted = await app.request("/api/orders/submit", {
      method: "POST", headers: { ...headers("a"), "idempotency-key": "idem-admin" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }),
    });
    const { order } = await submitted.json() as { order: { id: string } };

    expect((await app.request(`/api/admin/orders/${order.id}/approve`, {
      method: "POST", headers: headers("admin"), body: JSON.stringify({}),
    })).status).toBe(200);
    expect((await app.request(`/api/admin/orders/${order.id}/revisions`, {
      method: "POST", headers: headers("admin"),
      body: JSON.stringify({ lines: [{ offeringId: "offer-1", quantities: { "7": 2, "8": 2 } }] }),
    })).status).toBe(201);

    const afterRevision = await repo.findOrder(admin, order.id);
    expect(afterRevision?.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(afterRevision?.versions[0]?.lines[0]?.quantities).toEqual({ "7": 4 });

    expect((await app.request("/api/admin/holds", {
      method: "POST", headers: headers("admin", "corr-hold"),
      body: JSON.stringify({ orderId: order.id, orderLineId: `${order.id}:offer-1`, size: "7", pairs: 1, reason: "Credit" }),
    })).status).toBe(201);
    expect((await app.request("/api/admin/dispatches", {
      method: "POST", headers: headers("admin", "corr-dispatch"),
      body: JSON.stringify({ orderId: order.id, orderLineId: `${order.id}:offer-1`, size: "7", pairs: 1 }),
    })).status).toBe(201);
    const exceeds = await app.request("/api/admin/dispatches", {
      method: "POST", headers: headers("admin"),
      body: JSON.stringify({ orderId: order.id, orderLineId: `${order.id}:offer-1`, size: "7", pairs: 2 }),
    });
    expect(exceeds.status).toBe(422);
    expect(repo.auditEvents.map((event) => event.correlationId)).toEqual(expect.arrayContaining(["corr-hold", "corr-dispatch"]));
  });

  it("decides a line+size atomically, moving the order to PARTIALLY_APPROVED and reflecting the exact split", async () => {
    const repo = repository();
    const app = createCommerceApp({ repository: repo, verifySession: verifier({ a: dealerA, admin }) });
    await app.request("/api/drafts/current", { method: "PUT", headers: headers("a"), body: JSON.stringify({ offeringId: "offer-1", quantities: { "7": 4 } }) });
    const submitted = await app.request("/api/orders/submit", { method: "POST", headers: { ...headers("a"), "idempotency-key": "idem-decide" }, body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }) });
    const { order } = await submitted.json() as { order: { id: string; allocations: Array<{ orderLineId: string }> } };
    const orderLineId = order.allocations[0]!.orderLineId;

    const decision = await app.request(`/api/admin/orders/${order.id}/decide`, {
      method: "POST", headers: headers("admin", "corr-decide"),
      body: JSON.stringify({ orderLineId, size: "7", approvedPairs: 3, heldPairs: 1, holdReason: "STOCK_REVIEW" }),
    });
    expect(decision.status).toBe(200);
    const { order: decided } = await decision.json() as { order: { status: string; allocations: Array<{ approvedPairs: number; heldPairs: number; holdReason?: string }> } };
    expect(decided.status).toBe("PARTIALLY_APPROVED");
    expect(decided.allocations[0]).toMatchObject({ approvedPairs: 3, heldPairs: 1, holdReason: "STOCK_REVIEW" });
    expect(repo.auditEvents.map((event) => event.correlationId)).toContain("corr-decide");

    const rejected = await app.request(`/api/admin/orders/${order.id}/decide`, {
      method: "POST", headers: headers("admin"),
      body: JSON.stringify({ orderLineId, size: "7", approvedPairs: 4, heldPairs: 1, holdReason: "OTHER" }),
    });
    expect(rejected.status).toBe(422);
  });

  it("denies dealer access to admin operations", async () => {
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA }) });
    const response = await app.request("/api/admin/imports", {
      method: "POST", headers: headers("a"), body: JSON.stringify({ sourceFileId: "source-1", profileId: "nike" }),
    });
    expect(response.status).toBe(403);
  });

  it("exposes the organisation-scoped admin queue and order detail", async () => {
    const repo = repository();
    const app = createCommerceApp({ repository: repo, verifySession: verifier({ a: dealerA, admin }) });
    await app.request("/api/drafts/current", { method: "PUT", headers: headers("a"), body: JSON.stringify({ offeringId: "offer-1", quantities: { "7": 4 } }) });
    const submitted = await app.request("/api/orders/submit", { method: "POST", headers: { ...headers("a"), "idempotency-key": "admin-list" }, body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }) });
    const orderId = ((await submitted.json()) as { order: { id: string } }).order.id;
    const queue = await app.request("/api/admin/orders", { headers: headers("admin") });
    expect(queue.status).toBe(200);
    await expect(queue.json()).resolves.toMatchObject({ orders: [{ id: orderId, dealerId: "dealer-a" }] });
    const detail = await app.request(`/api/admin/orders/${orderId}`, { headers: headers("admin") });
    await expect(detail.json()).resolves.toMatchObject({ order: { id: orderId } });
  });
});
