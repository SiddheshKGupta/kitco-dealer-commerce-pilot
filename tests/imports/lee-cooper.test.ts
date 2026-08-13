import { parseLeeCooperSoh } from "../../src/imports/lee-cooper";
import { leeCooperSourceFixture } from "../fixtures/imports/sources";

describe("Lee Cooper SOH profile", () => {
	it("inherits continuation identity and excludes the 1,732-pair grand total row", () => {
		const result = parseLeeCooperSoh(leeCooperSourceFixture);

		expect(result.stockLines).toHaveLength(3);
		expect(result.stockLines[1]).toMatchObject({
			articleNo: "LC-SAN-001",
			category: "SHOE LACEUP",
			colour: "BROWN",
			gender: "MEN",
			totalPairs: 700,
			source: {
				locator: "page:1#line:4",
				raw: {
					lineText: "\t\tBROWN\t\t2999\t100\t100\t100\t100\t100\t100\t100\t700",
				},
			},
		});
		expect(result.totalPairs).toBe(1_732);
		expect(result.declaredGrandTotalPairs).toBe(1_732);
		expect(result.offerings).toEqual([{ kind: "STOCK_IN_HAND", numericalAvailability: "INTERNAL_ONLY" }]);
		expect(result.conflicts).toEqual([]);
	});
});
