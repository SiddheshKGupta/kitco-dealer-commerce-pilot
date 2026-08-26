import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const sourceRoot = "D:/KITCO B2B data";
const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory() {
	const directory = mkdtempSync(join(tmpdir(), "kitco-media-manifest-"));
	temporaryDirectories.push(directory);
	return directory;
}

describe("prepare-media", () => {
	it("preserves the approved KITCO logo byte-for-byte", () => {
		const bytes = readFileSync("public/brand/kitco-sports.png");
		expect(createHash("sha256").update(bytes).digest("hex")).toBe("520d16f6ea692e3ee182e613048360f216c0e1590250ed3f5f78eb0d65e79fbe");
	});

	it("maps all 90 exact Nike articles at their supplied 1600px square dimensions", () => {
		const directory = temporaryDirectory();
		const output = join(directory, "media-manifest.json");
		execFileSync(process.execPath, [
			"scripts/prepare-media.mjs", "--nike-dir", `${sourceRoot}/NIKE`, "--nike-workbook", `${sourceRoot}/Nike Item master File.xlsx`, "--output", output,
		]);
		const manifest = JSON.parse(readFileSync(output, "utf8"));

		expect(manifest.media).toHaveLength(90);
		for (const item of manifest.media) {
			expect(item.articleNo).toMatch(/^[A-Z0-9]+-\d{3}$/);
			expect(item.source).toMatchObject({ mimeType: "image/jpeg", width: 1600, height: 1600 });
			expect(item.variants.map((variant: { width: number }) => variant.width)).toEqual([200, 600, 900, 1400]);
			expect(item.source.key).toBe(`media/nike/${item.articleNo}/source.jpg`);
			expect(item.variants.every((variant: { key: string }) => variant.key.startsWith(`media/nike/${item.articleNo}/`))).toBe(true);
		}
		expect(new Set(manifest.media.map((item: { articleNo: string }) => item.articleNo)).size).toBe(90);
		expect(manifest.media.find((item: { articleNo: string }) => item.articleNo === "IH2380-300")?.source.fileName).toBe("IH2380-300.jpg");
	});
});
