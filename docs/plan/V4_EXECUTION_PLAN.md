# KITCO Dealer Commerce — v4.0 Execution Plan

**Governing brief:** Product Change Brief & Implementation Direction v4.0 (14 Aug 2026)
**Planned by:** Opus 5 · **Executed by:** Sonnet
**Branch:** `codex/kitco-pilot` · **Worktree:** `.worktrees/kitco-pilot`
**Live:** https://kitco-dealer-commerce.siddeshgup.workers.dev

---

## 0. Authority order — CHANGED

```text
1. Change Brief v4.0 (14 Aug 2026)      ← governing; supersedes v3.0 on conflict
2. Handover v3.0 (FROZEN FOR BUILD)     ← still authoritative where v4.0 is silent
3. Client answers recorded in §2 below  ← override both where explicit
4. Escapement design-intelligence / ui.md
5. KITCO_Dealer_Commerce_Prototype.html ← visual reference only
```

Handover v3.0 is **no longer top authority**. Where v4.0 contradicts it, v4.0 wins.
Where v4.0 is silent (commercial display rules, RLS, import lineage, immutability),
v3.0 still governs and must not be regressed.

**Still absolutely binding from v3.0 — do not regress:**
- §24/§26 — no dealer price, margin, GST estimate, payable, or numeric stock, anywhere dealer-facing.
- §119/§120 — RLS dealer isolation from `auth.uid()`; never trust a client-supplied dealer id.
- §121 — service-role key never reaches the browser.
- §123 — idempotent final submission.
- Order submission evidence stays immutable (v4.0 §47 agrees).

---

## 1. What v4.0 reverses

| # | Previously | Now | Source |
|---|---|---|---|
| 1 | v3.0 §11 — do **not** ask GSTIN/address at activation | GSTIN + address **required** | v4.0 §13/§14 |
| 2 | v3.0 §8 — no KITCO approval gate | New dealers need an approval queue | v4.0 §12 |
| 3 | v3.0 §16 — email OTP only, SMS not exposed | Multi-channel fallback | v4.0 §15 |
| 4 | v3.0 §7.1 — one admin, no role UI | Multi-admin + superadmin + permissions | v4.0 §6/§35/§36 |
| 5 | v3.0 §95 — dealer OTP-accepts "V2 PROPOSED" | Dealer **views** decision; no re-acceptance | v4.0 §28 + Q4 |
| 6 | v3.0 §4.4 — footer carries VLCO attribution | Footer = support contact | v4.0 §5.2 |
| 7 | Our Q1 — attribution twice | **Once**, header only | v4.0 §5.1 |
| 8 | Our Q2 — self-activate; access code is the gate | Approval queue; **access code deleted** | v4.0 §8/§12 |
| 9 | Our Q3 — dealer-first, admin last | Admin order ops + CSV export are **P0** | v4.0 §39 |
| 10 | Our plan — system Arial, explicitly not Inter | **Geist** | v4.0 §4.2 |

---

## 2. Client decisions — 14 Aug 2026 (override the brief where they differ)

| # | Question | Decision |
|---|---|---|
| D1 | Design system approach | **P0 subset (~14 primitives) on the existing CSS-variable system.** No Tailwind/shadcn migration. Remaining components added as screens need them. |
| D2 | SMS fallback | **Email only** (primary + secondary) for P0. `PILOT_STATIC_OTP=123456` **stays** as a fallback. SMS behind a port, unimplemented. |
| D3 | Address autocomplete | **Structured manual entry only** for P0. No third-party provider. |
| D4 | Partial approval | **Dealer views the decision. No re-acceptance, no second OTP.** |
| D5 | GSTIN | **Plain input. No format validation, no master-record matching, no gate.** |
| D6 | GSTIN + address required? | **Yes — required to complete activation, but unvalidated.** Pre-fill whatever KITCO holds. |
| D7 | CSV export | **CSV only.** "Dealer-wise" = **one consolidated CSV covering every dealer and every order**, one row per dealer → order → article → size. Not one file per dealer. |
| D8 | Dealer Home screen | **Deferred to P1.** Products is the landing page. |
| D9 | Superadmin identity | **A KITCO email the client will supply.** Do not hardcode — read from config/env and document the promotion step. |
| D10 | Alternate-email takeover | **Activate instantly + notify the registered email.** Accepted risk (see §7 R1). |

