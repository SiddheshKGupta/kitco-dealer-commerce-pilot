import { parseDoubleuItemMaster } from "../../src/imports/doubleu";
import { doubleuSourceFixture } from "../fixtures/imports/sources";

describe("DOUBLEU item-master profile", () => {
	it("groups the authoritative Sheet1's 159 size rows into 29 articles", () => {
		const result = parseDoubleuItemMaster(doubleuSourceFixture);

		expect(result.sourceRowCount).toBe(159);
		expect(result.articles).toHaveLength(29);
		expect(result.configuredSizeSet).toEqual(["36", "37", "38", "39", "40", "41", "42", "43", "44"]);
		expect(result.articles[0]).toMatchObject({
			articleNo: "DW-1",
			gender: "WOMEN",
			rawGenderValues: ["WOMEN "],
			sizes: ["36", "37", "38", "39", "40", "41"],
		});
		expect(result.articles[0].sizeSources[0]).toMatchObject({
			sourceValue: 36,
			locator: "Sheet1!A3:S3",
		});
		expect(result.articles[1]).toMatchObject({
			gender: "MEN",
			rawGenderValues: ["Men "],
		});
	});
});

