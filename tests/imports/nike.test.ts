import { parseNikeItemMaster } from "../../src/imports/nike";
import { nikeSourceFixture } from "../fixtures/imports/sources";

describe("Nike item-master profile", () => {
	it("segments three repeated headers and groups 480 rows into 463 articles", () => {
		const result = parseNikeItemMaster(nikeSourceFixture);

		expect(result.sourceRowCount).toBe(480);
		expect(result.articles).toHaveLength(463);
		expect(result.repeatedSourceArticleCount).toBe(17);
		expect(result.headerRegions).toEqual([
			{
				locator: "Sheet1!A2:AA2",
				sizes: ["5", "6", "7", "8", "9", "10", "11", "12", "13"],
			},
			{
				locator: "Sheet1!A306:Y306",
				sizes: ["5.5", "6.5", "7.5", "8.5", "9.5", "10.5", "11.5"],
			},
			{ locator: "Sheet1!A433:U433", sizes: ["S", "M", "L"] },
		]);
	});

	it("reports the two observed master conflicts with exact values and source rows", () => {
		const result = parseNikeItemMaster(nikeSourceFixture);

		expect(result.conflicts).toEqual([
			{
				code: "MASTER_VALUE_CONFLICT",
				articleNo: "IO2091-103",
				field: "category",
				values: [
					{ value: "JORDAN BRAND", locator: "Sheet1!A297:AA297" },
					{ value: "JORDAN LEGACY", locator: "Sheet1!A298:AA298" },
				],
			},
			{
				code: "MASTER_VALUE_CONFLICT",
				articleNo: "SX7667-906",
				field: "uom",
				values: [
					{ value: "PAIRS", locator: "Sheet1!A443:U443" },
					{ value: "PCS", locator: "Sheet1!A444:U444" },
				],
			},
		]);
		expect(result.articles.find((article) => article.articleNo === "IO2091-103")).toMatchObject({
			sourceRows: [{ locator: "Sheet1!A297:AA297" }, { locator: "Sheet1!A298:AA298" }],
			offerings: [{ season: "FA2026" }, { season: "SU2026" }],
		});
	});
});

