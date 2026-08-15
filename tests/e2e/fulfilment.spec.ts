import { describe, expect, it } from "vitest";
import { createCommerceApp } from "../../worker/app";
import { groupByArticle, summarizeFulfilment } from "../../src/features/dispatch/fulfilment";
import { admin, dealerA, headers, repository, verifier } from "../worker/fixtures";

describe("connected fulfilment smoke", () => {
	it("submits an order, partially approves+holds one size in a single decision, and the dealer sees the exact split", async () => {
		const repo = repository();
		const app = createCommerceApp({ repository: repo, verifySession: verifier({ dealer: dealerA, admin }) });
		await app.request("/api/drafts/current", { method: "PUT", headers: headers("dealer"), body: JSON.stringify({ offeringId: "offer-1", quantities: { "7": 4 } }) });
		const submission = await app.request("/api/orders/submit", { method: "POST", headers: { ...headers("dealer", "corr-submit"), "idempotency-key": "fulfilment-decision" }, body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }) });
		const { order } = await submission.json() as { order: { id: string; allocations: Array<{ orderLineId: string }> } };
		const orderLineId = order.allocations[0]!.orderLineId;

		const decision = await app.request(`/api/admin/orders/${order.id}/decide`, { method: "POST", headers: headers("admin", "corr-decide"), body: JSON.stringify({ orderLineId, size: "7", approvedPairs: 3, heldPairs: 1, holdReason: "CREDIT_HOLD" }) });
		expect(decision.status).toBe(200);
		const { order: decided } = await decision.json() as { order: { status: string } };
		expect(decided.status).toBe("PARTIALLY_APPROVED");

		const dealerOrder = await app.request(`/api/orders/${order.id}`, { headers: headers("dealer") });
		expect(dealerOrder.status).toBe(200);
		const { order: scoped } = await dealerOrder.json() as { order: { status: string; allocations: unknown[] } };
		expect(scoped.status).toBe("PARTIALLY_APPROVED");
		expect(summarizeFulfilment(scoped.allocations as never)).toEqual({ orderedPairs: 4, dispatchedPairs: 0, heldPairs: 1, pendingPairs: 2 });
		const [[, sizeRows]] = groupByArticle(scoped.allocations as never);
		expect(sizeRows).toEqual([expect.objectContaining({ orderedPairs: 4, approvedPairs: 3, heldPairs: 1, holdReason: "CREDIT_HOLD" })]);
		expect(repo.auditEvents.map((event) => event.correlationId)).toContain("corr-decide");
	});

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
		expect(summarizeFulfilment(scoped.allocations as never)).toEqual({ orderedPairs: 4, dispatchedPairs: 2, heldPairs: 1, pendingPairs: 1 });
		expect(repo.auditEvents.map((event) => event.correlationId)).toEqual(expect.arrayContaining(["corr-approve", "corr-hold", "corr-dispatch"]));
	});
});
