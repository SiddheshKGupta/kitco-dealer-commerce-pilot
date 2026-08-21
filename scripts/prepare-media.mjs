import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

const VARIANT_WIDTHS = [200, 600, 900, 1400];

function option(name) {
	const index = process.argv.indexOf(`--${name}`);
	return index < 0 ? undefined : process.argv[index + 1];
}

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

function zipEntry(bytes, target) {
	for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
		if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
		const centralOffset = bytes.readUInt32LE(offset + 16);
		const count = bytes.readUInt16LE(offset + 10);
		let cursor = centralOffset;
		for (let index = 0; index < count; index += 1) {
			if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid XLSX central directory");
			const compression = bytes.readUInt16LE(cursor + 10);
			const compressedSize = bytes.readUInt32LE(cursor + 20);
			const nameLength = bytes.readUInt16LE(cursor + 28);
			const extraLength = bytes.readUInt16LE(cursor + 30);
			const commentLength = bytes.readUInt16LE(cursor + 32);
			const localOffset = bytes.readUInt32LE(cursor + 42);
			const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
			cursor += 46 + nameLength + extraLength + commentLength;
			if (name !== target) continue;
			const localNameLength = bytes.readUInt16LE(localOffset + 26);
			const localExtraLength = bytes.readUInt16LE(localOffset + 28);
			const compressed = bytes.subarray(localOffset + 30 + localNameLength + localExtraLength, localOffset + 30 + localNameLength + localExtraLength + compressedSize);
			return compression === 0 ? compressed : compression === 8 ? inflateRawSync(compressed) : (() => { throw new Error(`Unsupported XLSX compression ${compression}`); })();
		}
	}
	throw new Error(`XLSX entry not found: ${target}`);
}

function decodeXml(value) { return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))); }

async function nikeArticleNumbers(workbookPath) {
	const bytes = await readFile(workbookPath);
	const strings = Array.from(zipEntry(bytes, "xl/sharedStrings.xml").toString("utf8").matchAll(/<si>([\s\S]*?)<\/si>/g), (match) => decodeXml(Array.from(match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g), (part) => part[1]).join("")));
	const sheet = zipEntry(bytes, "xl/worksheets/sheet1.xml").toString("utf8");
	const articles = new Set();
	for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
		for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
			if (!/\br="F\d+"/.test(cell[1])) continue;
			const value = /<v>(.*?)<\/v>/.exec(cell[2])?.[1];
			const article = value === undefined ? undefined : /\bt="s"/.test(cell[1]) ? strings[Number(value)] : value;
			if (article && /^[A-Z0-9]+-\d{3}$/.test(article)) articles.add(article);
		}
	}
	return articles;
}

function jpegDimensions(bytes) {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Expected JPEG SOI marker");
	for (let offset = 2; offset < bytes.length;) {
		if (bytes[offset] !== 0xff) { offset += 1; continue; }
		const marker = bytes[offset + 1];
		const length = bytes.readUInt16BE(offset + 2);
		if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
		offset += 2 + length;
	}
	throw new Error("JPEG dimensions were not found");
}

async function createVariants(media, sourceDir, variantsDir) {
	for (const item of media) {
		for (const variant of item.variants) {
			const target = resolve(variantsDir, variant.key);
			await mkdir(dirname(target), { recursive: true });
			execFileSync("magick", [resolve(sourceDir, item.source.fileName), "-resize", `${variant.width}x${variant.width}`, "-background", "white", "-gravity", "center", "-extent", `${variant.width}x${variant.width}`, target]);
		}
	}
}

const nikeDir = option("nike-dir");
const workbook = option("nike-workbook");
const output = option("output");
if (!nikeDir || !workbook || !output) throw new Error("Usage: prepare-media.mjs --nike-dir <directory> --nike-workbook <xlsx> --output <manifest.json> [--variants-dir <directory>]");
const workbookArticles = await nikeArticleNumbers(resolve(workbook));
const sourceFiles = (await readdir(resolve(nikeDir))).filter((name) => extname(name).toLowerCase() === ".jpg").sort();
if (sourceFiles.length !== 90) throw new Error(`Expected 90 Nike JPEGs, found ${sourceFiles.length}`);
const media = [];
for (const fileName of sourceFiles) {
	const articleNo = basename(fileName, ".jpg");
	if (!workbookArticles.has(articleNo)) throw new Error(`MEDIA_REVIEW_REQUIRED: ${fileName} has no exact Nike Article match`);
	const bytes = await readFile(resolve(nikeDir, fileName));
	const dimensions = jpegDimensions(bytes);
	if (dimensions.width !== 1600 || dimensions.height !== 1600) throw new Error(`MEDIA_REVIEW_REQUIRED: ${fileName} is ${dimensions.width}x${dimensions.height}, expected 1600x1600`);
	media.push({ articleNo, source: { fileName, mimeType: "image/jpeg", byteSize: bytes.length, sha256: sha256(bytes), ...dimensions, key: `media/nike/${articleNo}/source.jpg` }, variants: VARIANT_WIDTHS.map((width) => ({ width, mimeType: "image/webp", fit: "contain", key: `media/nike/${articleNo}/${width}.webp` })) });
}
if (option("variants-dir")) await createVariants(media, nikeDir, option("variants-dir"));
const manifest = { schemaVersion: 1, visibility: "PRIVATE_R2", sourceCount: media.length, media };
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(resolve(output), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
