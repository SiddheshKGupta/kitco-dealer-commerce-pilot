# KITCO Dealer Commerce v5 — Execution Plan

**Status:** Phase 0 complete. Decisions frozen 2026-08-24.
**Nature:** Uplift of the live v4 pilot. Not a rebuild.

---

## 1. What changed, and why the v4 model could not absorb it

v4 modelled a dealer like an ecommerce account: one dealer, one login, one set of
addresses, orders approved or not. v5's business model is an enterprise B2B
account structure. The gap is not cosmetic — it is the object model.

The correction was validated against a real Nike.net B2B operational screen
(dealer-supplied, 2026-08-20), which shows the vocabulary a mature wholesale
platform actually uses:

| Nike.net shows | KITCO v4 had | v5 introduces |
|---|---|---|
| `5098725 HP LIFESTYLE PRIVATE LIMITED` (Sold-To) + `5098726 HARYANA` (Ship-To) | one dealer, `dealer_locations` | Dealer Group → Dealer (Sold-To) → Locations, with Bill-To/Ship-To as *partner functions* |
| Order # **and** PO # | order number only | `dealer_po_number` on the order |
| CRD (Customer Request Date) **and** Estimated Delivery Date | neither | `requested_delivery_date` + `estimated_delivery_date`, never conflated |
| Column "Credit Hold Status", value `UNDER CREDIT REVIEW` | "Credit Hold" everywhere | internal mechanics keep `hold`; UI says **Credit Review** |
| Requested / Confirmed / Rejected / Shipped / Open | ordered + approved only, no reject | four commercial buckets + separate fulfilment axis |

Nike's own data satisfies the invariant we are adopting: `Requested 73 = Confirmed 50 + Rejected 23`.

---

## 2. Frozen decisions

| # | Decision | Resolution |
|---|---|---|
| A1 | Pilot vs v5 | **Freeze the v4 pilot**, build v5 on `main`. |
| A2 | Existing 136 dealers | Issue email (their provided primary) + password. Group membership by **request → KITCO approves**, never auto-join. VLCO stays as-is (test account). |
| A3 | P0 trigger bug | Fixed in Phase 0 (below), not deferred. |
| B5 | Login identifier | **Dealer Code.** One field, not a separate Dealer ID. |
| B6 | GSTIN sharing | **Permitted.** `gst_registrations` is its own table: one registration → many dealers; one dealer → exactly one registration. GSTIN unique on the *registration*, never on the dealer. |
| B7 | `dealer_locations` | **Survives.** Checkout is Ordering Dealer → Bill-To Dealer → Ship-To Dealer → Ship-To Location. |
| B8 | Where decisions live | **New mutable `order_line_decisions` table.** Submission stays immutable. |
| B9 | Invariant | `ordered = approved + credit_review + rejected + pending`, `pending` derived. |
| B10 | `(8 x 10)` format | **UI/email only.** CSV keeps wide size columns. |
| B11 | Credit Review | **Presentation rename only.** No DB rename. |
| C12 | GST provider | Deferred to a later phase. Mock adapter + `NOT_LIVE_VERIFIED` until real GSP credentials exist. |
| C14 | Size system | `size_system` on size sets, admin-mappable, admin can add new systems. |
| C15 | Notification drain | **Both:** `ctx.waitUntil()` immediate attempt + Cloudflare Cron (`* * * * *`) retry sweep. |
| C16 | Email | Resend Pro required before rollout (Free = 100/day; ~110/day expected at 30 orders). Split senders: `security@`, `orders@`, `notifications@` on the existing verified `notify.kitco.co.in`. |
| C17 | `PILOT_STATIC_OTP` | **Removed from production.** Tests inject a deterministic OTP provider; production never accepts `123456`. |

### Why group membership is request-approve, not code-entry

A group code is discoverable. If entering `OPENAI001` auto-joined the group, the
code becomes a de-facto password and the joiner immediately gains Bill-To/Ship-To
reach into every dealer in that group — exactly what §3 forbids. The dealer
enters the code; KITCO approves. One button for the demo, invitation tokens later.

---

## 3. Phase 0 — COMPLETE

### 3.1 The P0: partial approval never worked in production

`kitco_core.sql` puts `BEFORE UPDATE OR DELETE` triggers running
`private.reject_mutation()` on `order_versions`, `order_lines`,
`order_line_sizes`. `decide_kitco_order_line` then tried to UPDATE
`order_line_sizes.approved_quantity_pairs`. Those statements are logically
incompatible. Proven against the live database:

