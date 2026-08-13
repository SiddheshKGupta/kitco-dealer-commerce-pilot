import { describe, expect, it } from "vitest";
import { createCommerceApp } from "../../worker/app";
import { dealerA, dealerB, headers, repository, verifier } from "./fixtures";

async function putValidDraft(app: ReturnType<typeof createCommerceApp>) {
  const response = await app.request("/api/drafts/current", {
    method: "PUT",
    headers: headers("a"),
    body: JSON.stringify({ offeringId: "offer-1", quantities: { "7": 4, "8": 2 } }),
  });
  expect(response.status).toBe(200);
}

describe("dealer order routes", () => {
  it("recalculates Retail Value and makes OTP submission idempotent", async () => {
    const repo = repository();
    const app = createCommerceApp({ repository: repo, verifySession: verifier({ a: dealerA }) });
    await putValidDraft(app);
    const request = () => app.request("/api/orders/submit", {
      method: "POST",
      headers: { ...headers("a", "corr-submit"), "idempotency-key": "idem-1" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }),
    });
    const first = await request();
    const second = await request();
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const created = await first.json() as { order: { id: string; dealerId: string; version: number; retailValueMinor: number } };
    const replay = await second.json() as { order: { id: string } };
    expect(created.order).toMatchObject({ dealerId: "dealer-a", version: 1, retailValueMinor: 60000 });
    expect(replay.order.id).toBe(created.order.id);
    expect(repo.auditEvents.map((event) => event.correlationId)).toContain("corr-submit");
  });

  it("isolates dealer orders even when another dealer guesses the order ID", async () => {
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA, b: dealerB }) });
    await putValidDraft(app);
    const submit = await app.request("/api/orders/submit", {
      method: "POST", headers: { ...headers("a"), "idempotency-key": "idem-2" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }),
    });
    const { order } = await submit.json() as { order: { id: string } };
    const forbidden = await app.request(`/api/orders/${order.id}`, { headers: headers("b") });
    expect(forbidden.status).toBe(404);
  });

  it("creates a scoped cancellation request without accepting payload dealer scope", async () => {
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA }) });
    await putValidDraft(app);
    const submit = await app.request("/api/orders/submit", {
      method: "POST", headers: { ...headers("a"), "idempotency-key": "idem-3" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }),
    });
    const { order } = await submit.json() as { order: { id: string } };
    const response = await app.request(`/api/orders/${order.id}/cancellations`, {
      method: "POST", headers: headers("a"), body: JSON.stringify({ reason: "Shop closed", dealerId: "dealer-b" }),
    });
    expect(response.status).toBe(400);
  });

  it("lists only the current dealer's orders and server-scoped locations", async () => {
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA, b: dealerB }) });
    await putValidDraft(app);
    await app.request("/api/orders/submit", {
      method: "POST", headers: { ...headers("a"), "idempotency-key": "idem-list" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }),
    });
    const orders = await app.request("/api/orders", { headers: headers("a") });
    expect(orders.status).toBe(200);
    await expect(orders.json()).resolves.toMatchObject({ orders: [{ dealerId: "dealer-a", version: 1 }] });
    const locations = await app.request("/api/dealer/locations", { headers: headers("a") });
    await expect(locations.json()).resolves.toMatchObject({ locations: [{ name: "Main location", locationType: "BOTH" }] });
  });
});
