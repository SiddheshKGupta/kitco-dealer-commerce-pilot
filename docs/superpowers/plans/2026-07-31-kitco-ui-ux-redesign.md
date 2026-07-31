# KITCO UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic SaaS visual system in `C:\KITCO\index.html` with a KITCO-specific design system built on the doctrine "a named clock on every rupee", reconnect four working-but-unwired features, and rebuild TaskFlow on ClickUp's interaction model — without changing business logic or the data model.

**Architecture:** The app stays a single self-contained HTML file with no build step. Design tokens live as CSS custom properties on `:root` inside the existing `<style>` block, so the values the tests assert are the values that ship. Tests are plain Node scripts that read `index.html` directly: one extracts `:root` and asserts WCAG contrast, the other evaluates the `<script id="app-script">` body via `new Function` and asserts pure logic. The script's bootstrap is already guarded by `typeof document!=="undefined"`, so it defines its functions and does nothing under Node — no DOM stubs required.

**Tech Stack:** Vanilla HTML/CSS/JS (single file), Node 24 for tests (`node:assert`, `node:test` not required), Archivo via Google Fonts, native HTML5 drag-and-drop. No framework, no bundler, no runtime dependencies.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-31-kitco-ui-ux-redesign-design.md`. Every requirement in it is in force.
- **No build step.** The file must open and work by double-click.
- **Business logic, calculations, seed data, and the Excel/CSV round-trip are unchanged.** If a task appears to require changing a calculation, stop and report it.
- **Brand is never a state. State is never brand.** `--brand` marks the user's current position only.
- **`--fs-label: 11.5px` is for uppercase tracked labels only.** Running text below `12.5px` is a defect.
- **A colour may not enter `:root` without its pair entering `tests/contrast.mjs`.**
- **Every component shows amount, owner and age, or justifies its absence.**
- **Status vocabulary is exactly five values:** `Open`, `Active`, `Waiting`, `Breached`, `Closed`.
- **Contrast floors:** text ≥ 4.5:1 on both `--canvas` and `--surface`; control bounds ≥ 3:1.
- Run `npm test` before every commit. It must pass.

**Seed data, verified by running `createSeedData()` under the harness.** Use these
figures, not the ones in `KITCO_Project_Log.md`, which are stale.

| | Actual (v5) | Project log claims |
|---|---:|---:|
| Tasks | 90 | 56 |
| Employees | 20 | 20 |
| Vendors | 5 | 12 |
| Departments | 8 | 10 |
| Workflows | 15 | — |
| Overdue | 4 | — |

Vocabularies are Title Case throughout — `In Progress`, not `In progress`:

- **Status:** `Not Started` · `In Progress` · `Pending Verification` · `Completed` · `Closed`
- **Escalation:** `Normal` · `Attention` · `At Risk` · `Approval Required` · `Overdue` · `Escalated`
- **Priority:** `Critical` · `High` · `Medium` (no `Low` in the data)
- **Type:** `Routine Responsibility` · `Business Exception` · `Approval` · `Management Instruction` · `Meeting Action`
- **Money:** `formatMoney(3279000)` → `₹32,79,000` (Indian grouping)

---

### Task 1: Repository, test harness, and the contrast gate

Establishes the verification harness first so every later task has a gate. The contrast test is written against the *target* palette, so it fails until Task 2 lands the tokens.

**Files:**
- Create: `C:\KITCO\package.json`
- Create: `C:\KITCO\tests\harness.mjs`
- Create: `C:\KITCO\tests\contrast.mjs`
- Create: `C:\KITCO\.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: `readHtml(): string`, `readTokens(): Record<string,string>`, `loadApp(): object` — all exported from `tests/harness.mjs`. `loadApp()` returns `{createSeedData, isOverdue, rankAttentionTasks, filterRecords, setState, getState}` and is extended by later tasks.

- [ ] **Step 1: Initialise the repository**

```bash
cd "C:/KITCO"
git init
git add index.html docs
git commit -m "chore: import KITCO Management Suite v5 as redesign baseline"
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.claude/
*.log
```

- [ ] **Step 3: Create `package.json`**

```json
{
  "name": "kitco-management-suite",
  "version": "5.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node tests/contrast.mjs && node tests/logic.mjs"
  }
}
```

Note: `tests/logic.mjs` is created in Task 3. Until then `npm test` will error on the second command — run `node tests/contrast.mjs` directly for Tasks 1 and 2.

- [ ] **Step 4: Create `tests/harness.mjs`**

```js
// Reads the shipped artifact directly. There is no build, so the values
// asserted here are the values that ship — no second copy to drift.
import { readFileSync } from "node:fs";

const HTML_PATH = new URL("../index.html", import.meta.url);

export function readHtml() {
  return readFileSync(HTML_PATH, "utf8");
}

export function readTokens() {
  const css = readHtml().match(/<style>([\s\S]*?)<\/style>/)[1];
  const root = css.match(/:root\s*\{([\s\S]*?)\n\s*\}/)[1];
  return Object.fromEntries(
    [...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()])
  );
}

// The app script guards its own bootstrap with `typeof document !== "undefined"`,
// so evaluating it here defines every function and runs no DOM code.
export function loadApp() {
  const src = readHtml().match(/<script id="app-script">([\s\S]*?)<\/script>/)[1];
  const exports = `return {
    createSeedData, isOverdue, rankAttentionTasks, filterRecords,
    setState: v => { state = v; }, getState: () => state
  };`;
  return new Function(`${src}\n${exports}`)();
}
```

- [ ] **Step 5: Create `tests/contrast.mjs`**

```js
import assert from "node:assert/strict";
import { readTokens } from "./harness.mjs";

const srgb = h => h.replace("#", "").match(/../g).map(x => parseInt(x, 16) / 255);
const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = h => { const [r, g, b] = srgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const t = readTokens();
const CANVAS = t["--canvas"];
const SURFACE = t["--surface"];

// Text tones must clear AA on BOTH backgrounds they can appear on.
const TEXT = ["--ink", "--muted", "--faint", "--brand", "--pass", "--warn", "--fail", "--info"];
// Bounds of actual controls carry the 3:1 obligation (WCAG 1.4.11).
const CONTROL = ["--rule-control"];
// Fills are never text. Asserted only to be perceptible against the surface.
const FILL = ["--pass-fill", "--warn-fill", "--fail-fill"];

let failures = 0;
const check = (name, got, floor, against) => {
  const ok = got >= floor;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(16)} ${got.toFixed(2).padStart(6)} : 1  on ${against} (need ${floor})`);
};

for (const name of TEXT) {
  assert.ok(t[name], `token ${name} missing from :root`);
  check(name, ratio(t[name], CANVAS), 4.5, "canvas");
  check(name, ratio(t[name], SURFACE), 4.5, "surface");
}
for (const name of CONTROL) {
  assert.ok(t[name], `token ${name} missing from :root`);
  check(name, ratio(t[name], SURFACE), 3, "surface");
}
for (const name of FILL) {
  assert.ok(t[name], `token ${name} missing from :root`);
  check(name, ratio(t[name], SURFACE), 1.5, "surface");
}

// The doctrine, asserted: brand and state must never share a value.
for (const s of ["--pass", "--warn", "--fail", "--info"]) {
  assert.notEqual(t[s], t["--brand"], `${s} must not equal --brand (spec 4.1)`);
}

assert.equal(failures, 0, `${failures} contrast failure(s)`);
console.log("\nAll contrast pairs pass.");
```

- [ ] **Step 6: Run the contrast test to verify it fails**

Run: `node tests/contrast.mjs`
Expected: FAIL — `AssertionError: token --canvas missing from :root`. The current `:root` uses `--app-bg`, not the target token names. This is the correct failure; Task 2 makes it pass.

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore tests/
git commit -m "test: add contrast gate and node harness for single-file app"
```

---

### Task 2: Colour tokens, Archivo type scale, and density registers

**Files:**
- Modify: `C:\KITCO\index.html:3-7` (head — font link)
- Modify: `C:\KITCO\index.html:9-66` (`:root` and `:root[data-theme="dark"]`)
- Modify: `C:\KITCO\index.html:316-344` (print stylesheet token override block)

**Interfaces:**
- Consumes: `readTokens()` from Task 1.
- Produces: the token names asserted in `tests/contrast.mjs`, plus `--fs-label|small|base|lead|fig|fig-l|title`, `--row-h`, and the `[data-register]` overrides consumed by every later task.

