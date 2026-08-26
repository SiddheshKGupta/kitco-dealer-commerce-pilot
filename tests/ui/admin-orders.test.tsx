import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminOrderPanel } from "../../src/features/admin/AdminOrderPanel";
import { DealerFulfilmentStatus } from "../../src/features/reports/DealerFulfilmentStatus";

function reviewOrder(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: "order-1", orderNumber: "KIT-2608-00001", status: "SUBMITTED",
		orderingDealer: { name: "VLCO Sports", gstin: "GSTIN1", city: "Patna", state: "Bihar" },
		billTo: null, shipTo: null, dealerPoNumber: "PO-42", deliveryPreference: "ASAP", requestedDeliveryDate: null, estimatedDeliveryDate: null,
		articles: [{
			orderLineId: "line-1", articleNo: "NK-101", brand: "Nike", familyName: "Air Max", colour: "Black",
			sizes: [{ orderLineId: "line-1", size: "7", orderedQty: 6, approvedQty: 0, creditReviewQty: 0, rejectedQty: 0, pendingQty: 6, creditReviewReason: null, rejectionReason: null }],
		}],
		totals: { ordered: 6, approved: 0, creditReview: 0, rejected: 0, pending: 6 },
		audit: [{ correlationId: "corr-submitted", action: "Order submitted", detail: "Submitted as version 1", occurredAt: "2026-08-01T09:00:00.000Z", actorEmail: "dealer@example.com" }],
		...overrides,
	};
}

function stubLoad(order: ReturnType<typeof reviewOrder>) {
	vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ order }), { status: 200 })));
}

afterEach(() => vi.unstubAllGlobals());

describe("KITCO Control v5 order review", () => {
	it("renders one tile per article, collapsed by default", async () => {
		stubLoad(reviewOrder());
		const { container } = render(<AdminOrderPanel orderId="order-1" />);
		await screen.findByText("Order review · KIT-2608-00001");
		const details = container.querySelector("details.control-article") as HTMLDetailsElement;
		expect(details).toBeTruthy();
		expect(details.open).toBe(false);
	});

	it("expanding a tile reveals the per-size decision controls, and saves a decision via decide-v5", async () => {
		stubLoad(reviewOrder());
		const api = vi.fn(async () => ({
			order: reviewOrder({
				status: "PARTIALLY_APPROVED",
				totals: { ordered: 6, approved: 4, creditReview: 2, rejected: 0, pending: 0 },
				articles: [{
					orderLineId: "line-1", articleNo: "NK-101", brand: "Nike", familyName: "Air Max", colour: "Black",
					sizes: [{ orderLineId: "line-1", size: "7", orderedQty: 6, approvedQty: 4, creditReviewQty: 2, rejectedQty: 0, pendingQty: 0, creditReviewReason: "Exposure limit", rejectionReason: null }],
				}],
			}),
		}));
		render(<AdminOrderPanel orderId="order-1" api={api} />);
		await screen.findByText("Order review · KIT-2608-00001");

		fireEvent.change(screen.getByLabelText("Approve"), { target: { value: "4" } });
		fireEvent.change(screen.getByLabelText("Credit review"), { target: { value: "2" } });
		fireEvent.change(screen.getByLabelText("Credit review reason"), { target: { value: "Exposure limit" } });
		fireEvent.click(screen.getByRole("button", { name: "Save decision" }));

		await screen.findByText("Decision saved");
		expect(api).toHaveBeenCalledWith("/api/admin/orders/order-1/decide-v5", {
			orderLineId: "line-1", size: "7", approvedQty: 4, creditReviewQty: 2, rejectedQty: 0,
			creditReviewReason: "Exposure limit", rejectionReason: null,
		});
		expect(screen.getByText("Partially approved")).toBeInTheDocument();
	});

	it("blocks saving a decision that exceeds ordered pairs or is missing a required reason", async () => {
		stubLoad(reviewOrder());
		render(<AdminOrderPanel orderId="order-1" api={vi.fn()} />);
		await screen.findByText("Order review · KIT-2608-00001");

		fireEvent.change(screen.getByLabelText("Approve"), { target: { value: "5" } });
		fireEvent.change(screen.getByLabelText("Reject"), { target: { value: "3" } });
		expect(screen.getByText(/can't add up to more than the 6 pairs ordered/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Save decision" })).toBeDisabled();

		fireEvent.change(screen.getByLabelText("Approve"), { target: { value: "4" } });
		fireEvent.change(screen.getByLabelText("Reject"), { target: { value: "2" } });
		expect(screen.getByRole("button", { name: "Save decision" })).toBeDisabled(); // reject > 0 needs a reason
	});

	it("approves the entire order through the atomic approve-entire RPC, not a per-line loop", async () => {
		stubLoad(reviewOrder());
		const api = vi.fn(async () => ({ order: reviewOrder({ status: "APPROVED", totals: { ordered: 6, approved: 6, creditReview: 0, rejected: 0, pending: 0 } }) }));
		render(<AdminOrderPanel orderId="order-1" api={api} />);
		await screen.findByText("Order review · KIT-2608-00001");

		fireEvent.click(screen.getByRole("button", { name: "Approve entire order" }));
		await screen.findByText("Approved");
		expect(api).toHaveBeenCalledWith("/api/admin/orders/order-1/approve-entire", {});
		expect(api).toHaveBeenCalledTimes(1);
	});

	it("requires a reason before rejecting the entire order, then calls the atomic reject-entire RPC", async () => {
		stubLoad(reviewOrder());
		const api = vi.fn(async () => ({ order: reviewOrder({ status: "REJECTED", totals: { ordered: 6, approved: 0, creditReview: 0, rejected: 6, pending: 0 } }) }));
		render(<AdminOrderPanel orderId="order-1" api={api} />);
		await screen.findByText("Order review · KIT-2608-00001");

		fireEvent.click(screen.getByRole("button", { name: "Reject entire order" }));
		const confirmButton = screen.getByRole("button", { name: "Confirm reject" });
		expect(confirmButton).toBeDisabled();

		fireEvent.change(screen.getByLabelText("Reason for rejecting the entire order"), { target: { value: "Dealer over credit limit" } });
		fireEvent.click(confirmButton);
		await screen.findByText("Rejected");
		expect(api).toHaveBeenCalledWith("/api/admin/orders/order-1/reject-entire", { reason: "Dealer over credit limit" });
	});

	it("shows dealer Ordered, Dispatched, Pending, and hold quantities without availability data", () => {
		const order = {
			id: "order-1", status: "SUBMITTED", allocations: [
				{ orderLineId: "order-1:offer-1", size: "7", orderedPairs: 6, approvedPairs: 6, dispatchedPairs: 2, heldPairs: 1 },
			], audit: [],
		};
		render(<DealerFulfilmentStatus order={order} />);
		expect(screen.getByText("Ordered 6 pairs")).toBeInTheDocument();
		expect(screen.getByText("Dispatched 2 pairs")).toBeInTheDocument();
		expect(screen.getByText("Pending 3 pairs")).toBeInTheDocument();
		expect(screen.getByText("On hold 1 pair")).toBeInTheDocument();
		expect(screen.queryByText(/available/i)).not.toBeInTheDocument();
	});
});