---

## 3. Verified current state (inspected 14 Aug, not assumed)

| Area | Reality | Consequence |
|---|---|---|
| Multi-article cart | `saveDraft` upserts `draft_order_lines` on `(draft_order_id, commercial_offering_id)` — **already accumulates lines** | Cart is a **UI + one missing GET**, not a rebuild. Big de-risk. |
| Load the cart | **No `GET /api/drafts/current` exists** | Must add before a cart page can render |
| Partial approval | `approveOrder` = whole order via RPC `approve_kitco_order`; **`reviseOrder()` throws `ADMIN_MUTATION_UNAVAILABLE`** | P0 partial approve **requires a new audited Postgres function**. Not frontend-only. |
| Holds | `apply_kitco_credit_hold` RPC exists, per line+size+pairs+reason | Extend for non-credit hold types |
| Access code | 6 files: `worker/auth/app.ts`, `worker/env.ts`, `worker/routes/activation.ts`, `ActivationPage.tsx`, `tests/worker/auth.test.ts`, `tests/ui/activation.test.tsx` + the Worker secret | Removal is well-bounded |
| Dealer nav | `Products \| Orders \| Reports`, no cart, no home | Replace with `Products \| Cart \| Orders` |
| Footer | `App.tsx` — "Pilot Environment · Developed by V L & CO" | Becomes support contact |
| Data | 136 dealers · 115 GST registrations · 641 colourways · 90 with media · 0 seasons · 0 schemes | ~21 dealers have no GSTIN (D5/D6 make this a non-blocker) |
| Baseline | 137 tests green, typecheck + build clean | Keep green after every slice |

---

## 4. P0 slices — ship in this order, each independently deployable

Run after **every** slice:
```bash
npm.cmd run typecheck && npm.cmd test -- --run --testTimeout=20000 && npm.cmd run build
```
Deploy only after `npm run build` — `wrangler deploy` reads `dist/kitco_dealer_commerce/wrangler.json`,
not `wrangler.jsonc`. Skipping the build ships stale code and can silently drop `vars`.

---

### Slice 0 — Design system foundation
**Brief:** §4, §5, §50 · **Decision:** D1

1. **Tokens** (`src/styles/tokens.css`) — freeze one scale each: spacing, radius, shadow,
   border, focus, status palette. Load **Geist Variable**; keep a system fallback stack.
2. **Primitives** in `src/components/ui/` — exactly these 14 for P0:
   `Button` · `IconButton` · `Input` · `PasswordInput` · `OTPInput` · `Select` · `Checkbox`
   · `Tabs` · `StatusBadge` · `Card` · `BottomSheet` · `Modal` · `EmptyState` · `QuantityStepper`
   Plus `FormField`, `SearchField`, `Toast`, `Skeleton` if a P0 screen needs them.
   One API: `<Button variant="primary|secondary|ghost|danger" size="sm|md" />`.
3. **Delete competing styles.** `.primary-action`, `.commerce-primary`, `.btn`, `.control-actions button`
   and `.chip` all currently style buttons differently. Collapse to `Button`/`Chip`.
4. **Mobile shell** — bottom nav `Products | Cart | Orders` with a cart count badge;
   ≥44px targets (48px preferred); safe-area insets.
5. **Attribution** — header only, once: `Pilot Run · Developed by V L & CO`.
   **Footer** becomes support placeholders — do **not** invent the number or address:
   ```
   Need assistance?
   {SUPPORT_PHONE} | {SUPPORT_EMAIL}
   © KITCO. Pilot Environment.
   ```
   Read from config with obvious placeholder defaults.

**Accept:** no feature CSS defines its own button/input; one font family; 360/390/430 all clean;
"Developed by V L & CO" appears exactly once.

> Geist is on the `impeccable` hook's overused-font list — expect a warning on every UI file.
> It's a client instruction (D1/§4.2). Record it as a known accepted finding; don't fight it.

---

### Slice 1 — Roles, superadmin, routing
**Brief:** §6, §35, §36 · **Decision:** D9

