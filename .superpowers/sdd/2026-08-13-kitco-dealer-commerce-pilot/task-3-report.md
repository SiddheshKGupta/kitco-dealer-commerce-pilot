# Task 3 report: deterministic KITCO source profiles

## Scope

Implemented the five Task 3 parsing profiles over normalized workbook rows and PDF text lines. Raw XLSX/PDF decoding remains a controlled Task 7 ingestion-adapter responsibility. Task 3 adds no parsing dependency and does not modify `package.json` or the lockfile.

The user explicitly removed Escapement. This task does not add or depend on it.

## Privacy boundary

- No supplied XLSX/PDF document is copied into the repository.
- Dealer fixtures contain generated names, synthetic `example.invalid` email values, null mobile/GSTIN values, and sanitized addresses only.
- The fixture builder deterministically replaces names, contact fields, addresses, pincodes, and GSTINs while preserving structural relationships such as a shared contact.
- Canonical seed preparation removes every `raw` field recursively and rejects imports with unresolved conflicts.

## Source evidence and deterministic assertions

Read-only inspection of the supplied documents established the structural facts encoded by sanitized fixtures:

| Profile | Structural assertion |
| --- | --- |
| Bihar dealer replacement | Sheet range `A1:H136`: one header plus exactly 135 staged dealer rows; empty/shared contacts produce warnings rather than rejection. |
| Nike | Three repeated headers at rows 2, 306, and 433; 302 whole-size rows, 125 half-size rows, and 53 alpha-size rows; 480 source rows, 463 unique Articles, and 17 repeated Articles. |
| Nike conflict 1 | `IO2091-103`, `category`: `JORDAN BRAND` at `Sheet1!A297:AA297` versus `JORDAN LEGACY` at `Sheet1!A298:AA298`. |
| Nike conflict 2 | `SX7667-906`, `uom`: `PAIRS` at `Sheet1!A443:U443` versus `PCS` at `Sheet1!A444:U444`. |
| Reebok | Sheet range `A1:L86`: one header plus exactly 85 Articles; product name, category, and season remain null with `NEEDS_ENRICHMENT`. |
| DOUBLEU | Detailed `Sheet1`, range `A2:S161`: one header plus 159 size rows grouped into exactly 29 Articles; source `SIZE US` values and gender spellings are retained, while operational gender normalizes to `MEN`/`WOMEN`. |
| Lee Cooper | Continuation colour rows inherit Article/category/gender; the grand-total row is excluded; parsed size quantities 39–45 reconcile to exactly 1,732 pairs. |

Every staged row retains the source file name, supplied SHA-256 identity, and stable worksheet or PDF locator. Conflicting field values retain their individual source locators.

## TDD evidence

1. The initial import suite failed because every requested parser module was absent.
2. After implementing the parser contracts and profiles, the six parser test files passed with 8 tests.
3. Script behavior tests then failed because both requested scripts were absent.
4. After implementing the scripts, the focused imports suite passed with 7 files and 10 tests.

## Verification

Fresh verification results before commit:

- `npm.cmd test -- --run tests/imports`: 7 files passed, 10 tests passed.
- Task 3-only TypeScript check using the repository compiler with `src/imports`, TypeScript import tests, and fixture sources: exit 0.
- `npm.cmd test -- --run`: 17 files passed, 54 tests passed.
- `npm.cmd run smoke`: unavailable because the shared bootstrap does not define a `smoke` script.
- `npm.cmd run typecheck`: exit 0.
- `npm.cmd run build`: exit 0. Wrangler reported a non-fatal sandbox-only debug-log write warning after the successful build because its user-level log directory is outside the workspace.
