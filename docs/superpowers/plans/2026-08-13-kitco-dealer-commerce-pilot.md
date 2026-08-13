# KITCO Dealer Commerce Pilot Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task.

**Goal:** Deliver and deploy a production-shaped KITCO dealer-commerce pilot with real email OTP, five deterministic source imports, Nike-inspired dealer UX, immutable ordering, approval, dispatch, Credit Hold, and dealer-visible fulfilment.

**Architecture:** A React/TypeScript Vite application and Hono API run as one Cloudflare Worker with Static Assets. Supabase Auth and Postgres hold canonical identity and business state behind RLS. R2 stores immutable source files and exact product media. Browser requests use the Worker as the application boundary; the Worker derives dealer scope, recalculates commercial values, and sends purpose-specific OTP emails through Resend.

**Tech stack:** React, TypeScript, Vite, Hono, Cloudflare Workers/Static Assets/R2, Supabase Auth/Postgres/RLS, Resend HTTP API, Vitest, Testing Library, Playwright, XLSX parsing, PDF text extraction, Sharp build-time media transforms.

---

## Execution rules

- Work test-first for every business rule and bug fix.
- Keep one connected happy path working after each task.
- Run the listed focused test before each commit and the full smoke suite after every three tasks.
- Never commit secrets, dealer passwords, OTP values, private keys, raw source files, or user inboxes.
- Treat the supplied Markdown handover as governing when the old prototype conflicts.
- Do not claim completion until local and deployed verification evidence exists.

## Task 1: Initialize Escapement and replace the legacy shell

**Files:**

