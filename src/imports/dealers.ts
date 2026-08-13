import {
	asString,
	findHeaderRow,
	headerIndexes,
	sourceRowReference,
	valueAt,
} from "./normalize";
import type {
	CellValue,
	ImportConflict,
	ImportStatus,
	ImportWarning,
	SourceRowReference,
	WorkbookSource,
} from "./types";

export interface StagedDealer {
	dealerName: string;
	city: string | null;
	address: string | null;
	pincode: string | null;
	mobile: string | null;
	email: string | null;
	gstin: string | null;
	shippingAddress: string | null;
	status: ImportStatus;
	raw: Record<string, CellValue>;
	source: SourceRowReference;
}

export function parseDealerMaster(source: WorkbookSource): {
	profile: "DEALER_MASTER_BIHAR";
	sourceRowCount: number;
	dealers: StagedDealer[];
	warnings: ImportWarning[];
	conflicts: ImportConflict[];
} {
	const sheet = source.sheets.find((candidate) =>
		findHeaderRow(candidate.rows, ["Dealer Name", "City", "GSTIN"]),
	);
	if (!sheet) throw new Error("Dealer header was not found");
	const headerRow = findHeaderRow(sheet.rows, ["Dealer Name", "City", "GSTIN"]);
	if (!headerRow) throw new Error("Dealer header was not found");
	const indexes = headerIndexes(headerRow.cells);
	const dataRows = sheet.rows.filter(
		(row) => row.rowNumber > headerRow.rowNumber && asString(valueAt(row, indexes, "Dealer Name")),
	);
	const warnings: ImportWarning[] = [];
	const contactLocations = new Map<string, string[]>();

	const dealers = dataRows.map((row): StagedDealer => {
		const sourceRow = sourceRowReference(source, sheet.name, headerRow.cells, row);
		const mobile = asString(valueAt(row, indexes, "Mobile"));
		const email = asString(valueAt(row, indexes, "Email"));
		for (const contact of [mobile, email]) {
			if (contact) contactLocations.set(contact, [...(contactLocations.get(contact) ?? []), sourceRow.locator]);
		}
		if (!mobile && !email) {
			warnings.push({
				code: "MISSING_CONTACT",
				message: "Dealer has no staged mobile or email; activation data remains separate.",
				locator: sourceRow.locator,
			});
		}
		return {
			dealerName: asString(valueAt(row, indexes, "Dealer Name")) as string,
			city: asString(valueAt(row, indexes, "City")),
			address: asString(valueAt(row, indexes, "Address")),
			pincode: asString(valueAt(row, indexes, "Pincode")),
			mobile,
			email,
			gstin: asString(valueAt(row, indexes, "GSTIN")),
			shippingAddress: asString(valueAt(row, indexes, "Shipping Address")),
			status: !mobile && !email ? "WARNING" : "READY",
			raw: sourceRow.raw,
			source: sourceRow,
		};
	});

	for (const [contact, locators] of contactLocations) {
		if (locators.length > 1) {
			for (const locator of locators) {
				warnings.push({
					code: "SHARED_CONTACT",
					message: `Contact ${contact} is shared by ${locators.length} staged dealer rows.`,
					locator,
				});
			}
		}
	}

	return {
		profile: "DEALER_MASTER_BIHAR",
		sourceRowCount: dataRows.length,
		dealers,
		warnings,
		conflicts: [],
	};
}

