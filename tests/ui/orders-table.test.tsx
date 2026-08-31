import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrdersTable, type OrderTableRow } from "../../src/features/reports/OrdersTable";

const order: OrderTableRow = {
	id: "order-1", orderNumber: "KIT-2608-00001", status: "APPROVED", submittedAt: "2026-08-20T00:00:00Z", retailValueMinor: 40000,
	allocations: [{ orderLineId: "line-1", size: "7", orderedPairs: 6, approvedPairs: 4, dispatchedPairs: 2, heldPairs: 1, articleNo: "NK-101", familyName: "Air Max", brand: "Nike" }],
	dealerName: "Alpha Footwear", dealerCity: "Patna", dealerState: "Bihar",
};

function stubNarrow(matches: boolean) {
	vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
		matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
	})));
}

afterEach(() => vi.unstubAllGlobals());

describe("OrdersTable desktop (admin)", () => {
	it("shows a dense grouped-header table with the Requested/Confirmed/Shipped/Remaining breakdown and a Review action", () => {
		const onReview = vi.fn();
		render(<OrdersTable orders={[order]} variant="admin" onReview={onReview} />);
		expect(screen.getByRole("columnheader", { name: "Pairs" })).toBeInTheDocument();
		expect(screen.getByText("Alpha Footwear")).toBeInTheDocument();
		const row = screen.getByText("KIT-2608-00001").closest("tr")!;
		const cells = within(row).getAllByRole("cell");
		expect(cells[3]).toHaveTextContent("6"); // Requested
		expect(cells[4]).toHaveTextContent("4"); // Confirmed
		expect(cells[5]).toHaveTextContent("2"); // Shipped
		expect(cells[6]).toHaveTextContent("1"); // Remaining
		expect(within(row).getByText("⚑ 1 on hold")).toBeInTheDocument();

		fireEvent.click(within(row).getByRole("button", { name: "Review" }));
		expect(onReview).toHaveBeenCalledWith("order-1");
	});

	it("has no Dealer column for the dealer variant, and lets the order expand to see its articles", () => {
		render(<OrdersTable orders={[order]} variant="dealer" downloadHrefFor={(id) => `/api/orders/${id}/export-products.csv`} />);
		expect(screen.queryByText("Alpha Footwear")).not.toBeInTheDocument();
		expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/orders/order-1/export-products.csv");

		const toggle = screen.getByText("See the articles in this order");
		expect(within(toggle.closest("details")!).queryByText(/Air Max/)).not.toBeVisible();
		fireEvent.click(toggle);
		expect(screen.getByText(/Air Max/)).toBeVisible();
	});
});

describe("OrdersTable mobile", () => {
	it("renders a card list instead of a table below the breakpoint", () => {
		stubNarrow(true);
		render(<OrdersTable orders={[order]} variant="admin" onReview={vi.fn()} />);
		expect(screen.queryByRole("table")).not.toBeInTheDocument();
		expect(screen.getByText("KIT-2608-00001")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument();
	});
});