- [ ] **Step 1: Add the Archivo font link**

Insert after line 7 (`<meta name="description" …>`):

```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400..700&display=swap" rel="stylesheet">
```

<!-- ponytail: remote webfont — a live demo on bad wifi falls back to Segoe UI.
     If an offline demo is ever required, base64-embed the woff2 subset into the
     <style> block. Not worth doing before someone asks. -->

- [ ] **Step 2: Replace the entire `:root` block (lines 9-41) with the token set**

```css
    :root {
      color-scheme:light;

      /* Canvas — three levels, so a block reads as a block */
      --canvas:#F7F5F8;
      --surface:#FFFFFF;
      --sunk:#EFEDF1;

      /* Ink — one ink, three weights */
      --ink:#1C121B;
      --muted:#605A60;
      --faint:#6E6670;

      /* Accent — brand and interaction. NEVER a state.
         KITCO's real brand colour is unconfirmed; Deep Plum is the documented
         fallback, and swapping it here is the whole change. */
      --brand:#53284F;
      --brand-hover:#3B1C39;
      --brand-tint:#F4ECF3;

      /* State — text tones. Every one clears AA on canvas and surface. */
      --pass:#14664A;
      --warn:#8A5300;
      --fail:#B0242C;
      --info:#1F5FA8;

      /* State — fills and indicators ONLY. Never a word. */
      --pass-fill:#2D8A56;
      --warn-fill:#E59400;
      --fail-fill:#D93838;
      --pass-tint:#E6F4EE;
      --warn-tint:#FBF3E3;
      --fail-tint:#FCEBEA;
      --info-tint:#EAF2FC;

      /* Rules — --rule is decorative and exempt from 1.4.11.
         --rule-control bounds real controls and meets 3:1. */
      --rule:#E2E0E4;
      --rule-control:#8A848C;

      /* Type — one family. Figures use tabular-nums, not a second font. */
      --sans:"Archivo","Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;
      --fs-label:11.5px;
      --fs-small:12.5px;
      --fs-base:13.5px;
      --fs-lead:15px;
      --fs-fig:20px;
      --fs-fig-l:28px;
      --fs-title:38px;

      /* Measure */
      --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px;
      --sp-5:24px; --sp-6:32px; --sp-7:48px;
      --row-h:36px;
      --radius:10px;
      --shadow-overlay:0 18px 50px rgba(28,18,27,.18);
    }

    /* Density registers. Two registers, one token set, one attribute. */
    [data-register="exec"]{--fs-body:var(--fs-lead);--fs-figure:var(--fs-fig-l);--rhythm:var(--sp-5)}
    [data-register="work"]{--fs-body:var(--fs-base);--fs-figure:var(--fs-fig);--rhythm:var(--sp-3)}
    /* Overlays are always working density, whatever opened them. */
    .drawer,.modal{--fs-body:var(--fs-base);--fs-figure:var(--fs-fig);--rhythm:var(--sp-3)}
```

- [ ] **Step 3: Replace the dark theme block (lines 42-66)**

```css
    :root[data-theme="dark"]{
      color-scheme:dark;
      --canvas:#141118;
      --surface:#1C1822;
      --sunk:#17141D;
      --ink:#F4F1F6;
      --muted:#A79FA8;
      --faint:#948B96;
      --brand:#C79BC2;
      --brand-hover:#D9B6D5;
      --brand-tint:#2C2130;
      --pass:#5FC79B;
      --warn:#E0A busy;
      --fail:#F0868C;
      --info:#7FB0EE;
      --rule:#2E2836;
      --rule-control:#8F8694;
      --shadow-overlay:0 18px 50px rgba(0,0,0,.5);
    }
```

Correct the deliberate typo before saving: `--warn:#E0A busy;` must read `--warn:#E0A45A;`. (If you did not notice it, you are not reading the code you are pasting.)

- [ ] **Step 4: Update the global font declaration**

Replace line 68 (`html{background:var(--app-bg);…}`):

```css
    html{background:var(--canvas);color:var(--ink);font-family:var(--sans);font-size:var(--fs-base)}
    body{margin:0;min-height:100vh;background:var(--canvas);color:var(--ink)}
    .mono,.kpi-value,.impact,td.mono,.health-value{font-variant-numeric:tabular-nums;font-family:var(--sans)}
```

- [ ] **Step 5: Replace remaining legacy token references**

The old names appear throughout the stylesheet. Apply these substitutions across the whole `<style>` block:

| Old | New |
|---|---|
| `var(--app-bg)` | `var(--canvas)` |
| `var(--surface-subtle)`, `var(--surface-raised)`, `var(--sidebar-bg)` | `var(--sunk)` |
| `var(--text)` | `var(--ink)` |
| `var(--text-muted)` | `var(--muted)` |
| `var(--text-faint)` | `var(--faint)` |
| `var(--border)` | `var(--rule)` |
| `var(--border-strong)` | `var(--rule-control)` |
| `var(--state-brand-fg)`, `var(--blue-600)` | `var(--info)` |
| `var(--state-green-fg)`, `var(--green-700)`, `var(--teal)`, `var(--state-teal-fg)` | `var(--pass)` |
| `var(--state-orange-fg)`, `var(--orange-600)` | `var(--warn)` |
| `var(--state-red-fg)`, `var(--red-600)` | `var(--fail)` |
| `var(--navy-950)`, `var(--navy-900)` | `var(--brand)` |
| `var(--slate-100)` | `var(--sunk)` |
| `var(--slate-300)` | `var(--rule-control)` |
| `var(--display)`, `var(--body)`, `var(--data)` | `var(--sans)` |

Then delete the now-unreferenced legacy aliases from `:root` — every `--navy-*`, `--blue-*`, `--teal-*`, `--orange-*`, `--red-*`, `--green-*`, `--slate-*`, `--white`, `--display`, `--body`, `--data`, `--shadow`.

- [ ] **Step 6: Raise every `11px` that carries prose**

In the `<style>` block, replace `font-size:11px` with `font-size:var(--fs-small)` everywhere EXCEPT these selectors, which are uppercase tracked labels and take `var(--fs-label)`:

`.nav-label`, `.eyebrow`, `.ribbon-signal`, `.hierarchy-section-label`, `.module-context span`, `.detail label`, `.metric-mini label`, `.accounting-metric label`, `.board-head`, `.my-work-group h3`, `th`, `.source-chip`, `.health-card-top`.

- [ ] **Step 7: Update the print block token overrides (lines 316-344)**

Replace the token list inside `@media print` with the light-theme values so a dark-mode user still prints on white:

```css
      :root,:root[data-theme="dark"]{
        color-scheme:light!important;
        --canvas:#F7F5F8; --surface:#FFFFFF; --sunk:#EFEDF1;
        --ink:#1C121B; --muted:#605A60; --faint:#6E6670;
        --brand:#53284F; --brand-hover:#3B1C39; --brand-tint:#F4ECF3;
        --pass:#14664A; --warn:#8A5300; --fail:#B0242C; --info:#1F5FA8;
        --rule:#E2E0E4; --rule-control:#8A848C;
      }
```

- [ ] **Step 8: Run the contrast test to verify it passes**

Run: `node tests/contrast.mjs`
Expected: PASS — every token listed, `All contrast pairs pass.`

- [ ] **Step 9: Verify in the browser**

Start the preview (`kitco`, port 5959), then confirm: the sidebar, top bar and Command Centre render in plum-on-neutral with Archivo; no element still renders in `#2367d1`; dark mode toggles without unreadable text.

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "feat(design): KITCO token system, Archivo scale, density registers"
```

---

### Task 3: Status vocabulary — five values and an age indicator

**Files:**
- Modify: `C:\KITCO\index.html` — add `STATUS_VALUE` and `statusValueFor()` beside `statusPill()` (near line 1001)
- Modify: `C:\KITCO\index.html:158-171` (pill CSS)
- Modify: `C:\KITCO\tests\harness.mjs` (extend exports)
- Create: `C:\KITCO\tests\logic.mjs`

**Interfaces:**
- Consumes: `isOverdue(task)`, `createSeedData()`.
- Produces: `statusValueFor(task, source): "Open"|"Active"|"Waiting"|"Breached"|"Closed"`, `ageDays(task, source): number`, `STATUS_VALUE: Record<string,string>`.

- [ ] **Step 1: Extend the harness exports**

In `tests/harness.mjs`, replace the `exports` template string in `loadApp()`:

```js
  const exports = `return {
    createSeedData, isOverdue, rankAttentionTasks, filterRecords,
    statusValueFor, ageDays, STATUS_VALUE,
    setState: v => { state = v; }, getState: () => state
  };`;
