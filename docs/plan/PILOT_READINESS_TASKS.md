# KITCO Dealer Commerce — Pilot Readiness Task Plan

**Context:** confirmed by a three-part codebase audit ahead of a ~150-dealer pilot.
Each task below is an independently deployable gap-fix. Base commit for this plan: `d90c0a8`.

## Global Constraints (binding on every task)

- **Mobile is the priority surface.** Every UI change must be built and verified at
  360 / 390 / 430px first — no horizontal scroll, touch targets ≥44px (48px preferred).
  Desktop is secondary; it must not break, but mobile correctness is the bar.
- **Think from the user's side.** A dealer or admin using this on a phone in a shop should
  never wonder "did that work?" — every save/submit/approve shows a visible busy state and a
  clear result. Minimize steps. Don't surface a screen that requires scrolling to discover
  its own primary action.
- **Plain language only.** All user-facing copy (dealer and admin) must be simple, everyday
  English — no internal jargon, no technical identifiers (UUIDs, correlation IDs, "V1/V2",
  status enum names) ever shown to a dealer. Admin copy can be a little more operational but
  still plain — no raw enum values without a human label.
- **No dealer price/margin/GST estimate/payable/numeric stock anywhere dealer-facing** (v3.0
  §24/§26 — do not regress). Retail Value (MRP-based) is the only figure a dealer ever sees.
- **Every DB query must be scoped by `organisation_id` / `dealer_id` taken from the session**
  — never trust a client-supplied id. The Worker uses the service-role key and bypasses RLS,
  so a missing filter is a real cross-tenant data leak, not a cosmetic bug.
- **Order submission stays idempotent and immutable.** Never regress `Idempotency-Key`
  handling or allow a submitted order's evidence to be edited in place.
- **Match the existing design system.** Reuse `src/components/ui/*` primitives and the
  existing CSS custom-property tokens (`src/styles/global.css`, `src/features/admin/control.css`,
  `src/features/catalogue/commerce.css`). Do not invent a new button/input style.
- **Verification gate for every task**, run before considering it done:
  ```bash
  npm run typecheck && npm test -- --run --testTimeout=20000 && npm run build
  ```
- **Deploy** only reads `dist/kitco_dealer_commerce/wrangler.json` (via `npm run build`) —
  never deploy without building first.

---

## Task 1: Meaningful order numbers, mapped through to the UI

**Problem:** `submit_kitco_order` (supabase/migrations/20260813183000_atomic_order_submission.sql:116)
generates `order_number` as `'KIT-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))`
— a random 12-char hex string with no meaning. Separately, `orderFromRow()` in
`worker/supabase-commerce-repository.ts` selects `order_number` in `ORDER_SELECT` (already in
the query) but never maps it onto the returned `OrderRecord` object — so today dealers and
admins see the raw database UUID (`order.id`) everywhere in the UI instead.

**Do:**
1. Add a migration that changes new-order numbering to something a human can actually read
   and reference on the phone with a KITCO admin, e.g. `KIT-YYMM-00001` (year+month prefix +
   a per-organisation sequential counter, zero-padded to 5 digits). Use a Postgres sequence;
   update `submit_kitco_order` to use it instead of the uuid-substring approach. Existing rows
   keep their current (ugly but valid) `order_number` — don't rewrite history.
2. Add `orderNumber: string` to the `OrderRecord`/`OrderVersion`-adjacent shape returned by
   `orderFromRow()` in worker/supabase-commerce-repository.ts (and the in-memory
   `worker/repository.ts` equivalent, for test parity) — map `row.order_number` straight through.
3. Update every place that currently renders `order.id` (full or `.slice(0,8)`) as the
   dealer/admin-visible order label to render `order.orderNumber` instead. Grep for
   `order.id` in `src/features/` and `src/app/PilotSurfaces.tsx` — you'll find it in the
   dealer Orders list, the admin Orders queue table, and the admin order-review panel's audit
   table caption. `order.id` (the real uuid) should still be used internally for API calls
   (`/api/admin/orders/${order.id}/approve` etc.) — only the *displayed* label changes.
