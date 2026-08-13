export type FixtureCell = string | number | null;

export interface FixtureWorksheetRow {
	rowNumber: number;
	cells: FixtureCell[];
}

const fixtureHash = (digit: string) => digit.repeat(64);

// Generated from normalized structural facts only. No raw source document,
// dealer name, address, telephone number, GSTIN, or deliverable email is stored.

const row = (rowNumber: number, cells: FixtureCell[]): FixtureWorksheetRow => ({
	rowNumber,
	cells,
});

export const dealerSourceFixture = {
	kind: "workbook" as const,
	fileName: "sanitized-bihar-dealers.xlsx",
	sha256: fixtureHash("1"),
	sheets: [
		{
			name: "Sheet1",
			rows: [
				row(1, [
					"Dealer Name",
					"City",
					"Address",
					"Pincode",
					"Mobile",
					"Email",
					"GSTIN",
					"Shipping Address",
				]),
				...Array.from({ length: 135 }, (_, index) => {
					const number = index + 1;
					return row(number + 1, [
						`SANITIZED DEALER ${number.toString().padStart(3, "0")}`,
						number % 2 === 0 ? "Gaya" : "Patna",
						number === 1 ? null : `Sanitized address ${number}`,
						800_000 + number,
						null,
						number <= 2 ? "shared@example.invalid" : null,
						null,
						null,
					]);
				}),
			],
		},
	],
};

const nikeHeader = (sizes: string[]) => [
	"Brand",
	"Section",
	"Sub Section",
	"Product Type",
	"Gender",
	"Article No",
	"Article Name",
	"Colour Code",
	"Color Name",
	"Global Category",
	"Category",
	"Season",
	"UOM",
	"HSN Code",
	"MRP",
	"Year",
	"MRP Group",
	...sizes,
	"Total",
];

const nikeData = (
	articleNo: string,
	season: string,
	category: string,
	uom: string,
	sizeCount: number,
) => [
	"NIKE",
	"FOOTWEAR",
	"LOW TOP",
	"LACE-UP",
	"UNISEX",
	articleNo,
	`SANITIZED PRODUCT ${articleNo}`,
	"001",
	"SANITIZED COLOUR",
	"SPORTSWEAR",
	category,
	season,
	uom,
	"64041190",
	4_995,
	2_026,
	"4001-5000",
	...Array.from({ length: sizeCount }, () => null),
	null,
];

const wholeSizeRows: FixtureWorksheetRow[] = [];
const wholeArticles = Array.from({ length: 291 }, (_, index) => `NW-${index + 1}`);
const wholeAssignments = [
	...wholeArticles,
	...wholeArticles.slice(0, 3),
	"IO2091-103",
	"IO2091-103",
	...wholeArticles.slice(3, 9),
];
for (let index = 0; index < wholeAssignments.length; index += 1) {
	const articleNo = wholeAssignments[index];
	wholeSizeRows.push(
		row(
			3 + index,
			nikeData(
				articleNo,
				index % 2 === 0 ? "SU2026" : "FA2026",
				articleNo === "IO2091-103" && 3 + index === 298
					? "JORDAN LEGACY"
					: "JORDAN BRAND",
				"PAIRS",
				9,
			),
		),
	);
}

const halfSizeRows: FixtureWorksheetRow[] = [];
const halfArticles = Array.from({ length: 119 }, (_, index) => `NH-${index + 1}`);
for (let index = 0; index < halfArticles.length; index += 1) {
	halfSizeRows.push(
		row(307 + index, nikeData(halfArticles[index], "SU2026", "RUNNING", "PAIRS", 7)),
	);
}
for (let index = 0; index < 6; index += 1) {
	halfSizeRows.push(
		row(
			307 + halfArticles.length + index,
			nikeData(halfArticles[index], "FA2026", "RUNNING", "PAIRS", 7),
		),
	);
}

const alphaSizeRows: FixtureWorksheetRow[] = [];
const alphaArticles = Array.from({ length: 51 }, (_, index) => `NA-${index + 1}`);
const alphaAssignments = [
	...alphaArticles.slice(0, 9),
	"SX7667-906",
	"SX7667-906",
	...alphaArticles.slice(9),
];
for (let index = 0; index < alphaAssignments.length; index += 1) {
	alphaSizeRows.push(
		row(
			434 + index,
			nikeData(
				alphaAssignments[index],
				index % 2 === 0 ? "SU2026" : "FA2026",
				"MEN TRAINING",
				alphaAssignments[index] === "SX7667-906" && 434 + index === 443
					? "PAIRS"
					: "PCS",
				3,
			),
		),
	);
}

