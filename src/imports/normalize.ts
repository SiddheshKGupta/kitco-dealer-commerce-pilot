import type {
	CellValue,
	SourceReference,
	SourceRowReference,
	WorkbookSource,
	WorksheetRow,
} from "./types";

export function normalizeHeader(value: CellValue): string {
	return String(value ?? "")
		.trim()
		.replace(/\s+/g, " ")
		.toUpperCase();
}

export function asString(value: CellValue): string | null {
	if (value === null || value === undefined) return null;
	const normalized = String(value).trim();
	return normalized.length > 0 ? normalized : null;
}

export function asNumber(value: CellValue): number | null {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	const normalized = asString(value);
	if (normalized === null) return null;
	const parsed = Number(normalized.replace(/,/g, ""));
	return Number.isFinite(parsed) ? parsed : null;
}

export function moneyMinor(value: CellValue): number | null {
	const number = asNumber(value);
	return number === null ? null : Math.round(number * 100);
}

export function normalizeGender(value: CellValue): string | null {
	const normalized = normalizeHeader(value);
	if (normalized === "MEN" || normalized === "MENS" || normalized === "MALE") return "MEN";
	if (normalized === "WOMEN" || normalized === "WOMENS" || normalized === "FEMALE") {
		return "WOMEN";
	}
	return normalized || null;
}

export function columnName(index: number): string {
	let value = index;
	let result = "";
	while (value > 0) {
		value -= 1;
		result = String.fromCharCode(65 + (value % 26)) + result;
		value = Math.floor(value / 26);
	}
	return result;
}

export function worksheetLocator(sheetName: string, row: WorksheetRow): string {
	return `${sheetName}!A${row.rowNumber}:${columnName(row.cells.length)}${row.rowNumber}`;
}

export function sourceReference(
	source: WorkbookSource,
	sheetName: string,
	row: WorksheetRow,
): SourceReference {
	return {
		fileName: source.fileName,
		sha256: source.sha256.toLowerCase(),
		locator: worksheetLocator(sheetName, row),
	};
}

export function headerIndexes(cells: CellValue[]): Map<string, number> {
	return new Map(cells.map((cell, index) => [normalizeHeader(cell), index]));
}

export function rawRecord(
	header: CellValue[],
	row: WorksheetRow,
): Record<string, CellValue> {
	const record: Record<string, CellValue> = {};
	header.forEach((cell, index) => {
		const key = normalizeHeader(cell).toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_, next) =>
			next ? String(next).toUpperCase() : "",
		);
		if (key) record[key] = row.cells[index] ?? null;
	});
	return record;
}

export function sourceRowReference(
	source: WorkbookSource,
	sheetName: string,
	header: CellValue[],
	row: WorksheetRow,
): SourceRowReference {
	return {
		...sourceReference(source, sheetName, row),
		raw: rawRecord(header, row),
	};
}

export function valueAt(
	row: WorksheetRow,
	indexes: Map<string, number>,
	header: string,
): CellValue {
	const index = indexes.get(normalizeHeader(header));
	return index === undefined ? null : (row.cells[index] ?? null);
}

export function findHeaderRow(
	rows: WorksheetRow[],
	requiredHeaders: string[],
): WorksheetRow | undefined {
	const required = requiredHeaders.map(normalizeHeader);
	return rows.find((row) => {
		const values = new Set(row.cells.map(normalizeHeader));
		return required.every((header) => values.has(header));
	});
}