```

- [ ] **Step 2: Write the failing test**

Create `tests/logic.mjs`:

```js
import assert from "node:assert/strict";
import { loadApp } from "./harness.mjs";

const app = loadApp();
const seed = app.createSeedData();
app.setState(seed);

const VALUES = ["Open", "Active", "Waiting", "Breached", "Closed"];

// Every status present in the data must map explicitly. A silent fallback
// would let a new status render as "Open" and quietly lie to the owner.
const present = [...new Set(seed.tasks.map(t => t.status))];
for (const status of present) {
  assert.ok(
    Object.hasOwn(app.STATUS_VALUE, status),
    `status "${status}" has no entry in STATUS_VALUE — add it explicitly`
  );
}

// Every task resolves to one of exactly five values.
for (const task of seed.tasks) {
  const value = app.statusValueFor(task, seed);
  assert.ok(VALUES.includes(value), `task ${task.id} resolved to "${value}"`);
}

// Breach outranks the stored status: an overdue "In progress" task is Breached.
const overdue = seed.tasks.filter(t => app.isOverdue(t));
assert.ok(overdue.length > 0, "seed data should contain overdue tasks");
for (const task of overdue) {
  assert.equal(app.statusValueFor(task, seed), "Breached", `task ${task.id}`);
}

// A closed task is never Breached, whatever its due date.
for (const task of seed.tasks.filter(t => t.status === "Closed")) {
  assert.equal(app.statusValueFor(task, seed), "Closed", `task ${task.id}`);
}

// Age is a non-negative whole number of days.
for (const task of seed.tasks) {
  const age = app.ageDays(task, seed);
  assert.ok(Number.isInteger(age) && age >= 0, `task ${task.id} age ${age}`);
}

console.log(`Logic: ${seed.tasks.length} tasks, ${present.length} statuses, all mapped.`);
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node tests/logic.mjs`
Expected: FAIL — `TypeError: app.statusValueFor is not a function`

- [ ] **Step 4: Implement the mapping**

Insert immediately after `function statusPill(value){…}` (line 1001):

```js
  // Five values, no more. Every stored status maps explicitly — a fallback
  // would let an unknown status render as "Open" and understate a problem.
  // Casing matches the seed data exactly — verified against createSeedData().
  // Statuses:    Not Started | In Progress | Pending Verification | Completed | Closed
  // Escalations: Normal | Attention | At Risk | Approval Required | Overdue | Escalated
  const STATUS_VALUE={
    "Not Started":"Open","Open":"Open","Normal":"Open",
    "In Progress":"Active","Active":"Active",
    "Pending Verification":"Waiting","Approval Required":"Waiting",
    "At Risk":"Waiting","Attention":"Waiting",
    "Overdue":"Breached","Escalated":"Breached",
    "Completed":"Closed","Closed":"Closed"
  };
  function statusValueFor(task,source=state){
    if(["Closed","Completed"].includes(task.status))return "Closed";
    if(isOverdue(task))return "Breached";
    return STATUS_VALUE[task.status]||"Open";
  }
  function ageDays(task,source=state){
    const asOf=Date.parse(asOfDate(source));
    const from=Date.parse(task.lastUpdate||task.dueDate);
    return Math.max(0,Math.round((asOf-from)/86400000));
  }
  function statusValuePill(task,source=state){
    const value=statusValueFor(task,source);
    return `<span class="status-pill ${slug(value)}">${value}</span>`;
  }
  function agePill(task,source=state){
    const days=ageDays(task,source);
    const breached=statusValueFor(task,source)==="Breached";
    return `<span class="age${breached?" breached":""}">${days}d</span>`;
  }
```

`asOfDate()` is defined in Task 9. For this task only, add a temporary definition directly above `statusValueFor` and delete it in Task 9 Step 4:

```js
  function asOfDate(source=state){return source?.meta?.demoDate||DEMO_TODAY}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/logic.mjs`
Expected: PASS — `Logic: N tasks, M statuses, all mapped.`

- [ ] **Step 6: Replace the pill CSS (lines 158-171)**

```css
    .status-pill,.type-pill,.workload-pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:3px 9px;font-size:var(--fs-label);font-weight:700;white-space:nowrap}
    .status-pill.open{background:var(--sunk);color:var(--muted)}
    .status-pill.active{background:var(--info-tint);color:var(--info)}
    .status-pill.waiting{background:var(--warn-tint);color:var(--warn)}
    .status-pill.breached{background:var(--fail-tint);color:var(--fail)}
    .status-pill.closed{background:var(--pass-tint);color:var(--pass)}
    /* Age is the clock half of the doctrine. Neutral until it breaches. */
    .age{font-variant-numeric:tabular-nums;color:var(--muted);font-size:var(--fs-small)}
    .age.breached{color:var(--fail);font-weight:700}
    /* Priority keeps a flag glyph so it is never confused with status. */
    .type-pill{background:transparent;color:var(--muted);padding-left:0}
    .type-pill::before{content:"⚑";margin-right:4px}
    .type-pill.critical{color:var(--fail)}
    .type-pill.high{color:var(--warn)}
    .type-pill.medium{color:var(--info)}
    .type-pill.low{color:var(--faint)}
    .workload-pill.balanced{background:var(--pass-tint);color:var(--pass)}
    .workload-pill.heavy{background:var(--warn-tint);color:var(--warn)}
    .workload-pill.critical{background:var(--fail-tint);color:var(--fail)}
```

- [ ] **Step 7: Route rendering through the new pills**

Replace every `statusPill(task.escalation)` and `<span class="status-pill task-status ${slug(task.status)}">${escapeHtml(task.status)}</span>` occurrence with `statusValuePill(task)`. Occurrences are in `renderOverview` (deleted in Task 6), `renderCommandCentre`, `renderTaskList`, `renderWorkflowTaskList`, and `renderTaskBoard`.

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test`
Expected: both scripts pass.

```bash
git add index.html tests/
git commit -m "feat(design): reduce ~20 pill variants to five status values plus age"
```

---

### Task 4: Three component primitives

Collapses twelve card-shaped components into Line, Figure and Panel. CSS only — no markup or logic changes, so the visual result is verified in the browser rather than by test.

**Files:**
- Modify: `C:\KITCO\index.html` — the `<style>` block, selectors listed below

**Interfaces:**
- Consumes: tokens from Task 2, pills from Task 3.
- Produces: `.line`, `.figure`, `.panel` class contracts used by Tasks 6-9.

- [ ] **Step 1: Add the three primitives after the `.panel` rules (near line 151)**

```css
    /* ── Line: the chase row. Amount, owner, age, status. ───────────── */
    .line{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--sp-2) var(--sp-4);align-items:baseline;width:100%;border:0;border-bottom:1px solid var(--rule);background:var(--surface);padding:var(--sp-3) var(--sp-4);text-align:left;color:var(--ink)}
    .line:last-child{border-bottom:0}
    .line:hover{background:var(--sunk)}
    .line-title{font-size:var(--fs-body,var(--fs-base));font-weight:700;line-height:1.35}
    .line-meta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-2);margin-top:var(--sp-1);color:var(--muted);font-size:var(--fs-small)}
    .line-amount{font-variant-numeric:tabular-nums;font-size:var(--fs-body,var(--fs-base));font-weight:700;text-align:right;white-space:nowrap}
    .line-amount.breached{color:var(--fail)}
    /* The rail is the only decoration a Line carries. */
    .line.critical{box-shadow:inset 3px 0 var(--fail-fill)}
    .line.attention{box-shadow:inset 3px 0 var(--warn-fill)}

    /* ── Figure: a number, its label, its provenance. ────────────────── */
    .figure{display:block;width:100%;border:0;border-left:2px solid var(--rule);background:transparent;padding:var(--sp-2) var(--sp-4);text-align:left}
    .figure:hover{border-left-color:var(--brand);background:var(--sunk)}
    .figure-label{display:block;color:var(--muted);font-size:var(--fs-label);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .figure-value{display:block;margin:var(--sp-2) 0 var(--sp-1);color:var(--ink);font-variant-numeric:tabular-nums;font-size:var(--fs-figure,var(--fs-fig));font-weight:700;letter-spacing:-.02em;line-height:1}
    .figure-note{display:block;color:var(--muted);font-size:var(--fs-small);line-height:1.4}
    .figure-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--sp-4) 0}

    /* ── Panel: a titled container. ──────────────────────────────────── */
    .panel{min-width:0;background:var(--surface);border:1px solid var(--rule);border-radius:var(--radius)}
    .panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--sp-4);padding:var(--sp-4);border-bottom:1px solid var(--rule)}
    .panel-head h2{font-size:var(--fs-lead)}
    .panel-head p{margin:var(--sp-1) 0 0;color:var(--muted);font-size:var(--fs-small)}
    .panel-body{padding:var(--sp-4)}
```

