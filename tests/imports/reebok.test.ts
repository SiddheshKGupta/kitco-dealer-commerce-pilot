import { parseReebokBuyForm } from "../../src/imports/reebok";
import { reebokSourceFixture } from "../fixtures/imports/sources";

describe("Reebok buy-form profile", () => {
	it("keeps the 85 article families deterministic without fabricating enrichment", () => {
		const result = parseReebokBuyForm(reebokSourceFixture);

		expect(result.sourceRowCount).toBe(85);
		expect(result.articles).toHaveLength(85);
		expect(result.articles[0]).toMatchObject({
			articleNo: "RB-1",
			familyKey: "REEBOK:RB-1",
			productName: null,
			category: null,
			season: null,
			sizes: ["7"],
			sourceRows: [{ locator: "Sheet2!A2:L2" }],
		});
		expect(result.articles.every((article) => article.status === "NEEDS_ENRICHMENT")).toBe(true);
		expect(result.conflicts).toEqual([]);
	});
});

