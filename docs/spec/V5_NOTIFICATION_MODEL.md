# KITCO Dealer Commerce v5 — Notification Model

**Status:** PLANNED. Nothing in this document is built. Phase 6.
**Depends on:** `V5_DATA_MODEL.md` §6, Phase 4 (order partner functions)
**Frozen decisions:** `V5_EXECUTION_PLAN.md` C15, C16

v4 sends exactly one kind of email: the OTP, inline, best-effort, via
`ResendEmailProvider`. Nothing tells a dealer their order was approved. v5 adds an
outbox so lifecycle mail is durable, retryable, and — critically — cannot take a
business transaction down with it.

---

## 1. The pipeline

```
DOMAIN EVENT           the business thing that happened
      │                ORDER_APPROVED, order_id, dealer_id, payload
      ▼
NOTIFICATION OUTBOX    notification_events  — written in the SAME transaction
      │                notification_deliveries — one row per (event × channel × recipient)
      ▼
CHANNEL RENDERER       EMAIL → subject + text/html from a template
      │                WHATSAPP → template name + variables      (interface only)
      ▼
PROVIDER               Resend (EMAIL). WhatsApp provider: not selected.
```

Four stages because each has a different failure mode. The event is a fact and must be
durable. The delivery is an attempt and may fail many times. The renderer is pure and
testable without a network. The provider is the only thing that talks to the outside.

---

## 2. Event types

| Event | Fires when | Dealer notified | Admin notified |
|---|---|---|---|
| `ORDER_SUBMITTED` | dealer completes OTP submission | yes — receipt | yes — new work |
| `ORDER_UNDER_REVIEW` | first decision recorded, quantity still pending | yes | no |
| `ORDER_APPROVED` | pending = 0, approved = ordered | yes | no |
| `ORDER_PARTIALLY_APPROVED` | pending = 0, mixed outcome, no credit review | yes | no |
| `ORDER_CREDIT_REVIEW` | pending = 0 and credit_review > 0 | yes | yes — a human must act |
| `CREDIT_REVIEW_CLEARED` | credit-review quantity resolved to approved or rejected | yes | no |
| `ORDER_REJECTED` | pending = 0, rejected = ordered | yes | no |
| `ORDER_PARTIALLY_DISPATCHED` | a dispatch finalises, dispatched < approved | yes | no |
| `ORDER_DISPATCHED` | dispatched = approved | yes | no |

These map one-to-one onto the status derivation in
`private.recompute_kitco_order_status` (`V5_DATA_MODEL.md` §4) plus the separate
fulfilment axis. That is deliberate: the event is emitted from the status *transition*,
so an event can never claim something the database does not say.

`CREDIT_REVIEW_CLEARED` has no corresponding order status — it is the resolution of a
condition, not a state. It fires on the transition *out of* credit review regardless of
where the order lands, so the dealer is told the block is gone rather than being left to
infer it from a second status email.

An event fires **once per transition**. Re-running a decision that produces the same
status does not re-notify. The idempotency key is `(order_id, event_type, status_from,
status_to)`.

---

## 3. Tables — PLANNED, not built

```sql
-- PLANNED (Phase 6). Neither table exists today.

notification_events
  id, organisation_id, event_type, dealer_id, order_id,
  payload jsonb,              -- everything the renderer needs; no re-query at send time
  correlation_id,             -- matches the audit_events correlation id for the same action
  occurred_at, created_at

notification_deliveries
  id, organisation_id, notification_event_id,
  channel            EMAIL | WHATSAPP,
  recipient,                  -- resolved address at enqueue time, not at send time
  template,                   -- e.g. ORDER_PARTIALLY_APPROVED_DEALER_V1
  status             PENDING | SENT | FAILED_RETRYABLE | FAILED_PERMANENT,
  attempt_count      integer default 0,
  provider_reference,         -- Resend message id
  next_attempt_at    timestamptz,
  error              text,    -- redacted; never contains the recipient (see §6)
  created_at, updated_at
```

Two tables rather than one because the fan-out is real: one `ORDER_CREDIT_REVIEW` event
produces a dealer email and an admin email, and later a dealer WhatsApp message. Those
succeed and fail independently. Collapsing them would mean a failed admin copy marking
the dealer's delivered email as failed.

`payload` is a **snapshot**, not a pointer. The renderer must not re-query the order at
send time: a retry three minutes later would then render a *different* order state than
the one the event described, and the dealer would get an "approved" email describing a
subsequently-rejected line.

