import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseDealerMaster } from "../src/imports/dealers";
import { parseDoubleuItemMaster } from "../src/imports/doubleu";
import { parseLeeCooperSoh } from "../src/imports/lee-cooper";
import { parseNikeItemMaster } from "../src/imports/nike";
import { parseReebokBuyForm } from "../src/imports/reebok";
import { readLeeCooperPdf, readXlsxWorkbook } from "./adapters/source-files.mjs";

function option(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index < 0 ? undefined : process.argv[index + 1];
}

function stripRaw(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripRaw);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "raw").map(([key, nested]) => [key, stripRaw(nested)]));
}

async function main() {
	const sourceRoot = option("source-root");
	const output = option("output");
	if (!sourceRoot || !output) throw new Error("Usage: build-canonical-import.mjs --source-root <directory> --output <canonical.json>");

	const dealers = parseDealerMaster(await readXlsxWorkbook(resolve(sourceRoot, "Bihar Dealer List new.xlsx")));
	const nike = parseNikeItemMaster(await readXlsxWorkbook(resolve(sourceRoot, "Nike Item master File.xlsx")));
	const reebok = parseReebokBuyForm(await readXlsxWorkbook(resolve(sourceRoot, "REEBOK BUY FORM.xlsx")));
	const doubleu = parseDoubleuItemMaster(await readXlsxWorkbook(resolve(sourceRoot, "DOUBLUE_ITEM _MASTER _FILE.xlsx")));
	const leeCooper = parseLeeCooperSoh(await readLeeCooperPdf(resolve(sourceRoot, "Lee Cooper 68 pcs Sample Warehouse Stock sheet.pdf")));

	const conflictedNike = new Set(nike.conflicts.map((conflict) => conflict.articleNo).filter((value): value is string => Boolean(value)));
	const canonicalNikeArticles = nike.articles.filter((article) => !conflictedNike.has(article.articleNo));
	const quarantinedNikeArticles = nike.articles
		.filter((article) => conflictedNike.has(article.articleNo))
		.map((article) => ({ ...article, status: "CONFLICT", conflicts: nike.conflicts.filter((conflict) => conflict.articleNo === article.articleNo) }));
	const dealerRecords = [
		...dealers.dealers,
		{ dealerName: "VLCO", state: "Bihar", city: "Patna", location: "VLCO Main", pilotEmailEnv: "VLCO_TEST_EMAIL", pilotEmailSource: "SELF_DECLARED_PILOT", synthetic: true },
	];
	const imports = [
		{ ...dealers, dealers: dealerRecords, canonicalRecordCount: dealerRecords.length },
		{
			...nike,
			articles: canonicalNikeArticles,
			canonicalRecordCount: canonicalNikeArticles.length,
			quarantinedRecordCount: quarantinedNikeArticles.length,
			quarantinedRecords: quarantinedNikeArticles,
		},
		{ ...reebok, canonicalRecordCount: reebok.articles.length, publishableRecordCount: 0 },
		{ ...doubleu, canonicalRecordCount: doubleu.articles.length },
		{ ...leeCooper, canonicalRecordCount: leeCooper.stockLines.length },
	];
	const payload = { schemaVersion: 1, generatedAt: new Date().toISOString(), imports: stripRaw(imports) };
	await mkdir(dirname(resolve(output)), { recursive: true });
	await writeFile(resolve(output), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

await main();
