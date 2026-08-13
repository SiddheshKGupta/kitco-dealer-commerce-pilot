import {
	detectImportProfile,
	findDuplicateSource,
	sha256Hex,
} from "../../src/imports/profile-detection";
import {
	dealerSourceFixture,
	doubleuSourceFixture,
	leeCooperSourceFixture,
	nikeSourceFixture,
	reebokSourceFixture,
} from "../fixtures/imports/sources";

describe("source profile detection and identity", () => {
	it("detects all five profiles from normalized source structure", () => {
		expect(detectImportProfile(dealerSourceFixture)).toBe("DEALER_MASTER_BIHAR");
		expect(detectImportProfile(nikeSourceFixture)).toBe("NIKE_ITEM_MASTER");
		expect(detectImportProfile(reebokSourceFixture)).toBe("REEBOK_BUY_FORM");
		expect(detectImportProfile(doubleuSourceFixture)).toBe("DOUBLEU_ITEM_MASTER");
		expect(detectImportProfile(leeCooperSourceFixture)).toBe("LEE_COOPER_SOH");
	});

	it("uses the raw byte SHA-256 as duplicate source identity", async () => {
		const bytes = new TextEncoder().encode("abc");
		const hash = await sha256Hex(bytes);

		expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		expect(
			await findDuplicateSource(bytes, [
				{ sourceId: "prior-source", sha256: hash },
				{ sourceId: "unrelated", sha256: "0".repeat(64) },
			]),
		).toEqual({ sourceId: "prior-source", sha256: hash });
	});
});

