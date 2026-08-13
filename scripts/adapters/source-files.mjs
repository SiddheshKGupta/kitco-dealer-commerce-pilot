import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { inflateRawSync } from "node:zlib";

function sha256(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function decodeXml(value) {
	return value
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
		.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function zipEntries(bytes) {
	for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
		if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
		const entries = new Map();
		const count = bytes.readUInt16LE(offset + 10);
		let cursor = bytes.readUInt32LE(offset + 16);
		for (let index = 0; index < count; index += 1) {
			if (bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid XLSX central directory");
			const compression = bytes.readUInt16LE(cursor + 10);
			const compressedSize = bytes.readUInt32LE(cursor + 20);
			const nameLength = bytes.readUInt16LE(cursor + 28);
			const extraLength = bytes.readUInt16LE(cursor + 30);
			const commentLength = bytes.readUInt16LE(cursor + 32);
			const localOffset = bytes.readUInt32LE(cursor + 42);
			const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
			const localNameLength = bytes.readUInt16LE(localOffset + 26);
			const localExtraLength = bytes.readUInt16LE(localOffset + 28);
			const start = localOffset + 30 + localNameLength + localExtraLength;
			const compressed = bytes.subarray(start, start + compressedSize);
			entries.set(name, compression === 0 ? compressed : compression === 8 ? inflateRawSync(compressed) : null);
			cursor += 46 + nameLength + extraLength + commentLength;
		}
		return entries;
	}
	throw new Error("XLSX end-of-central-directory record was not found");
}

function requiredEntry(entries, name) {
	const entry = entries.get(name);
	if (!entry) throw new Error(`XLSX entry not found or unsupported: ${name}`);
	return entry.toString("utf8");
}

function richText(xml) {
	return decodeXml(Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (part) => part[1]).join(""));
}

function columnIndex(reference) {
	const letters = /^([A-Z]+)/iu.exec(reference)?.[1]?.toUpperCase();
	if (!letters) throw new Error(`Invalid XLSX cell reference: ${reference}`);
	let index = 0;
	for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
	return index - 1;
}

function cellValue(attributes, body, sharedStrings) {
	const type = /\bt="([^"]+)"/u.exec(attributes)?.[1];
	if (type === "inlineStr") return richText(body);
	const raw = /<v>([\s\S]*?)<\/v>/u.exec(body)?.[1];
	if (raw === undefined) return null;
	if (type === "s") return sharedStrings[Number(raw)] ?? null;
	if (type === "b") return raw === "1";
	if (type === "str" || type === "e") return decodeXml(raw);
	const numeric = Number(raw);
	return Number.isFinite(numeric) ? numeric : decodeXml(raw);
}

function parseSheet(xml, sharedStrings) {
	const rows = [];
	for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gu)) {
		const rowNumber = Number(/\br="(\d+)"/u.exec(rowMatch[1])?.[1]);
		if (!Number.isInteger(rowNumber)) continue;
		const cells = [];
		for (const cell of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)) {
			const reference = /\br="([A-Z]+\d+)"/iu.exec(cell[1])?.[1];
			if (!reference) continue;
			cells[columnIndex(reference)] = cellValue(cell[1], cell[2], sharedStrings);
		}
		for (let index = 0; index < cells.length; index += 1) if (cells[index] === undefined) cells[index] = null;
		rows.push({ rowNumber, cells });
	}
	return rows;
}

export async function readXlsxWorkbook(filePath) {
	const bytes = await readFile(filePath);
	const entries = zipEntries(bytes);
	const sharedXml = entries.get("xl/sharedStrings.xml")?.toString("utf8");
	const sharedStrings = sharedXml ? Array.from(sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/gu), (match) => richText(match[1])) : [];
	const relationships = new Map(
		Array.from(requiredEntry(entries, "xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/gu), (match) => {
			const id = /\bId="([^"]+)"/u.exec(match[1])?.[1];
			const target = /\bTarget="([^"]+)"/u.exec(match[1])?.[1];
			return [id, target];
		}).filter(([id, target]) => id && target),
	);
	const workbookXml = requiredEntry(entries, "xl/workbook.xml");
	const sheets = [];
	for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?>(?:<\/sheet>)?/gu)) {
		const name = decodeXml(/\bname="([^"]+)"/u.exec(match[1])?.[1] ?? "");
		const relationshipId = /\br:id="([^"]+)"/u.exec(match[1])?.[1];
		const target = relationshipId ? relationships.get(relationshipId) : undefined;
		if (!name || !target) continue;
		const normalizedTarget = target.replace(/^\//u, "").startsWith("xl/") ? target.replace(/^\//u, "") : `xl/${target.replace(/^\.\//u, "")}`;
		sheets.push({ name, rows: parseSheet(requiredEntry(entries, normalizedTarget), sharedStrings) });
	}
	return { kind: "workbook", fileName: basename(filePath), sha256: sha256(bytes), sheets };
}

function tableColumns(header) {
	const labels = ["Article no.", "Category", "COLOR", "GENDER", "MRP", "39", "40", "41", "42", "43", "44", "45", "Total"];
	const starts = [];
	let cursor = 0;
	for (const label of labels) {
		const start = header.indexOf(label, cursor);
		if (start < 0) throw new Error(`Lee Cooper PDF column ${label} was not found`);
		starts.push(start);
		cursor = start + label.length;
	}
	return starts;
}

function tableLine(line, starts) {
	return starts.map((start, index) => line.slice(start, starts[index + 1] ?? line.length).trim()).join("\t");
}

export async function readLeeCooperPdf(filePath) {
	const bytes = await readFile(filePath);
	const text = execFileSync("pdftotext", ["-table", "-enc", "UTF-8", filePath, "-"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
	const pages = text.split("\f").map((page, pageIndex) => {
		const rawLines = page.replace(/^\uFEFF/u, "").split(/\r?\n/u);
		const headerIndex = rawLines.findIndex((line) => line.includes("Article no.") && line.includes("MRP") && line.includes("Total"));
		if (headerIndex < 0) return null;
		const starts = tableColumns(rawLines[headerIndex]);
		return {
			pageNumber: pageIndex + 1,
			lines: rawLines
				.map((line, lineIndex) => ({ line, lineNumber: lineIndex + 1 }))
				.filter(({ line, lineNumber }) => lineNumber >= headerIndex + 1 && line.trim().length > 0)
				.map(({ line, lineNumber }) => ({ lineNumber, text: tableLine(line, starts) })),
		};
	}).filter(Boolean);
	return { kind: "pdf-text", fileName: basename(filePath), sha256: sha256(bytes), pages };
}