1. **Migration** — widen the role constraint once, to the full future vocabulary:
   ```sql
   alter table app_users drop constraint app_users_app_role_check;
   alter table app_users add constraint app_users_app_role_check
     check (app_role = any (array[
       'SUPERADMIN','ADMIN','MANAGEMENT','CATALOGUE_MANAGER','SALES',
       'ORDER_OPERATIONS','DISPATCH_OPERATIONS','FINANCE_REPORTS','READ_ONLY','DEALER'
     ]));
   alter table app_users add column if not exists must_change_password boolean not null default false;
   alter table app_users add column if not exists status text not null default 'ACTIVE';
   ```
   Implement **SUPERADMIN / ADMIN / DEALER** only. Others reserved, unused.
2. **Guards** (`worker/middleware/auth.ts`) — generalise to `requireRole(...roles)`;
   keep `requireAdmin()` = `requireRole('SUPERADMIN','ADMIN')` so every existing
   `/api/admin/*` route keeps working. Add `requireSuperAdmin()`.
3. > **TRAP — this will silently lock out the superadmin.**
   > `worker/auth/verified-session.ts` branches on `app_role === "ADMIN"` **and** requires
   > `dealer_id === null`. If `SUPERADMIN` isn't added to that branch the account
   > authenticates and is then immediately rejected, with no useful error. Fix it in this slice.
4. **Role routing** — one sign-in form, no role picker. After OTP: `DEALER → /products`,
   `ADMIN|SUPERADMIN → /control`. Extend the existing `{ authenticated, role }` response.
5. **Superadmin seed** — promote the client-supplied email (D9). Read from env/config;
   **do not hardcode**. Document as a manual step until Users & Roles ships.

**Accept:** superadmin holds a session and reaches `/control`; a dealer hitting `/control`
is refused **server-side**, not just hidden in the UI.

---

### Slice 2 — Remove access code + rebuild existing-dealer activation
**Brief:** §8, §9, §10, §11, §13, §14 · **Decisions:** D3, D5, D6, D10

1. **Delete the pilot access code** from all 6 files, the `ACTIVATION_ACCESS_CODE` Worker
   secret, `.dev.vars.example`, and any deploy docs. Remove the copy, the input, and the tests
   that assert it.
2. **Migration** (additive only):
   ```sql
   alter table dealers add column if not exists primary_login_email text;
   alter table dealers add column if not exists secondary_email text;
   alter table dealers add column if not exists mobile text;
   alter table dealers add column if not exists contact_person text;
   alter table dealers add column if not exists gstin text;              -- unvalidated (D5)
   alter table dealers add column if not exists address_line1 text;
   alter table dealers add column if not exists address_line2 text;
   alter table dealers add column if not exists district text;
   alter table dealers add column if not exists pin_code text;
   alter table dealers add column if not exists country text default 'India';
   alter table dealers add column if not exists onboarding_status text;
   alter table dealers add column if not exists activated_via text;      -- MASTER_EMAIL | ALTERNATE_EMAIL
   alter table dealers add column if not exists primary_email_verified_at timestamptz;
   alter table dealers add column if not exists secondary_email_verified_at timestamptz;
   ```
   **Never overwrite `master_email`** (v3.0 §13 still stands).
3. **Flow** — mobile-first, one step per screen:
   ```
   Find dealership  → autocomplete: name + city only (never GSTIN/contact — v3.0 §10)
   Confirm business → GSTIN + structured address, PRE-FILLED where known,
                      REQUIRED but UNVALIDATED (D5/D6)
   Choose email     → masked master  [ Send OTP ]
                      "Can't access this email?" → [ Use another email ]
   Verify OTP       → with fallback (Slice 3)
   Create password  → ≥12 chars
   ACTIVE           → /products
   ```
4. **Alternate-email path (D10)** — activates instantly. Additionally, and **not** dependent on
   mail delivery:
   - write an audit event `DEALER_ACTIVATED_VIA_ALTERNATE_EMAIL`
   - set `dealers.activated_via = 'ALTERNATE_EMAIL'`
   - surface an "Alternate email" flag in Control → Dealers
   - attempt a notification to `master_email` (best-effort; see §7 R1)