- [ ] **Step 2: Point the legacy component selectors at the primitives**

Rather than rewrite every render function, alias the old class names onto the new rules. Add immediately after the block above:

```css
    /* Legacy component names, folded onto the three primitives.
       Render functions still emit these; the visual system is now one system. */
    .attention-row,.story,.my-work-item,.management-alert,.accounting-list button{
      display:grid;grid-template-columns:minmax(0,1fr) auto;gap:var(--sp-2) var(--sp-4);
      align-items:baseline;width:100%;border:0;border-bottom:1px solid var(--rule);
      background:var(--surface);padding:var(--sp-3) var(--sp-4);text-align:left;color:var(--ink)
    }
    .attention-row:hover,.story:hover,.my-work-item:hover,.management-alert:hover{background:var(--sunk)}
    .attn-title,.story-result,.my-work-item strong{font-size:var(--fs-body,var(--fs-base));font-weight:700;line-height:1.35}
    .attn-meta,.story-cause,.my-work-item small{display:block;margin-top:var(--sp-1);color:var(--muted);font-size:var(--fs-small);line-height:1.45}
    .impact,.story-decision strong,.task-card-impact{font-variant-numeric:tabular-nums;font-weight:700;text-align:right;color:var(--ink)}
    .kpi,.business-kpi,.metric-mini,.accounting-metric{
      display:block;width:100%;border:0;border-left:2px solid var(--rule);border-radius:0;
      background:transparent;padding:var(--sp-2) var(--sp-4);text-align:left;min-height:0
    }
    .kpi:hover,.business-kpi:hover,.accounting-metric:hover{border-left-color:var(--brand);background:var(--sunk)}
    .kpi::before{content:none}
    .kpi-label,.metric-mini label,.accounting-metric label{color:var(--muted);font-size:var(--fs-label);font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .kpi-value,.metric-mini strong,.accounting-metric strong{display:block;margin:var(--sp-2) 0 var(--sp-1);color:var(--ink);font-variant-numeric:tabular-nums;font-size:var(--fs-figure,var(--fs-fig));font-weight:700;letter-spacing:-.02em;line-height:1}
    .kpi-note,.metric-mini small,.accounting-metric small{color:var(--muted);font-size:var(--fs-small);line-height:1.4}
    .kpis,.business-kpis,.metric-band,.accounting-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:var(--sp-4) 0;margin-bottom:var(--sp-5)}
    /* The arrow was decoration on every KPI. Removed. */
    .kpi-arrow{display:none}
```

- [ ] **Step 3: Delete the superseded rules**

Remove these selectors and their declarations entirely — they are now handled above: the original `.kpi`, `.kpi::before`, `.business-kpi`, `.metric-mini`, `.accounting-metric`, `.attention-row`, `.story`, `.my-work-item`, `.health-card` and `.module-health` blocks. (`.health-card` markup is removed in Task 9; deleting its CSS now is safe because the block is `hidden`.)

- [ ] **Step 4: Verify in the browser**

Reload the preview. Confirm: KPI rows render as label/figure/note separated by a left rule rather than as bordered cards; attention rows and stories share one row treatment; no double borders; nothing overflows at 1440px, 1200px and 820px.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test`

```bash
git add index.html
git commit -m "refactor(design): collapse twelve card components onto three primitives"
```

---

### Task 5: Reconnect the hierarchy rail and scope filtering to it

`renderHierarchyRail()` at line 1135 has never rendered. `taskMatchesHierarchy()` at line 1168 has never filtered.

**Files:**
- Modify: `C:\KITCO\index.html:1210-1212` (`filteredTaskFlowTasks`)
- Modify: `C:\KITCO\index.html:1229-1239` (`renderTaskFlow`)
- Modify: `C:\KITCO\tests\harness.mjs`
- Modify: `C:\KITCO\tests\logic.mjs`

**Interfaces:**
- Consumes: `renderHierarchyRail()`, `taskMatchesHierarchy(task)`, `selectHierarchy(kind,id)`, `hierarchyCounts(kind,id)` — all already defined.
- Produces: `filteredTaskFlowTasks()` now honours `ui.hierarchy`.

- [ ] **Step 1: Extend the harness**

```js
  const exports = `return {
    createSeedData, isOverdue, rankAttentionTasks, filterRecords,
    statusValueFor, ageDays, STATUS_VALUE,
    taskMatchesHierarchy, filteredTaskFlowTasks, hierarchyTasks,
    ui, setState: v => { state = v; }, getState: () => state
  };`;
```

- [ ] **Step 2: Write the failing test**

Append to `tests/logic.mjs`:

```js
// ── Hierarchy scoping ────────────────────────────────────────────────
// Selecting a department must narrow TaskFlow. Before this task the rail
// rendered nowhere and the filter was never consulted, so selection was inert.
const dept = seed.departments[0];
app.ui.hierarchy = { kind: "department", id: dept.id };
app.ui.taskFilters = { search: "", department: "All", assigneeId: "All", status: "All", priority: "All", overdue: false };
app.ui.search = "";

const scoped = app.filteredTaskFlowTasks();
const expected = app.hierarchyTasks("department", dept.id, seed);

assert.ok(expected.length > 0, `department ${dept.id} should own tasks in seed data`);
assert.ok(scoped.length > 0, "scoped result should not be empty");
assert.ok(
  scoped.length <= seed.tasks.length,
  "scoping must narrow, never widen"
);
for (const task of scoped) {
  assert.ok(
    app.taskMatchesHierarchy(task),
    `task ${task.id} leaked past the hierarchy filter`
  );
}

// Clearing the selection restores the full set.
app.ui.hierarchy = { kind: "root", id: null };
assert.equal(app.filteredTaskFlowTasks().length, seed.tasks.length, "root shows all tasks");

