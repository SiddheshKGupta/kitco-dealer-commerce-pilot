import { parseDealerMaster } from "../../src/imports/dealers";
import { dealerSourceFixture } from "../fixtures/imports/sources";

describe("Bihar replacement dealer profile", () => {
	it("stages all 135 replacement dealers without rejecting empty or shared contacts", () => {
		const result = parseDealerMaster(dealerSourceFixture);

		expect(result.profile).toBe("DEALER_MASTER_BIHAR");
		expect(result.sourceRowCount).toBe(135);
		expect(result.dealers).toHaveLength(135);
		expect(result.conflicts).toEqual([]);
		expect(result.dealers[0]).toMatchObject({
			dealerName: "SANITIZED DEALER 001",
			city: "Patna",
			email: "shared@example.invalid",
			source: {
				fileName: "sanitized-bihar-dealers.xlsx",
				sha256: "1".repeat(64),
				locator: "Sheet1!A2:H2",
			},
		});
		expect(result.dealers[0].raw.mobile).toBeNull();
		expect(result.dealers[1].email).toBe("shared@example.invalid");
		expect(result.warnings.map((warning) => warning.code)).toContain("SHARED_CONTACT");
		expect(result.warnings.map((warning) => warning.code)).toContain("MISSING_CONTACT");
	});
});

