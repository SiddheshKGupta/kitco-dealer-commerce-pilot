# KITCO Dealer Commerce — Pilot Uplift Plan

**Status:** Ready for execution
**Planned:** 2026-08-14 (Opus 5) · **Executed by:** Sonnet
**Branch:** `codex/kitco-pilot` · **Worktree:** `.worktrees/kitco-pilot`
**Live:** https://kitco-dealer-commerce.siddeshgup.workers.dev

---

## 0. How to use this document

Work the phases **in order**. Each phase lists: root cause, exact files, the change, and
an acceptance check. Do not start a phase until the previous phase's acceptance check passes.

Run after every phase:

```bash
npm.cmd run typecheck && npm.cmd test -- --run --testTimeout=20000 && npm.cmd run build
```

Deploy only from the worktree, and **always `npm run build` first** — `wrangler deploy` reads
the built artifact `dist/kitco_dealer_commerce/wrangler.json`, *not* `wrangler.jsonc` directly.
Skipping the build silently deploys stale code and can drop `vars`.

```bash
export XDG_CONFIG_HOME="$PWD/.wrangler-config"
npm.cmd exec -- wrangler deploy
```

---

## 1. Authority order (resolve all conflicts this way)

```text
1. Handover v3.0 (FROZEN FOR BUILD)        ← commercial + data rules win
2. Escapement docs/standards/design-intelligence.md  ← design constitution
3. Escapement docs/standards/ui.md          ← enterprise UI standard
4. KITCO_Dealer_Commerce_Prototype.html     ← visual reference only
5. VoltAgent Nike DESIGN.md                 ← external reference, lowest
```

**Known conflict — already resolved:** the approved prototype shows dealer price, indicative
margin, GST estimate and numeric stock availability, and offers WhatsApp/SMS OTP. Handover
§24 / §26 forbid all of the first four; §16 mandates email-only OTP. **The handover wins.**
Take *visual language* from the prototype, never its commercial fields. The current build is
already correct on this — do not regress it.

---

## 2. Confirmed defects (verified in code, not assumed)

| # | Defect | Root cause | Evidence |
|---|---|---|---|
| D1 | "Developed by V L & CO" appears 3× on desktop | Header lockup + top-right pill + footer all carry the string | `KitcoHeader.tsx:17,19`; footer in `App.tsx` |
| D2 | Product search barely works | Catalogue API never returns product **name / category / gender** | `supabase-commerce-repository.ts` → `CATALOGUE_SELECT` selects only `product_families!inner(brands!inner(name))` |
| D3 | Filters are Brand-only | `FilterRail.tsx` renders a single `Brand` fieldset | vs Handover §89 which lists 13 filter dimensions |
| D4 | No product families / colourway switching | Same as D2 — family name never leaves the DB | Handover §36 requires Nike-style family grouping |
| D5 | Admin nav hides 9 of 15 sections on mobile | `control.css` `@media(max-width:760px)` sets `.control-nav span, .control-nav nav a:nth-of-type(n+7){display:none}` | Was written for a 6-item nav; console now has 15 |
| D6 | Admin sections are read-only | Console ships reads; only Orders has approve/dispatch/hold | Handover §58/§81/§86 expect publish, commit, upload actions |
| D7 | Registration flow ≠ new client requirement | Current `/activate` is lookup → email → OTP → password | Client now wants self-registration with prefill |

**Not a defect (do not "fix"):** 551 products showing *"Image arriving soon"*. Only 90 Nike
JPEGs were ever supplied; Reebok / DOUBLEU / Lee Cooper photography does not exist. Handover
§51/§87 explicitly require a clean placeholder and allow the product to stay orderable.
This needs *photography*, not code.

---

## 2B. Visual defect register — from live screenshots, 2026-08-14

This is the "all over the place / nothing like Nike" list, itemised. Every entry is a
**specific cause**, not a taste note. Fix these in Phase 1 (chrome/shell) and Phase 3
(catalogue) — they are the difference between "styled" and "designed".

