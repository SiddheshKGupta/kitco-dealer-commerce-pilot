import { describe, expect, it } from "vitest";
import { summarizeFulfilment, type FulfilmentAllocation } from "../../src/features/dispatch/fulfilment";

describe("summarizeFulfilment", () => {
	it("reports approvedPairs distinctly from orderedPairs once a partial decision has been made", () => {
		const allocations: FulfilmentAllocation[] = [
			{ orderLineId: "line-1", size: "8", orderedPairs: 10, approvedPairs: 7, dispatchedPairs: 0, heldPairs: 3 },
		];
		const summary = summarizeFulfilment(allocations);
		expect(summary.orderedPairs).toBe(10);
		expect(summary.approvedPairs).toBe(7);
		expect(summary.heldPairs).toBe(3);
	});
});
