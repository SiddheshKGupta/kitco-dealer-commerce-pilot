# Task 2 Report: Core commerce invariants

## Commit

`feat: encode dealer commerce rules`

## Files

- `src/domain/catalogue.ts`
- `src/domain/orders.ts`
- `src/domain/dispatch.ts`
- `src/domain/holds.ts`
- `src/domain/otp.ts`
- `tests/domain/catalogue.test.ts`
- `tests/domain/orders.test.ts`
- `tests/domain/dispatch.test.ts`
- `tests/domain/holds.test.ts`
- `tests/domain/otp.test.ts`

## Red evidence

`npm.cmd test -- --run tests/domain` failed as expected before implementation:

- all five domain test files failed to resolve their corresponding missing `src/domain/*` module;
- the Vitest environment and shared test setup loaded successfully, so the failure identified the absent domain behavior rather than test configuration.

## Green evidence

- `npm.cmd test -- --run tests/domain` — 5 files passed, 16 tests passed.
- `npm.cmd run typecheck` — passed (`tsc --noEmit`).
- `npm.cmd test -- --run` — 6 files passed, 17 tests passed.
- `npm.cmd run build` — exited 0 and produced Worker/client artifacts. Wrangler emitted non-fatal sandbox logging errors when attempting to create `C:\Users\Siddhesh\AppData\Roaming\xdg.config`; output artifacts were still built.

## Scope and concerns

- Implemented only pure domain rules: normalized catalogue identity, configured sizes and offering windows, MOQ/multiples and authoritative integer-minor-unit Retail Value, immutable version copying/idempotency, dispatch pending and hold protections, and OTP expiry/purpose/attempt/replay rules.
- No Escapement dependency or generated files were added.
- `package.json` has no lint script, so a lint command was not available to run.
- `tests/contrast.mjs` and `tests/harness.mjs` were deleted by the concurrently authorized Task 1 review fix; they are intentionally excluded from this Task 2 commit.
