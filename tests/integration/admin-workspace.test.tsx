import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AdminWorkspace } from "../../src/features/admin/AdminWorkspace";

describe("AdminWorkspace composition seam", () => {
	it("composes the control ledger and dealer-safe fulfilment readout from one order", () => {
		render(<AdminWorkspace order={{
			id: "order-1", status: "APPROVED",
			allocations: [{ orderLineId: "order-1:offer-1", size: "8", approvedPairs: 6, dispatchedPairs: 2, heldPairs: 1 }],
			audit: [{ correlationId: "corr-approve", action: "Order approved", detail: "Order approved for fulfilment", occurredAt: "2026-08-01T09:00:00.000Z", actorEmail: "admin@example.com" }],
		}} />);

		expect(screen.getByRole("main")).toHaveTextContent("Order review");
		expect(screen.getByLabelText("Order fulfilment")).toHaveTextContent("Pending 3 pairs");
		expect(screen.getByText("Order approved")).toBeInTheDocument();
		expect(screen.getByText("Order approved for fulfilment")).toBeInTheDocument();
	});
});
