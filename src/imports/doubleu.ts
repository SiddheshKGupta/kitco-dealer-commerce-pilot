import {
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
	ImportWarning,
	SourceRowReference,
	WorkbookSource,
} from "./types";

interface DoubleuSizeRow {
	articleNo: string;
	brand: string;
	productName: string | null;
	category: string | null;
	season: string | null;
	colour: string | null;
	rawGender: string | null;
	gender: string | null;
	mrpMinor: number | null;
	sourceSize: string;
	source: SourceRowReference;
}

export interface DoubleuArticle {
	articleNo: string;
	brand: string;
	productName: string | null;
	category: string | null;
	season: string | null;
	colour: string | null;
	gender: string | null;
	rawGenderValues: string[];
	mrpMinor: number | null;
	sizes: string[];
	sizeSources: Array<{ sourceValue: string | number; locator: string }>;
	sourceRows: SourceRowReference[];
}

export function parseDoubleuItemMaster(source: WorkbookSource): {
	profile: "DOUBLEU_ITEM_MASTER";
	sourceRowCount: number;
	articles: DoubleuArticle[];
	configuredSizeSet: string[];
	warnings: ImportWarning[];
	conflicts: ImportConflict[];
} {
	const sheet = source.sheets.find(
		(candidate) =>
			candidate.name === "Sheet1" &&
			findHeaderRow(candidate.rows, ["Item Code", "Article No", "SIZE US", "Season2"]),
	);
	if (!sheet) throw new Error("Authoritative DOUBLEU Sheet1 was not found");
	const header = findHeaderRow(sheet.rows, ["Item Code", "Article No", "SIZE US", "Season2"]);
	if (!header) throw new Error("Authoritative DOUBLEU Sheet1 was not found");
	const indexes = headerIndexes(header.cells);
	const parsedRows: DoubleuSizeRow[] = [];
	for (const row of sheet.rows) {
		if (row.rowNumber <= header.rowNumber) continue;
		const articleNo = asString(valueAt(row, indexes, "Article No"));
		const sourceSize = asString(valueAt(row, indexes, "SIZE US"));
		if (!articleNo || !sourceSize) continue;
		const rawGender = valueAt(row, indexes, "Gender");
		parsedRows.push({
			articleNo,
			brand: asString(valueAt(row, indexes, "Brand")) ?? "DOUBLEU",
			productName: asString(valueAt(row, indexes, "Article Name")),
			category: asString(valueAt(row, indexes, "Category")),
			season: asString(valueAt(row, indexes, "Season2")),
			colour: asString(valueAt(row, indexes, "Color Name")),
			rawGender: rawGender === null ? null : String(rawGender),
			gender: normalizeGender(rawGender),
			mrpMinor: moneyMinor(valueAt(row, indexes, "MRP")),
			sourceSize,
			source: sourceRowReference(source, sheet.name, header.cells, row),
		});
	}

	const groups = new Map<string, DoubleuSizeRow[]>();
	for (const parsedRow of parsedRows) {
		groups.set(parsedRow.articleNo, [...(groups.get(parsedRow.articleNo) ?? []), parsedRow]);
	}
	const articles = Array.from(groups, ([articleNo, rows]): DoubleuArticle => {
		const first = rows[0];
		return {
			articleNo,
			brand: first.brand,
			productName: first.productName,
			category: first.category,
			season: first.season,
			colour: first.colour,
			gender: first.gender,
			rawGenderValues: Array.from(
				new Set(rows.map((row) => row.rawGender).filter((value): value is string => value !== null)),
			),
			mrpMinor: first.mrpMinor,
			sizes: Array.from(new Set(rows.map((row) => row.sourceSize))),
			sizeSources: rows.map((row) => ({
				sourceValue: /^\d+(?:\.\d+)?$/.test(row.sourceSize)
					? Number(row.sourceSize)
					: row.sourceSize,
				locator: row.source.locator,
			})),
			sourceRows: rows.map((row) => row.source),
		};
	});

	return {
		profile: "DOUBLEU_ITEM_MASTER",
		sourceRowCount: parsedRows.length,
		articles,
		configuredSizeSet: ["36", "37", "38", "39", "40", "41", "42", "43", "44"],
		warnings: [],
		conflicts: [],
	};
}

