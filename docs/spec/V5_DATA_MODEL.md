# KITCO Dealer Commerce v5 — Data Model

**Status:** Phase 0 tables applied and verified. Later-phase tables marked PLANNED.
Additive only — no v4 migration is rewritten, no v4 column is dropped.

---

## 1. Object model

```
DEALER GROUP                         (dealer_groups)
    │  group_code, group_name, primary_dealer_id
    │
    ├── DEALER / SOLD-TO ACCOUNT     (dealers)
    │       │  dealer_code = login identifier
    │       │  legal_name (statutory) | display_name (UI)
    │       │  account_state, storefront_photo_key
    │       │
    │       ├── GST REGISTRATION     (gst_registrations)   ← shared, many dealers → one registration
    │       │
    │       └── LOCATIONS            (dealer_locations)    ← v4 table, retained
    │             ├── Store
    │             └── Warehouse
    │
    └── DEALER / SOLD-TO ACCOUNT …

ORDER                                (orders)
    ├── ordering_dealer_id  + snapshot
    ├── bill_to_dealer_id   + snapshot      PLANNED (Phase 4)
    ├── ship_to_dealer_id   + snapshot      PLANNED (Phase 4)
    ├── ship_to_location_id + snapshot      PLANNED (Phase 4)
    ├── dealer_po_number                    PLANNED (Phase 4)
    ├── requested_delivery_date             PLANNED (Phase 4)
    └── estimated_delivery_date             PLANNED (Phase 4)
         │
    ORDER VERSIONS → ORDER LINES → ORDER LINE SIZES     ← IMMUTABLE dealer request
         │
    ORDER LINE DECISIONS                                 ← MUTABLE KITCO decision
         │  approved / credit_review / rejected / pending(generated)
         │
    DISPATCHES → DISPATCH LINES                          ← fulfilment axis
```

Two axes, deliberately separate:

```
COMMERCIAL   ordered = approved + credit_review + rejected + pending
FULFILMENT   approved = dispatched + remaining_to_dispatch
```

---

## 2. Why GST is its own table

Indian GST issues **one GSTIN per PAN per state**, covering a principal place of
business plus unlimited *additional places of business* under that same
registration. Multiple KITCO outlet accounts in the same state therefore
legitimately operate under one GSTIN:

```
OpenAI Retail Pvt Ltd — GSTIN 19ABCDE…
  ├── Dealer 001 · Park Street
  ├── Dealer 002 · Salt Lake
  └── Dealer 003 · Howrah
```

So:

```
one gst_registration  →  many dealers      (outlets sharing a registration)
one dealer            →  exactly one gst_registration
```

GSTIN is `unique (organisation_id, gstin)` **on the registration row** — one row
per real registration, verified once, never duplicated 15 times. It is
deliberately **not** unique on `dealers`. This is what "One Dealer = One GSTIN"
actually means, and it makes future GST API verification cheap: verify the
registration, every dealer under it inherits the evidence.