4. Update the CSV export (`worker/supabase-orders-export.ts`) if it isn't already using
   `order_number` for its "Order No" column — check first, it may already be correct.

**Out of scope:** do not touch order *status* language (that's a separate concern) or the
partial-approve/hold logic (Task 5).

---

## Task 2: Dealer-side expansive order view

**Problem:** the dealer-facing Orders screen (`OrdersSurface` in `src/app/PilotSurfaces.tsx`,
~line 42-50) renders each order as a flat card: order number, status, version, retail value,
and an aggregate fulfilment strip (`DealerFulfilmentStatus` — ordered/dispatched/pending/held
*pair counts only*, no article detail at all). A dealer cannot see which articles/sizes are in
which order without going back to their own memory of what they ordered.

**Do:**
1. Give each order card an expand/collapse control (or a "View details" link to a per-order
   detail view — your call, but mobile-first: a bottom sheet or inline expand reads better on
   a phone than a separate route if the list is usually short. If you add a route, it needs a
   real back-navigation affordance).
2. Expanded, show every article in the order: family/article name, colour, size×pairs
   breakdown, and per-article status in plain language (Ordered / Approved / On Hold /
   Dispatched / Pending pairs) — reuse the existing `groupByArticle`-style grouping pattern
   already used in `src/features/admin/AdminOrderPanel.tsx` (don't duplicate that logic if you
   can share it — check whether it can be extracted to a shared helper, e.g. in
   `src/features/dispatch/fulfilment.ts`, and reused by both the admin panel and this dealer
   view without an admin-only import).
3. Business language only — no V1/V2, no correlation IDs, no internal statuses. This is
   already a documented requirement (v3.0 §25/§53) — the existing `DealerFulfilmentStatus`
   component already gets this right at the aggregate level; match its tone at the per-article
   level.
4. Verify at 360/390/430px — a 20+ pair order across 4 articles must not become an
   unreadable wall of text on a small screen.

---

## Task 3: Admin order queue — real columns, correct line targeting

**Problem:** two related gaps in `src/features/admin/ControlConsole.tsx`'s `OrdersSection`
(~line 85-115):
1. The queue table only shows Order / Version / Lines / Retail Value / Status — the plan's
   accept criteria (V4_EXECUTION_PLAN.md Slice 8, ~line 316-317) requires Order No, Dealer,
   City, State, Submitted, Articles, Pairs, Retail Value, Status, Approved, Held, Dispatched,
   Pending, with filters. None of the dealer/location columns exist because `OrdersSection`'s
   `LiveOrder` type has a `dealerName`/`submittedAt` field declared but the admin orders API
   response doesn't appear to populate them consistently — verify and fix the data plumbing
   (`worker/routes/admin-orders.ts` or wherever `/api/admin/orders` is implemented) so dealer
   name, city, state, and submitted-at are actually returned per order.
2. In `src/features/admin/AdminOrderPanel.tsx` line ~27:
   `const allocation = order.allocations[0];` — this wires the `DispatchForm` and
   `CreditHoldPanel` to always target the FIRST line/size row of the order, regardless of
   which article the admin is actually looking at in the per-article tables rendered above it.
   Fix this so dispatch/hold actions target the specific line+size the admin selects (add a
   selection control per row, or render a dispatch/hold action inline per line-size row instead
   of one shared panel at the bottom — mobile-first, so prefer inline row actions over a
   separate global panel if that fits the existing table layout better).

**Do not** attempt the full partial-approve-quantity redesign here — that's Task 5. This task
is: correct queue columns + correct line targeting for the *existing* dispatch/hold actions.

---

## Task 4: Gender — full normalization + visible on card and PDP

**Problem:** two gaps in `worker/supabase-commerce-repository.ts`'s `normalizeGender` (~line
29-37): (a) it only explicitly maps MEN/MENS and WOMEN/WOMENS — KIDS, UNISEX, or any typo'd
source value just gets uppercased and passed through raw, and a missing/blank value returns
`null` rather than the literal string the rest of the system should treat as "unknown". (b)
Downstream, `CataloguePage.tsx`'s filter facet builder silently drops any product with a null
gender from the Gender filter entirely — a product with no gender data just becomes invisible
to that filter, which the plan explicitly says must not happen (v4.0 §41 — "never fabricate,
absent stays UNKNOWN", i.e. it must render as a filterable "Unknown", not vanish). Separately,
neither the product card (grep `ProductGrid` or wherever cards render in
`src/features/catalogue/`) nor the PDP (`src/features/orders/DealerOrderJourney.tsx`) actually
displays gender/category text at all (§19.3 wants `Men · Running` style copy on the card).

**Do:**
1. Fix `normalizeGender` to explicitly handle the full vocabulary `MEN | WOMEN | KIDS |
   UNISEX | UNKNOWN` (case-insensitive, common plural variants) and return `"UNKNOWN"` (not
   `null`) for anything blank or unrecognized.
2. Fix the catalogue filter facet logic so a product with `gender === "UNKNOWN"` still shows
   up under an "Unknown" option in the Gender filter, rather than disappearing from the facet.
3. Add gender (title-cased) + category to the product card copy, and to the PDP header area,
   following the existing copy pattern already used for brand/colour/MRP on those components
   (match existing typography/spacing conventions — don't introduce a new text style).
4. Verify at 360/390/430px that this doesn't crowd the card layout.

---

## Task 5: Partial approve/hold — real per-line/size decision, structured reason

**Problem (the big one):** `approve_kitco_order` (see
`supabase/migrations/20260813184500_admin_fulfilment_rpc.sql`) only flips the whole order's
status to APPROVED — it takes no per-line/size quantities. `approved_quantity_pairs` is
actually pre-set equal to `ordered_quantity_pairs` at submission time
(`atomic_order_submission.sql` ~line 139-145), so every order effectively starts "fully
approved" with no path to write a smaller number. The only hold mechanism,
`apply_kitco_credit_hold`, requires the order already be APPROVED/PARTIALLY_APPROVED first
(approve-then-hold, not one atomic decision), and its `hold_type` check constraint is
`['CREDIT','OPERATIONAL']` — not the plan's required 6-value reason vocabulary
`CREDIT_HOLD | STOCK_REVIEW | COMMERCIAL_REVIEW | ALLOCATION_PENDING | MANUAL_REVIEW | OTHER`,
and `reason` is unstructured free text today.

**Do:**
1. New migration: an audited Postgres function that lets an admin submit, per order line +
   size, an `approved_quantity_pairs` and `held_quantity_pairs` with a `hold_reason` drawn from
   the 6-value enum above, enforcing `approved + held <= ordered` (pilot: require
   `approved + held = ordered` before the order can be finalised, per the plan's §27.2). Model
   this as *separate allocation data*, not a rewrite of the dealer's original submitted
   order/version (the submitted evidence must stay immutable). Write an audit event capturing
   who/when/what/how-many for every decision (v3.0 §109 — audit events are never mutable).
2. Widen (or replace) the `hold_type`/reason constraint to the 6-value vocabulary. Decide
   whether to migrate existing CREDIT/OPERATIONAL rows to the closest new value (CREDIT →
   CREDIT_HOLD, OPERATIONAL → OTHER) or leave history alone and only enforce the new
   vocabulary going forward — pick whichever is simpler and document the choice in the
   migration comment.
3. Admin UI: give `AdminOrderPanel.tsx` a real per-line/size decision control (approve
   quantity / hold quantity / reason dropdown, one row per size) instead of the current
   whole-order "Approve order" button plus a bottom `DispatchForm`/`CreditHoldPanel` pinned to
   line 1 (Task 3 will already have partially addressed the line-1 bug — coordinate with
   that, but this task supersedes it for the approve/hold path specifically). Mobile-first
   layout: this is likely the densest table in the whole app — make sure it's still usable at
   390px (stacked cards per size row, not a wide table that requires horizontal scroll).
4. Dealer-facing: confirm `DealerFulfilmentStatus`/the Task 2 expansive view correctly reflects
   a real partial decision (e.g. 70 approved / 30 held on one size) once this exists — add a
   quick end-to-end check (submit → partially approve+hold → verify dealer sees it correctly)
   as part of this task's own verification, not a separate task.

**This task depends on Task 3 (line-targeting fix) landing first** — do not start it before
Task 3's review is clean, since it touches the same `AdminOrderPanel.tsx` region.

---

## Task 6: CSV export — filters + column count to spec

**Problem:** `worker/routes/admin-export.ts` emits exactly 26 CSV headers; the plan's brief
§29 specifies 30 columns exactly (the canonical list isn't duplicated elsewhere in this repo —
if you can't locate the original client brief text for §29, use your best judgment to fill
the gap with columns a KITCO ops person would obviously need that are currently missing, e.g.
per-line hold reason, dispatch date, and note the assumption in your commit message). Separately,
zero filters are implemented: the route reads no query params at all (`context.req.query()` is
never called) and just dumps every order for the organisation unconditionally, even though the
accept criteria explicitly requires filtering by dealer, date range, brand, order status, hold
status, and state.

**Do:**
1. Add query-param filters (dealer id, date range, brand, order status, hold status, state) to
   the `/api/admin/orders/export.csv` route and thread them into
   `SupabaseOrdersExporter.exportRows` (`worker/supabase-orders-export.ts`) as real SQL-level
   filters — don't filter in memory after fetching everything.
2. Add a simple filter UI to the admin Reports section (`ReportsSection` in
   `src/features/admin/ControlConsole.tsx` already has a status filter for the on-screen table
   — extend that pattern to also apply to the CSV export link's query string, and add the
   remaining filter controls: dealer, date range, brand, hold status, state).
3. Reconcile the column count/list per the note above.
4. Keep organisation scoping intact — this must never leak cross-tenant data regardless of
   which filters are applied.

---

## Task 7: GSTIN + address collection during existing-dealer activation

**Problem:** the plan (v4.0 §13/§14, binding) requires activation to collect GSTIN and a
structured address (required but explicitly unvalidated per decision D5/D6), pre-filled from
whatever KITCO already has on file. The current activation flow
(`src/features/activation/ActivationPage.tsx`) goes straight from dealer-lookup to
email-choice to OTP-verify to done — there is no GSTIN/address step, and the `dealers` table
has no columns to store it (confirmed via direct query: no `gstin`, `address_line1`,
`address_line2`, `district`, `pin_code`, `contact_person`, `mobile` columns exist today).

**Do:**
1. Migration: add the missing columns to `dealers` (gstin unvalidated per D5, address fields,
   contact_person, mobile) — additive only, nullable, never overwrite `master_email`.
2. Add a "Confirm business" step to `ActivationPage.tsx` between dealer-lookup and
   email-choice: GSTIN + structured address fields, pre-filled where a value already exists on
   the dealer record, required to proceed but not format-validated (match the validation
   posture already used in `RegisterPage.tsx`'s GSTIN field — 15 chars, no regex check beyond
   that, for consistency with the pattern this codebase already established).
3. Persist the collected values to the new `dealers` columns as part of the existing
   `activate()` call (or a step just before it) in whichever file implements `ActivationStore`
   (`worker/auth/supabase-auth.ts`, `SupabaseActivationStore.activate`).
4. Mobile-first: this is one more step in an already-mobile flow — keep it to one screen, one
   scroll, large touch targets, matching the existing `.auth-page` pattern used by every other
   activation step.

---

## Notes for every implementer

- This repo has no separate PR/review-branch workflow in this session — work happens directly
  on the current worktree/branch (`codex/kitco-pilot`) and gets committed with a normal `git
  commit`. Do not create a new worktree or branch.
- After your changes pass the verification gate, commit with a clear message (no need to
  push or deploy — the controller handles deploy once the task's review is clean).
- If you find you need a decision only the product owner can make that isn't answered by this
  brief, report status `NEEDS_CONTEXT` with the specific question rather than guessing.
