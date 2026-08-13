import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminOrderPanel } from "../../src/features/admin/AdminOrderPanel";
import { DealerFulfilmentStatus } from "../../src/features/reports/DealerFulfilmentStatus";

const order = {
	id: "order-1", status: "SUBMITTED", allocations: [
		{ orderLineId: "order-1:offer-1", size: "7", approvedPairs: 6, dispatchedPairs: 0, heldPairs: 0 },
	], audit: [{ correlationId: "corr-submitted", action: "ORDER_SUBMITTED" }],
};

describe("KITCO Control order operations", () => {
	it("approves an order and records a partial dispatch through the admin API", async () => {
		const api = vi.fn(async () => ({ status: "FINALISED" }));
		render(<AdminOrderPanel order={order} api={api} />);
		fireEvent.click(screen.getByRole("button", { name: "Approve order" }));
		await screen.findByText("Order approved");
		expect(api).toHaveBeenCalledWith("/api/admin/orders/order-1/approve", {});
		fireEvent.change(screen.getByLabelText("Dispatch pairs"), { target: { value: "2" } });
		fireEvent.click(screen.getByRole("button", { name: "Record dispatch" }));
		await screen.findByText("Dispatch recorded");
		expect(api).toHaveBeenLastCalledWith("/api/admin/dispatches", expect.objectContaining({ pairs: 2, size: "7" }));
	});

	it("shows an over-dispatch rejection and captures a partial size Credit Hold", async () => {
		const api = vi.fn(async (path: string) => {
			if (path.includes("dispatches")) throw new Error("DISPATCH_EXCEEDS_PENDING");
			return { status: "ACTIVE" };
		});
		render(<AdminOrderPanel order={order} api={api} />);
		fireEvent.change(screen.getByLabelText("Dispatch pairs"), { target: { value: "9" } });
		fireEvent.click(screen.getByRole("button", { name: "Record dispatch" }));
		await screen.findByText("Dispatch exceeds the approved pending quantity.");
		fireEvent.change(screen.getByLabelText("Hold pairs"), { target: { value: "1" } });
		fireEvent.change(screen.getByLabelText("Hold reason"), { target: { value: "Credit review" } });
		fireEvent.click(screen.getByRole("button", { name: "Apply Credit Hold" }));
		await screen.findByText("Credit Hold applied");
		expect(api).toHaveBeenLastCalledWith("/api/admin/holds", expect.objectContaining({ pairs: 1, reason: "Credit review" }));
	});

	it("shows dealer Ordered, Dispatched, Pending, and hold quantities without availability data", () => {
		render(<DealerFulfilmentStatus order={{ ...order, allocations: [{ ...order.allocations[0], dispatchedPairs: 2, heldPairs: 1 }] }} />);
		expect(screen.getByText("Ordered 6 pairs")).toBeInTheDocument();
		expect(screen.getByText("Dispatched 2 pairs")).toBeInTheDocument();
		expect(screen.getByText("Pending 3 pairs")).toBeInTheDocument();
		expect(screen.getByText("Credit Hold 1 pair")).toBeInTheDocument();
		expect(screen.queryByText(/available/i)).not.toBeInTheDocument();
	});
});
