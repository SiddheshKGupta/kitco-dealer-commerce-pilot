import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function temporaryDirectory() {
	const directory = mkdtempSync(join(tmpdir(), "kitco-import-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

describe("source fixture and seed scripts", () => {
	it("sanitizes dealer contacts deterministically while preserving shared-contact structure", () => {
		const directory = temporaryDirectory();
		const input = join(directory, "normalized.json");
		const output = join(directory, "fixture.json");
		writeFileSync(
			input,
			JSON.stringify({
				kind: "workbook",
				fileName: "private.xlsx",
				sha256: "a".repeat(64),
				sheets: [
					{
						name: "Sheet1",
						rows: [
							{ rowNumber: 1, cells: ["Dealer Name", "City", "Mobile", "Email", "GSTIN"] },
							{ rowNumber: 2, cells: ["Private One", "Patna", "PRIVATE-MOBILE", "secret@real.test", "GST-1"] },
							{ rowNumber: 3, cells: ["Private Two", "Gaya", "PRIVATE-MOBILE", "secret@real.test", "GST-2"] },
						],
					},
				],
			}),
		);

		execFileSync(process.execPath, [
			"scripts/build-source-fixtures.mjs",
			"--profile",
			"DEALER_MASTER_BIHAR",
			"--input",
			input,
			"--output",
			output,
		]);
		const fixture = JSON.parse(readFileSync(output, "utf8"));
		const serialized = JSON.stringify(fixture);

		expect(serialized).not.toContain("Private One");
		expect(serialized).not.toContain("PRIVATE-MOBILE");
		expect(serialized).not.toContain("secret@real.test");
		expect(serialized).not.toContain("GST-1");
		expect(fixture.sheets[0].rows[1].cells[0]).toBe("SANITIZED DEALER 001");
		expect(fixture.sheets[0].rows[1].cells[2]).toBe(fixture.sheets[0].rows[2].cells[2]);
		expect(fixture.sheets[0].rows[1].cells[3]).toBe("shared-email-001@example.invalid");
		expect(fixture.sha256).toMatch(/^[a-f0-9]{64}$/);
	});

	it("refuses unresolved conflicts and strips raw fields from prepared seed records", () => {
		const directory = temporaryDirectory();
		const input = join(directory, "parsed.json");
		const output = join(directory, "seed.json");
		writeFileSync(
			input,
			JSON.stringify({
				profile: "NIKE_ITEM_MASTER",
				conflicts: [{ code: "MASTER_VALUE_CONFLICT" }],
				articles: [],
			}),
		);

		expect(() =>
			execFileSync(process.execPath, [
				"scripts/prepare-seed.mjs",
				"--input",
				input,
				"--output",
				output,
			]),
		).toThrow(/Unresolved conflicts/);

		writeFileSync(
			input,
			JSON.stringify({
				profile: "REEBOK_BUY_FORM",
				conflicts: [],
				articles: [
					{
						articleNo: "RB-1",
						raw: { email: "must-not-seed@example.test" },
						sourceRows: [{ locator: "Sheet2!A2:L2", raw: { email: "also-private@example.test" } }],
					},
				],
			}),
		);
		execFileSync(process.execPath, [
			"scripts/prepare-seed.mjs",
			"--input",
			input,
			"--output",
			output,
		]);
		const seed = JSON.parse(readFileSync(output, "utf8"));
		const serialized = JSON.stringify(seed);

		expect(seed.records[0].sourceRows[0].locator).toBe("Sheet2!A2:L2");
		expect(serialized).not.toContain("must-not-seed");
		expect(serialized).not.toContain("also-private");
	});
});
