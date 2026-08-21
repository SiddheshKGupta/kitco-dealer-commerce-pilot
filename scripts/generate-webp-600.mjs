import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const nikeDir = process.argv[process.argv.indexOf("--nike-dir") + 1];
const manifestPath = process.argv[process.argv.indexOf("--media-manifest") + 1];
const outputDir = process.argv[process.argv.indexOf("--output-dir") + 1];
if (!nikeDir || !manifestPath || !outputDir) throw new Error("Usage: generate-webp-600.mjs --nike-dir <dir> --media-manifest <manifest.json> --output-dir <dir>");

const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
const results = [];
for (const item of manifest.media) {
	const variant = item.variants.find((entry) => entry.width === 600);
	if (!variant) throw new Error(`No 600px variant declared for ${item.articleNo}`);
	const sourcePath = resolve(nikeDir, item.source.fileName);
	const targetPath = resolve(outputDir, variant.key);
	const buffer = await sharp(await readFile(sourcePath))
		.resize(600, 600, { fit: "contain", background: "#ffffff" })
		.webp()
		.toBuffer();
	await mkdir(dirname(targetPath), { recursive: true });
	await writeFile(targetPath, buffer);
	results.push({ articleNo: item.articleNo, key: variant.key, sha256: createHash("sha256").update(buffer).digest("hex"), width: 600, height: 600, byteSize: buffer.length });
}
console.log(JSON.stringify(results, null, 2));
