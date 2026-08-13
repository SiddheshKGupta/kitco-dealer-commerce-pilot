import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function option(name) {
	const index = process.argv.indexOf(`--${name}`);
	return index < 0 ? undefined : process.argv[index + 1];
}

const bucket = option("bucket");
const mediaManifestPath = option("media-manifest");
const sourceDir = option("source-dir");
const variantsDir = option("variants-dir");
const importManifestPath = option("import-manifest");
const rawSourceRoot = option("raw-source-root");
const importEndpoint = option("import-endpoint");
const bearerToken = option("bearer-token");
const execute = process.argv.includes("--execute");
if (!bucket || !mediaManifestPath || !sourceDir) throw new Error("Usage: upload-r2.mjs --bucket <private-bucket> --media-manifest <manifest.json> --source-dir <nike-dir> [--variants-dir <dir>] [--import-manifest <manifest.json> --raw-source-root <dir> --import-endpoint <url> --bearer-token <token>] [--execute]");
if (Boolean(importManifestPath) !== Boolean(rawSourceRoot)) throw new Error("--import-manifest and --raw-source-root must be supplied together");
const manifest = JSON.parse(await readFile(resolve(mediaManifestPath), "utf8"));
const mediaUploads = manifest.media.flatMap((item) => [
	{ file: resolve(sourceDir, item.source.fileName), key: item.source.key },
	...(variantsDir ? item.variants.map((variant) => ({ file: resolve(variantsDir, variant.key), key: variant.key })) : []),
]);
const importManifest = importManifestPath ? JSON.parse(await readFile(resolve(importManifestPath), "utf8")) : undefined;
const rawUploads = importManifest ? importManifest.imports.map((source) => ({ file: resolve(rawSourceRoot, source.fileName), key: `raw/${source.sha256}/${source.fileName}` })) : [];
const uploads = [...rawUploads, ...mediaUploads];
if (!execute) {
	console.log(JSON.stringify({ mode: "DRY_RUN", bucket, uploads, importEndpoint: importEndpoint ?? null, mediaMappings: manifest.media.map((item) => ({ articleNo: item.articleNo, sourceKey: item.source.key, variantKeys: item.variants.map((variant) => variant.key) })) }, null, 2));
	process.exit(0);
}
for (const upload of uploads) execFileSync("wrangler", ["r2", "object", "put", `${bucket}/${upload.key}`, "--file", upload.file, "--remote"], { stdio: "inherit" });
if (importManifest && importEndpoint) {
	const response = await fetch(importEndpoint, { method: "POST", headers: { "content-type": "application/json", ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}) }, body: JSON.stringify({ imports: importManifest.imports, media: manifest.media }) });
	if (!response.ok) throw new Error(`Audited import endpoint rejected seed: ${response.status} ${await response.text()}`);
}
