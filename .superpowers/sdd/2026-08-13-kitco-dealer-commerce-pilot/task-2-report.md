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

## Review hardening

Commit: `fix: harden commerce invariants`

### Findings addressed

- Hold state and requests now require valid allocation identities and non-negative safe-integer state; hold requests must be positive safe integers.
- Holds and dispatches are enforced against an exact `(orderLineId, size)` allocation. A held size is blocked without affecting an unheld size on the same order line.
- Dispatch state, aggregate dispatch history, purchase quantities, MOQ, and multiples reject negative, fractional, non-finite, unsafe, or internally inconsistent values.
- Retail Value calculation checks both quantity addition and MRP multiplication for safe-integer overflow.
- Order versions are deep-copied and frozen at the version, line-array, line, and nested quantity-map levels.
- OTP instants are parsed before comparison, malformed timestamps are rejected, offset-equivalent instants compare correctly, and `now >= expiresAt` is expired.

### Regression-first evidence

- Initial review regression run: 17 expected behavioral failures and 9 passes across the order, hold, dispatch, and OTP tests.
- Malformed allocation-identity follow-up: 2 expected failures caused by unsafe `.trim()` calls; both now return typed domain failures.
- Focused green: `npm.cmd test -- --run tests/domain/orders.test.ts tests/domain/holds.test.ts tests/domain/dispatch.test.ts tests/domain/otp.test.ts tests/domain/catalogue.test.ts` — 5 files passed, 31 tests passed.
- Full green: `npm.cmd test -- --run` — 17 files passed, 54 tests passed.
- Task 2-only strict compile: explicit `npx.cmd tsc --noEmit --ignoreConfig ...` over all Task 2 sources/tests — passed.
- Production build: `npm.cmd run build` — exited 0 and emitted Worker/client artifacts; Wrangler again emitted only the known sandbox log-directory warning.

### Concurrent verification note

The repository-wide `npm.cmd run typecheck` was rerun and was temporarily blocked by concurrent untracked Task 4 work in `src/lib/supabase.ts` (`TS2559`) and `tests/database/clients.test.ts` (`TS2445`). The controller approved treating those out-of-scope errors as concurrent state; no Task 3 or Task 4 file was modified for this fix.
