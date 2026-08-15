import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SizeChartSheet } from "../../src/components/SizeChartSheet";
import { DealerOrderJourney } from "../../src/features/orders/DealerOrderJourney";

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

describe("SizeChartSheet", () => {
	it("shows a static Men's US/UK/EU/CM table by default and switches to Women's on tab click", () => {
		render(<SizeChartSheet open onClose={() => undefined} />);
		expect(screen.getByRole("dialog", { name: "Shoe Size Chart" })).toBeInTheDocument();
		expect(screen.getByRole("tab", { name: "Men's" })).toHaveAttribute("aria-selected", "true");
		const usRow = (name: string) => screen.getAllByRole("row").find((row) => within(row).queryAllByRole("cell")[0]?.textContent === name)!;
		const menRow = usRow("7");
		expect(menRow.textContent).toContain("6.5");
		expect(menRow.textContent).toContain("40");

		fireEvent.click(screen.getByRole("tab", { name: "Women's" }));
		expect(screen.getByRole("tab", { name: "Women's" })).toHaveAttribute("aria-selected", "true");
		const womenRow = usRow("7");
		expect(womenRow.textContent).toContain("4.5");
	});

	it("renders nothing when closed", () => {
		render(<SizeChartSheet open={false} onClose={() => undefined} />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});
});

describe("Shoe Size Chart access from the PDP", () => {
	const product = { colourwayId: "cw-1", articleNo: "NK-101", brand: "Northstar", colour: "Black / Sail", mrpMinor: 10000, currencyCode: "INR", mediaUrl: "/api/media/nk.webp", availability: "AVAILABLE_TO_ORDER" as const, offering: { id: "offer-1", enabledSizes: ["7", "8"], moqPairs: 4, orderMultiplePairs: 2, type: "STOCK_IN_HAND" as const } };

	it("opens the size chart from the size grid without leaving the product page", () => {
		render(<DealerOrderJourney product={product} />);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Not sure of your size? See the size chart" }));
		expect(screen.getByRole("dialog", { name: "Shoe Size Chart" })).toBeInTheDocument();
	});
});
