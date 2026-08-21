# KITCO Management Suite — UI/UX Redesign

**Date:** 2026-07-31
**Engagement:** VL & Co × KITCO
**Baseline:** `VLCO_Enterprise_AI_Coding_Standards_Project_Baseline_v3.0.md`
**Source artifact:** `KITCO_Management_Suite_v5_Working_Preview.html` (1,689 lines, single file)
**Working copy:** `C:\KITCO\index.html`
**Scope:** Visual system and interaction design. Business logic, data model and calculations are retained.

---

## 1. Problem

v5 is functionally close and visually undifferentiated. It is a competent generic
SaaS admin panel: stock dashboard blue, an `11px` type floor, ~20 pill variants,
and twelve card-shaped components that all render as a bordered white rectangle
on grey. Nothing in it signals a point of view, and the layer that constitutes
the actual IP — exception → owner → evidence → closure — is collapsed behind a
`View all metrics` toggle on the owner's landing page.

Separately, four working features are unreachable because they were written and
never wired (§7).

## 2. Doctrine

> **A named clock on every rupee.**

KITCO is a chase product, not an analytics product. Three facts set the
hierarchy on every screen: **amount, owner, age.**

**The enforcement rule.** A component that shows a number but names no owner and
states no age must justify its existence or be removed. Applied to v5 this
deletes the nine module-health cards and most of the KPI wall.

**Where the executive summary lives.** The "daily brief" reading of this product
is correct but does not belong in the app shell. It belongs in the existing
`@media print` stylesheet, which already hides chrome and renders overview only —
a four-minute read-out the owner can forward as a PDF. The app underneath stays
a working tool for the twenty staff whose daily use justifies a retainer.

## 3. Verified findings

Measured, not asserted. Contrast computed per WCAG 2.1 relative luminance;
harness retained as `tests/contrast.mjs`.

### 3.1 Contrast

| Token | On `#FFFFFF` | Verdict |
|---|---:|---|
| `--text-faint #98A2B3` (v5) | 2.58 | **FAIL** |
| Baseline v3.0 `Warning #E59400` | 2.45 | **FAIL** |
| Baseline v3.0 `Success #2D8A56` | 4.30 | large text only |
| Baseline v3.0 `Error #D93838` | 4.59 | marginal |
| Baseline v3.0 `Information #2374AB` | 5.05 | pass |
| v5 `--state-orange-fg #8A4200` | 7.34 | pass |
| v5 `--state-red-fg #9D2530` | 7.66 | pass |
| v5 `--state-green-fg #0B6542` | 7.11 | pass |

Two consequences:

1. **`--text-faint` is the label colour for the entire interface** — `.nav-label`,
   `.ribbon-signal`, `.hierarchy-section-label`, `.kpi-arrow`. Every organising
   label in the product is below AA.
2. **Baseline v3.0's own state colours fail as text.** `#E59400` at 2.45:1 can
   never be a word. This is a defect in the standard, not in KITCO, and should be
   raised against the baseline document: it needs a fill-tone / text-tone split.
   v5's `--state-*-fg` variants already solve this correctly and are the model.

### 3.2 Staleness

`DEMO_TODAY = "2026-07-23"` is frozen, and `renderPageHead()` hard-codes
`Management date · 23 JUL 2026 · IST` into every screen. The project log states
the opposite rule twice: as-of anchoring must be computed, and every screen must
show "Data as of [timestamp]" so a stale upload is never mistaken for live data.
The demo currently displays an eight-day-old date on every page.

`"6.8% positive movement"` is a hard-coded string rendered beside computed
figures. In a product whose pitch is that every number reconciles, one typed
number is a liability.

### 3.3 Default-state inversion

`renderCommandCentre()` places three alerts, six KPI tiles and four counters
above the fold — thirteen boxes, no sentence, no ranking. *Connected management
stories*, *Module health* and the *Management action queue* render inside
`<section class="all-metrics" hidden>`.

## 4. Foundations

### 4.1 Colour

One accent. `--brand: #53284F` carries brand and interaction both — links,
primary actions, current position, focus ring.

**Brand is never a state. State is never brand.** A reader who learns to read
the brand colour as a warning cannot unlearn it.

KITCO's real brand colour is unconfirmed. `--brand` is a single custom property
with Deep Plum as the documented fallback, so confirmation is a one-line change.
This satisfies baseline §0.4 (configuration-driven identity) without blocking.