### Layout structure

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| **V1** | Login/activation card sits top-left in a huge grey void; ~65% of the screen empty | `.auth-shell` centres its grid child, but that child is `.route-transition{width:100%}` which fills the row — `.auth-page` inside has no auto margin | `global.css:55` add `display:grid;justify-items:center` to `.route-transition`, **or** `margin-inline:auto` on `.auth-page`. Then build the prototype's split hero (dark `#0c0c0c` panel left, form right) so the space is *used*, not just centred. |
| **V2** | Products page: title far left, lead copy far right, enormous gap between them | `.commerce-page-heading` is `grid-template-columns:minmax(0,1fr) minmax(260px,400px)` with `align-items:end` — pushes the two apart at 1900px | Cap the header to a readable measure; put eyebrow + h1 + lead in one left-aligned stack, actions right. Kill the two-column split. |
| **V3** | ~700px of dead space before the first product | `.commerce-page{padding:clamp(42px,6vw,88px)}` + `.commerce-page-heading{padding-bottom:clamp(40px,7vw,92px)}` compound | Reduce to `32px` top and `24px` header gap. Products must be visible above the fold — this is the single biggest "not like Nike" signal. |
| **V4** | PDP: below the image the left ~55% of the viewport is empty white for a full screen height | `.commerce-pdp-grid` gives the image column `1.45fr` with a fixed aspect ratio; once the image ends nothing occupies the column | Make the right column sticky (`position:sticky;top:96px;align-self:start`) so ordering controls stay beside the image, or move Current Order summary under the image. |
| **V5** | PDP size entry is a 2-column list of 13 rows — very tall, pushes the CTA off-screen | `.commerce-size-grid{grid-template-columns:repeat(2,1fr)}` with one row per size | Use a compact wholesale size matrix: sizes as a header row, quantity inputs beneath (Handover §40 shows exactly this). Falls back to stacked rows under 560px. |

### Product identity and content

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| **V6** | Cards and PDP are titled by **article number** (`343851-007`), never a product name | D2 — catalogue API never returns `product_families.name` | Phase 2. Then card title = family name, article no becomes secondary metadata. This is *the* reason it reads as a spreadsheet rather than Nike. |
| **V7** | Colour renders as raw uppercase `PURE PLATINUM/BLACK-COOL GREY-WOLF GREY` | Source string passed through untouched | Title-case for display, keep the raw value in the data layer. Truncate to one line with `title` attr for the full string. |
| **V8** | Orders list shows raw UUIDs (`0c42d5f0-c3dc-436a-…`) | `order_number` **is** selected at `supabase-commerce-repository.ts:117` but never mapped into `OrderRecord`, so the UI falls back to `order.id` | Map `order_number` through the repository → `OrderRecord` → API → UI. Handover §95 wants `KIT-ORD-000281` form. Pure plumbing, high visible payoff. |
| **V9** | No offering badge on product cards | Card markup has no badge slot | Add the prototype's `.badge` (top-left on the image) carrying Stock in Hand / Upcoming / Prebook. Currently the tabs are the *only* way to tell them apart. |
| **V10** | "Minimum **1 pairs**" | Unpluralised string | Pluralise: `1 pair` / `12 pairs`. Same for "0 pairs selected". |
| **V11** | Orders page headed **"Current Order"** but lists *submitted* orders | `OrdersSurface` hardcodes the heading | Heading should be "Orders"; "Current Order" is the draft, which belongs in its own tab/section (Handover §42 — one active Current Order). |