**Accept:** full activation on a 390px screen; no access code anywhere in code, tests, env or
docs; GSTIN/address persisted; alternate-email activation is visible in Control even if the
notification email never arrives.

---

### Slice 3 — OTP channels + fallback
**Brief:** §15, §16 · **Decision:** D2

1. **Migration:**
   ```sql
   alter table otp_challenges add column if not exists delivery_channel text default 'PRIMARY_EMAIL';
   alter table otp_challenges add column if not exists destination_masked text;
   alter table otp_challenges add column if not exists fallback_from_challenge_id uuid;
   ```
2. **Provider port** — generalise `EmailOTPProvider` to `VerificationChannel` with
   `PRIMARY_EMAIL`, `SECONDARY_EMAIL` implemented and `SMS` defined-but-unregistered.
   > **Do not regress:** `ResendEmailProvider` must keep calling `fetch` bound to `globalThis`.
   > Calling it as a method throws `Illegal invocation` on Workers. This was a live production bug.
3. **UI** — render only channels that actually exist for that dealer:
   ```
   Didn't receive the code?
   [ Resend to primary email ]   [ Send to secondary email ]
   ```
   SMS must **not** render while unimplemented (dead controls are banned).
4. **Keep `PILOT_STATIC_OTP`** (D2), env-gated. Preserve expiry, hashing, attempt limits,
   replay protection, purpose binding, correlation ID.
5. **Mobile OTP UX** (§16) — `inputmode="numeric"`, `autocomplete="one-time-code"`, paste
   support, auto-advance, resend timer, masked destination.

**Accept:** falling back to the secondary email issues a new challenge linked via
`fallback_from_challenge_id`; SMS is absent from the UI; `123456` still works while the secret is set.

---

### Slice 4 — New dealer registration + approval queue
**Brief:** §12, §45

1. **Migration** — `dealer_applications` with statuses
   `DRAFT | OTP_VERIFIED | SUBMITTED | UNDER_REVIEW | APPROVED | REJECTED | MORE_INFO_REQUIRED`.
2. **`/register`** — business name, GSTIN, address, contact person, primary + secondary email,
   mobile → OTP → `SUBMITTED`. Explicitly tell the applicant they are **not** active yet.
3. **`/control/dealer-applications`** — queue with approve / reject / request-more-info.
   Approval creates the canonical dealer and only then permits activation.
4. **Hard rule (§45):** a submitted application grants **no** dealer access. Enforce
   server-side — an unapproved applicant hitting `/api/catalogue` gets 403.

**Accept:** a new dealer submits, cannot reach `/products`, appears in the queue, and gains
access only after approval.

---

### Slice 5 — Cart as a first-class route
**Brief:** §22, §17, §21

1. **`GET /api/drafts/current`** — this does not exist today and blocks everything here.
   Return lines with product identity (family name, article, colour, sizes, pairs, retail value).
2. **`DELETE /api/drafts/current/lines/:offeringId`** and quantity edit.
3. **`/cart`** — mobile list per §22.1, edit quantities, remove lines, sticky summary
   (`N pairs · M articles · Retail Value`), `[ Review Order ]`.
4. **PDP change** — `Add to Current Order` saves the draft and shows
   `[ Continue Shopping ] [ View Cart ]`. **Remove the OTP and submit path from the PDP entirely.**
5. **Bottom nav** cart badge reflects line count.

**Accept:** 5+ articles accumulate, survive reload, quantities editable, lines removable,
and **no OTP is requested anywhere on the PDP**.

---

### Slice 6 — Review + single final OTP
**Brief:** §23, §24, §48

1. **`/checkout/review`** — dealer/Bill-To/Ship-To, every article with sizes and pairs, order
   summary, the §24 disclaimer verbatim, and a required confirmation checkbox.
2. **`Place Final Order`** → OTP (`ORDER_SUBMISSION`, with Slice 3 fallback) → atomic,
   idempotent submit. Keep the existing `Idempotency-Key` behaviour.
3. Delete the per-article OTP flow from `DealerOrderJourney`.

**Accept:** exactly **one** OTP per order regardless of article count; double-click creates one
order; a failed submit preserves the cart and allows retry (§52).

---