```
/* Canvas */
--canvas:  #F7F5F8   --surface: #FFFFFF   --sunk: #EFEDF1

/* Ink */
--ink:   #1C121B     --muted: #605A60     --faint: #6E6670

/* Accent */
--brand: #53284F     --brand-hover: #3B1C39   --brand-tint: #F4ECF3

/* State — text tones, all >= 5.8:1 on canvas and surface */
--pass: #14664A      --warn: #8A5300      --fail: #B0242C      --info: #1F5FA8

/* State — fills and indicators only, never text */
--pass-fill: #2D8A56 --warn-fill: #E59400 --fail-fill: #D93838

/* Rules */
--rule: #E2E0E4              /* decorative separators */
--rule-control: #8A848C      /* control bounds, 3.65:1 */
```

`--faint` replaces `#98A2B3` at 5.53:1. `--rule` is decorative and exempt from
1.4.11; `--rule-control` bounds actual controls and meets 3:1.

### 4.2 Type

**One family: Archivo** (variable, Google Fonts). A grotesque with a squared
industrial cut — it reads as infrastructure rather than as a startup.

Explicitly not Inter: it is the house typeface of every AI-generated dashboard
and would undo the brief on its own.

**The mono family is deleted.** `Cascadia Mono` exists in v5 only to align
figures. `font-variant-numeric: tabular-nums` does that within Archivo, removing
a font download and a maintenance surface.

```
--fs-label: 11.5px   /* uppercase, tracked, labels only — never prose */
--fs-small: 12.5px   /* floor for anything readable */
--fs-base:  13.5px
--fs-lead:  15px
--fs-fig:   20px
--fs-fig-l: 28px
--fs-title: 38px
```

`11.5px` is permitted only for uppercase tracked labels. Any running text at or
below `12.5px` is a defect.

### 4.3 Density registers

Two registers over one token set, selected by one attribute on the view root.

| | `data-register="exec"` | `data-register="work"` |
|---|---|---|
| Views | Command Centre, Business Performance | TaskFlow, Organisation, all tables |
| Base | 15px | 13.5px |
| Figures | 28–38px | 20px |
| Row height | — | 36px |
| Rhythm | 24–32px | 12–16px |

No component is duplicated across registers. The attribute overrides three
tokens; components inherit.

**Overlays always use the work register.** A drawer or modal is where a record
gets read and edited, regardless of which view opened it. A drill-down launched
from the Command Centre renders at working density, not executive density.

### 4.4 Motion

Near-zero. One exception: completing a task must leave a visible trace — the row
settles and the group count decrements, so the user sees the system received the
action. Everything else is instant. The existing `prefers-reduced-motion` block
is retained.

## 5. Component system

Twelve card-shaped components collapse to three primitives.

**Line** — the chase row. Amount, owner, age, status. Serves attention rows,
management stories, task rows, my-work items, accounting list, execution items.

**Figure** — a number with a label and its provenance. Serves all four current
KPI variants, `metric-mini`, and accounting metrics.

**Panel** — a titled container with an optional action.

**Status vocabulary** reduces from ~20 pill variants to five values plus one age
indicator:

| Value | Tone | Meaning |
|---|---|---|
| Open | neutral | not started |
| Active | `--info` | in progress |
| Waiting | `--warn` | blocked on someone else / approval |
| Breached | `--fail` | overdue or escalated |
| Closed | `--pass` | verified complete |

`Active` takes `--info`, not `--brand`. Brand marks the user's current position
in the interface; it cannot simultaneously mean "this task is in progress"
without violating §4.1.

Age renders as elapsed days, coloured only on breach. Priority keeps a separate
flag glyph so priority and status are never confused for one another.

## 6. Information architecture

### 6.1 Navigation

- **Add Organisation to the sidebar.** `data-view="departments"` and
  `renderHierarchyDepartments()` both exist; no nav entry targets them.
- **Move `Add record` and `Import & export` out of the nav** into the top bar.
  Actions are not navigation.

### 6.2 Command Centre

Default state, in order:

1. **A computed sentence.** "Seven items need you. ₹32.79L exposed. Two have
   been open longer than a week." Derived from state, never written. When
   nothing is breached it states that plainly — "Nothing needs you. Fourteen
   items are on track." — rather than hiding, so the absence of exceptions is
   itself reported and the owner can trust the silence.
2. **The ranked decision list** — result → cause → owner → action → decision.
   Unhidden. This is the page.
3. **Execution counters** as one rule-separated strip, not four bordered buttons.
4. **Figures**, below the decisions.
5. **Module health: removed.** Nine values with no owner and no age.
6. **As-of computed from the data**, and marked when stale.

### 6.3 TaskFlow — ClickUp as the reference model

TaskFlow adopts ClickUp's interaction model. Most of it is already written and
unplugged (§7), so this is predominantly wiring and restyling.

**Layout.** Three columns inside the module: hierarchy rail (268px) → view
content → task detail slide-over. The `.taskflow-workspace` grid already exists
in CSS, including its two responsive breakpoints.