Sources: [GST portal — additional place of business](https://tutorial.gst.gov.in/userguide/registration/Apply_for_Registration_Normal_Taxpayer.htm), [principal place of business](https://tutorial.gst.gov.in/userguide/registration/Principal_Place_of_Business.htm), [Tally — multi-branch GST in one state](https://tallysolutions.com/gst/got-two-or-more-branches-in-the-same-state-find-out-if-you-need-multiple-gst-registration-multiple-gstin/)

---

## 3. Applied tables (Phase 0)

### `dealer_groups`
`group_code` (unique per org), `group_name`, `status ACTIVE|SUSPENDED`,
`primary_dealer_id`. Carries `unique (organisation_id, id)` so children can use
composite FKs and never cross an organisation boundary.

### `gst_registrations`
`gstin` (unique per org), statutory fields (`legal_name`, `trade_name`,
`gst_status`, `registration_date`, `constitution`, `taxpayer_type`,
`principal_address` jsonb, `state`, `pin_code`, `business_activities` jsonb),
plus verification evidence (`verification_status`, `verified_at`, `provider`,
`provider_reference`, `raw_response`).

`verification_status` defaults to `UNVERIFIED`; the mock adapter writes
`NOT_LIVE_VERIFIED`. Mock data is **never** presented as officially GST verified.

### `dealers` — added columns
`dealer_group_id`, `gst_registration_id` (both composite-FK'd on
`organisation_id`), `legal_name`, `display_name`, `storefront_photo_key`,
`is_main_dealer`, `account_state`, `credentials_issued_at`, `first_login_at`,
`last_login_at`, and provenance (`source_system`, `source_reference`,
`last_synced_at`).

`legal_name` is stored exactly as GST returns it and is never reformatted for
display. `display_name` is the admin-editable UI name. Title-casing
`SHREE GANESH FOOTWEAR` → `Shree Ganesh Footwear` is a display concern only, and
must not blindly transform `OpenAI`, `V L & Co`, `S2G Fashion`, `HP Lifestyle`.

v4's `activation_status` is untouched and remains authoritative until cutover;
`account_state` is the v5 machine:

```
IMPORTED → CREDENTIALS_PENDING → CREDENTIALS_ISSUED → FIRST_LOGIN_PENDING
→ OTP_PENDING → PASSWORD_CHANGE_REQUIRED → ACTIVE
                                          ↘ SUSPENDED / DISABLED
```

No state is terminal-by-accident — the `DRAFT` stranding that broke the demo is
structurally impossible here.

### `dealer_group_membership_requests`
`requested_group_code`, `resolved_group_id`, `status
PENDING|APPROVED|REJECTED|CANCELLED`, `decided_by`, `decided_at`,
`decision_notes`. Partial unique index allows exactly one `PENDING` request per
dealer.

### `order_line_decisions` — the P0 fix
```
ordered_qty        integer  (copied from the immutable submission)
approved_qty       integer
credit_review_qty  integer
rejected_qty       integer
pending_qty        integer GENERATED ALWAYS AS
                     (ordered_qty - approved_qty - credit_review_qty - rejected_qty) STORED
credit_review_reason, rejection_reason, decided_by, decided_at
unique (order_line_size_id)
check  (approved_qty + credit_review_qty + rejected_qty <= ordered_qty)
```

`pending_qty` being generated means the §29 invariant is a schema guarantee, not
a convention someone can drift away from.

An `AFTER INSERT` trigger on `order_line_sizes` scaffolds the decision row for
every submitted size line, so no order can exist without its decision skeleton.
Existing orders were backfilled with `approved_qty = 0` — **not** copied from
v4's `approved_quantity_pairs`, which is pre-set equal to ordered at submission
and records what the dealer asked for, not a decision anyone made.

---

## 4. RPCs

| Function | Purpose |
|---|---|
| `decide_kitco_order_line_v5` | One line+size, three-way split, reasons required for credit review / rejection, guards against dropping approved below already-dispatched |
| `approve_entire_kitco_order` | Approves all **pending** quantity atomically. Does not silently override existing credit-review or rejected allocations (§25) |
| `reject_entire_kitco_order` | Rejects all **pending** quantity atomically, reason mandatory |
| `private.recompute_kitco_order_status` | Derives commercial status from the decision rows |

Status derivation:

```
pending > 0, nothing decided     → SUBMITTED
pending > 0, some decided        → UNDER_REVIEW
pending = 0, rejected = ordered  → REJECTED
pending = 0, approved = ordered  → APPROVED
pending = 0, credit_review > 0   → CREDIT_REVIEW   (a human must act — outranks partial)
otherwise                        → PARTIALLY_APPROVED
```

`orders.status` check constraint widened to include `CREDIT_REVIEW`.

---

## 5. RLS

Every new table has RLS enabled **and forced**. The Worker uses the service-role
key and bypasses RLS, so these policies are defence-in-depth against any direct
Supabase access.

| Table | Dealer access |
|---|---|
| `dealer_groups` | SELECT own group only, via `private.is_dealer_in_group()` |
| `gst_registrations` | SELECT only registrations attached to a dealer in the caller's own group |
| `dealer_group_membership_requests` | SELECT/INSERT own only; cannot self-approve (`status='PENDING'`, `decided_by`/`decided_at`/`resolved_group_id` must be null on insert) |
| `order_line_decisions` | SELECT on own orders only. No dealer write path — decisions are written exclusively through the RPCs |

Group membership grants Bill-To/Ship-To *selectability* and nothing else. It
never exposes another dealer's orders, credit, logins or activity (§3).

---

## 6. PLANNED — later phases

**Phase 4 — order partner functions & snapshots**
`bill_to_dealer_id`, `ship_to_dealer_id`, `ship_to_location_id`, plus immutable
`ordering_dealer_snapshot` / `bill_to_snapshot` / `ship_to_snapshot` jsonb
(dealer code, name, GSTIN, address at time of order). Historical documents must
stay accurate when Dealer Master changes. Also `dealer_po_number`,
`delivery_preference ASAP|REQUESTED_DATE`, `requested_delivery_date`,
`estimated_delivery_date`.

**Phase 4 — size system**
`size_systems` lookup (US/UK/EU/CM/IN, admin-extensible) + `size_sets.size_system_id`.

**Phase 6 — notification outbox**
`notification_events` (event_type, dealer_id, order_id, payload, correlation_id)
and `notification_deliveries` (channel `EMAIL|WHATSAPP`, recipient, template,
status, attempt_count, provider_reference, next_attempt_at, error). Written in
the same transaction as the business change; delivered by `ctx.waitUntil()` with
a Cloudflare Cron sweep for retries. A Resend outage must never roll back an
otherwise valid approved order.
