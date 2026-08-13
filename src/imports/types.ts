export type ImportProfile =
	| "DEALER_MASTER_BIHAR"
	| "NIKE_ITEM_MASTER"
	| "REEBOK_BUY_FORM"
	| "DOUBLEU_ITEM_MASTER"
	| "LEE_COOPER_SOH";

export type ImportStatus =
	| "READY"
	| "WARNING"
	| "CONFLICT"
	| "NEEDS_ENRICHMENT"
	| "ERROR"
	| "IGNORED";

export type CellValue = string | number | boolean | null;

export interface WorksheetRow {
	rowNumber: number;
	cells: CellValue[];
}

export interface WorksheetSource {
	name: string;
	rows: WorksheetRow[];
}

export interface WorkbookSource {
	kind: "workbook";
	fileName: string;
	sha256: string;
	sheets: WorksheetSource[];
}

export interface PdfTextLine {
	lineNumber: number;
	text: string;
}

export interface PdfTextPage {
	pageNumber: number;
	lines: PdfTextLine[];
}

export interface PdfTextSource {
	kind: "pdf-text";
	fileName: string;
	sha256: string;
	pages: PdfTextPage[];
}

export type NormalizedSource = WorkbookSource | PdfTextSource;

export interface SourceReference {
	fileName: string;
	sha256: string;
	locator: string;
}

export interface SourceRowReference extends SourceReference {
	raw: Record<string, CellValue>;
}

export interface ImportWarning {
	code: string;
	message: string;
	locator: string;
}

export interface ImportConflictValue {
	value: string;
	locator: string;
}

export interface ImportConflict {
	code: string;
	articleNo?: string;
	field: string;
	values: ImportConflictValue[];
}

export interface DuplicateSourceRecord {
	sourceId: string;
	sha256: string;
}