---

## 4. Delivery strategy

Decided (C15). Both mechanisms, each covering the other's weakness:

```
                    ┌─ business transaction ─────────────────────────┐
   approve order →  │  UPDATE order_line_decisions                    │
                    │  recompute status                               │
                    │  INSERT audit_events                            │
                    │  INSERT notification_events                     │  ← same transaction
                    │  INSERT notification_deliveries (PENDING)       │
                    └────────────────────── COMMIT ──────────────────┘
                                    │
                    ┌───────────────┴────────────────┐
                    ▼                                ▼
        ctx.waitUntil(drain(ids))          Cron Trigger  * * * * *
        immediate attempt, after the       sweeps PENDING and
        response is already returned       FAILED_RETRYABLE where
        to the admin                       next_attempt_at <= now()
```

| Property | Comes from |
|---|---|
| The event cannot be lost | it commits with the business change |
| Normal case is fast | `ctx.waitUntil()` — the send starts immediately, but *after* the HTTP response is flushed, so the admin never waits on Resend |
| A crashed isolate or a provider outage still delivers | the cron sweep picks up anything left `PENDING`/`FAILED_RETRYABLE` |
| No duplicate sends | a delivery row moves `PENDING → SENT` under a conditional update; the sweep only claims rows still `PENDING` |

Backoff for `FAILED_RETRYABLE`: `next_attempt_at = now() + min(2^attempt_count minutes, 60
minutes)`, capped at 10 attempts, then `FAILED_PERMANENT` and visible in an admin
exception list. A 4xx from the provider (invalid address, blocked recipient) is
`FAILED_PERMANENT` immediately — retrying a malformed address 10 times is just noise.

Requires `"triggers": { "crons": ["* * * * *"] }` in `wrangler.jsonc` (absent today) and
a `scheduled` export alongside the existing `fetch` in `worker/index.ts`.

---

## 5. Hard requirement: a Resend outage must never roll back an order

> The business transaction and the delivery attempt are **decoupled**. Nothing about
> sending mail can fail an otherwise valid approved order.

Concretely, this forbids three tempting shortcuts:

1. **Sending inside the transaction.** A slow or failing HTTP call would hold a Postgres
   transaction open, and a thrown provider error would roll back an approval an admin
   already believes they made.
2. **Awaiting the send before responding.** Even without a rollback, the admin's approve
   button would spin for Resend's latency and error on Resend's failure — the UI would
   report a database success as a failure.
3. **Deriving order state from delivery state.** No code path may read
   `notification_deliveries.status` to decide anything commercial. An undelivered email
   is a delivery problem; the order is still approved.

The v4 precedent for the wrong shape is `OtpService.issue()`, which correctly *does*
couple them — an OTP nobody received is useless, so it consumes the challenge and throws.
That coupling is right for OTP and wrong for everything in §2. Do not generalise it.

**Verification:** an integration test that stubs the provider to throw on every call,
approves an order, and asserts the order is `APPROVED`, the audit row exists, and the
delivery row is `FAILED_RETRYABLE` with `attempt_count = 1`.

---

## 6. Email content

Concise and operational. The reader is a shop owner on a phone, mid-day, who wants to
know what happened to their order and what they now have to do.

Rules:

- **Subject carries the outcome**, not the system: `Order KIT-2608-00042 — 57 of 60 pairs
  approved`. Not `Notification from KITCO Dealer Commerce`.
- **Dealer-facing language is "Credit Review", never "Credit Hold"** — presentation rename
  only, the database keeps `hold` (decision B11).
- No internal identifiers. No UUIDs, no correlation IDs, no `PARTIALLY_APPROVED` enum
  strings, no V1/V2 (v3.0 §25/§53, still binding).
- No price, margin, GST estimate, payable, or numeric stock (v3.0 §24/§26, still binding).
  Retail Value is the only figure.
- Sizes render through the **one shared formatter** used by the UI, with the size system
  always visible: `US (8 x 10), (9 x 5), (10 x 5)`. A dealer must never see a bare
  `8 9 10` — a US 9 and an EU 9 are different shoes. CSV exports are unaffected and keep
  their existing shapes (§8).

A **partial approval email must show all four buckets explicitly**, even where one is
zero, because the whole point is that the dealer can reconcile it:

```
Order KIT-2608-00042 · submitted 24 Aug

  KITCO Air Zoom · Black/White · Article 91234
  Size system: US
                       Ordered    Approved   Credit Review   Rejected
    (8 x 10)                10           7               2          1
    (9 x 5)                  5           5               0          0
    (10 x 5)                 5           5               0          0
  ─────────────────────────────────────────────────────────────────
  Total                     20          17               2          1

2 pairs are under Credit Review. KITCO will contact you.
```

`Ordered = Approved + Credit Review + Rejected` on every row and on the total. That is
the same invariant the schema enforces via the generated `pending_qty` column, shown to
the dealer rather than asserted at them. If the arithmetic in an email does not
reconcile, the email is wrong — the numbers come from `order_line_decisions`, never
recomputed in the renderer.

Where quantity is still pending, it appears as a fourth column rather than being folded
silently into any of the others.

---

## 7. Senders

One verified domain, already in place: `notify.kitco.co.in`. Three addresses, split by
what a dealer would do about a message from each:

| Sender | Carries | Why separate |
|---|---|---|
| `security@notify.kitco.co.in` | OTP, password reset, credential issuance | Security mail must be filterable and separately deliverable. If lifecycle mail trips a spam filter, sign-in must not go down with it. |
| `orders@notify.kitco.co.in` | every `ORDER_*` / `CREDIT_REVIEW_*` event in §2 | The dealer's operational stream — the one they will build a folder rule for |
| `notifications@notify.kitco.co.in` | everything else (admin digests, group-membership decisions, account changes) | Low-urgency; must never dilute the two above |

Today `wrangler.jsonc` sets `OTP_FROM_EMAIL = "KITCO <otp@notify.kitco.co.in>"`. v5
renames that address to `security@` and adds the other two as separate vars. Same
verified domain, so no new DNS work.

### Volume — Resend Pro is required before rollout

Free tier is 100 emails/day. Projected load at 30 orders/day is roughly:

```
  30 order submissions      × 2 (dealer + admin)   =  60
  30 decisions                                     =  30
  ~15 dispatch notifications                       =  15
  ~5 OTP/auth                                      =   5
                                                     ───
                                                     110 /day
```

That is over the free cap on day one, before any retry traffic. **Resend Pro must be
active before dealer rollout** — this is a billing action, not an engineering one, and it
is open item 4 in `V5_EXECUTION_PLAN.md` §6. Until it is done, the outbox will simply
accumulate `FAILED_RETRYABLE` rows once the cap is hit, which is at least visible rather
than silent, but it is not a substitute for buying the plan.

Provider error bodies are redacted before logging — Resend echoes the recipient back in
validation messages, and `redactProviderError()` in `worker/auth/resend-provider.ts`
already handles this. The `notification_deliveries.error` column stores the redacted form.

---

## 8. WhatsApp: interface only

WhatsApp is a **future channel adapter**. What v5 builds is the seam, and nothing behind it:

```ts
// PLANNED — Phase 6
interface NotificationChannel {
  readonly channel: "EMAIL" | "WHATSAPP";
  send(delivery: RenderedDelivery): Promise<{ providerReference: string }>;
}
```

`channel` on `notification_deliveries` already admits `WHATSAPP`, so adding the adapter
later needs no migration.

What this document deliberately does **not** contain: a provider choice, credentials,
template ids, a phone-number source, or an opt-in mechanism. India's WhatsApp Business
API requires an approved BSP, pre-approved message templates, and recorded opt-in —
none of which KITCO has supplied. Writing a plausible-looking configuration here would
produce exactly the failure mode this project already paid for once: documentation that
reads as verified and is not.

The channel must not be rendered in any UI while unimplemented. Dead controls are banned
(same rule that kept SMS out of the v4 OTP screen).

**Open decisions, explicitly not invented:**

| Question | Safe default until KITCO decides |
|---|---|
| WhatsApp BSP and credentials | none configured; adapter unregistered; channel absent from the UI |
| Which events go to WhatsApp | none — email carries everything |
| Dealer opt-out per event type | not offered; all §2 events are transactional, none are marketing |
| Admin recipient list for `ORDER_SUBMITTED` / `ORDER_CREDIT_REVIEW` | all `ACTIVE` users with `ADMIN`/`SUPERADMIN` in the organisation. Per-user subscription preferences are a later feature, not a v5 assumption |