```
order_line_sizes UPDATE = BLOCKED[55000: order_line_sizes is immutable]
order_lines      UPDATE = BLOCKED[55000: order_lines is immutable]
```

**All 233 tests passed** because they exercise `InMemoryCommerceRepository`, never
Postgres. The mocked repo was never evidence that the database workflow worked.

### 3.2 The fix

Stop mutating the dealer's submission. Decisions become their own row:

```
order_line_sizes      (immutable)  "dealer ordered US 9 x 10"
         |
order_line_decisions  (mutable)    "approved 7, credit review 2, rejected 1, pending 0"
```

`pending_qty` is a **generated column** — the invariant is enforced by the schema,
not by convention, and pending can never be independently edited.

Delivered:
- `20260824100000_v5_dealer_groups_and_gst.sql`
- `20260824110000_v5_order_line_decisions.sql`
- `20260824120000_v5_fix_bulk_decision_counts.sql`

New RPCs: `decide_kitco_order_line_v5`, `approve_entire_kitco_order`,
`reject_entire_kitco_order` (§27: whole-order actions are one atomic backend
operation, never a React loop over 50 article calls).

### 3.3 Verified against real Postgres

```
1 PARTIAL       ordered=10 approved=7 credit=2 rejected=1 pending=0  invariant=TRUE
2 BULK_APPROVE  lines=5  pairs_approved=50   status -> CREDIT_REVIEW
3 BULK_REJECT   lines=12 pairs_rejected=89   status -> REJECTED
4 ORDER TOTALS  60 = 57 + 2 + 1 + 0          reconciles=TRUE
5 AUDIT         line=1 bulk=1 reject=1
```

Run inside a self-aborting transaction; live pilot data untouched (re-verified
after: all three orders back at `SUBMITTED`, fully pending, 3 genuine
`ORDER_SUBMITTED` audit rows only).

The probe also caught a bug in the first cut of the bulk RPCs: `RETURNING
pending_qty` returns the *post*-update value of a generated column — always 0,
because the update is what consumes it. Totals are now read before the update.
That bug would have shipped silently under mocked tests.

---

## 4. Remaining phases

| Phase | Scope | Depends on |
|---|---|---|
| 1 | Dealer Group + GST admin UI, Bill-To/Ship-To resolution service, group-access enforcement | Phase 0 schema ✔ |
| 2 | Admin Add Dealer, Dealer CSV import (template → parse → validate → preview → staged commit), credential provisioning, account state machine | 1 |
| 3 | Auth v5: Dealer Code + password + OTP, first login, forced password change, reset, `PILOT_STATIC_OTP` removal | 2 |
| 4 | Checkout: Bill-To/Ship-To/Location selection, immutable snapshots, requested delivery, PO number, size system, `(8 x 10)` formatter | 1, 3 |
| 5 | Order Review: article tiles, size matrix, article + whole-order actions, reconciliation summary | 0 ✔, 4 |
| 6 | Notification outbox, lifecycle emails, retries, WhatsApp channel interface | 4 |
| 7 | CSV export: group/bill-to/ship-to/requested-delivery header, correct grain | 4 |
| 8 | Regression + hardening, **production integration suite** | all |

Phase 5 is the client-visible one but cannot precede Phase 4's data model, which
cannot precede Phase 1's identity model. Sequence is not negotiable.

---

## 5. Non-negotiable for v5: the production integration suite

The P0 exists because mocked tests were treated as evidence. From here:

> **No mocked implementation is evidence that a database workflow works.**

Every critical workflow gets a test against real migrations and real constraints:

```
create dealer group → import dealer → verify GST → issue credentials
→ first login → forced password change → normal login
→ browse → add sizes → select bill-to/ship-to → submit with OTP
→ approve article → partial size decision → credit review → reject
→ whole-order approve → dispatch → export
```

Plus a schema/RPC contract test asserting every RPC can actually write every
table it claims to write, under production triggers and RLS.

---

## 6. Open items requiring KITCO input

1. **Dealer group mapping** for the existing 136 dealers (until supplied: each is a single-dealer group).
2. **GST provider credentials** (until supplied: mock, everything flagged `NOT_LIVE_VERIFIED`).
3. **Size system per existing set** — proposed: `REEBOK_7_12`/`NIKE_HALF`/`NIKE_WHOLE` = US, `DOUBLEU_36_44`/`LEE_COOPER_39_45` = EU, `NIKE_ALPHA` = alpha. Admin-editable, so this is a starting point, not a lock.
4. **Resend plan upgrade** before dealer rollout.
5. **Credit Review financial rules** — credit limit source, exposure definition, ageing thresholds. Architecture is ready; the formula is deliberately not invented (§49).
