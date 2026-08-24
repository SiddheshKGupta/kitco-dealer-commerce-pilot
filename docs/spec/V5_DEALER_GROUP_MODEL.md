# KITCO Dealer Commerce v5 — Dealer Group Model

**Status:** Schema applied (Phase 0). Resolution service and admin UI are Phase 1.
**Depends on:** `V5_DATA_MODEL.md` §1–§3, `20260824100000_v5_dealer_groups_and_gst.sql`

This document covers the identity hierarchy above the dealer, the partner functions
that hang off it, and the one security rule that makes the whole thing safe.

---

## 1. The hierarchy

```
DEALER GROUP              dealer_groups          "OpenAI Group"
    │
    ├── DEALER            dealers                Sold-To account, one dealer_code, one login
    │     ├── GST REG     gst_registrations      shared: many dealers → one registration
    │     └── LOCATIONS   dealer_locations       BILL_TO | SHIP_TO | BOTH
    │
    └── DEALER …
```

Four levels, four different jobs:

| Level | Answers | Cardinality |
|---|---|---|
| Dealer Group | "who is allowed to bill or ship to whom" | 1 group → many dealers |
| Dealer | "who is the commercial counterparty" | 1 dealer → 1 group, 1 GSTIN, 1 login |
| GST Registration | "under which statutory registration" | 1 registration → many dealers |
| Location | "which physical door" | 1 dealer → many locations |

A dealer belongs to exactly one group. A group has a `primary_dealer_id` — the main
dealer, used as the default Bill-To and as the group's display anchor.

`dealer_groups.status` is `ACTIVE | SUSPENDED`. A **suspended group grants nothing**:
partner resolution collapses to the ordering dealer naming only itself, exactly as if it
had no group. Suspension is therefore a safe, reversible kill switch for the whole
selectability graph — it never blocks the dealer from trading on its own account.

---

## 2. Worked example

OpenAI Group operates three trading entities. Each is separately GST-registered, and
each has its own doors.

```
DEALER GROUP  OPENAI001 · "OpenAI Group"        primary_dealer_id → DLR-CHATGPT
│
├── DEALER  DLR-CHATGPT     "ChatGPT Retail Pvt Ltd"
│     GSTIN 19AAACO1234A1Z5   (West Bengal)
│     ├── LOC  Park Street Store        BOTH
│     └── LOC  Salt Lake Warehouse      SHIP_TO
│
├── DEALER  DLR-HARDWARE    "OpenAI Hardware Pvt Ltd"
│     GSTIN 27AAACO9876B1Z3   (Maharashtra)
│     ├── LOC  Andheri Store            SHIP_TO
│     └── LOC  Bhiwandi Warehouse       SHIP_TO
│
└── DEALER  DLR-OSS         "OpenSource Distribution LLP"
      GSTIN 29AAACO5555C1Z8   (Karnataka)
      └── LOC  Koramangala Store        BOTH
```

Three GSTINs because three states and three PANs. Nothing here forces one dealer per
GSTIN — see §5.

A buyer signed in as `DLR-CHATGPT` may name any of the three dealers as Bill-To or
Ship-To, and any location under the chosen Ship-To dealer as the delivery address.
They may not see any of those dealers' orders.

---

## 3. Partner functions

Modelled on SAP SD's Sold-To / Ship-To / Bill-To / Payer partner functions, and
validated against a real Nike.net B2B screen (dealer-supplied, 2026-08-20) which shows:

```
Sold-To    5098725  HP LIFESTYLE PRIVATE LIMITED
Ship-To    5098726  HARYANA
```

Two separately numbered accounts on one order. That is the shape v4 could not express —
v4 had one dealer and a flat `dealer_locations` list, so "bill this entity, ship to that
one" had nowhere to live.

v5 resolves four partner slots per order:

| Slot | Bound to | Who sets it | Notes |
|---|---|---|---|
| **Ordering Dealer** | `dealers` | the session, never the browser | = SAP Sold-To. Always the authenticated dealer. Not selectable. |
| **Bill-To Dealer** | `dealers` | dealer at checkout | Defaults to the ordering dealer. Determines the GSTIN on the invoice. |
| **Ship-To Dealer** | `dealers` | dealer at checkout | Determines *whose* address book the next slot reads. |
| **Ship-To Location** | `dealer_locations` | dealer at checkout | Must belong to the Ship-To Dealer. |

`dealer_locations.location_type` (`BILL_TO | SHIP_TO | BOTH`) already exists from v4 and
is retained. It constrains which locations are offered for which slot; it does **not**
carry any authorisation weight of its own.

SAP's fourth function, **Payer**, is deliberately not modelled. KITCO has not said the
payer can differ from the Bill-To. Adding a slot nobody asked for would mean inventing a
settlement rule. If it turns out to be needed, it is one more nullable FK plus one more
snapshot — the shape already supports it.

Each slot is snapshotted onto the order as immutable jsonb at submission (Phase 4, see
`V5_DATA_MODEL.md` §6). A dealer renaming itself next year must not silently rewrite
last year's invoice.

---

## 4. The security rule

> **Group membership authorises Bill-To/Ship-To selectability and nothing else.**

It never grants visibility of another dealer's orders, credit position, logins, contact
details beyond what appears in the selector, or activity of any kind.

What the group *does* grant, exhaustively:

| Granted | Not granted |
|---|---|
| See sibling dealers in the Bill-To/Ship-To pickers (code, display name, GSTIN, address) | See a sibling's orders, order history, or CSV export |
| Name a sibling as Bill-To on your own order | See a sibling's credit limit, exposure, or credit-review reasons |
| Name a sibling as Ship-To and pick one of its locations | See a sibling's users, logins, or last-login times |
| Read your own group's name and code | Edit a sibling, or edit the group |

