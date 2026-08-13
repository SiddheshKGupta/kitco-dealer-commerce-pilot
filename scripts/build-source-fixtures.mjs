import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function option(name) {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function stableToken(prefix, value, cache) {
	if (value === null || value === undefined || String(value).trim() === "") return null;
	const key = String(value);
	if (!cache.has(key)) cache.set(key, `${prefix}-${String(cache.size + 1).padStart(3, "0")}`);
	return cache.get(key);
}

function sanitizeDealerWorkbook(source) {
	const nameTokens = new Map();
	const cityTokens = new Map();
	const addressTokens = new Map();
	const pincodeTokens = new Map();
	const mobileTokens = new Map();
	const emailTokens = new Map();
	const gstinTokens = new Map();
	const shippingTokens = new Map();

	return {
		...source,
		fileName: "sanitized-bihar-dealers.xlsx",
		sheets: source.sheets.map((sheet) => {
			const header = sheet.rows[0]?.cells ?? [];
			const indexes = new Map(header.map((value, index) => [String(value).trim().toUpperCase(), index]));
			const valueIndex = (name) => indexes.get(name);
			return {
				...sheet,
				rows: sheet.rows.map((row, rowIndex) => {
					if (rowIndex === 0) return row;
					const cells = [...row.cells];
					const set = (name, value) => {
						const index = valueIndex(name);
						if (index !== undefined) cells[index] = value;
					};
					const get = (name) => {
						const index = valueIndex(name);
						return index === undefined ? null : cells[index];
					};
					const dealerNumber = String(nameTokens.size + 1).padStart(3, "0");
					if (get("DEALER NAME")) {
						stableToken("dealer", get("DEALER NAME"), nameTokens);
						set("DEALER NAME", `SANITIZED DEALER ${dealerNumber}`);
					}
					set("CITY", stableToken("City", get("CITY"), cityTokens));
					set("ADDRESS", stableToken("Sanitized address", get("ADDRESS"), addressTokens));
					set("PINCODE", stableToken("PIN", get("PINCODE"), pincodeTokens));
					set("MOBILE", stableToken("shared-mobile", get("MOBILE"), mobileTokens));
					const email = stableToken("shared-email", get("EMAIL"), emailTokens);
					set("EMAIL", email ? `${email}@example.invalid` : null);
					set("GSTIN", stableToken("SANITIZED-GSTIN", get("GSTIN"), gstinTokens));
					set(
						"SHIPPING ADDRESS",
						stableToken("Sanitized shipping address", get("SHIPPING ADDRESS"), shippingTokens),
					);
					return { ...row, cells };
				}),
			};
		}),
	};
}

const profile = option("profile");
const inputPath = option("input");
const outputPath = option("output");
if (!profile || !inputPath || !outputPath) {
	throw new Error("Usage: build-source-fixtures.mjs --profile <PROFILE> --input <normalized.json> --output <fixture.json>");
}

const source = JSON.parse(await readFile(resolve(inputPath), "utf8"));
const sanitized = profile === "DEALER_MASTER_BIHAR" ? sanitizeDealerWorkbook(source) : source;
const withoutSourceHash = { ...sanitized };
delete withoutSourceHash.sha256;
const canonical = JSON.stringify(withoutSourceHash);
const fixture = {
	...withoutSourceHash,
	sha256: createHash("sha256").update(canonical).digest("hex"),
};
await mkdir(dirname(resolve(outputPath)), { recursive: true });
await writeFile(resolve(outputPath), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");

