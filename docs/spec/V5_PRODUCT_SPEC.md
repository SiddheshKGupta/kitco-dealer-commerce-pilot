# KITCO Dealer Commerce v5 — Product Specification

**Status:** Phase 0 complete. Phases 1–8 planned (`V5_EXECUTION_PLAN.md` §4).
**Nature:** Uplift of the live v4 pilot, not a rebuild.

The product-level view: what the platform does end to end, who sees what, and what
"done" means. Structure and mechanics live in the companion specs — this document
references them rather than restating them.

| Concern | Spec |
|---|---|
| Object model, applied schema, RPCs, RLS | `V5_DATA_MODEL.md` |
| Group / dealer / GSTIN / location hierarchy, partner functions, the access rule | `V5_DEALER_GROUP_MODEL.md` |
| Dealer Code + password + OTP, account state machine, credential migration | `V5_AUTH_FLOW.md` |
| Outbox, lifecycle events, delivery, senders | `V5_NOTIFICATION_MODEL.md` |
| GSTIN verification, provider abstraction, name handling | `V5_GST_INTEGRATION.md` |
| Phases, frozen decisions, the P0 writeup | `V5_EXECUTION_PLAN.md` |

---

## 1. What this is

A B2B wholesale ordering platform for authorised KITCO footwear dealers. Dealers browse a
KITCO-controlled catalogue, build size-wise orders, submit them with an OTP, and track
what KITCO approves and dispatches. KITCO reviews every order and decides it — in full,
in part, or not at all.

It is not ecommerce. There is no checkout payment, no self-service signup, and **no
price, margin, GST estimate, payable or numeric stock anywhere a dealer can see** (v3.0
§24/§26, still binding). Retail Value, derived from MRP, is the only figure a dealer ever
sees.

The governing design constraint, unchanged from the pilot: **the dealer is 40–50, on a
phone, standing in a shop.** Mobile at 360/390/430px is the primary surface. Desktop must
not break; mobile must be correct.

---

## 2. End-to-end workflow

```
KITCO ADMIN                                          DEALER
────────────────────────────────────────────────────────────────────────────────
Create dealer
  GSTIN → Verify → review → confirm      §GST
  assign Dealer Group                    §GROUP
  add locations (Bill-To / Ship-To)
        │
Issue credentials                        §AUTH
  Dealer Code + initial password
        │                                         │
        │                                  First login
        │                                    code + password → OTP
        │                                    → forced password change → ACTIVE
        │                                         │
        │                                  Browse catalogue
        │                                    brand / gender / category filters
        │                                         │
        │                                  Build a size-wise order
        │                                    quantity per size, MOQ + multiple honoured
        │                                    accumulates across articles in one Cart
        │                                         │
        │                                  Review order
        │                                    Bill-To dealer                  ┐
        │                                    Ship-To dealer                  │ §GROUP
        │                                    Ship-To location                ┘
        │                                    PO number (dealer's own)
        │                                    requested delivery date (ASAP | a date)
        │                                         │
        │                                  Submit — ONE OTP for the whole order
        │                                    idempotent; a double tap makes one order
        │                                         │
        │◄────────────── ORDER_SUBMITTED ─────────┘              §NOTIFY
        │
Review the order                                            status: SUBMITTED
  per article, per size:
    approve / credit review / reject
  or whole-order approve / reject (one atomic RPC)
        │
        │  ordered = approved + credit_review + rejected + pending
        │  enforced by a generated column, not by convention
        │
        ├─ ORDER_APPROVED ───────────────────────►  dealer sees the decision
        ├─ ORDER_PARTIALLY_APPROVED ────────────►   plain language, all four buckets
        ├─ ORDER_CREDIT_REVIEW ─────────────────►   "2 pairs under Credit Review"
        └─ ORDER_REJECTED ──────────────────────►   with reason
        │
Dispatch (separate axis)
  approved = dispatched + remaining
        ├─ ORDER_PARTIALLY_DISPATCHED ──────────►
        └─ ORDER_DISPATCHED ────────────────────►
        │
Export CSV                                          Dealer downloads their own order
```