### Slice 7 — Catalogue mobile + gender
**Brief:** §19, §20, §21, §41

1. **Gender** — extend normalisation to `MEN | WOMEN | KIDS | UNISEX | UNKNOWN`
   (currently MEN/WOMEN/UNISEX only). Display title-case. **Never fabricate** — absent stays `UNKNOWN`.
2. **Product card** (§19.3) — image → brand → family name → `Men · Running` → colour → MRP,
   offering badge only when meaningful.
3. **Filters** — bottom sheet on mobile. Gender/Brand/Category/Offering/MRP ship now.
   **Season and Schemes stay deferred** — both tables are empty (0 rows); rendering them would
   be dead controls. Ship them when data exists.
4. **PDP mobile** (§21) — large image, colourway switcher where a family has siblings,
   `QuantityStepper` per size, MOQ/multiple warning, one sticky CTA.

**Accept:** 360/390/430 with no horizontal scroll; gender visible on card and PDP; quantity
steppers comfortably thumb-sized.

---

### Slice 8 — KITCO order queue + partial approve/hold
**Brief:** §26, §27, §28, §37 · **Decision:** D4
**This slice needs database work — it is not frontend-only.**

1. **New audited Postgres function** for partial decisions. `approve_kitco_order` only approves
   whole orders and `reviseOrder()` currently throws. Model KITCO's decision as **separate
   allocation data** (§47) — do **not** rewrite the dealer's submitted order.
   ```sql
   -- decision per order line + size
   approved_quantity_pairs
   held_quantity_pairs
   hold_reason  -- CREDIT_HOLD | STOCK_REVIEW | COMMERCIAL_REVIEW
                -- | ALLOCATION_PENDING | MANUAL_REVIEW | OTHER
   ```
   Enforce `approved + held <= ordered` server-side; for the pilot require
   `approved + held = ordered` before finalising (§27.2).
2. **`/control/orders`** — real queue: Order No, Dealer, City, State, Submitted, Articles,
   Pairs, Retail Value, Status, Approved, Held, Dispatched, Pending. Filters per §27.1.
3. **`/control/orders/:id`** — per line/size `Ordered / Approve / Hold / Reason`, mobile card
   layout per §27.3.
4. **Dealer view (§28)** — business language only:
   `Ordered / Approved / On Hold / Dispatched / Pending`.
   **No V1/V2, no correlation IDs, no technical identifiers** (§25, §53).
5. **Audit (§37)** — readable admin history: who, when, what, how many.

**Accept:** approving 70 and holding 30 of 100 persists, audits, and is visible to the dealer in
plain language. Dealer is **not** asked to re-accept (D4).

---

### Slice 9 — Consolidated CSV export
**Brief:** §29 · **Decision:** D7

**One CSV covering every dealer and every order** — one row per dealer → order → article → size.
Not one file per dealer.

Columns exactly per §29 (30 columns: Order No … Fulfilment Status).
Filters: dealer, date range, brand, order status, hold status, state.
Server-generated and streamed from the Worker; scope every query by `organisation_id`.

**Accept:** opens cleanly in Excel; columns match §29; approved/held/dispatched/pending are
correct against a partially-approved order.

---

### Slice 10 — Language + identifier cleanup
**Brief:** §25, §53

- Business statuses only: `SUBMITTED | UNDER_REVIEW | PARTIALLY_APPROVED | APPROVED | ON_HOLD
  | PARTIALLY_DISPATCHED | DISPATCHED | CANCELLED`.
- **Map `order_number` through to the UI.** It is already selected in `ORDER_SELECT` but never
  mapped into `OrderRecord`, so dealers currently see raw UUIDs. Pure plumbing, high payoff.
- Purge V1/V2 and correlation IDs from all dealer-facing copy.

---

## 5. P1 / P2 / P3

**P1 — operational completeness (§30):** dealer CRUD · admin-user CRUD (Users & Roles UI, temp
password shown once, `must_change_password`) · product/catalogue CRUD · catalogue import
upload→preview→commit (§31) · offerings · schemes · dealer Home (D8) · broader reporting.

**P2 — media (§32):** upload button, media library, colourway mapping, R2 variant pipeline,
image status. This is what finally closes the 551 missing images — *and it needs photography
from KITCO, not just code.*