### Controls and affordance

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| **V12** | Search is a bare underline spanning ~1600px; doesn't read as a search field | `.commerce-search input{border:0;border-bottom:1px solid}` with no width cap | Prototype `search-pill`: `background:var(--soft)`, `radius:24px`, `height:40px`, magnifier icon, `max-width:420px`. |
| **V13** | Auth text inputs are full pill (999px) | `--radius-control` applied to inputs | Inputs use `--radius-sm` (12px) per prototype; pills are for **buttons and chips only**. |
| **V14** | Disabled primary CTA is mid-grey and reads as enabled-but-broken | `.primary-action:disabled{opacity:.5}` on a black fill → muddy grey | Disabled = `background:var(--soft)`, `color:var(--muted)`, `cursor:not-allowed`. Never a half-opacity black. |
| **V15** | Stray scrollbar artifact beside the catalogue tabs | `.commerce-tabs{overflow-x:auto}` shows a vertical scrollbar track on Windows | `overflow-x:auto;overflow-y:hidden` + `scrollbar-width:none` with a fade affordance. |

**Sequencing note:** V6 depends on Phase 2. V1–V5, V7, V9–V15 are pure frontend and can all
land in one pass. V8 is a small backend map. Do V1–V5 first — layout structure is what makes
it read as "all over the place"; the rest is finish.

---

## 3. Design direction — **decide before writing UI code**

Escapement's `design-system` skill forbids silently picking a visual direction. KITCO has two
surfaces with genuinely different jobs, which maps to the handover's own governing principle
(*"Browse like Nike. Order like a wholesaler."*):

| Surface | Archetype (design-intelligence §4) | Why |
|---|---|---|
| Dealer catalogue, PDP, ordering | **4.5 Product Gallery Minimalism** | product-first imagery, minimal chrome, restrained colour |
| KITCO Control | **4.1 Enterprise Structured** | high density, strong grid, visible hairlines, predictable nav |

Shared token spine (both surfaces, already partly landed in `tokens.css`):

```text
ink #111111 · canvas #ffffff · soft #f6f6f6 · soft2 #fafafa · line #e5e5e5 · muted #6f6f6f
success #137333 · warning #9a6700 · danger #b42318 · info #174ea6 · focus #1151ff
radius 18px (card) / 12px (control) / 999px (pill)
font  system Arial/Helvetica stack   ← prototype uses system fonts, NOT Inter
depth one shadow level only: 0 18px 45px rgba(0,0,0,.10)
```

**Deliverable for this phase:** write `DESIGN.md` at repo root recording the above, the
adopted/rejected patterns, and the accessibility obligations. `frontend-implementation`
requires an approved `DESIGN.md` to exist before implementing UI.

---

## Phase 1 — Chrome, attribution, and the app shell

**Fixes D1.**