The dealer is updated at every transition, not just at the ends. That is the whole point
of the outbox: v4 approved orders in silence.

### Two axes, deliberately separate

```
COMMERCIAL   ordered   = approved + credit_review + rejected + pending
FULFILMENT   approved  = dispatched + remaining_to_dispatch
```

Conflating them is how v4 ended up unable to express "approved but not yet shipped"
distinctly from "not approved". They are never merged into one status field.

### The dealer never re-accepts

A partial approval is shown, not negotiated. No second OTP, no acceptance step (decision
D4, carried forward). The dealer sees what KITCO decided and can act on it commercially
outside the system.

---

## 3. Navigation

Two entirely separate surfaces. A dealer hitting an admin route is refused **server-side**,
not merely hidden in the UI.

### Dealer

```
Products  |  Cart  |  Orders  |  Reports
```

Bottom navigation on mobile, with a cart count badge. Four items, no more — everything a
dealer needs is one tap from here. Group membership status and account settings live
inside the account menu, not in the primary bar; they are visited rarely.

### KITCO Control (admin)

| Group | Sections |
|---|---|
| Primary | Dashboard · Orders · Dispatch · **Credit Review** · Dealers · **Dealer Groups** *(new)* · Dealer Applications · Catalogue |
| Operations | Catalogue Imports · Media Library · Size Sets · Offerings · Seasons · Schemes · Reports · Audit Trail · Admin Users · Settings |

Two changes from v4's list:

- **Dealer Groups** is new (Phase 1) — create groups, approve membership requests, set
  the primary dealer.
- **"Credit Holds" is renamed "Credit Review"** everywhere in the UI, per §4. The section
  slug, the tables, the RPCs and `hold_allocations` are untouched.

Admin density may be slightly higher than dealer screens, but the same legibility floor
applies — admins check orders on phones too.

---

## 4. Presentation rules

Binding on every screen, every email, every export. Each exists because getting it wrong
has a concrete cost.

### "Credit Review", never "Credit Hold"

Dealer-facing and admin-facing UI both say **Credit Review**. The database keeps `hold`,
`holds`, `hold_allocations`, `apply_kitco_credit_hold` and the `CREDIT_HOLD` reason code —
this is a **presentation-layer rename only** (decision B11), no migration.

Validated against the Nike.net screen, which labels the column "Credit Hold Status" and
puts the value `UNDER CREDIT REVIEW` in it. "Hold" reads as punitive and final; "review"
reads as in-progress, which is what it actually is.

Current code still says "On hold" — `src/features/reports/DealerFulfilmentStatus.tsx` and
the Control Console section label. Both are Phase 5 renames.

### Size × quantity: one shared formatter

```
(8 x 10), (9 x 5), (10 x 5)
```

One formatter, used by every surface that renders sizes to a human — dealer order cards,
admin review tiles, and lifecycle emails. Not three near-identical implementations that
drift.

Today the dealer order card renders `Size 8 · 10 pairs` inline in
`DealerFulfilmentStatus.tsx`; that becomes a call to the shared formatter.

**CSV formats do not change** (decision B10). There are two, and both keep their existing
shapes:

| Export | Grain | Sizes |
|---|---|---|
| `/api/admin/orders/export.csv` | one row per dealer → order → article → size | a `Size` column, 30 columns total |
| `.../export-products.csv` (admin + dealer) | one row per dealer → article | **wide** — one column per distinct size |

A spreadsheet is not a sentence. `(8 x 10)` in a cell is unfilterable and unpivotable;
wide columns and long rows are what a buyer's Excel actually wants.

### Size System is never optional

`US`, `UK`, `EU`, `CM`, `IN` — always rendered next to the sizes it labels. A dealer must
never see a bare `8` `9` `10`, because a US 9, a UK 9 and an EU 9 are three different
shoes and the mistake is only discovered when the carton is opened.

```
✔  Size system: US    (8 x 10), (9 x 5), (10 x 5)
✘                     (8 x 10), (9 x 5), (10 x 5)
```