- Create: `AGENTS.md` and Escapement-generated governance files
- Replace: `package.json`, `index.html`
- Create: `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `wrangler.jsonc`
- Create: `src/main.tsx`, `src/app/App.tsx`, `src/app/router.tsx`
- Create: `src/styles/tokens.css`, `src/styles/global.css`
- Create: `worker/index.ts`, `worker/env.ts`
- Create: `tests/setup.ts`, `tests/smoke/app-shell.test.tsx`

1. Clone the requested Escapement repository into a temporary directory, inspect its current initialization instructions, and initialize it against this repository.
2. Read every generated repository instruction file before editing application code.
3. Write a failing smoke test asserting the KITCO logo, `Dealer Commerce Platform`, dealer navigation, and pilot attribution render.
4. Run `npm test -- --run tests/smoke/app-shell.test.tsx` and confirm the expected failure.
5. Bootstrap the Worker/Vite/React shell and pinned dependencies with a committed lockfile.
6. Make the shell test pass and run `npm run typecheck && npm run build`.
7. Commit: `chore: bootstrap KITCO dealer commerce worker`.

## Task 2: Establish domain rules with deterministic tests

**Files:**

- Create: `src/domain/catalogue.ts`, `src/domain/orders.ts`, `src/domain/dispatch.ts`, `src/domain/holds.ts`, `src/domain/otp.ts`
- Create: `tests/domain/catalogue.test.ts`, `tests/domain/orders.test.ts`, `tests/domain/dispatch.test.ts`, `tests/domain/holds.test.ts`, `tests/domain/otp.test.ts`

1. Write failing tests for family/colourway identity, configurable sizes, offering eligibility, MOQ/multiples, authoritative Retail Value, immutable versions, idempotency, dispatch pending quantity, over-dispatch rejection, partial holds, OTP expiry/attempts/purpose/replay.
2. Run `npm test -- --run tests/domain` and verify failures are behavioral rather than setup errors.
3. Implement pure functions with integer minor units for money and integer pairs for quantity.
4. Run the domain suite, typecheck, and lint.
5. Commit: `test: define KITCO commerce invariants`.

## Task 3: Implement the five source profiles

**Files:**

- Create: `src/imports/types.ts`, `src/imports/profile-detection.ts`, `src/imports/dealers.ts`, `src/imports/nike.ts`, `src/imports/reebok.ts`, `src/imports/doubleu.ts`, `src/imports/lee-cooper.ts`, `src/imports/normalize.ts`
- Create: `scripts/build-source-fixtures.mjs`, `scripts/prepare-seed.mjs`
- Create: `tests/imports/*.test.ts`, `tests/fixtures/imports/*`

1. Create minimal sanitized fixtures from the supplied files; fixtures must retain structural edge cases without committing private dealer contact data.
2. Write failing tests for replacement dealer counts, Nike repeated headers and two known conflicts, Reebok null enrichment fields, DOUBLEU size-row grouping, and Lee Cooper continuation rows plus the 1,732-pair total.
3. Implement profile detection, canonical row types, raw lineage, warnings/conflicts, stable source locators, and SHA-256 duplicate identity.
4. Run `npm test -- --run tests/imports` and `npm run smoke`.
5. Commit: `feat: add deterministic KITCO source parsers`.

## Task 4: Create the Supabase schema and RLS boundary

**Files:**

- Create: `supabase/config.toml`
- Create: `supabase/migrations/<generated>_kitco_core.sql`
- Create: `supabase/seed.sql`
- Create: `tests/database/rls.test.ts`, `tests/database/schema.test.ts`
- Create: `src/lib/supabase.ts`, `worker/lib/supabase-admin.ts`

1. Discover the installed Supabase CLI commands with `supabase --help`; use an imperative migration workflow because no declarative schema exists.
2. Write database tests that expect Dealer A/B isolation, admin-only mutations, immutable submitted versions, and append-only audit events.
3. Create the minimum connected schema from the approved design, including organisation scoping, dealer mappings, catalogue/offering/size data, OTP challenges, orders/versions, dispatches, holds, imports, and audit.
4. Enable RLS on every exposed table; combine `TO authenticated` with ownership predicates and both `USING`/`WITH CHECK` where applicable.
5. Keep privileged functions in a non-exposed schema, revoke default `PUBLIC` execution, and validate `auth.uid()` explicitly.
6. Seed the synthetic VLCO dealer using `VLCO_TEST_EMAIL` at runtime rather than committing a real inbox.
7. Run migrations in the selected Supabase project, execute the RLS tests, then run Supabase security and performance advisors.
8. Commit: `feat: add Supabase commerce schema and RLS`.

## Task 5: Build real email OTP and authenticated Worker sessions

**Files:**

- Create: `worker/auth/otp-service.ts`, `worker/auth/email-provider.ts`, `worker/auth/resend-provider.ts`, `worker/auth/session.ts`
- Create: `worker/routes/activation.ts`, `worker/routes/login.ts`, `worker/routes/otp.ts`
- Create: `tests/worker/auth.test.ts`, `tests/worker/resend-provider.test.ts`
- Update: `worker/env.ts`, `wrangler.jsonc`, `.dev.vars.example`

1. Write failing tests for activation lookup privacy, master-email preservation, single activation lock, password pending-session isolation, OTP hashing, expiry, attempt limits, purpose isolation, replay rejection, resend cooldown, provider errors, and log redaction.
2. Implement a capture provider for tests and a Resend HTTP provider for runtime.
3. Keep pending Supabase authentication server-side until login OTP verification; issue secure HttpOnly application cookies only after success.
4. Require `RESEND_API_KEY`, `OTP_FROM_EMAIL`, and `VLCO_TEST_EMAIL` in deployed environments and fail closed when missing.
5. Run `npm test -- --run tests/worker/auth.test.ts tests/worker/resend-provider.test.ts`.
6. Commit: `feat: add real purpose-specific email OTP`.

## Task 6: Build authoritative catalogue and order APIs

**Files:**

- Create: `worker/middleware/auth.ts`, `worker/middleware/correlation.ts`, `worker/middleware/errors.ts`
- Create: `worker/routes/catalogue.ts`, `worker/routes/drafts.ts`, `worker/routes/orders.ts`, `worker/routes/admin-orders.ts`, `worker/routes/dispatch.ts`, `worker/routes/holds.ts`, `worker/routes/imports.ts`, `worker/routes/media.ts`
- Create: `tests/worker/catalogue.test.ts`, `tests/worker/orders.test.ts`, `tests/worker/admin.test.ts`

1. Write failing route tests for dealer scoping, hidden numeric stock, forged-MRP rejection, size/MOQ/multiple validation, idempotent OTP submission, immutable revision, approval, dispatch, hold, cancellation, and audit correlation.
2. Implement typed Hono routes and Zod request boundaries; derive organisation/dealer identity from the verified server session.
3. Recalculate Retail Value from canonical MRP and pairs on the server.
4. Return no dealer price, margin, GST estimate, payable amount, or numeric availability.
5. Run worker tests and `npm run smoke`.
6. Commit: `feat: add authoritative commerce API`.

## Task 7: Prepare canonical seed data and exact Nike media

**Files:**

- Create: `scripts/import-sources.mjs`, `scripts/prepare-media.mjs`, `scripts/upload-r2.mjs`
- Create: `src/generated/import-manifest.json`, `src/generated/media-manifest.json`
- Create: `public/brand/kitco-sports.png`
- Create: `tests/scripts/import-sources.test.ts`, `tests/scripts/media.test.ts`

1. Copy the supplied KITCO logo into the public brand path without altering the source file.
2. Write failing manifest tests for all five imports, the exact 90 Nike Article matches, 1600x1600 source validation, and no cross-colourway substitution.
3. Build raw-file hashes, canonical seed payloads, conflict evidence, and media variants at 200/600/900/1400 WebP.
4. Upload immutable raw files and media to private R2, then load canonical rows through audited server-side import endpoints.
5. Verify expected record counts and both Nike conflicts in Supabase.
6. Commit code/manifests only: `feat: prepare KITCO catalogue and media ingestion`.

## Task 8: Build dealer activation and login UI

**Files:**

- Create: `src/features/activation/*`, `src/features/auth/*`
- Create: `src/components/KitcoHeader.tsx`, `src/components/OtpInput.tsx`, `src/components/RouteTransition.tsx`
- Create: `tests/ui/activation.test.tsx`, `tests/ui/login.test.tsx`

1. Write failing interaction tests for autocomplete privacy, city disambiguation, masked/master versus self-declared email, real OTP request/verify states, resend countdown, password creation, login OTP, provider failure, focus management, and reduced motion.
2. Implement the approved black/white KITCO shell, rounded primary actions, 160-220ms motion, visible focus, and mobile pilot badge.
3. Use optimistic UI only for non-authoritative display state; surface server errors precisely.
4. Run UI tests and accessibility smoke checks.
5. Commit: `feat: add dealer activation and email OTP login`.

## Task 9: Build Nike-inspired catalogue and Current Order

**Files:**

- Create: `src/features/catalogue/*`, `src/features/orders/*`
- Create: `src/components/ProductGrid.tsx`, `src/components/FilterRail.tsx`, `src/components/MobileFilterDrawer.tsx`, `src/components/SizeGrid.tsx`
- Create: `tests/ui/catalogue.test.tsx`, `tests/ui/current-order.test.tsx`, `tests/e2e/dealer-order.spec.ts`

1. Write failing tests for tabs, search/filter/sort, responsive grid, exact colourway media, placeholder behavior, size quantities, MOQ/multiple errors, draft persistence, Retail Value, delivery allocation, review, fresh OTP, and immutable submission.
2. Implement the desktop filter rail, mobile drawer, square grey image stages, family/colourway PDP, sticky add action, and Current Order flow.
3. Ensure product cards and review pages show only MRP/Retail Value and pairs.
4. Run UI tests and the dealer-order browser smoke test.
5. Commit: `feat: add dealer catalogue and ordering journey`.

## Task 10: Build KITCO Control and fulfilment visibility

**Files:**

- Create: `src/features/admin/*`, `src/features/dispatch/*`, `src/features/holds/*`, `src/features/reports/*`
- Create: `tests/ui/admin-orders.test.tsx`, `tests/e2e/fulfilment.spec.ts`

1. Write failing tests for admin order review, approval/revision, partial dispatch, over-dispatch rejection, partial Credit Hold, audit visibility, and dealer Ordered/Dispatched/Pending reconciliation.
2. Implement the denser KITCO Control navigation and task-first tables.
3. Complete the end-to-end dealer -> order OTP -> admin approval -> dispatch/hold -> dealer status flow.
4. Run the fulfilment browser smoke and the full smoke suite.
5. Commit: `feat: complete KITCO order fulfilment pilot`.

## Task 11: Local ultra-review

**Files:**

- Create: `docs/reviews/2026-08-13-local-ultra-review.md`
- Update: application/tests only for verified findings

1. Run `npm run verify` for unit/integration/UI tests, typecheck, lint, build, and browser smoke.
2. Review secrets, auth boundaries, RLS, IDOR/BOLA, OTP replay, forged commercial data, immutable orders, over-dispatch, source lineage, responsive layout, keyboard/focus, contrast, reduced motion, and error states.
3. Record evidence and severity-ranked findings; fix every Critical/High issue and rerun affected tests.
4. Use the verification-before-completion and requesting-code-review skills before declaring the local build ready.
5. Commit: `test: complete KITCO local ultra-review`.

## Task 12: Deploy and verify on Cloudflare

**Files:**

- Create: `docs/deploy/cloudflare.md`, `docs/reviews/2026-08-13-cloud-review.md`
- Update: `wrangler.jsonc` and deployment configuration only as required by verified runtime behavior

1. Select the intended Supabase project and Cloudflare account/project without creating paid resources silently.
2. Configure publishable Supabase settings and set `SUPABASE_SECRET_KEY`, `SESSION_SECRET`, `RESEND_API_KEY`, `OTP_FROM_EMAIL`, and `VLCO_TEST_EMAIL` as Cloudflare secrets/configuration.
3. Configure the private R2 binding, deploy migrations/import data, and deploy the Worker.
4. Run deployed health/build checks, then perform real inbox OTP tests for activation, login, order submission, and revision acceptance.
5. Run the complete deployed dealer/admin/fulfilment browser flow and inspect Worker, Supabase Auth, database, and provider logs for errors or leaked sensitive values.
6. Record URLs, versions, smoke evidence, and remaining non-blocking issues in the cloud review.
7. Commit: `docs: record KITCO cloud deployment verification`.

## Required configuration before the live email smoke

- `VLCO_TEST_EMAIL`: a real inbox controlled by the user.
- `OTP_FROM_EMAIL`: a sender on a Resend-verified domain, or the Resend onboarding sender where account restrictions permit.
- `RESEND_API_KEY`: entered directly as a Cloudflare secret; never sent in chat or committed.