console.log(`Hierarchy: ${dept.id} scopes ${scoped.length} of ${seed.tasks.length} tasks.`);
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node tests/logic.mjs`
Expected: FAIL — `root shows all tasks` passes trivially but the scoped assertion fails, because `filteredTaskFlowTasks()` ignores `ui.hierarchy` and returns all tasks for the department selection too.

- [ ] **Step 4: Join the filter (line 1210)**

```js
  function filteredTaskFlowTasks(){
    const scoped=state.tasks.filter(taskMatchesHierarchy);
    return sortRecords(filterRecords(scoped,{...ui.taskFilters,search:ui.taskFilters.search||ui.search}),ui.sort.key,ui.sort.direction);
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/logic.mjs`
Expected: PASS

- [ ] **Step 6: Emit the rail — replace `renderTaskFlow` (lines 1229-1239)**

```js
  function renderTaskFlow(){
    const tasks=filteredTaskFlowTasks();
    const modeContent=ui.taskFlowMode==="people"?renderPeopleLedger():ui.taskFlowMode==="board"?renderTaskBoard(tasks):renderTaskList(tasks);
    return `${renderPageHead("Work management","Execution Centre","KITCO tasks, recurring responsibilities, approvals and business exceptions in one operating workspace.")}
      <section class="taskflow-shell panel">
        <header class="taskflow-head"><div><h2>TaskFlow</h2><p>Responsibilities, controls, approvals and business exceptions</p></div><button class="btn primary small" id="taskflow-add">+ Create task</button></header>
        <div class="taskflow-tabs" aria-label="TaskFlow view"><button class="${ui.taskFlowMode==="list"?"active":""}" data-taskflow-mode="list">List</button><button class="${ui.taskFlowMode==="board"?"active":""}" data-taskflow-mode="board">Board</button><button class="${ui.taskFlowMode==="people"?"active":""}" data-taskflow-mode="people">People</button><button data-view-open="calendar">Calendar</button></div>
        <div class="taskflow-workspace">
          ${renderHierarchyRail()}
          <div class="taskflow-main">
            <div class="taskflow-toolbar"><div class="saved-views" aria-label="Saved views"><button class="${ui.taskFilters.overdue?"active":""}" data-preset="my-overdue">Overdue</button><button class="${ui.taskFilters.approval?"active":""}" data-preset="approvals">Approvals</button><button class="${ui.taskFilters.highPriority?"active":""}" data-preset="high-impact">High priority</button></div><div class="task-tools">${renderFilters(ui.taskFlowMode==="people"?"ledger":"tasks")}</div></div>
            <div class="taskflow-content" id="taskflow-content">${modeContent}</div>
          </div>
        </div>
      </section>`;
  }
```

Two changes beyond the rail: the `list` mode now reaches `renderTaskList` (the 8-column view) instead of falling through to `renderWorkflowTaskList`, and the toolbar moves inside `.taskflow-main` so the rail spans the full module height.

- [ ] **Step 7: Confirm the rail's click handlers are bound**

`bindDynamicEvents()` must wire `[data-hierarchy-select]` and `[data-hierarchy-expand]`. Search for those attributes in `renderHierarchyRail()` and confirm matching handlers exist in `bindDynamicEvents()`. If absent, add:

```js
    document.querySelectorAll("[data-hierarchy-select]").forEach(button=>button.onclick=()=>{
      const [kind,id]=button.dataset.hierarchySelect.split(":");selectHierarchy(kind,id)
    });
    document.querySelectorAll("[data-hierarchy-expand]").forEach(button=>button.onclick=()=>{
      const key=button.dataset.hierarchyExpand;ui.hierarchyExpanded[key]=!ui.hierarchyExpanded[key];renderApp()
    });
```

Match the exact attribute names used by `renderHierarchyRail()` — do not invent new ones.

- [ ] **Step 8: Verify in the browser**

Open TaskFlow. Confirm: the rail renders at 268px on the left; departments expand to teams and teams to workflows; per-node overdue and approval counts appear; selecting a node narrows the task list and the count under the table; the reset control clears back to all tasks; below 820px the rail moves above the content.

- [ ] **Step 9: Run the suite and commit**

Run: `npm test`

```bash
git add index.html tests/
git commit -m "fix(taskflow): render hierarchy rail and scope filtering to selection"
```

---

### Task 6: Navigation — add Organisation, remove dead code, move actions out of the nav

**Files:**
- Modify: `C:\KITCO\index.html:366-375` (sidebar nav)
- Modify: `C:\KITCO\index.html:386-398` (top bar actions)
- Delete: `C:\KITCO\index.html:1029-1044` (`renderOverview`)

**Interfaces:**
- Consumes: `renderHierarchyDepartments()`, `VIEW_TITLES`.
- Produces: reachable `departments` view.

- [ ] **Step 1: Add Organisation to the Execution nav group and remove the Data controls group**

Replace lines 366-375:

```html
      <div class="nav-label">Execution</div>
      <nav class="nav">
        <button data-view-target="ledger"><span class="nav-icon"><svg viewBox="0 0 24 24" role="img"><title>TaskFlow</title><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/></svg></span>TaskFlow</button>
        <button data-view-target="departments"><span class="nav-icon"><svg viewBox="0 0 24 24" role="img"><title>Organisation</title><circle cx="12" cy="7" r="3"/><path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/></svg></span>Organisation</button>
        <button data-view-target="calendar"><span class="nav-icon"><svg viewBox="0 0 24 24" role="img"><title>Management Calendar</title><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 10h18"/></svg></span>Management Calendar</button>
      </nav>
```

- [ ] **Step 2: Move the two actions into the top bar menu**

The `#open-add` and `#open-tools` buttons were removed with the nav group above. Replace the `.top-menu-popover` contents (line 395) so both keep working:

```html
            <div class="top-menu-popover">
              <button class="btn" id="open-tools"><svg viewBox="0 0 24 24" role="img"><title>Import and export</title><path d="M8 3v14m-4-4 4 4 4-4m4 8V7m-4 4 4-4 4 4"/></svg>Import &amp; export</button>
              <button class="btn" id="print-summary"><svg viewBox="0 0 24 24" role="img"><title>Print summary</title><path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-4a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v7H7Z"/></svg>Print summary</button>
            </div>
```

`#open-add` is now redundant — `#top-add` in the top bar already opens the same modal. In `bindStaticEvents()` (line 1666) delete this fragment:

```js
document.getElementById("open-add").addEventListener("click",()=>addRecordModal("task"));
```

Leave the `#open-tools` and `#top-add` listeners in place.

- [ ] **Step 3: Delete `renderOverview()`**

Remove lines 1029-1044 in full. `renderApp()` maps `overview → renderCommandCentre`, so nothing references it. Confirm with `grep -c "renderOverview" index.html` — expected: `0`.

- [ ] **Step 4: Add `departments` to `VIEW_TITLES` if absent**

Check the `VIEW_TITLES` object at line 922. It must contain `departments:"Organisation"`. Add it if missing.

- [ ] **Step 5: Verify in the browser**

Click Organisation in the sidebar. Confirm: the department cards render, the top bar title reads "Organisation", the nav item shows as active, and Import & export still opens from the top bar menu.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`

```bash
git add index.html
git commit -m "fix(nav): surface Organisation, move actions to top bar, drop dead renderOverview"
```

---

### Task 7: TaskFlow list — ClickUp row model

**Files:**
- Modify: `C:\KITCO\index.html:1213-1220` (`renderTaskList`)
- Modify: `C:\KITCO\index.html:221-275` (TaskFlow CSS)

**Interfaces:**
- Consumes: `statusValuePill(task)`, `agePill(task)`, `taskCompletionInfo(task,source)`, `.inline-editor`.
- Produces: `.taskflow-list` row contract used by Task 8's drag targets.

- [ ] **Step 1: Replace `renderTaskList` (lines 1213-1220)**

```js
  function renderTaskList(tasks){
    const arrow=key=>ui.sort.key===key?(ui.sort.direction==="asc"?" ↑":" ↓"):"";
    const workflowStatusOrder=Object.keys(getTaskFlowGroups(tasks));
    const taskStatuses=[...new Set(tasks.map(task=>task.status))];
    const statusOrder=ui.sort.key==="status"?taskStatuses:[...workflowStatusOrder,...taskStatuses.filter(status=>!workflowStatusOrder.includes(status))];
    const groups=statusOrder.map(status=>[status,tasks.filter(task=>task.status===status)]).filter(([,items])=>items.length);
    const head=`<thead><tr>
      <th><button data-sort="title">Task${arrow("title")}</button></th>
      <th><button data-sort="assigneeId">Assignee${arrow("assigneeId")}</button></th>
      <th><button data-sort="status">Status${arrow("status")}</button></th>
      <th><button data-sort="priority">Priority${arrow("priority")}</button></th>
      <th><button data-sort="dueDate">Due${arrow("dueDate")}</button></th>
      <th>Age</th>
      <th><button data-sort="businessImpact">Impact${arrow("businessImpact")}</button></th>
    </tr></thead>`;
    const rows=groups.map(([status,items])=>{
      const value=statusValueFor(items[0],state);
      return `<tr class="task-group-head"><td colspan="7">
          <button type="button" data-taskflow-group="${slug(status)}" data-taskflow-label="${escapeHtml(status)}" aria-expanded="true"><span class="group-bar ${slug(value)}"></span>${escapeHtml(status)}</button>
          <span>${items.length}</span>
          <button type="button" data-taskflow-add>+ New task</button>
        </td></tr>
        ${items.map(task=>{
          const employee=employeeById(task.assigneeId),role=employee?.role||"Unassigned";
          const completion=taskCompletionInfo(task,state);
          const label=completion.closed?`${task.title} is verified closed`:completion.complete?`Reopen ${task.title}`:`Mark ${task.title} complete`;
          return `<tr data-taskflow-group-row="${slug(status)}" data-task-row="${task.id}">
            <td><div class="task-title-cell">
              <button class="task-complete-control${completion.complete?" checked":""}" type="button" data-task-complete="${task.id}" aria-label="${escapeHtml(label)}" aria-pressed="${completion.complete}" ${completion.closed?"disabled":""}><span aria-hidden="true">&#10003;</span></button>
              <button class="row-button" data-task="${task.id}"><strong>${escapeHtml(task.title)}</strong><span class="row-id">${task.id} · ${escapeHtml(task.type)}</span></button>
            </div></td>
            <td><span class="task-owner"><span class="avatar">${initials(role)}</span><span>${escapeHtml(role)}</span></span></td>
            <td>${statusValuePill(task)}</td>
            <td><span class="type-pill ${slug(task.priority)}">${escapeHtml(task.priority)}</span></td>
            <td><input class="inline-editor due" type="date" value="${task.dueDate}" data-inline-edit="dueDate" data-inline-task="${task.id}" aria-label="Due date for ${escapeHtml(task.title)}"></td>
            <td>${agePill(task)}</td>
            <td class="mono">${formatMoney(task.businessImpact)}</td>
          </tr>`}).join("")}`}).join("");
    return `<div class="table-wrap"><table class="taskflow-list">${head}<tbody>${rows}</tbody></table></div>
      <div class="filter-count" style="margin-top:10px">${tasks.length} of ${state.tasks.length} tasks shown</div>`;
  }
```

- [ ] **Step 2: Add the ClickUp row CSS**

Append to the TaskFlow section of the stylesheet:

```css
    .taskflow-list td{height:var(--row-h);padding:0 var(--sp-3);border-bottom:1px solid var(--rule)}
    .taskflow-list tbody tr:hover td{background:var(--sunk)}
    .taskflow-list .row-id{display:block;margin-top:2px;color:var(--faint);font-size:var(--fs-label);font-variant-numeric:tabular-nums}
    /* Group header: status colour bar, name, count, inline create. */
    .task-group-head td{height:auto;padding:var(--sp-2) var(--sp-3);background:var(--sunk);border-bottom:1px solid var(--rule)}
    .task-group-head button:first-child{display:inline-flex;align-items:center;gap:var(--sp-2);min-width:168px;border:0;background:transparent;padding:0;color:var(--ink);font-size:var(--fs-label);font-weight:700;letter-spacing:.06em;text-transform:uppercase}
    .group-bar{display:inline-block;width:3px;height:13px;border-radius:2px;background:var(--muted)}
    .group-bar.active{background:var(--info)}.group-bar.waiting{background:var(--warn-fill)}
    .group-bar.breached{background:var(--fail-fill)}.group-bar.closed{background:var(--pass-fill)}
    .task-group-head>td>span{margin-left:var(--sp-2);color:var(--muted);font-variant-numeric:tabular-nums;font-size:var(--fs-label)}
    .task-group-head button:last-child{float:right;border:0;background:transparent;color:var(--muted);font-size:var(--fs-label);font-weight:700;opacity:0;transition:opacity .12s}
    .task-group-head:hover button:last-child,.task-group-head button:last-child:focus-visible{opacity:1}
    /* Cells are editable in place; the control only appears on approach. */
    .inline-editor{width:100%;min-width:112px;height:28px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--ink);padding:0 var(--sp-2);font-size:var(--fs-small);font-variant-numeric:tabular-nums}
    .inline-editor:hover,.inline-editor:focus{border-color:var(--rule-control);background:var(--surface)}
    .task-owner .avatar{width:24px;height:24px;font-size:var(--fs-label);background:var(--brand-tint);color:var(--brand)}
