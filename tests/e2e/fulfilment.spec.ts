import { describe, expect, it } from "vitest";
import { createCommerceApp } from "../../worker/app";
import { summarizeFulfilment } from "../../src/features/dispatch/fulfilment";
import { admin, dealerA, headers, repository, verifier } from "../worker/fixtures";

describe("connected fulfilment smoke", () => {
	it("moves a dealer order through approval, partial hold, partial dispatch, and scoped status", async () => {
		const repo = repository();
		const app = createCommerceApp({ repository: repo, verifySession: verifier({ dealer: dealerA, admin }) });
		await app.request("/api/drafts/current", { method: "PUT", headers: headers("dealer"), body: JSON.stringify({ offeringId: "offer-1", quantities: { "7": 4 } }) });
		const submission = await app.request("/api/orders/submit", { method: "POST", headers: { ...headers("dealer", "corr-submit"), "idempotency-key": "fulfilment-flow" }, body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }) });
		const { order } = await submission.json() as { order: { id: string } };
		const line = `${order.id}:offer-1`;
		expect((await app.request(`/api/admin/orders/${order.id}/approve`, { method: "POST", headers: headers("admin", "corr-approve"), body: "{}" })).status).toBe(200);
		expect((await app.request("/api/admin/holds", { method: "POST", headers: headers("admin", "corr-hold"), body: JSON.stringify({ orderId: order.id, orderLineId: line, size: "7", pairs: 1, reason: "Credit review" }) })).status).toBe(201);
		expect((await app.request("/api/admin/dispatches", { method: "POST", headers: headers("admin", "corr-dispatch"), body: JSON.stringify({ orderId: order.id, orderLineId: line, size: "7", pairs: 2 }) })).status).toBe(201);
		const dealerOrder = await app.request(`/api/orders/${order.id}`, { headers: headers("dealer") });
		expect(dealerOrder.status).toBe(200);
		const { order: scoped } = await dealerOrder.json() as { order: { allocations: unknown[] } };
		expect(summarizeFulfilment(scoped.allocations as never)).toEqual({ orderedPairs: 4, approvedPairs: 4, dispatchedPairs: 2, heldPairs: 1, pendingPairs: 1 });
		expect(repo.auditEvents.map((event) => event.correlationId)).toEqual(expect.arrayContaining(["corr-approve", "corr-hold", "corr-dispatch"]));
	});
});
