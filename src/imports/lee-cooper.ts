import { asNumber, asString, normalizeHeader, normalizeGender } from "./normalize";
import type {
	ImportConflict,
	ImportWarning,
	PdfTextSource,
	SourceReference,
} from "./types";

const sizeValues = ["39", "40", "41", "42", "43", "44", "45"] as const;

export interface LeeCooperStockLine {
	articleNo: string;
	category: string;
	colour: string;
	gender: string;
	mrpMinor: number;
	sizes: Record<(typeof sizeValues)[number], number>;
	totalPairs: number;
	source: SourceReference & { raw: { lineText: string } };
}

export function parseLeeCooperSoh(source: PdfTextSource): {
	profile: "LEE_COOPER_SOH";
	stockLines: LeeCooperStockLine[];
	totalPairs: number;
	declaredGrandTotalPairs: number | null;
	offerings: Array<{ kind: "STOCK_IN_HAND"; numericalAvailability: "INTERNAL_ONLY" }>;
	warnings: ImportWarning[];
	conflicts: ImportConflict[];
} {
	const stockLines: LeeCooperStockLine[] = [];
	const warnings: ImportWarning[] = [];
	let currentArticle: string | null = null;
	let currentCategory: string | null = null;
	let currentGender: string | null = null;
	let declaredGrandTotalPairs: number | null = null;
	let declaredGrandTotalLocator: string | null = null;

	for (const page of source.pages) {
		for (const line of page.lines) {
			const cells = line.text.split("\t");
			const locator = `page:${page.pageNumber}#line:${line.lineNumber}`;
			if (cells.length < 13 || normalizeHeader(cells[0]) === "ARTICLE NO.") continue;
			const articleCell = asString(cells[0]);
			if (normalizeHeader(articleCell) === "TOTAL") {
				declaredGrandTotalPairs = asNumber(cells[12]);
				declaredGrandTotalLocator = locator;
				continue;
			}
			if (articleCell) currentArticle = articleCell;
			const categoryCell = asString(cells[1]);
			if (categoryCell) currentCategory = categoryCell;
			const genderCell = normalizeGender(cells[3]);
			if (genderCell) currentGender = genderCell;
			const colour = asString(cells[2]);
			const mrp = asNumber(cells[4]);
			if (!currentArticle || !currentCategory || !currentGender || !colour || mrp === null) {
				warnings.push({
					code: "UNPARSEABLE_SOH_LINE",
					message: "SOH row lacks inherited identity or commercial fields.",
					locator,
				});
				continue;
			}
			const sizes = Object.fromEntries(
				sizeValues.map((size, index) => [size, asNumber(cells[index + 5]) ?? 0]),
			) as Record<(typeof sizeValues)[number], number>;
			const computedTotal = Object.values(sizes).reduce((sum, quantity) => sum + quantity, 0);
			const declaredLineTotal = asNumber(cells[12]);
			if (declaredLineTotal !== null && declaredLineTotal !== computedTotal) {
				warnings.push({
					code: "LINE_TOTAL_MISMATCH",
					message: `Declared ${declaredLineTotal} pairs but size quantities total ${computedTotal}.`,
					locator,
				});
			}
			stockLines.push({
				articleNo: currentArticle,
				category: currentCategory,
				colour,
				gender: currentGender,
				mrpMinor: Math.round(mrp * 100),
				sizes,
				totalPairs: computedTotal,
				source: {
					fileName: source.fileName,
					sha256: source.sha256.toLowerCase(),
					locator,
					raw: { lineText: line.text },
				},
			});
		}
	}

	const totalPairs = stockLines.reduce((sum, line) => sum + line.totalPairs, 0);
	const conflicts: ImportConflict[] = [];
	if (declaredGrandTotalPairs !== null && declaredGrandTotalPairs !== totalPairs) {
		conflicts.push({
			code: "GRAND_TOTAL_MISMATCH",
			field: "totalPairs",
			values: [
				{ value: String(totalPairs), locator: "computed:stock-lines" },
				{ value: String(declaredGrandTotalPairs), locator: declaredGrandTotalLocator as string },
			],
		});
	}

	return {
		profile: "LEE_COOPER_SOH",
		stockLines,
		totalPairs,
		declaredGrandTotalPairs,
		offerings: [{ kind: "STOCK_IN_HAND", numericalAvailability: "INTERNAL_ONLY" }],
		warnings,
		conflicts,
	};
}