export const nikeSourceFixture = {
	kind: "workbook" as const,
	fileName: "sanitized-nike-item-master.xlsx",
	sha256: fixtureHash("2"),
	sheets: [
		{
			name: "Sheet1",
			rows: [
				row(2, nikeHeader(["5", "6", "7", "8", "9", "10", "11", "12", "13"])),
				...wholeSizeRows,
				row(306, nikeHeader(["5.5", "6.5", "7.5", "8.5", "9.5", "10.5", "11.5"])),
				...halfSizeRows,
				row(433, nikeHeader(["S", "M", "L"])),
				...alphaSizeRows,
			],
		},
	],
};

export const reebokSourceFixture = {
	kind: "workbook" as const,
	fileName: "sanitized-reebok-buy-form.xlsx",
	sha256: fixtureHash("3"),
	sheets: [
		{
			name: "Sheet2",
			rows: [
				row(1, [
					"Article No",
					"MRP",
					"Colour",
					"Gender",
					"Brand",
					"7",
					"8",
					"9",
					"10",
					"11",
					"12",
					"Grand Total",
				]),
				...Array.from({ length: 85 }, (_, index) =>
					row(index + 2, [
						`RB-${index + 1}`,
						2_499 + index,
						"SANITIZED COLOUR",
						index % 2 === 0 ? "UNISEX" : "MENS",
						"REEBOK",
						1,
						null,
						null,
						null,
						null,
						null,
						1,
					]),
				),
			],
		},
	],
};

const doubleuRows: FixtureWorksheetRow[] = [];
let doubleuRowNumber = 3;
for (let articleIndex = 0; articleIndex < 29; articleIndex += 1) {
	const sizeCount = articleIndex < 14 ? 6 : 5;
	const firstSize = articleIndex < 14 ? 36 : 40;
	for (let sizeIndex = 0; sizeIndex < sizeCount; sizeIndex += 1) {
		doubleuRows.push(
			row(doubleuRowNumber, [
				`SAN-${articleIndex + 1}-${sizeIndex + 1}`,
				"64029990",
				"DOUBLEU",
				"FOOTWEAR",
				"OPEN",
				"SLIDE",
				articleIndex % 3 === 0 ? "WOMEN " : articleIndex % 3 === 1 ? "Men " : "MEN",
				`DW-${articleIndex + 1}`,
				`SANITIZED DOUBLEU ${articleIndex + 1}`,
				"NA",
				"SANITIZED COLOUR",
				"SANDAL",
				"CLOGS",
				"AW2026",
				firstSize + sizeIndex,
				"PAIRS",
				1_499,
				2_026,
				"1001-2000",
			]),
		);
		doubleuRowNumber += 1;
	}
}

export const doubleuSourceFixture = {
	kind: "workbook" as const,
	fileName: "sanitized-doubleu-item-master.xlsx",
	sha256: fixtureHash("4"),
	sheets: [
		{
			name: "Sheet1",
			rows: [
				row(2, [
					"Item Code",
					"HSN Code",
					"Brand",
					"Section",
					"Sub Section",
					"Product Type",
					"Gender",
					"Article No",
					"Article Name",
					"Colour Code",
					"Color Name",
					"Global Category",
					"Category",
					"Season2",
					"SIZE US",
					"UOM",
					"MRP",
					"Year",
					"MRP Group",
				]),
				...doubleuRows,
			],
		},
	],
};

const leeData = [
	"LC-SAN-001\tSHOE LACEUP\tBLACK\tMEN\t2999\t100\t100\t100\t100\t100\t100\t100\t700",
	"\t\tBROWN\t\t2999\t100\t100\t100\t100\t100\t100\t100\t700",
	"LC-SAN-002\tSANDAL\tTAN\tMEN\t1999\t40\t40\t40\t40\t40\t40\t92\t332",
];

export const leeCooperSourceFixture = {
	kind: "pdf-text" as const,
	fileName: "sanitized-lee-cooper-soh.pdf",
	sha256: fixtureHash("5"),
	pages: [
		{
			pageNumber: 1,
			lines: [
				{ lineNumber: 1, text: "Lee Cooper sanitized Warehouse SOH dated 12.08.26" },
				{
					lineNumber: 2,
					text: "Article no.\tCategory\tCOLOR\tGENDER\tMRP\t39\t40\t41\t42\t43\t44\t45\tTotal",
				},
				...leeData.map((text, index) => ({ lineNumber: index + 3, text })),
			],
		},
		{
			pageNumber: 2,
			lines: [
				{
					lineNumber: 1,
					text: "Article no.\tCategory\tCOLOR\tGENDER\tMRP\t39\t40\t41\t42\t43\t44\t45\tTotal",
				},
				{
					lineNumber: 2,
					text: "Total\t\t\t\t\t32\t322\t397\t416\t394\t146\t25\t1732",
				},
			],
		},
	],
};
