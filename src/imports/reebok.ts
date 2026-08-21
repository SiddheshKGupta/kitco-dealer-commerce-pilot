import {
	asNumber,
	asString,
	findHeaderRow,
	headerIndexes,
	moneyMinor,
	normalizeGender,
	sourceRowReference,
	valueAt,
} from "./normalize";
import type {
	ImportConflict,
	ImportStatus,
	ImportWarning,
	SourceRowReference,
	WorkbookSource,
} from "./types";

export interface ReebokArticle {
	articleNo: string;
	familyKey: string;
	brand: string;
	productName: null;
	category: null;
	season: null;
	colour: string | null;
	gender: string | null;
	mrpMinor: number | null;
	sizes: string[];
	status: ImportStatus;
	sourceRows: SourceRowReference[];
}

export function parseReebokBuyForm(source: WorkbookSource): {
	profile: "REEBOK_BUY_FORM";
	sourceRowCount: number;
	articles: ReebokArticle[];
	warnings: ImportWarning[];
	conflicts: ImportConflict[];
} {
	const sheet = source.sheets.find((candidate) =>
		findHeaderRow(candidate.rows, ["Article No", "MRP", "Colour", "Grand Total"]),
	);
	if (!sheet) throw new Error("Reebok buy-form header was not found");
	const header = findHeaderRow(sheet.rows, ["Article No", "MRP", "Colour", "Grand Total"]);
	if (!header) throw new Error("Reebok buy-form header was not found");
	const indexes = headerIndexes(header.cells);
	const rows = sheet.rows.filter(
		(row) => row.rowNumber > header.rowNumber && asString(valueAt(row, indexes, "Article No")),
	);
	const articles = rows.map((row): ReebokArticle => {
		const articleNo = asString(valueAt(row, indexes, "Article No")) as string;
		const brand = asString(valueAt(row, indexes, "Brand")) ?? "REEBOK";
		const sizes = ["7", "8", "9", "10", "11", "12"].filter(
			(size) => (asNumber(valueAt(row, indexes, size)) ?? 0) > 0,
		);
		return {
			articleNo,
			familyKey: `${brand}:${articleNo}`,
			brand,
			productName: null,
			category: null,
			season: null,
			colour: asString(valueAt(row, indexes, "Colour")),
			gender: normalizeGender(valueAt(row, indexes, "Gender")),
			mrpMinor: moneyMinor(valueAt(row, indexes, "MRP")),
			sizes,
			status: "NEEDS_ENRICHMENT",
			sourceRows: [sourceRowReference(source, sheet.name, header.cells, row)],
		};
	});

	return {
		profile: "REEBOK_BUY_FORM",
		sourceRowCount: rows.length,
		articles,
		warnings: articles.map((article) => ({
			code: "NULL_ENRICHMENT_FIELDS",
			message: `${article.articleNo} retains null product name, category, and season.`,
			locator: article.sourceRows[0].locator,
		})),
		conflicts: [],
	};
}