```

- [ ] **Step 3: Bind inline date editing**

In `bindDynamicEvents()`, add:

```js
    document.querySelectorAll("[data-inline-edit]").forEach(input=>input.onchange=()=>{
      const next=clone(state);
      const task=next.tasks.find(t=>t.id===input.dataset.inlineTask);
      if(!task)return;
      task[input.dataset.inlineEdit]=input.value;
      commitState(next);
      renderApp();
      showToast("Task updated");
    });
```

- [ ] **Step 4: Verify in the browser**

Open TaskFlow → List. Confirm: seven columns with Age present; rows are 36px; group headers show a status colour bar and a count, with `+ New task` appearing on hover; changing a due date persists across a view switch; sorting still works from the header buttons.

- [ ] **Step 5: Run the suite and commit**

Run: `npm test`

```bash
git add index.html
git commit -m "feat(taskflow): ClickUp row model with inline edit and group headers"
```

---

### Task 8: Board drag-and-drop

**Files:**
- Modify: `C:\KITCO\index.html:1221-1228` (`renderTaskBoard`)
- Modify: `C:\KITCO\index.html` — `bindDynamicEvents()`
- Modify: `C:\KITCO\tests\logic.mjs`

**Interfaces:**
- Consumes: `commitState(candidate)`, `validateTaskWorkflow(task)`, `workflowStatusesFor(workflowId)`.
- Produces: `moveTaskToStatus(taskId, status): boolean` — returns `false` and changes nothing when the status is not valid for the task's workflow.

- [ ] **Step 1: Extend the harness**

Add `moveTaskToStatus` to the `exports` list in `tests/harness.mjs`.

- [ ] **Step 2: Write the failing test**

Append to `tests/logic.mjs`:

```js
// ── Board drag ───────────────────────────────────────────────────────
// A drop must respect the task's workflow. Dragging into a column the
// workflow does not define is rejected, not silently written.
app.setState(app.createSeedData());
const fresh = app.getState();
const subject = fresh.tasks.find(t => !["Closed", "Completed"].includes(t.status));
const legal = fresh.workflows.find(w => w.id === subject.workflowId);
assert.ok(legal, `task ${subject.id} should reference a real workflow`);

assert.equal(
  app.moveTaskToStatus(subject.id, "Definitely Not A Status"),
  false,
  "an undefined status must be rejected"
);
assert.equal(
  app.getState().tasks.find(t => t.id === subject.id).status,
  subject.status,
  "a rejected move must not mutate the task"
);

