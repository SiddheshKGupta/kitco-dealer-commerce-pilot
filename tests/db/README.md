# Production integration suite

Real Postgres. Real migrations. Real triggers. Real RLS. **No mocks, no fixtures, no repository doubles.**

## Why this exists

The v4 P0 — partial order approval never worked in production, not once — sailed
past **233 passing tests**, because every one of them ran against
`InMemoryCommerceRepository`. The database said submitted order rows are
immutable; the RPC said "update submitted order rows to record approval." Those
two statements are incompatible, and nothing in the test suite was positioned to
notice.

The rule that produced:

> **No mocked implementation is evidence that a database workflow works.**

Nothing in this directory may import a fixture, a fake, or a repository double.

## Running it

```bash
npm run test:db
```

Without credentials it **skips** rather than fails, so a contributor without
database access still gets a green `npm test`. It is excluded from the default
suite (see `exclude` in `vite.config.ts` and the separate `vitest.db.config.ts`).

### Credentials

Needs a Supabase **personal access token**:

```
SUPABASE_ACCESS_TOKEN=sbp_...
```

in the environment or in `.dev.vars` (gitignored). Create one at
<https://supabase.com/dashboard/account/tokens>.

`SUPABASE_SECRET_KEY` is deliberately **not** sufficient. PostgREST exposes table
CRUD and pre-declared RPCs only — it cannot execute an anonymous `DO` block, and
the suite depends on those. Optionally override `SUPABASE_PROJECT_ID` (defaults
to the pilot project).

## How it stays safe on a live database

The target database holds **live pilot data** — 3 real orders and 136 real
dealers. Two properties keep that safe:

1. **Nothing commits.** Every probe runs inside a PL/pgSQL `DO` block that ends
   by deliberately `RAISE`-ing an exception carrying its results. The raise
   aborts the transaction, so scaffolding never persists; the error message *is*
   the assertion payload. Same self-aborting pattern used to diagnose the P0
   (`docs/plan/V5_EXECUTION_PLAN.md` §3.3).

2. **It proves it afterwards.** The suite snapshots row counts at start and the
   final test re-reads them, failing if anything moved.

Cleanup-by-`DELETE` is not an option here anyway: `order_lines`,
`order_line_sizes` and `audit_events` all carry `BEFORE DELETE` triggers that
raise `55000`.

## What it covers

| Test | Guards against |
|---|---|
| probes every RPC the worker calls | the P0 class: an RPC that cannot write a table it claims to write |
| whole order lifecycle through the real RPCs | drift between the domain model and the actual schema |
| three-way split keeps the invariant | `ordered = approved + credit_review + rejected + pending` breaking |
| **regression guard: `decide_kitco_order_line_v5` never raises 55000** | the exact P0 returning |
| `approve_entire` approves only PENDING | silently overriding existing credit-review / rejected decisions (v5 §25) |
| `reject_entire` demands a reason | unreasoned bulk rejection |
| still blocks direct UPDATE/DELETE on submitted orders | a future migration quietly dropping the immutability guarantee |
| RLS enabled *and forced* on the four v5 tables | a new table shipping without tenant isolation |
| row counts match the start-of-suite snapshot | any probe having leaked |

## Adding a test

Reuse `SCAFFOLD_DECLARE` and the helpers in `harness.ts`. The shape is always:
build scaffolding inside a `DO` block, exercise the real RPC, collect results
into a text payload, then `raise exception` with it. Parse the returned message
and assert. Never `commit`.
