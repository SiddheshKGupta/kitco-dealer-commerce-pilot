import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminOrderPanel } from "../../src/features/admin/AdminOrderPanel";
import { DealerFulfilmentStatus } from "../../src/features/reports/DealerFulfilmentStatus";

const order = {
	id: "order-1", status: "SUBMITTED", allocations: [
		{ orderLineId: "order-1:offer-1", size: "7", orderedPairs: 6, approvedPairs: 6, dispatchedPairs: 0, heldPairs: 0 },
	], audit: [{ correlationId: "corr-submitted", action: "Order submitted", detail: "Submitted as version 1", occurredAt: "2026-08-01T09:00:00.000Z", actorEmail: "dealer@example.com" }],
};

afterEach(() => vi.unstubAllGlobals());

describe("KITCO Control order operations", () => {
	it("extracts the API's error message correctly through the real defaultApi (not the whole {code,message} object stringified to [object Object])", async () => {
		vi.stubGlobal("fetch", vi.fn(async () =>
			new Response(JSON.stringify({ error: { code: "DISPATCH_EXCEEDS_PENDING", message: "This dispatch would exceed the pairs still pending for this size." } }), { status: 422 })));
		render(<AdminOrderPanel order={order} />);
		fireEvent.change(screen.getByLabelText("Dispatch pairs"), { target: { value: "9" } });
		fireEvent.click(screen.getByRole("button", { name: "Record dispatch" }));
		await screen.findByText("This dispatch would exceed the pairs still pending for this size.");
		expect(screen.queryByText("[object Object]")).not.toBeInTheDocument();
	});

	it("saves a per-size approve/hold decision and records a dispatch through the admin API", async () => {
		const api = vi.fn(async (path: string) => {
			if (path.includes("decide")) return { order: { status: "PARTIALLY_APPROVED", allocations: [{ ...order.allocations[0], approvedPairs: 4, heldPairs: 2, holdReason: "STOCK_REVIEW" }] } };
			return { status: "FINALISED" };
		});
		render(<AdminOrderPanel order={order} api={api} />);

		fireEvent.change(screen.getByLabelText("Approve pairs"), { target: { value: "4" } });
		fireEvent.change(screen.getByLabelText("Hold pairs"), { target: { value: "2" } });
		fireEvent.change(screen.getByLabelText("Hold reason"), { target: { value: "STOCK_REVIEW" } });
		fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
		await screen.findByText("Decision saved");
		expect(api).toHaveBeenCalledWith("/api/admin/orders/order-1/decide", { orderLineId: "order-1:offer-1", size: "7", approvedPairs: 4, heldPairs: 2, holdReason: "STOCK_REVIEW" });
		expect(screen.getByText("Partially approved")).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Dispatch pairs"), { target: { value: "2" } });
		fireEvent.click(screen.getByRole("button", { name: "Record dispatch" }));
		await screen.findByText("Dispatch recorded");
		expect(api).toHaveBeenLastCalledWith("/api/admin/dispatches", expect.objectContaining({ pairs: 2, size: "7", orderLineId: "order-1:offer-1" }));
	});

	it("updates the tile summary and order-total table live from the dispatch response, instead of staying stale until a reload", async () => {
		const api = vi.fn(async (path: string) => {
			if (path.includes("dispatches")) return { status: "FINALISED", order: { status: "APPROVED", allocations: [{ ...order.allocations[0], dispatchedPairs: 2 }] } };
			throw new Error(`unexpected path ${path}`);
		});
		render(<AdminOrderPanel order={order} api={api} />);
		expect(screen.getByText("0 dispatched · 0 on hold · 6 pending")).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText("Dispatch pairs"), { target: { value: "2" } });
		fireEvent.click(screen.getByRole("button", { name: "Record dispatch" }));
		await screen.findByText("Dispatch recorded");

		expect(screen.getByText("2 dispatched · 0 on hold · 4 pending")).toBeInTheDocument();
		expect(screen.getByLabelText("Dispatch pairs")).toHaveValue(null);
	});

	it("blocks saving a decision that exceeds ordered pairs or is missing a hold reason", () => {
		render(<AdminOrderPanel order={order} api={vi.fn()} />);
		fireEvent.change(screen.getByLabelText("Approve pairs"), { target: { value: "5" } });
		fireEvent.change(screen.getByLabelText("Hold pairs"), { target: { value: "3" } });
		expect(screen.getByText(/can't add up to more than the 6 pairs ordered/)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Save decision" })).toBeDisabled();

		fireEvent.change(screen.getByLabelText("Approve pairs"), { target: { value: "4" } });
		fireEvent.change(screen.getByLabelText("Hold pairs"), { target: { value: "2" } });
		expect(screen.getByRole("button", { name: "Save decision" })).toBeDisabled();
	});

	it("surfaces the API's specific error message instead of a generic one for both a decision and a dispatch failure", async () => {
		// The API always throws with the server's real, specific message here (this is what
		// AdminOrderPanel's defaultApi actually extracts from {error: {code, message}} in
		// production -- see the regression test below for that extraction itself).
		const api = vi.fn(async (path: string) => {
			if (path.includes("decide")) throw new Error("Approved plus held pairs can't exceed what the dealer ordered for this size.");
			throw new Error("This dispatch would exceed the pairs still pending for this size.");
		});
		render(<AdminOrderPanel order={order} api={api} />);
		fireEvent.change(screen.getByLabelText("Approve pairs"), { target: { value: "6" } });
		fireEvent.click(screen.getByRole("button", { name: "Save decision" }));
		await screen.findByText("Approved plus held pairs can't exceed what the dealer ordered for this size.");

		fireEvent.change(screen.getByLabelText("Dispatch pairs"), { target: { value: "9" } });
		fireEvent.click(screen.getByRole("button", { name: "Record dispatch" }));
		await screen.findByText("This dispatch would exceed the pairs still pending for this size.");
	});

	it("targets the decision and dispatch at the right line+size on a multi-line order", async () => {
		const multiLineOrder = {
			id: "order-2", status: "SUBMITTED",
			allocations: [
				{ orderLineId: "order-2:offer-1", size: "7", orderedPairs: 6, approvedPairs: 6, dispatchedPairs: 0, heldPairs: 0 },
				{ orderLineId: "order-2:offer-2", size: "9", orderedPairs: 4, approvedPairs: 4, dispatchedPairs: 0, heldPairs: 0 },
			],
			audit: [],
		};
		const api = vi.fn(async () => ({ status: "FINALISED" }));
		render(<AdminOrderPanel order={multiLineOrder} api={api} />);
		const dispatchInputs = screen.getAllByLabelText("Dispatch pairs");
		fireEvent.change(dispatchInputs[1]!, { target: { value: "2" } });
		fireEvent.click(screen.getAllByRole("button", { name: "Record dispatch" })[1]!);
		await screen.findByText("Dispatch recorded");
		expect(api).toHaveBeenLastCalledWith("/api/admin/dispatches", expect.objectContaining({ orderLineId: "order-2:offer-2", size: "9", pairs: 2 }));
	});

	it("shows dealer Ordered, Dispatched, Pending, and hold quantities without availability data", () => {
		render(<DealerFulfilmentStatus order={{ ...order, allocations: [{ ...order.allocations[0], dispatchedPairs: 2, heldPairs: 1 }] }} />);
		expect(screen.getByText("Ordered 6 pairs")).toBeInTheDocument();
		expect(screen.getByText("Dispatched 2 pairs")).toBeInTheDocument();
		expect(screen.getByText("Pending 3 pairs")).toBeInTheDocument();
		expect(screen.getByText("On hold 1 pair")).toBeInTheDocument();
		expect(screen.queryByText(/available/i)).not.toBeInTheDocument();
	});
});
