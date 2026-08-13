# Canonical source ingestion

This utility converts KITCO's five supplied source files into one canonical JSON payload without copying source documents into Git.

## Prerequisites

- Run `npm ci` so the pinned Vite runtime is available.
- Install `pdftotext` and make it available on `PATH`. The repository uses its table extraction mode for the Lee Cooper SOH PDF.
- Keep the five source files under one local directory using their original names.

## Build and verify the canonical payload

```powershell
npm.cmd run ingest:canonical -- --source-root C:\Users\Siddhesh\Downloads --output .kitco-ingestion\canonical.json
```

`.kitco-ingestion/` is ignored by Git because the generated payload contains private dealer source fields. Never move it under `src/`, commit it, or attach it to a public build.

The verified payload contains:

- 135 replacement source dealers plus synthetic VLCO = 136 canonical dealers
- Nike: 480 source rows, 461 canonical Articles, and exactly two quarantined conflicts (`IO2091-103`, `SX7667-906`)
- Reebok: 85 staged `NEEDS_ENRICHMENT` Articles and zero publishable Articles
- DOUBLEU: 159 size rows grouped into 29 Articles
- Lee Cooper: 66 colourways and a 1,732-pair internal stock snapshot

The output retains hashes and stable source locators but recursively removes parser `raw` fields. Use it only from the privileged audited Supabase loader; browser code must never receive this payload.

## Prepare and upload exact Nike media

The committed media manifest stores bucket-relative `media/...` keys. Generate optional WebP variants locally:

```powershell
node scripts/prepare-media.mjs --nike-dir C:\Users\Siddhesh\Downloads\NIKE --nike-workbook "C:\Users\Siddhesh\Downloads\Nike Item master File.xlsx" --output src\generated\media-manifest.json --variants-dir .kitco-ingestion\variants
```

Review the R2 operation before adding `--execute`:

```powershell
node scripts/upload-r2.mjs --bucket kitco-dealer-commerce-private-media --media-manifest src\generated\media-manifest.json --source-dir C:\Users\Siddhesh\Downloads\NIKE --variants-dir .kitco-ingestion\variants --import-manifest src\generated\import-manifest.json --raw-source-root C:\Users\Siddhesh\Downloads
```

The database stores the same relative `media/...` object key. At read time the repository adds the authenticated organisation ID to the URL-scoped key, the media route validates that prefix, and the R2 adapter removes it before requesting the relative bucket key. This keeps storage, database, and authenticated routing contracts consistent.
