import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const sourceRoot = "C:/Users/Siddhesh/Downloads";
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory() {
	const directory = mkdtempSync(join(tmpdir(), "kitco-source-manifest-"));
	temporaryDirectories.push(directory);
	return directory;
}

describe("import-sources", () => {
	it("writes a safe deterministic manifest for all five source profiles", () => {
		const directory = temporaryDirectory();
		const output = join(directory, "import-manifest.json");
		execFileSync(process.execPath, ["scripts/import-sources.mjs", "--source-root", sourceRoot, "--output", output]);
		const manifest = JSON.parse(readFileSync(output, "utf8"));

		expect(manifest.imports).toHaveLength(5);
		expect(manifest.imports.map((item: { profile: string }) => item.profile)).toEqual([
			"DEALER_MASTER_BIHAR",
			"NIKE_ITEM_MASTER",
			"REEBOK_BUY_FORM",
			"DOUBLEU_ITEM_MASTER",
			"LEE_COOPER_SOH",
		]);
		expect(manifest.imports[0]).toMatchObject({ sourceRowCount: 135, seed: { syntheticDealer: { dealerName: "VLCO", pilotEmailEnv: "VLCO_TEST_EMAIL" } } });
		expect(manifest.imports[1]).toMatchObject({ sourceRowCount: 480, canonicalRecordCount: 463, repeatedSourceArticleCount: 17 });
		expect(manifest.imports[1].conflicts).toEqual(expect.arrayContaining([
			expect.objectContaining({ articleNo: "IO2091-103", field: "category" }),
			expect.objectContaining({ articleNo: "SX7667-906", field: "uom" }),
		]));
		expect(manifest.imports[3]).toMatchObject({ sourceRowCount: 159, canonicalRecordCount: 29 });
		expect(manifest.imports[4]).toMatchObject({ totalPairs: 1732 });
		expect(JSON.stringify(manifest)).not.toMatch(/@|GSTIN|MOBILE|ADDRESS/i);
	});
});