`size_systems` is admin-extensible (decision C14), so this is a lookup, not a hardcoded
list. The wide CSV's size headers carry the system too — bare numeric headers have the
same ambiguity.

**Open item:** the size system for each existing size set is proposed, not decided —
`REEBOK_7_12`/`NIKE_HALF`/`NIKE_WHOLE` = US, `DOUBLEU_36_44`/`LEE_COOPER_39_45` = EU,
`NIKE_ALPHA` = alpha (`V5_EXECUTION_PLAN.md` §6 item 3). KITCO confirms; the field is
admin-editable either way.

### Business language only

No UUIDs, no correlation IDs, no V1/V2, no raw enum strings, no internal identifiers
anywhere a dealer can see (v3.0 §25/§53). Order numbers are the human-readable
`order_number`, never `order.id`.

---

## 5. Open decisions

Carried here so they are visible at product level rather than buried. None of these is
invented in any spec; each has a safe default that holds until KITCO decides.

| Open item | Safe default in force |
|---|---|
| Dealer group mapping for the 136 live dealers | each is a single-dealer group; pickers offer only itself; checkout behaves exactly as v4 |
| GST provider credentials | `MockGstProvider`; everything flagged `NOT_LIVE_VERIFIED`; never shown as verified |
| Size system per existing size set | proposal above, admin-editable, confirmed before rollout |
| Resend plan upgrade | required before rollout; ~110 emails/day projected against a 100/day free cap |
| **Credit Review financial rules** — credit limit source, exposure definition, ageing buckets | **none invented.** Credit review is applied manually by an admin, with a mandatory free-text reason enforced by the RPC. The architecture supports an automatic rule; the formula is deliberately absent until KITCO supplies it. |
| WhatsApp channel | interface only; no provider, no credentials, not rendered in any UI |
| Multi-group dealer membership | not supported; one `dealer_group_id` per dealer |

A fabricated credit formula would be worse than none: it would produce confident,
wrong-looking numbers that an admin would have to argue with, and it would be believed.

---

## 6. Acceptance path

The full production integration run, against **real migrations, real constraints, real
triggers and real RLS** (`V5_EXECUTION_PLAN.md` §5):

```
create dealer group → import dealer → verify GST → issue credentials
→ first login → forced password change → normal login
→ browse → add sizes → select bill-to/ship-to → submit with OTP
→ approve article → partial size decision → credit review → reject
→ whole-order approve → dispatch → export
```

Plus the specific assertions v5 exists to guarantee:

| # | Assertion | Guards against |
|---|---|---|
| 1 | Partial approval persists against production triggers | the P0 — `decide_kitco_order_line` was blocked by the immutability triggers on every call, and 233 mocked tests never noticed |
| 2 | `ordered = approved + credit_review + rejected + pending` on every line and every order total | drift between the review UI and the database |
| 3 | Dealer A cannot read Dealer B — including siblings in the same group | the group model's one real risk (`V5_DEALER_GROUP_MODEL.md` §4) |
| 4 | A browser-supplied Bill-To/Ship-To outside the caller's group is rejected 403 and audited | trusting a client-supplied dealer id |
| 5 | `123456` fails OTP against a production-configured service | `PILOT_STATIC_OTP` surviving into production |
| 6 | A provider that throws on every send leaves the order `APPROVED` and the delivery `FAILED_RETRYABLE` | a Resend outage rolling back a valid order |
| 7 | A mock-verified GSTIN never renders as "verified" | presenting placeholder data as official |
| 8 | Every RPC can actually write every table it claims to write, under production triggers and RLS | the exact class of bug the P0 belonged to |
| 9 | No dealer account can reach a state with no next action and no admin recovery | the v4 `DRAFT` stranding |
| 10 | 360 / 390 / 430px clean, no horizontal scroll, targets ≥44px | the dealer is on a phone |

Assertion 1 is the reason the rest of this list exists.

> **No mocked implementation is evidence that a database workflow works.**

That sentence is the single most expensive thing v4 taught this project. Every critical
workflow above is tested against Postgres or it is not tested.