**Hierarchy rail.** Departments → Teams → Workflows, mapping to ClickUp's
Spaces → Folders → Lists. Expand chevrons, per-node overdue and approval counts,
reset control. Selecting a node scopes every view. `renderHierarchyRail()`,
`selectHierarchy()`, `hierarchyCounts()` and `taskMatchesHierarchy()` are all
written; `taskMatchesHierarchy()` must be joined into `filteredTaskFlowTasks()`,
which currently ignores hierarchy selection.

**View tabs**, scoped to the selected node: List · Board · Calendar · People.

**Toolbar**, ClickUp order: Search · Filter · Group by · Sort · Assignee · Me
mode · Columns. Saved views remain as pinned chips.

**List view** — `renderTaskList()`, the 8-column version, wired to the List tab:

```
[✓] Task title          Assignee  Status   Priority  Due      Impact
```

- Collapsible group headers with a status colour bar, count, and inline
  `+ New task`.
- 36px rows. Hover reveals row actions.
- Click any cell to edit in place. `.inline-editor` already exists.
- Title click opens the detail slide-over — the existing `.drawer`.

**Board view.** Columns by status, with **native HTML5 drag-and-drop** to change
status. This is the single most recognisably-ClickUp interaction and native DnD
keeps it to roughly thirty lines; no library.

**Keyboard.** `/` search · `c` create · `j`/`k` move · `e` edit · `Esc` close.

**Deliberately excluded from v1:** Gantt, time tracking, comments and mentions,
dependencies, a custom-field builder, automations, and multi-select with a bulk
action bar. Multi-select is the most likely first addition — add it when a user
asks to change five rows at once, not before.

## 7. Dead code to reactivate

Four features are written, tested by their own CSS, and unreachable. Reconnecting
them is the cheapest functionality in the project.

| Function | Line | Status |
|---|---:|---|
| `renderHierarchyRail()` | 1135 | never called; `.taskflow-workspace` never emitted |
| `renderTaskList()` | 1213 | List tab falls through to `renderWorkflowTaskList()` |
| `renderHierarchyDepartments()` | 1305 | reachable only by direct state edit — no nav entry |
| `renderOverview()` | 1029 | superseded by `renderCommandCentre()` — **delete** |

`renderOverview()` is genuinely obsolete and should be removed. The other three
are wired up.

## 8. Accessibility and verification

- Every foreground/background pair asserted in `tests/contrast.mjs`. A colour
  may not enter `tokens.css` without its pair entering the test.
- Tokens live in real CSS custom properties on `:root`, readable from the live
  document — not in a JS template string, which is how a contrast check produces
  a false pass.
- State is never carried by colour alone: each status carries a word, and
  breached items carry an age.
- Focus ring is `--brand` at 3px with 2px offset, on every interactive element.
- Existing `prefers-reduced-motion` and print stylesheets are retained.

## 9. Build approach

**Restyle in place. Stay single-file.**

The redesign is ~340 lines of CSS plus roughly six render functions. A Vite split
is a week of scaffolding that buys nothing while the artifact still fits in one
file and demos by double-click. Introduce a project when it stops fitting.

**No build step.** Tokens live as `:root` custom properties inside the existing
`<style>` block in `index.html`. `tests/contrast.mjs` parses that block directly,
so the values it asserts are the values that ship — there is no second copy to
drift. A separate `tokens.css` would require a build to inline, which is the
thing being avoided.

Files:

```
C:\KITCO\
  index.html          the application, tokens included
  tests/contrast.mjs  parses :root from index.html, asserts every fg/bg pair
  DESIGN.md           the doctrine, so the next change can be argued against it
```

**Order of work.** Each phase leaves the file working.

1. Tokens, type scale, registers — colour and type only, no markup changes.
2. Component reduction — three primitives, five status values.
3. Reactivate dead code (§7) and fix navigation.
4. TaskFlow ClickUp model (§6.3).
5. Command Centre inversion (§6.2), computed as-of, remove hard-coded figures.

## 10. Out of scope

Business logic, calculations, the seed dataset, WizApp integration, and the
Excel/CSV import-export round-trip are unchanged.

## 11. Open items

Carried from the project log; none block this work.

- **KITCO's real brand colour** — unconfirmed. `--brand` falls back to Deep Plum
  until supplied. One-line swap.
- **Real legal entity names** for the four placeholder group firms.
- **Baseline v3.0 state-colour contrast defect** (§3.1) — should be raised
  against the standard itself, as it affects every project governed by it.
- **`"6.8% positive movement"`** and any other hard-coded figures must be
  computed before client-facing use.