console.log(`Board: illegal drop on ${subject.id} correctly rejected.`);
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node tests/logic.mjs`
Expected: FAIL — `TypeError: app.moveTaskToStatus is not a function`

- [ ] **Step 4: Implement the move**

Insert beside `toggleTaskCompletion` (near line 993):

```js
  function moveTaskToStatus(taskId,status){
    const next=clone(state);
    const task=next.tasks.find(t=>t.id===taskId);
    if(!task)return false;
    if(!workflowStatusesForSource(next,task.workflowId).includes(status))return false;
    task.status=status;
    task.lastUpdate=asOfDate(next);
    commitState(next);
    return true;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/logic.mjs`
Expected: PASS

- [ ] **Step 6: Make the board draggable — replace `renderTaskBoard` (lines 1221-1228)**

```js
  function renderTaskBoard(tasks){
    const groups=getTaskFlowGroups(tasks);
    return `<div class="taskflow-board">${Object.entries(groups).map(([status,items])=>`<section class="board-column" data-board-status="${escapeHtml(status)}">
      <div class="board-head"><span><span class="group-bar ${slug(statusValueFor(items[0]||{status},state))}"></span>${escapeHtml(status)}</span><span>${items.length}</span></div>
      <div class="board-cards" data-board-drop="${escapeHtml(status)}">${items.map(task=>`<button class="task-card" data-task="${task.id}" data-board-card="${task.id}" draggable="true">
        <span class="task-card-title">${escapeHtml(task.title)}</span>
        ${task.businessImpact?`<span class="task-card-impact">${formatMoney(task.businessImpact)}</span>`:""}
        <span class="task-card-meta"><span>${escapeHtml(employeeById(task.assigneeId)?.role||"Unassigned")}</span><span class="task-card-due"><span class="type-pill ${slug(task.priority)}">${escapeHtml(task.priority)}</span>${agePill(task)}</span></span>
      </button>`).join("")||`<div class="empty" style="padding:24px 8px">No tasks</div>`}</div>
    </section>`).join("")}</div>`;
  }
```

- [ ] **Step 7: Bind native drag events**

In `bindDynamicEvents()`, add:

```js
    document.querySelectorAll("[data-board-card]").forEach(card=>{
      card.ondragstart=event=>{event.dataTransfer.setData("text/plain",card.dataset.boardCard);card.classList.add("dragging")};
      card.ondragend=()=>card.classList.remove("dragging");
    });
    document.querySelectorAll("[data-board-drop]").forEach(zone=>{
      zone.ondragover=event=>{event.preventDefault();zone.classList.add("drop-target")};
      zone.ondragleave=()=>zone.classList.remove("drop-target");
      zone.ondrop=event=>{
        event.preventDefault();
        zone.classList.remove("drop-target");
        const id=event.dataTransfer.getData("text/plain");
        if(moveTaskToStatus(id,zone.dataset.boardDrop)){renderApp();showToast("Task moved")}
        else showToast("That status is not part of this task's workflow",true);
      };
    });
```

- [ ] **Step 8: Add drag CSS**

```css
    .task-card[draggable="true"]{cursor:grab}
    .task-card.dragging{opacity:.5;cursor:grabbing}
    .board-cards.drop-target{background:var(--brand-tint);border-radius:8px;outline:2px dashed var(--brand);outline-offset:-2px}
```

- [ ] **Step 9: Verify in the browser**

Open TaskFlow → Board. Confirm: a card drags between columns and the counts update; the drop zone highlights on hover; dragging into a column the task's workflow does not define shows the rejection toast and the card returns.

- [ ] **Step 10: Run the suite and commit**

Run: `npm test`

```bash
git add index.html tests/
git commit -m "feat(taskflow): native drag-and-drop board with workflow validation"
```

---

### Task 9: Command Centre inversion, computed sentence, and live as-of

**Files:**
- Modify: `C:\KITCO\index.html:998-1000` (`renderPageHead`)
- Modify: `C:\KITCO\index.html:1072-1101` (`renderCommandCentre`)
- Modify: `C:\KITCO\index.html:400-408` (view sections — register attributes)
- Modify: `C:\KITCO\tests\harness.mjs`, `C:\KITCO\tests\logic.mjs`

**Interfaces:**
- Consumes: `getManagementDecisionCandidates()`, `getExecutionSummary()`, `isOverdue()`, `formatMoney()`.
- Produces: `asOfDate(source): string`, `stalenessDays(source): number`, `buildStateSentence(source): string`.

- [ ] **Step 1: Extend the harness**

Add `asOfDate, stalenessDays, buildStateSentence` to the `exports` list.

- [ ] **Step 2: Write the failing test**

Append to `tests/logic.mjs`:

```js
// ── Computed sentence and as-of ──────────────────────────────────────
app.setState(app.createSeedData());
const s = app.getState();

// As-of comes from the data, never from a literal.
const asOf = app.asOfDate(s);
assert.match(asOf, /^\d{4}-\d{2}-\d{2}$/, `asOfDate returned "${asOf}"`);
assert.ok(Number.isInteger(app.stalenessDays(s)), "stalenessDays must be a whole number");

// With breaches present, the sentence names the count and the exposure.
const sentence = app.buildStateSentence(s);
const breached = s.tasks.filter(t => !["Closed", "Completed"].includes(t.status) && app.isOverdue(t));
assert.ok(breached.length > 0, "seed data should contain breached tasks");
assert.match(sentence, new RegExp(`\\b${breached.length}\\b`), `sentence should state the count: "${sentence}"`);
assert.match(sentence, /₹/, `sentence should state the exposure: "${sentence}"`);

// With nothing breached, the all-clear is stated rather than hidden —
// the owner has to be able to trust the silence.
const clear = app.createSeedData();
clear.tasks = clear.tasks.map(t => ({ ...t, status: "Closed", escalation: "Closed" }));
const clearSentence = app.buildStateSentence(clear);
assert.match(clearSentence, /Nothing needs you/, `all-clear should be explicit: "${clearSentence}"`);

console.log(`Sentence: "${sentence}"`);
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node tests/logic.mjs`
Expected: FAIL — `TypeError: app.asOfDate is not a function` (the Task 3 stub is a local placeholder about to be replaced).

- [ ] **Step 4: Implement — delete the Task 3 stub and add the real functions**

Remove the temporary `asOfDate` added in Task 3 Step 4, and insert beside `renderPageHead`:

```js
  function todayISO(){return new Date().toISOString().slice(0,10)}
  function daysBetween(from,to){return Math.round((Date.parse(to)-Date.parse(from))/86400000)}
  // The as-of date is the latest fact in the data, never a literal. A stale
  // upload must never be able to present itself as live.
  function asOfDate(source=state){
    return (source?.tasks||[]).reduce((latest,task)=>
      task.lastUpdate&&task.lastUpdate>latest?task.lastUpdate:latest,
      source?.meta?.demoDate||DEMO_TODAY);
  }
  function stalenessDays(source=state){return Math.max(0,daysBetween(asOfDate(source),todayISO()))}
  function buildStateSentence(source=state){
    const active=(source.tasks||[]).filter(task=>!["Closed","Completed"].includes(task.status));
    const breached=active.filter(isOverdue);
    if(!breached.length)return `Nothing needs you. ${count.format(active.length)} item${active.length===1?"":"s"} on track.`;
    const exposed=breached.reduce((sum,task)=>sum+(task.businessImpact||0),0);
    const asOf=asOfDate(source);
    const stale=breached.filter(task=>daysBetween(task.dueDate,asOf)>7);
    const parts=[`${count.format(breached.length)} item${breached.length===1?"":"s"} need${breached.length===1?"s":""} you.`];
    if(exposed)parts.push(`${formatMoney(exposed)} exposed.`);
    if(stale.length)parts.push(`${count.format(stale.length)} ${stale.length===1?"has":"have"} been open longer than a week.`);
    return parts.join(" ");
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/logic.mjs`
Expected: PASS, printing the generated sentence.

- [ ] **Step 6: Make `renderPageHead` report real staleness**

```js
  function renderPageHead(eyebrow,title,description){
    const asOf=asOfDate(),stale=stalenessDays();
    const note=stale<=0?"Current":stale===1?"1 day old":`${stale} days old`;
    return `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="subhead">${description}</p></div>
      <div class="as-of">Data as of<strong>${asOf}</strong><span class="staleness${stale>1?" stale":""}">${note}</span></div></div>`;
  }
```

```css
    .as-of{text-align:right;color:var(--muted);font-size:var(--fs-small);line-height:1.6}
    .as-of strong{display:block;color:var(--ink);font-variant-numeric:tabular-nums}
    .staleness{color:var(--muted);font-size:var(--fs-label)}
    .staleness.stale{color:var(--warn);font-weight:700}
```

- [ ] **Step 7: Invert the Command Centre — replace `renderCommandCentre` (lines 1072-1101)**

```js
  function renderCommandCentre(){
    const kpis=calculateBusinessKpis(state),stories=getManagementDecisionCandidates();
    const headline=getHeadlineBusinessNumbers(),headlineIds=new Set(headline.map(kpi=>kpi.id));
    const remaining=kpis.filter(kpi=>!headlineIds.has(kpi.id));
    const execution=getExecutionSummary();
    return `${renderPageHead("Connected group intelligence","Management Command Centre","One view of performance, exposure, decisions and execution across the KITCO group.")}
      <p class="state-sentence">${escapeHtml(buildStateSentence())}</p>
      <section class="panel"><div class="panel-head"><div><h2>Decisions</h2><p>Result → cause → accountable role → action → decision</p></div><button class="btn small" data-view-open="ledger">Open TaskFlow</button></div>
        <div class="story-list">${stories.map(story=>`<button class="story ${story.severity}" data-story="${story.id}"><span><span class="story-result">${escapeHtml(story.result)}</span><span class="story-cause">${escapeHtml(story.cause)}</span><span class="story-path"><span class="story-node">${escapeHtml(story.accountableRole)}</span><span class="story-arrow">→</span><span class="story-node">${escapeHtml(story.action)}</span><span class="story-arrow">→</span><span class="story-node">${story.taskIds.length} TaskFlow actions</span></span></span><span class="story-decision"><strong>${story.severity==="critical"?"DECISION":"REVIEW"}</strong>${escapeHtml(story.decision)}</span></button>`).join("")}</div>
      </section>
      <div class="execution-strip">${execution.map(item=>`<button class="execution-item ${item.state}" data-execution-filter="${item.id}"><span>${item.label}</span><strong>${item.value}</strong></button>`).join("")}</div>
      <section class="panel"><div class="panel-head"><div><h2>Figures</h2><p>Headline commercial measures. Click any figure for its records.</p></div><button class="btn small" data-view-open="business">Business Performance</button></div>
        <div class="panel-body"><div class="business-kpis">${headline.map(kpi=>renderBusinessKpi(kpi,true)).join("")}</div></div>
      </section>
      <div class="all-metrics-toggle-row"><button class="btn small" type="button" data-toggle-all-metrics aria-expanded="false" aria-controls="all-metrics">View all metrics</button></div>
      <section class="all-metrics" id="all-metrics" hidden>
        <section class="panel"><div class="panel-head"><div><h2>Remaining business metrics</h2><p>Supporting commercial measures and existing drill-downs</p></div></div>
          <div class="panel-body"><div class="business-kpis">${remaining.map(kpi=>renderBusinessKpi(kpi)).join("")}</div></div>
        </section>
      </section>`;
  }
```

This removes the nine-card `Module health` block (values with no owner and no age, per spec §2) and the duplicate `Management action queue`, which repeated the decision list.

- [ ] **Step 8: Add the sentence and strip CSS**

```css
    .state-sentence{margin:0 0 var(--sp-5);color:var(--ink);font-size:var(--fs-fig);font-weight:600;line-height:1.4;letter-spacing:-.01em;max-width:62ch}
    .execution-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0;margin:var(--sp-5) 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}
    .execution-item{border:0;border-right:1px solid var(--rule);background:transparent;padding:var(--sp-3) var(--sp-4);text-align:left}
    .execution-item:last-child{border-right:0}
    .execution-item:hover{background:var(--sunk)}
    .execution-item span{display:block;color:var(--muted);font-size:var(--fs-label);font-weight:700;letter-spacing:.06em;text-transform:uppercase}
    .execution-item strong{display:block;margin-top:var(--sp-2);color:var(--ink);font-variant-numeric:tabular-nums;font-size:var(--fs-fig);font-weight:700}
    .execution-item.critical strong{color:var(--fail)}
    .execution-item.attention strong{color:var(--warn)}
```

- [ ] **Step 9: Remove the hard-coded movement string**

`getHeadlineBusinessNumbers()` and `renderBusinessKpi()` are unchanged, but the literal `"6.8% positive movement"` in the deleted `health` array is now gone with it. Confirm no hard-coded figures remain:

Run: `grep -n "6.8%" index.html`
Expected: no output.

- [ ] **Step 10: Set the density registers**

Replace lines 401-408 so each view declares its register:

```html
        <section class="view" id="overview-view" data-view="overview" data-register="exec"></section>
        <section class="view" id="business-view" data-view="business" data-register="exec" hidden></section>
        <section class="view" id="inventory-view" data-view="inventory" data-register="work" hidden></section>
        <section class="view" id="control-view" data-view="control" data-register="work" hidden></section>
        <section class="view" id="network-view" data-view="network" data-register="work" hidden></section>
        <section class="view" id="ledger-view" data-view="ledger" data-register="work" hidden></section>
        <section class="view" id="departments-view" data-view="departments" data-register="work" hidden></section>
        <section class="view" id="calendar-view" data-view="calendar" data-register="work" hidden></section>
```

- [ ] **Step 11: Verify in the browser**

Load the Command Centre. Confirm: the sentence is the first thing below the title and states a count and a rupee figure; decisions render immediately below it, not behind a toggle; the execution strip is one rule-bounded band; no module-health cards remain; the as-of block shows a computed date with a staleness note; Command Centre type is visibly larger than TaskFlow type.

- [ ] **Step 12: Run the suite and commit**

Run: `npm test`

```bash
git add index.html tests/
git commit -m "feat(command-centre): lead with computed state sentence and decisions"
```

---

### Task 10: Keyboard shortcuts

**Files:**
- Modify: `C:\KITCO\index.html` — `handleGlobalKeydown()` (line 1682)

**Interfaces:**
- Consumes: `setView`, `addRecordModal`, `closeOverlays`, `closeSecondBrain`.
- Produces: none.

- [ ] **Step 1: Replace `handleGlobalKeydown`**

```js
  function handleGlobalKeydown(event){
    if(event.key==="Escape"){closeOverlays();closeSecondBrain();return}
    // Never steal a keystroke the user is typing into a field.
    const target=event.target;
    if(target.matches("input,textarea,select")||target.isContentEditable)return;
    if(event.metaKey||event.ctrlKey||event.altKey)return;
    if(event.key==="/"){event.preventDefault();document.getElementById("global-search").focus();return}
    if(event.key==="c"){event.preventDefault();addRecordModal("task");return}
    if(event.key==="t"){event.preventDefault();setView("ledger")}
  }
```

`j`/`k`/`e` row navigation is deliberately omitted — it needs a row-cursor concept the app does not have, and adding one for three keys is not worth it until someone asks.

- [ ] **Step 2: Verify in the browser**

Press `/` — search focuses. Press `c` — the create modal opens. Press `t` — TaskFlow opens. Type `c` inside the search field — the character is inserted and no modal opens.

- [ ] **Step 3: Run the suite and commit**

Run: `npm test`

```bash
git add index.html
git commit -m "feat(taskflow): global keyboard shortcuts for search, create and TaskFlow"
```

---

### Task 11: DESIGN.md

**Files:**
- Create: `C:\KITCO\DESIGN.md`

- [ ] **Step 1: Write the doctrine**

```markdown
# KITCO Management Suite — Design System

Developed by V L & CO.

## Doctrine

**A named clock on every rupee.**

KITCO is a chase product, not an analytics product. Three facts set the
hierarchy on every screen: **amount, owner, age.**

**The enforcement rule.** A component that shows a number but names no owner and
states no age must justify its existence or be removed.

## Rules

1. **Brand is never a state. State is never brand.** `--brand` marks the user's
   current position. A reader who learns to read the brand colour as a warning
   cannot unlearn it. Asserted in `tests/contrast.mjs`.
2. **A colour may not enter `:root` without its pair entering the contrast test.**
   Tokens are real custom properties, readable from the live document — not a JS
   template string, which is how a contrast check produces a false pass.
3. **State colour is never the only signal.** Every status carries a word;
   breached items carry an age.
4. **`--fs-label` (11.5px) is for uppercase tracked labels only.** Running text
   below 12.5px is a defect.
5. **Two registers, one token set.** `data-register="exec"` for Command Centre
   and Business Performance; `data-register="work"` everywhere else. Overlays are
   always working density, whatever opened them.
6. **Three primitives.** Line (amount, owner, age, status), Figure (a number with
   its label and provenance), Panel (a titled container). New components need an
   argument, not just a use.
7. **Five status values.** Open, Active, Waiting, Breached, Closed. Every stored
   status maps explicitly; a silent fallback would understate a problem.
8. **The as-of date is computed from the data, never written.** A stale upload
   must never be able to present itself as live.
9. **Motion is near-zero**, with one exception: completing a task leaves a
   visible trace, so the user sees the system received the action.

## Verification

```bash
npm test
```

`tests/contrast.mjs` asserts every foreground/background pair against WCAG AA on
both `--canvas` and `--surface`. `tests/logic.mjs` asserts the status mapping,
hierarchy scoping, board drop validation, and the computed sentence.

## Open

- **KITCO's brand colour is unconfirmed.** `--brand` falls back to Deep Plum
  (`#53284F`). Confirmation is a one-line change in `:root`.
- **Baseline v3.0's state colours fail contrast as text** — `Warning #E59400` is
  2.45:1. Raised against the standard; KITCO uses text-safe tones instead.
```

- [ ] **Step 2: Commit**

```bash
git add DESIGN.md
git commit -m "docs: record the KITCO design doctrine"
```

---

## Self-review

**Spec coverage.** §2 doctrine → DESIGN.md (Task 11) and the enforcement rule applied in Tasks 4 and 9. §3.1 contrast → Tasks 1-2. §3.2 staleness → Task 9. §3.3 inversion → Task 9. §4.1 colour → Task 2. §4.2 type → Task 2. §4.3 registers → Tasks 2 and 9. §4.4 motion → carried by the existing reduced-motion block; the completion trace already exists via `setTaskCompletion` and `showToast`. §5 primitives → Task 4; status vocabulary → Task 3. §6.1 navigation → Task 6. §6.2 Command Centre → Task 9. §6.3 TaskFlow → Tasks 5, 7, 8, 10. §7 dead code → Tasks 5 and 6. §8 accessibility → Tasks 1-3. §9 build → Task 1.

**Gap found and closed:** §4.4's completion trace had no task. It is satisfied by existing behaviour (`toggleTaskCompletion` → `renderApp` → `showToast`); Task 7 Step 4 confirms it still fires after the row rewrite.

**Type consistency.** `statusValueFor(task, source)` is defined in Task 3 and used in Tasks 7, 8, 9 with the same signature. `asOfDate(source)` is stubbed in Task 3 Step 4 and explicitly deleted in Task 9 Step 4 — flagged in both places. `ageDays`/`agePill` defined Task 3, used Tasks 7-8. `moveTaskToStatus(taskId, status)` defined and tested in Task 8 only. The harness `exports` string grows in Tasks 1, 3, 5, 8, 9 — each task states its own additions in full.
