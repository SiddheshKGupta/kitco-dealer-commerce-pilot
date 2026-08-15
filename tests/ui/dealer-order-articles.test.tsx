import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DealerOrderArticles } from "../../src/features/reports/DealerFulfilmentStatus";
import { App } from "../../src/app/App";

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });

const allocations = [
	{ orderLineId: "line-1", size: "7", approvedPairs: 4, dispatchedPairs: 2, heldPairs: 0, articleNo: "NK-101", colour: "Black / Sail", familyName: "Air Runner", brand: "Northstar" },
	{ orderLineId: "line-1", size: "8", approvedPairs: 6, dispatchedPairs: 0, heldPairs: 1, articleNo: "NK-101", colour: "Black / Sail", familyName: "Air Runner", brand: "Northstar" },
	{ orderLineId: "line-2", size: "9", approvedPairs: 3, dispatchedPairs: 3, heldPairs: 0, articleNo: "NK-202", colour: "White", familyName: "Trail Glide", brand: "Northstar" },
];

describe("DealerOrderArticles", () => {
	it("groups allocations by article and shows size×pairs plus plain-language status per article", () => {
		render(<DealerOrderArticles allocations={allocations} />);
		const airRunner = screen.getByText("Northstar · Air Runner · NK-101").closest("article")!;
		expect(within(airRunner).getByText("Size 7 · 4 pairs")).toBeInTheDocument();
		expect(within(airRunner).getByText("Size 8 · 6 pairs")).toBeInTheDocument();
		expect(within(airRunner).getByText("Ordered 10 pairs")).toBeInTheDocument();
		expect(within(airRunner).getByText("Dispatched 2 pairs")).toBeInTheDocument();
		expect(within(airRunner).getByText("Pending 7 pairs")).toBeInTheDocument();
		expect(within(airRunner).getByText("Credit Hold 1 pair")).toBeInTheDocument();

		const trailGlide = screen.getByText("Northstar · Trail Glide · NK-202").closest("article")!;
		expect(within(trailGlide).getByText("Size 9 · 3 pairs")).toBeInTheDocument();
		expect(within(trailGlide).getByText("Pending 0 pairs")).toBeInTheDocument();

		expect(document.body.textContent).not.toMatch(/correlation|V1|V2|line-1|line-2/);
	});
});

describe("Dealer orders screen expansive view", () => {
	it("lets a dealer expand an order card to see per-article detail without a route change", async () => {
		window.history.replaceState({}, "", "/orders");
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
			orders: [{
				id: "order-1", orderNumber: "SO-1001", status: "APPROVED", version: 1, retailValueMinor: 40000,
				allocations,
			}],
		}), { status: 200 })));
		render(<App />);
		await screen.findByText("SO-1001");

		const toggle = screen.getByText("See the articles in this order");
		expect(within(toggle.closest("details")!).queryByText("Size 7 · 4 pairs")).not.toBeVisible();

		fireEvent.click(toggle);
		expect(await screen.findByText("Size 7 · 4 pairs")).toBeVisible();
		expect(screen.getByText("Northstar · Trail Glide · NK-202")).toBeInTheDocument();
		expect(window.location.pathname).toBe("/orders");
	});
});
