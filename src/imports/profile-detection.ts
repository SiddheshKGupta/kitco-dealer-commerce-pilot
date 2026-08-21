import { normalizeHeader } from "./normalize";
import type {
	DuplicateSourceRecord,
	ImportProfile,
	NormalizedSource,
	WorksheetRow,
} from "./types";

function containsHeaders(row: WorksheetRow, headers: string[]): boolean {
	const values = new Set(row.cells.map(normalizeHeader));
	return headers.every((header) => values.has(normalizeHeader(header)));
}

export function detectImportProfile(source: NormalizedSource): ImportProfile {
	if (source.kind === "pdf-text") {
		const text = source.pages.flatMap((page) => page.lines.map((line) => line.text)).join("\n");
		if (/ARTICLE\s+NO\.?/i.test(text) && /\bSOH\b/i.test(text)) return "LEE_COOPER_SOH";
		throw new Error(`No import profile matches ${source.fileName}`);
	}

	const rows = source.sheets.flatMap((sheet) => sheet.rows);
	if (rows.some((row) => containsHeaders(row, ["Dealer Name", "City", "GSTIN"]))) {
		return "DEALER_MASTER_BIHAR";
	}
	if (rows.some((row) => containsHeaders(row, ["Item Code", "Article No", "SIZE US", "Season2"]))) {
		return "DOUBLEU_ITEM_MASTER";
	}
	const articleHeaders = rows.filter((row) => containsHeaders(row, ["Article No", "MRP"]));
	if (articleHeaders.length >= 2 && articleHeaders.some((row) => containsHeaders(row, ["MRP Group"]))) {
		return "NIKE_ITEM_MASTER";
	}
	if (articleHeaders.some((row) => containsHeaders(row, ["Colour", "Brand", "Grand Total"]))) {
		return "REEBOK_BUY_FORM";
	}
	throw new Error(`No import profile matches ${source.fileName}`);
}

export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
	const buffer =
		bytes instanceof ArrayBuffer
			? bytes
			: (Uint8Array.from(bytes).buffer as ArrayBuffer);
	const digest = await crypto.subtle.digest("SHA-256", buffer);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function findDuplicateSource(
	bytes: Uint8Array | ArrayBuffer,
	priorSources: DuplicateSourceRecord[],
): Promise<DuplicateSourceRecord | undefined> {
	const identity = await sha256Hex(bytes);
	return priorSources.find((source) => source.sha256.toLowerCase() === identity);
}

