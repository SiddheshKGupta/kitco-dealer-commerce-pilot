# Task 7 report — canonical seed and media ingestion

- `src/generated/import-manifest.json` records hashes and safe structural facts for all five sources; it contains no dealer contacts or raw source content.
- The deployed seed mechanism represents the synthetic `VLCO` dealer with `VLCO_TEST_EMAIL`; no email address is committed.
- `src/generated/media-manifest.json` validates 90 exact Nike article-to-file mappings, each a 1600×1600 JPEG, and declares 200/600/900/1400 WebP private-R2 variants.
- `scripts/upload-r2.mjs` defaults to a dry run. With `--execute`, it uploads raw source and media objects to private R2 and can POST canonical import/media mappings to the audited import endpoint.
- The approved logo is copied verbatim to `public/brand/kitco-sports.png` (SHA-256 `520d16f6ea692e3ee182e613048360f216c0e1590250ed3f5f78eb0d65e79fbe`).

Verification:

- Passed: `npm.cmd test -- --run tests/scripts/import-sources.test.ts tests/scripts/media.test.ts` (3 tests).
- Passed: production build.
- Full test/typecheck were attempted. Existing in-progress Task 5/6 files fail independently because `worker/app` and related Task 6 modules are not yet present; no Task 7 test/typecheck diagnostics remain.
