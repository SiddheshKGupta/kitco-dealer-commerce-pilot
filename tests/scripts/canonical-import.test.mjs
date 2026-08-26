import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const sourceRoot = "D:/KITCO B2B data";
const temporaryDirectories = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(prefix) {
	const directory = mkdtempSync(join(tmpdir(), prefix));
	temporaryDirectories.push(directory);
	return directory;
}

describe("canonical source ingestion utility", () => {
	it("parses the supplied XLSX and PDF files into the verified canonical counts", () => {
		const directory = temporaryDirectory("kitco-canonical-import-");
		const output = join(directory, "canonical.json");
		execFileSync(process.execPath, [
			"scripts/build-canonical-import.mjs",
			"--source-root", sourceRoot,
			"--output", output,
		]);
		const result = JSON.parse(readFileSync(output, "utf8"));
		const imports = Object.fromEntries(result.imports.map((item) => [item.profile, item]));

		expect(imports.DEALER_MASTER_BIHAR).toMatchObject({ sourceRowCount: 135, canonicalRecordCount: 136 });
		expect(imports.DEALER_MASTER_BIHAR.dealers).toHaveLength(136);
		expect(imports.DEALER_MASTER_BIHAR.dealers.at(-1)).toMatchObject({ dealerName: "VLCO", pilotEmailEnv: "VLCO_TEST_EMAIL" });

		expect(imports.NIKE_ITEM_MASTER).toMatchObject({ sourceRowCount: 480, canonicalRecordCount: 461, quarantinedRecordCount: 2 });
		expect(imports.NIKE_ITEM_MASTER.articles).toHaveLength(461);
		expect(imports.NIKE_ITEM_MASTER.quarantinedRecords.map((item) => item.articleNo).sort()).toEqual(["IO2091-103", "SX7667-906"]);

		expect(imports.REEBOK_BUY_FORM).toMatchObject({ sourceRowCount: 85, canonicalRecordCount: 85, publishableRecordCount: 0 });
		expect(imports.REEBOK_BUY_FORM.articles).toHaveLength(85);
		expect(imports.REEBOK_BUY_FORM.articles.every((item) => item.status === "NEEDS_ENRICHMENT")).toBe(true);

		expect(imports.DOUBLEU_ITEM_MASTER).toMatchObject({ sourceRowCount: 159, canonicalRecordCount: 29 });
		expect(imports.LEE_COOPER_SOH).toMatchObject({ canonicalRecordCount: 66, totalPairs: 1732 });
		expect(imports.LEE_COOPER_SOH.stockLines).toHaveLength(66);
	}, 20_000);

	it("keeps R2 object keys relative for the repository-scoped media contract", () => {
		const directory = temporaryDirectory("kitco-r2-contract-");
		const mediaManifest = join(directory, "media.json");
		const importManifest = join(directory, "imports.json");
		writeFileSync(mediaManifest, JSON.stringify({ media: [{ articleNo: "NK-1", source: { fileName: "NK-1.jpg", key: "media/nike/NK-1/source.jpg" }, variants: [{ key: "media/nike/NK-1/600.webp" }] }] }));
		writeFileSync(importManifest, JSON.stringify({ imports: [{ fileName: "source.xlsx", sha256: "a".repeat(64) }] }));

		const output = execFileSync(process.execPath, [
			"scripts/upload-r2.mjs",
			"--bucket", "private",
			"--media-manifest", mediaManifest,
			"--source-dir", directory,
			"--variants-dir", directory,
			"--import-manifest", importManifest,
			"--raw-source-root", directory,
		], { encoding: "utf8" });
		const dryRun = JSON.parse(output);
		expect(dryRun.uploads.map((item) => item.key)).toEqual([
			"raw/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/source.xlsx",
			"media/nike/NK-1/source.jpg",
			"media/nike/NK-1/600.webp",
		]);
	});
});
