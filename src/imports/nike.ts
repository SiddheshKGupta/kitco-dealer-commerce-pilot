import {
	asString,
	headerIndexes,
	moneyMinor,
	normalizeHeader,
	normalizeGender,
	sourceRowReference,
	valueAt,
	worksheetLocator,
} from "./normalize";
import type {
	ImportConflict,
	ImportWarning,
	SourceRowReference,
	WorkbookSource,
	WorksheetRow,
} from "./types";

export interface NikeHeaderRegion {
	locator: string;
	sizes: string[];
}

export interface NikeOfferingReference {
	season: string | null;
	locator: string;
}

export interface NikeArticle {
	articleNo: string;
	brand: string;
	productName: string | null;
	category: string | null;
	season: string | null;
	colour: string | null;
	gender: string | null;
	mrpMinor: number | null;
	uom: string | null;
	sizes: string[];
	sourceRows: SourceRowReference[];
	offerings: NikeOfferingReference[];
}

interface ParsedNikeRow {
	articleNo: string;
	brand: string;
	productName: string | null;
	category: string | null;
	season: string | null;
	colour: string | null;
	gender: string | null;
	mrpMinor: number | null;
	uom: string | null;
	sizes: string[];
	source: SourceRowReference;
}

function isNikeHeader(row: WorksheetRow): boolean {
	const values = new Set(row.cells.map(normalizeHeader));
	// The supplied workbook stores the repeated headers' styled Total cell as
	// numeric 17, while the first header stores the expected text label.
	const terminalValue = normalizeHeader(row.cells.at(-1) ?? null);
	return values.has("ARTICLE NO") && values.has("MRP GROUP") && (values.has("TOTAL") || terminalValue === "17");
}

export function parseNikeItemMaster(source: WorkbookSource): {
	profile: "NIKE_ITEM_MASTER";
	sourceRowCount: number;
	articles: NikeArticle[];
	repeatedSourceArticleCount: number;
	headerRegions: NikeHeaderRegion[];
	warnings: ImportWarning[];
	conflicts: ImportConflict[];
} {
	const sheet = source.sheets.find((candidate) => candidate.rows.some(isNikeHeader));
	if (!sheet) throw new Error("Nike repeated-header regions were not found");

	const headerRegions: NikeHeaderRegion[] = [];
	const parsedRows: ParsedNikeRow[] = [];
	let activeHeader: WorksheetRow | undefined;
	let activeIndexes: Map<string, number> | undefined;
	let activeSizes: string[] = [];

	for (const row of [...sheet.rows].sort((left, right) => left.rowNumber - right.rowNumber)) {
		if (isNikeHeader(row)) {
			activeHeader = row;
			activeIndexes = headerIndexes(row.cells);
			const sizeStart = (activeIndexes.get("MRP GROUP") ?? 16) + 1;
			const totalIndex = activeIndexes.get("TOTAL") ?? (normalizeHeader(row.cells.at(-1) ?? null) === "17" ? row.cells.length - 1 : row.cells.length);
			activeSizes = row.cells
				.slice(sizeStart, totalIndex)
				.map(asString)
				.filter((size): size is string => size !== null);
			headerRegions.push({ locator: worksheetLocator(sheet.name, row), sizes: activeSizes });
			continue;
		}
		if (!activeHeader || !activeIndexes) continue;
		const articleNo = asString(valueAt(row, activeIndexes, "Article No"));
		if (!articleNo) continue;
		parsedRows.push({
			articleNo,
			brand: asString(valueAt(row, activeIndexes, "Brand")) ?? "NIKE",
			productName: asString(valueAt(row, activeIndexes, "Article Name")),
			category: asString(valueAt(row, activeIndexes, "Category")),
			season: asString(valueAt(row, activeIndexes, "Season")),
			colour: asString(valueAt(row, activeIndexes, "Color Name")),
			gender: normalizeGender(valueAt(row, activeIndexes, "Gender")),
			mrpMinor: moneyMinor(valueAt(row, activeIndexes, "MRP")),
			uom: asString(valueAt(row, activeIndexes, "UOM")),
			sizes: activeSizes,
			source: sourceRowReference(source, sheet.name, activeHeader.cells, row),
		});
	}

	const groups = new Map<string, ParsedNikeRow[]>();
	for (const parsedRow of parsedRows) {
		groups.set(parsedRow.articleNo, [...(groups.get(parsedRow.articleNo) ?? []), parsedRow]);
	}

	const conflicts: ImportConflict[] = [];
	const articles: NikeArticle[] = [];
	for (const [articleNo, rows] of groups) {
		for (const field of ["category", "uom"] as const) {
			const distinct = new Map<string, string>();
			for (const row of rows) {
				const value = row[field];
				if (value !== null && !distinct.has(value)) distinct.set(value, row.source.locator);
			}
			if (distinct.size > 1) {
				conflicts.push({
					code: "MASTER_VALUE_CONFLICT",
					articleNo,
					field,
					values: Array.from(distinct, ([value, locator]) => ({ value, locator })),
				});
			}
		}
		const first = rows[0];
		const sizes = Array.from(new Set(rows.flatMap((row) => row.sizes)));
		const offerings = Array.from(
			new Map(
				rows.map((row) => [
					`${row.season ?? ""}:${row.source.locator}`,
					{ season: row.season, locator: row.source.locator },
				]),
			).values(),
		).sort((left, right) => (left.season ?? "").localeCompare(right.season ?? ""));
		articles.push({
			articleNo,
			brand: first.brand,
			productName: first.productName,
			category: first.category,
			season: first.season,
			colour: first.colour,
			gender: first.gender,
			mrpMinor: first.mrpMinor,
			uom: first.uom,
			sizes,
			sourceRows: rows.map((row) => row.source),
			offerings,
		});
	}

	return {
		profile: "NIKE_ITEM_MASTER",
		sourceRowCount: parsedRows.length,
		articles,
		repeatedSourceArticleCount: Array.from(groups.values()).filter((rows) => rows.length > 1).length,
		headerRegions,
		warnings: [],
		conflicts,
	};
}