Handover §4 asks for pilot branding in three places; Decision Q1 resolved this as follows
(satisfies §4's intent without printing the same sentence twice in one 80px strip):

- `KitcoHeader.tsx` — keep the logo lockup line `Dealer Commerce Platform` + `Pilot Run`, but
  **drop `· Developed by V L & CO` from the lockup**.
- Keep the desktop top-right pill as **`PILOT · Developed by V L & CO`** (this is §4.2 verbatim).
- Keep the footer as **`Pilot Environment · Developed by V L & CO`** (§4.4 verbatim).
- Net: attribution appears twice total (top-right + footer), never twice in the same region.

Also in this phase, rebuild the shell toward the prototype topbar:

- Sticky 72px topbar; brand left, dealer nav centre with a 2px active underline, right cluster.
- Right cluster = user chip (avatar initials + dealer/admin name) + **Sign out**.
  Sign-out already exists (`/api/logout`) — move it into the chip cluster.
- Mobile (<850px): nav collapses to a drawer; keep `PILOT` badge; never hide sign-out.

**Files:** `src/components/KitcoHeader.tsx`, `src/app/App.tsx`, `src/styles/global.css`
**Accept:** on a 1280px viewport the string "Developed by V L & CO" appears exactly twice
(top-right, footer); at 375px the nav is reachable and sign-out is visible.

---

## Phase 2 — Catalogue data contract (**highest leverage — unblocks Phases 3 & 4**)

**Fixes D2, D4; prerequisite for D3.**

The DB already holds everything needed (`product_families`: 271 rows with `name`, `category`,
`gender`). The API simply never selects it.

1. `worker/supabase-commerce-repository.ts` — extend `CATALOGUE_SELECT`:

```diff
- product_families!inner(brands!inner(name)),
+ product_families!inner(id,name,category,gender,brands!inner(name)),
```

2. Extend the mapper to emit `familyId`, `familyName`, `category`, `gender`, and carry
   `offering.type` (already present) plus `season`/`expectedInwardMonth` when non-null.
3. `src/features/catalogue/types.ts` — add to `CatalogueProduct`:
   `familyId: string; familyName: string | null; category: string | null; gender: string | null;`
4. **Guard the commercial boundary:** do **not** add price/margin/GST/stock fields. Handover
   §24/§26. There is an existing test asserting this — keep it green.

**Accept:** `GET /api/catalogue` returns `familyName` and `category` for Nike rows; the
"no dealer price / no stock" test still passes.

---

## Phase 3 — Product discovery: search, filters, families

**Fixes D3, D4.**

### 3a. Search
Widen the match set in `CataloguePage.tsx` to `articleNo + brand + colour + familyName + category`.
Debounce ~150ms. Show `N results` and a **no-results** state with a "Clear filters" action
(Escapement `ui.md` requires an explicit no-results state).

### 3b. Filters — build to Handover §89, using only data we actually have
Ship these now (all derivable post-Phase 2):

| Filter | Source |
|---|---|
| Offering type (All / Stock in Hand / Upcoming / Prebook) | `offering.type` — already tabs, keep as tabs |
| Brand | `brand` |
| Category | `product_families.category` |
| Audience / Gender | `product_families.gender` |
| Size | `offering.enabledSizes` |
| Colour | `colour` |
| MRP range | `mrpMinor` |

Defer (no data yet — do **not** render a dead control): Season, Year, Delivery Month,
Expected Inward Month, Scheme, Collection. `seasons` and `schemes` tables are empty.
Escapement `enterprise-ui-review` item 13 explicitly bans dead controls.

Filter rail: sticky, collapsible groups, selected-count badge, **Clear all**. Mobile: reuse the
existing `MobileFilterDrawer` (its focus trap is already correct) and show an applied-filter
count on the trigger.

### 3c. Product families (Handover §36)
Group colourways by `familyId`. Card shows the family with a colourway count; PDP exposes
colourway switching that updates Article No, colour, image, MRP, enabled sizes and offering.
Fallback where a family has one colourway: render as today.

**Files:** `CataloguePage.tsx`, `FilterRail.tsx`, `MobileFilterDrawer.tsx`, `ProductGrid.tsx`,
`DealerOrderJourney.tsx`, `commerce.css`
**Accept:** searching a product name returns hits; each filter narrows the grid; clearing
restores 641; no filter renders with zero possible values.

---

## Phase 4 — Mobile and responsive pass

**Fixes D5.**

1. **Admin nav bug (D5)** — delete the `nth-of-type(n+7){display:none}` rule in
   `control.css`. Replace the mobile treatment with a horizontally scrollable section rail
   **or** a `<select>` section switcher. All 15 sections must be reachable at 375px.
2. Breakpoint spine (align all four CSS files, currently 640/760/880/440 — inconsistent):
   `1100px` (grid 3→2), `850px` (nav→drawer, rail→drawer, admin→stacked), `560px` (2→1 col).
3. Tap targets ≥44×44 (design-intelligence §9.2 / WCAG AAA).
4. Tables: card-stack or horizontal scroll with a sticky first column below 850px — the admin
   console has 6-column tables that will be unusable on a phone.
5. Verify: catalogue grid, PDP, Current Order tray, all 15 admin sections, login, registration.

**Accept:** `resize_window` to 375×812 → every route usable, no horizontal page scroll,
no clipped controls.

---

## Phase 5 — Dealer self-registration (**new client requirement**)

**Fixes D7.** This is the largest new build. See Decision Q2 in §11 before starting.

### Flow

```text
1  Find your dealership       autocomplete (min 3 chars) → name + city ONLY
2  Not listed? → manual path  (see below)
3  Email for the pilot        + pilot access code
4  Email OTP                  purpose = ACTIVATION
5  ── identity now proven ──
6  Profile completion         PREFILLED from master + dealer fills the gaps
7  Create password            ≥12 chars
8  ACTIVE                     → /products
```

### Security constraint — do not get this wrong
Prefill **must not** happen before step 5. Handover §10 forbids exposing GSTIN or full
mobile/email in autocomplete; returning master data at step 1 would let anyone who guesses a
dealer name harvest that dealership's GSTIN and contact details. **Serve prefill only after the
ACTIVATION OTP is verified**, scoped to the dealer bound to that verified challenge.

### Fields
Prefilled (editable) from `dealers` / `dealer_locations` / `dealer_gst_registrations`:
name, state, city, address, GSTIN.
Dealer-entered: contact person, mobile, pincode, shipping address, confirm email.

### Data gap — migration required
`dealers` has no `mobile` column and no `pincode`. `dealer_source_records` holds the raw
import only. Add a migration:

```sql
alter table dealers add column if not exists contact_person text;
alter table dealers add column if not exists mobile text;
alter table dealers add column if not exists pincode text;
```

Never overwrite `master_email` (Handover §13) — pilot values live in `pilot_email` /
`pilot_email_source`.

### API
- `GET  /api/activation/prefill` — requires verified pending ACTIVATION session; returns the
  bound dealer's prefillable fields.
- `POST /api/activation/profile` — writes profile + creates the auth user + flips to ACTIVE,
  transactionally, idempotently (Handover §123). Audit event per §108.

### Unknown dealer ("not listed") path — decided: self-activate
A dealer absent from the master completes the same flow and reaches ACTIVE directly (Decision Q2).
Required safeguards:

- `alter table dealers add column if not exists source text default 'KITCO_MASTER';`
  self-created rows get `'SELF_REGISTERED'`.
- Fuzzy-match the entered name against the master before creating; on a near match, return the
  candidates and push the user back to autocomplete rather than creating a shadow dealership.
- Audit event on creation; one dealer ↔ one auth user (§15).
- Control → Dealers must show the `source` column so KITCO can review self-created records.

**Files:** `ActivationPage.tsx` (→ multi-step), `worker/routes/activation.ts`,
`worker/auth/supabase-auth.ts`, new migration, `ControlSections.tsx` (Dealers approve queue)
**Accept:** a master dealer self-registers end-to-end with prefill; prefill returns 401 before
OTP; an unknown dealer lands in the review queue and cannot reach `/products`.

---

## Phase 6 — KITCO Control depth (read → act)

**Fixes D6.** The console currently reads live data across 15 sections; these add the actions
the handover expects. Ship in this order:

1. **Dealers** — detail drawer (GSTs, locations, activation history); Approve/Reject pending
   registrations (from Phase 5); reset activation (§15, audited).
2. **Catalogue** — publish / unpublish a colourway (§86 keeps import and publish separate);
   bulk publish by filter.
3. **Catalogue Imports** — upload → detect profile → preview → **confirm** → commit
   (§61, §81, §82). Commit must be transactional and idempotent.
4. **Media Library** — per-colourway upload → normalise to the §56 variant ladder
   (200/600/900/1400 WebP + 1600 JPEG master) → publish. Reuse `scripts/generate-webp-600.mjs`
   logic server-side. This is what actually closes the 551 missing images.
5. **Commercial Offerings** — edit MOQ, order multiple, booking window, publish state.
6. **Seasons / Schemes** — create + date windows; unblocks the deferred filters in Phase 3b.
7. **Reports** — filter set per §105, CSV export per §107.
8. **Dispatch / Credit Holds** — list + create; wire to the existing POST endpoints.

Every mutation: server-side validation (§122), correlation ID, audit event (§108), and a
visible busy state on the control (CLAUDE.md live-honest-UI rule).

**Accept:** each section's primary action round-trips to Supabase and writes an audit row.

---

## Phase 7 — Escapement UI quality gate + polish

1. Install Escapement into the repo, or run its gate standalone:
   ```bash
   python scripts/ui_quality_gate.py src
   ```
   It scans for responsive breakpoints, motion transitions, `prefers-reduced-motion`,
   `:focus-visible`, and loading/error-state handling. Must be clean before closing UI work.
2. Complete-state sweep (`ui.md`): every material screen covers loading, empty, no-results,
   partial, stale, error, permission, success, destructive-confirm.
3. Motion budget: ≤250ms, ease-out for enter/exit, `prefers-reduced-motion` fallback everywhere.
4. Accessibility: visible focus on every interactive element, labelled controls, keyboard paths
   through catalogue → PDP → order → submit, and through all 15 admin sections.

---

## 8. Security items to close before real dealers onboard

| Item | Action |
|---|---|
| `PILOT_STATIC_OTP=123456` is live on a public URL | Delete the secret once Resend delivers. Anyone who knows it can pass OTP for **any** account. |
| Resend sandbox | Only delivers to `siddheshgupta7@gmail.com`. Verify a domain or add verified recipients. |
| `ACTIVATION_ACCESS_CODE` | **Rotate before distribution — treat the current value as burned.** Per Decision Q2 this code is now the sole gate on dealership creation, so it is load-bearing. |
| Prefill endpoint | Must be gated on a verified OTP session (Phase 5). |

---

## 9. Regression guards — do not break these

- No dealer price, margin, GST estimate, payable, or numeric stock anywhere dealer-facing (§24/§26).
- Order versions immutable; revisions append (§95).
- RLS: dealer scope from `auth.uid()` → `app_users` → `dealer_id`; never trust a client-supplied
  dealer id (§119/§120).
- Service-role key never reaches the browser (§121).
- `SupabasePasswordAuthenticator` must keep using a **separate** client for `signInWithPassword`
  — sharing the admin client leaks the dealer session onto privileged writes and breaks RLS.
  (This was a live production bug; do not reintroduce it.)
- `ResendEmailProvider` must call `fetch` bound to `globalThis` — calling it as a method throws
  `Illegal invocation` on Workers. (Also a live bug already fixed.)

---

## 10. Current verified state (baseline)

```text
tests      134 passing
typecheck  clean
build      clean
deployed   d07f499a-155e-4036-91fd-b651c9874939
data       136 dealers · 641 colourways · 90 with display media · 641 offerings
           6 size sets · 5 import jobs · 4 brands · 3 audit events
           0 seasons · 0 schemes · 0 dispatches · 0 holds  ← genuinely empty, not broken
```

---

## 11. Decisions — RESOLVED 2026-08-14

**Q1 — Pilot attribution. → Drop from the logo lockup.**
Lockup keeps `Dealer Commerce Platform` / `Pilot Run`. The VLCO credit appears exactly twice:
the §4.2 desktop top-right pill and the §4.4 footer. Implement as written in Phase 1.

**Q2 — Unknown dealers. → Self-activate, same as known dealers.**
No `PENDING_KITCO_REVIEW` queue. A dealer not on the master completes the same registration and
reaches ACTIVE directly. Consequences that MUST be handled in Phase 5:

- The pilot access code becomes the **only** gate on dealership creation. Rotate
  `ACTIVATION_ACCESS_CODE` before distribution — the current value was generated in-session and
  has been discussed in plaintext, so treat it as burned.
- Mark self-created dealers so KITCO can tell them apart from the 135 imported records:
  set `dealers.source = 'SELF_REGISTERED'` (add the column in the Phase 5 migration) and keep
  `dealer_source_records` empty for them. Surface the distinction in Control → Dealers.
- Still write an audit event on creation (§108) and enforce one-dealer-one-auth-user (§15).
- Duplicate guard: block a self-registration whose name fuzzy-matches an existing master dealer,
  and steer the user back to the autocomplete instead of creating a shadow record.

**Q3 — Phase order. → Dealer-facing first.**
Execute 1 → 2 → 3 → 4, then 5 (registration), then 6 (admin depth), then 7 (gate + polish).