**P3 — sizes (§33):** size-set CRUD, values, ordering, product mapping, brand-specific sets.

**Shared mutation contract for all CRUD:** zod validation · **every query filtered by
`organisation_id`** (the Worker uses the service-role key and bypasses RLS, so a missing filter
is a cross-tenant write, not a cosmetic bug) · correlation ID · audit event · idempotency key on
creates · visible busy state · typed confirmation on destructive actions · deactivate rather
than delete.

**Never mutable:** `audit_events` (v3.0 §109) and submitted order evidence (§47).

---

## 6. Verification (§56)

**Functional:** activation happy path · alternate-email path · OTP fallback · new-dealer
registration · admin approval · login as dealer / admin / superadmin · 5+ articles in cart ·
edit cart · review · single final OTP · duplicate-click idempotency · admin approve+hold ·
dealer status visibility · CSV export.

**Security:** Dealer A cannot read Dealer B · dealer blocked from admin routes **server-side** ·
admin blocked from superadmin actions · unauthorised media access · OTP replay · OTP wrong
purpose · unapproved applicant cannot reach `/api/catalogue`.

**Mobile — 360 / 390 / 430px**, using Playwright (the built-in Browser pane blocks this origin):
```text
mcp__plugin_playwright_playwright__browser_navigate / _snapshot / _resize / _click / _console_messages
```
> Do **not** mix `browser_fill_form` and `browser_type` on one field — `fill()` sets and
> `pressSequentially()` appends, producing doubled values and a misleading 401.

Test with keyboard open, long dealer names, long addresses, and 20+ cart lines.

---

## 7. Risks and accepted trade-offs

**R1 — Dealership takeover via alternate email. ACCEPTED (D10).**
With the access code deleted (§8) and GSTIN unvalidated (D5), anyone who knows a dealer's name
can select it, supply their own email, receive the OTP and set a password — taking over that
dealership. This is the exact scenario v4.0 §11 says must not be allowed; the client has chosen
notify-and-activate instead. **Compounding factor:** Resend only delivers to
`siddheshgupta7@gmail.com` today, so the warning email will usually not arrive. Mitigations that
do not depend on delivery: audit event + `activated_via` flag + visible marker in Control →
Dealers. Revisit before the pilot is opened beyond a known dealer list.

**R2 — `PILOT_STATIC_OTP=123456` is live on a public URL. ACCEPTED (D2).**
Anyone who knows it passes OTP for **any** account, including admin. Acceptable for a closed
pilot. **Unset the secret before real dealers onboard** — it is a one-command change.

**R3 — Partial approval needs schema work.** Slice 8 cannot be done in the frontend;
`reviseOrder()` throws and `approve_kitco_order` is whole-order only. Budget for a migration
plus an audited function.

**R4 — Geist trips the design hook.** Client instruction; record as accepted, don't fight it.

**R5 — Season/Scheme filters have no data.** 0 rows in both tables. Deferred until data exists
rather than shipping dead controls.

**R6 — SMS deferred (D2).** India transactional SMS needs TRAI DLT registration. The channel
port exists so SMS drops in later with no schema or UI rework.

**R7 — 551 products have no photography.** Not a bug (v3.0 §51/§87). Needs images from KITCO.

---

## 8. Definition of P0 ready (§57)

1. Activation works with **no** pilot access code
2. Existing dealer can use primary **or** secondary email
3. OTP fallback works
4. New dealer can register for KITCO approval and is **not** auto-active
5. Dealer signs in on mobile
6. Dealer filters by gender
7. Multiple articles in one cart
8. **No OTP per article**
9. One OTP confirms the final order
10. KITCO receives all submitted orders
11. KITCO approves and holds quantities
12. Hold reason visible and audited
13. Dealer sees the decision in business language
14. Consolidated CSV export works
15. Multiple KITCO admins work
16. Superadmin works
17. One design system
18. 360 / 390 / 430 pass
19. RLS isolation passes
20. typecheck + tests + build green

**Pre-launch, separately:** unset `PILOT_STATIC_OTP`; supply real support phone/email for the
footer; supply and promote the superadmin email (D9).
