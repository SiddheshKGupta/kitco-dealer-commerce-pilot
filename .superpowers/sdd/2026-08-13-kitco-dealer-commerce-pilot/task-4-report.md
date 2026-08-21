# Task 4 Report — Supabase Commerce Schema and RLS

## Outcome

Implemented the local, review-ready Supabase foundation for the KITCO dealer commerce pilot. No live migration, seed, project mutation, or advisor command was run from this task.

The target project created by the controller is `lvbgpgsgotadoneyrtyt` (`KITCO Dealer Commerce Pilot`, `ap-south-1`). The repository's `supabase/config.toml` deliberately retains a stable local project identifier; remote linkage remains environment-local and should be performed by the controller without committing credentials or generated temporary state.

## Delivered

- Imperative Supabase layout: `supabase/config.toml`, one timestamped migration, and `supabase/seed.sql`.
- 47 connected public tables across organisation/dealer identity, catalogue and size data, commercial offerings, imports, schemes, draft and submitted orders, dispatches, holds, OTP evidence, audit, and exports.
- Lowercase `snake_case`, `timestamptz`, UUID keys, integer minor-unit currency fields, checks, uniqueness constraints, and explicit indexes for foreign keys and RLS predicates.
- RLS enabled and forced on every exposed `public` table. Dealer reads derive scope from `auth.uid()` through `app_users`; client writes are limited to dealer-owned drafts and cancellation requests. Import, dispatch, hold, approval, and submitted-order mutations have no authenticated client write policy.
- Private `SECURITY DEFINER` membership helpers use `search_path = ''`, explicitly validate `(select auth.uid())`, revoke default `PUBLIC` execution, and grant only the policy-required authenticated execution.
- Submitted order-version rows and their line/allocation children reject update/delete. Audit events reject update/delete and direct authenticated insert/update/delete.
- Synthetic VLCO seed uses the runtime PostgreSQL setting `app.settings.vlco_test_email`, populated from deployment configuration `VLCO_TEST_EMAIL`. It commits no email address and skips the operational dealer with a notice when configuration is absent.
- Pinned `@supabase/supabase-js` `2.112.3`, browser publishable-key factory, and server-only secret-key factory with session persistence disabled for the Worker admin client.

## TDD and Verification

The database suite was written first and observed failing because the migration and client modules did not exist. It now statically verifies table coverage, timestamp/money conventions, representative indexes, RLS coverage, ownership/write-policy shape, private-function hardening, version immutability, audit append-only behavior, seed/client configuration, and client factories.

Latest focused evidence before commit:

- `npm test -- --run tests/database`: 4 files, 12 tests passed.
- `npm run typecheck`: passed.
- `git diff --check -- supabase src/lib worker/lib tests/database`: passed.
- `npm test -- --run`: 17 files, 54 tests passed.
- `npm run build`: exited 0 and emitted the Worker and client production bundles. Its output was not pristine because the concurrent Task 3 post-build `scripts/prepare-seed.mjs` rejected unresolved Nike fixture conflicts and Wrangler could not create its external sandboxed debug-log directory; neither warning originates in or was changed by Task 4.

The Supabase CLI discovery requirement was attempted without a global install. `supabase` was absent; the PowerShell `npx.ps1` shim was blocked by local execution policy, and `npm exec --offline -- supabase --help` confirmed the CLI is not cached. Docker and `psql` are also absent, so connected SQL execution was not available locally and the tests intentionally inspect the migration artifact.

## Deferred Controller Steps

After reviewing the migration, the controller should:

1. Link the repository environment to project `lvbgpgsgotadoneyrtyt` without committing tokens or `.temp` state.
2. Apply the migration to that dedicated project.
3. Set `VLCO_TEST_EMAIL` through approved secret/configuration flow and seed the synthetic dealer (for SQL seeding, map it to `app.settings.vlco_test_email` for the seed transaction).
4. Create the corresponding Supabase Auth user and `app_users` mapping through a privileged audited path; the seed intentionally does not create or commit credentials.
5. Run connected Dealer A/B RLS mutation/read tests plus submitted-version and audit mutation attempts.
6. Run Supabase security and performance advisors and resolve findings before cloud flow work.

These live operations were deferred to preserve the controller's explicit apply-after-review boundary.