### Server-side validation is mandatory, on every write

Every Bill-To/Ship-To selection is re-derived server-side from the authenticated
dealer's own group. The browser-supplied dealer id is treated as a *proposal*, never as
a fact.

```
resolvePartners(session, { billToDealerId, shipToDealerId, shipToLocationId }):
  orderingDealer  = session.dealerId              -- from the sealed session, not the body
  groupId         = dealers[orderingDealer].dealer_group_id
  if groupId is null  → the only legal values are orderingDealer itself
  assert dealers[billToDealerId].dealer_group_id  == groupId
  assert dealers[shipToDealerId].dealer_group_id  == groupId
  assert dealer_locations[shipToLocationId].dealer_id == shipToDealerId
  assert every row's organisation_id == session.organisationId
  → else 403, audited
```

This is the same rule already binding in v3.0 §119/§120 and restated in
`V4_EXECUTION_PLAN.md`: the Worker holds the service-role key and bypasses RLS, so a
missing check here is a real cross-dealer write, not a cosmetic bug. RLS
(`private.is_dealer_in_group`) is defence-in-depth behind it, not a substitute for it.

A failed assertion is a **403 with an audit event**, not a silent fallback to the
ordering dealer. Silently substituting a legal value hides an attack and mis-bills an
honest mistake.

---

## 5. Why many dealers can share one GSTIN

Indian GST issues **one GSTIN per PAN per state**. That single registration covers a
*principal place of business* plus an unlimited number of *additional places of
business* in the same state. Two KITCO outlets in Kolkata under the same company are
therefore legitimately one registration, not two.

```
OpenAI Retail Pvt Ltd — GSTIN 19AAACO1234A1Z5 (West Bengal)
  ├── Dealer DLR-PARK     · Park Street     (principal place)
  ├── Dealer DLR-SALT     · Salt Lake       (additional place)
  └── Dealer DLR-HOWRAH   · Howrah          (additional place)
```

So the constraint is:

```
one gst_registration  →  many dealers
one dealer            →  exactly one gst_registration
```

`gstin` is `unique (organisation_id, gstin)` **on `gst_registrations`**, and deliberately
**not** unique on `dealers`. This is what "One Dealer = One GSTIN" actually means: one
GSTIN *per dealer*, not one dealer *per GSTIN*. It also makes verification cheap —
verify the registration once, and every dealer under it inherits the evidence rather
than burning fifteen provider calls on the same number.

Sources: [GST portal — additional place of business](https://tutorial.gst.gov.in/userguide/registration/Apply_for_Registration_Normal_Taxpayer.htm),
[principal place of business](https://tutorial.gst.gov.in/userguide/registration/Principal_Place_of_Business.htm).

Note that a GST registration and a dealer group are **orthogonal**. Group membership is
a commercial permission KITCO grants; a shared GSTIN is a statutory fact. Two dealers in
one group may have different GSTINs (§2), and two dealers sharing a GSTIN could in
principle sit in different groups. Neither implies the other, and neither may be
inferred from the other in code.

---

## 6. Joining a group: request → approve

A dealer **requests** membership by quoting a group code. A KITCO admin approves it.
There is no auto-join.

```
Dealer enters group code "OPENAI001"
   → INSERT dealer_group_membership_requests (status PENDING, resolved_group_id NULL)
   → dealer sees "Request sent to KITCO", and nothing changes for them yet
KITCO admin reviews in Control → Dealer Groups
   → APPROVE  : sets resolved_group_id, decided_by, decided_at,
                and sets dealers.dealer_group_id
   → REJECT   : status REJECTED + decision_notes, dealer stays where it was
CANCELLED is a supported status for a dealer withdrawing its own pending
request; the endpoint is a Phase 1 nicety, not a blocker.
```

A partial unique index enforces exactly one `PENDING` request per dealer, so the queue
can never fill with duplicates from an impatient tap.

### Why not auto-join by code

Because a group code is **discoverable**. It appears on paperwork, in emails, in a URL,
on a screen someone photographs. If typing `OPENAI001` joined the group, the code would
be a de-facto password — and the reward for guessing it is exactly the reach §4 exists
to restrict: the joiner could immediately name every dealer in that group as Bill-To or
Ship-To, and direct goods to an address they control.

An approval step costs one admin click and removes the entire class of attack. The code
stays a convenient *identifier*; it never becomes a *credential*.

For the demo this is one Approve button. Signed, expiring invitation tokens are the
obvious later upgrade — same table, `requested_group_code` becomes a token — but that is
an optimisation of the approval step, not a replacement for it.

### RLS backing this

Per `V5_DATA_MODEL.md` §5, a dealer may INSERT a membership request only with
`status = 'PENDING'` and `decided_by`, `decided_at`, `resolved_group_id` all NULL. A
dealer cannot self-approve even with direct Supabase access.

---

## 7. Existing dealers on cutover

The 136 live v4 dealers have no group. Until KITCO supplies a mapping (open item 1 in
`V5_EXECUTION_PLAN.md` §6), each is a **single-dealer group**: `dealer_group_id` null or
pointing at a group containing only itself.

The consequence is deliberate and safe: with no siblings, the Bill-To and Ship-To
pickers offer only the dealer itself, and checkout behaves exactly as v4 did. Nothing
breaks, and nobody gains reach they did not have yesterday. Groups light up only where
KITCO explicitly creates them.

**Open decision — not invented here:** whether a dealer may belong to more than one
group. The schema says no (`dealers.dealer_group_id` is a single FK). If KITCO later
needs a dealer to bill across two groups, that is a join table and a re-verified §4
check, and it must be decided explicitly rather than arrived at by loosening a
constraint.
