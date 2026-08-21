import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function option(name) {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function stripRaw(value) {
	if (Array.isArray(value)) return value.map(stripRaw);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => key !== "raw")
			.map(([key, nested]) => [key, stripRaw(nested)]),
	);
}

const inputPath = option("input");
const outputPath = option("output");
if (!inputPath || !outputPath) {
	throw new Error("Usage: prepare-seed.mjs --input <parsed.json> --output <seed.json>");
}

const parsed = JSON.parse(await readFile(resolve(inputPath), "utf8"));
const records = parsed.dealers ?? parsed.articles ?? parsed.stockLines ?? [];
const conflicts = parsed.conflicts ?? [];
const conflictedArticleNumbers = new Set(
	conflicts
		.map((conflict) => conflict.articleNo)
		.filter((articleNo) => typeof articleNo === "string" && articleNo.length > 0),
);
if (conflicts.length > 0 && (parsed.profile !== "NIKE_ITEM_MASTER" || conflictedArticleNumbers.size === 0)) {
	throw new Error(`Unresolved conflicts prevent seed preparation for ${parsed.profile}`);
}
const canonicalRecords = records.filter((record) => !conflictedArticleNumbers.has(record.articleNo));
const quarantinedRecords = records
	.filter((record) => conflictedArticleNumbers.has(record.articleNo))
	.map((record) => ({
		...record,
		status: "CONFLICT",
		conflicts: conflicts.filter((conflict) => conflict.articleNo === record.articleNo),
	}));
const seed = {
	profile: parsed.profile,
	sourceRowCount: parsed.sourceRowCount ?? records.length,
	canonicalRecordCount: canonicalRecords.length,
	quarantinedRecordCount: quarantinedRecords.length,
	records: stripRaw(canonicalRecords),
	quarantinedRecords: stripRaw(quarantinedRecords),
	warnings: stripRaw(parsed.warnings ?? []),
};
await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(resolve(outputPath), `${JSON.stringify(seed, null, 2)}\n`, "utf8");
