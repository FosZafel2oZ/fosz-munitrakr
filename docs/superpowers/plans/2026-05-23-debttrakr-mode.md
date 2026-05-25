# DebtTrakr Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second mode "DebtTrakr" to the existing PWA — a per-person IOU ledger with Lend/Borrow events, accessed via a dropdown menu attached to the topbar title.

**Architecture:** Pure debt math (per-person balances, totals, progress) lives in a new `public/debts.js` (UMD, Node-testable). The active mode is an in-memory variable (`currentMode`), not persisted — every boot lands on MuniTrakr. A `setMode()` orchestrator handles topbar text, header icon swap, dashboard render, and mode-specific UI show/hide. Debt records live in a brand-new `store.debts[]` array — fully isolated from `store.records` so MuniTrakr can't accidentally render debt rows.

**Tech Stack:** Vanilla JS + CSS (no build step), `localStorage`, service worker, Chart.js (vendored, unused in this plan), node + `assert` for unit tests.

**Project notes:**
- **No git repo.** Where the plan would normally say "commit," just save the files and move on.
- The spec we're executing lives at `docs/superpowers/specs/2026-05-23-debttrakr-mode-design.md`. Open it alongside this plan.
- Don't break MuniTrakr. Every UI surface that exists today should look and behave identically when `currentMode === "finance"`.

---

## File map

**Created**
- `public/debts.js` — UMD module. Pure functions: `personBalances(debts, peopleById)`, `totalsAcrossPeople(balances)`. No DOM, no `attachConversion`.
- `tests/debts.test.js` — Unit tests for the pure helpers.

**Modified**
- `public/index.html` — Adds: mode-switcher dropdown markup attached to the topbar title; DebtTrakr dashboard `<main>`; Per-Person History `<main>`; People settings block; second header-icon upload control; Add Debt modal; Add Person mini-form trigger.
- `public/app.js` — `currentMode` state; `setMode()` orchestrator; migrations in `loadStore` (people, debts, headerIcon split); `PEOPLE_ICONS` constant; DebtTrakr render functions; Per-Person History render; Add Debt modal logic; People settings CRUD; per-mode FAB dispatch; per-mode header-icon plumbing; mode-aware settings section visibility.
- `public/styles.css` — Debt-dashboard person-card + progress bar; mode-switcher dropdown; Add Debt modal sub-styles (mostly inherit from existing); People icon-picker grid.
- `public/sw.js` — Add `./debts.js` to `SHELL`; bump `CACHE` to `munitrakr-v47`.

---

### Task 1: `debts.js` scaffold + pure math helpers (TDD)

**Files:**
- Create: `public/debts.js`
- Create: `tests/debts.test.js`

- [ ] **Step 1: Create `public/debts.js` scaffold (UMD wrapper + stubbed exports)**

```js
/* MuniTrakr debt helpers — pure functions. Browser global + Node require. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  // Returns a Map<personId, { lent, back, outstanding, direction, progress }>.
  // - lent  = sum of converted amounts of "lend" debts for the person.
  // - back  = sum of converted amounts of "borrow" debts for the person.
  // - outstanding = lent - back (signed; +ve = they owe me, -ve = I owe them).
  // - direction   = "they-owe" | "i-owe" | "clear".
  // - progress    = 0..1 (only meaningful when direction !== "clear").
  function personBalances(debts, peopleById) {
    const out = new Map();
    if (!Array.isArray(debts)) return out;
    for (const d of debts) {
      if (!d || !d.personId) continue;
      // peopleById is optional; if provided, ignore debts whose person was deleted.
      if (peopleById && !peopleById[d.personId]) continue;
      const amt = Number(d.convertedAmount != null ? d.convertedAmount : d.amount) || 0;
      const row = out.get(d.personId) || { lent: 0, back: 0, outstanding: 0, direction: "clear", progress: 0 };
      if (d.type === "lend") row.lent += amt;
      else if (d.type === "borrow") row.back += amt;
      out.set(d.personId, row);
    }
    for (const [id, row] of out) {
      row.outstanding = row.lent - row.back;
      if (row.outstanding > 0) {
        row.direction = "they-owe";
        row.progress = row.lent > 0 ? Math.min(1, Math.max(0, row.back / row.lent)) : 0;
      } else if (row.outstanding < 0) {
        row.direction = "i-owe";
        row.progress = row.back > 0 ? Math.min(1, Math.max(0, row.lent / row.back)) : 0;
      } else {
        row.direction = "clear";
        row.progress = 1;
      }
    }
    return out;
  }

  // Given the Map from personBalances, return { totalLend, totalBorrow }.
  // totalLend  = sum of outstanding for people whose direction === "they-owe".
  // totalBorrow = -sum of outstanding for people whose direction === "i-owe" (unsigned).
  function totalsAcrossPeople(balances) {
    let totalLend = 0, totalBorrow = 0;
    if (!balances) return { totalLend: 0, totalBorrow: 0 };
    for (const [, row] of balances) {
      if (row.direction === "they-owe") totalLend += row.outstanding;
      else if (row.direction === "i-owe") totalBorrow += -row.outstanding;
    }
    return { totalLend, totalBorrow };
  }

  return { personBalances, totalsAcrossPeople };
});
```

- [ ] **Step 2: Create the test file with failing tests**

`tests/debts.test.js`:

```js
const { test, assert } = require("./_lib");
const D = require("../public/debts");

function debt(o) {
  return Object.assign({
    id: "d_" + Math.random().toString(36).slice(2, 7),
    type: "lend",
    personId: "p1",
    date: "2026-05-21",
    amount: 100,
    currency: "THB",
    notes: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }, o);
}

test("personBalances: empty input -> empty map", () => {
  const b = D.personBalances([], {});
  assert.equal(b.size, 0);
});

test("personBalances: single lend -> they-owe with 0 progress", () => {
  const b = D.personBalances([debt({ type: "lend", amount: 100, personId: "p1" })]);
  const row = b.get("p1");
  assert.equal(row.lent, 100);
  assert.equal(row.back, 0);
  assert.equal(row.outstanding, 100);
  assert.equal(row.direction, "they-owe");
  assert.equal(row.progress, 0);
});

test("personBalances: single borrow -> i-owe with 0 progress", () => {
  const b = D.personBalances([debt({ type: "borrow", amount: 50, personId: "p2" })]);
  const row = b.get("p2");
  assert.equal(row.outstanding, -50);
  assert.equal(row.direction, "i-owe");
  assert.equal(row.progress, 0);
});

test("personBalances: partial repayment -> progress correct", () => {
  const b = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),
    debt({ type: "borrow", amount: 30,  personId: "p1" }),
  ]);
  const row = b.get("p1");
  assert.equal(row.outstanding, 70);
  assert.equal(row.direction, "they-owe");
  assert.equal(row.progress, 0.3);
});

test("personBalances: full repayment -> clear, progress 1", () => {
  const b = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),
    debt({ type: "borrow", amount: 100, personId: "p1" }),
  ]);
  const row = b.get("p1");
  assert.equal(row.outstanding, 0);
  assert.equal(row.direction, "clear");
  assert.equal(row.progress, 1);
});

test("personBalances: uses convertedAmount when present", () => {
  const b = D.personBalances([
    debt({ type: "lend", amount: 1000, currency: "THB", convertedAmount: 27, convertedCurrency: "USD", personId: "p1" }),
  ]);
  assert.equal(b.get("p1").outstanding, 27);
});

test("personBalances: ignores debts whose person was deleted (when peopleById given)", () => {
  const b = D.personBalances(
    [debt({ personId: "ghost" })],
    { p1: {} }
  );
  assert.equal(b.size, 0);
});

test("personBalances: keeps debts when peopleById not provided", () => {
  const b = D.personBalances([debt({ personId: "anyone" })]);
  assert.equal(b.size, 1);
});

test("personBalances: multiple people independent", () => {
  const b = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),
    debt({ type: "lend",   amount: 200, personId: "p2" }),
    debt({ type: "borrow", amount: 80,  personId: "p2" }),
  ]);
  assert.equal(b.get("p1").outstanding, 100);
  assert.equal(b.get("p2").outstanding, 120);
});

test("totalsAcrossPeople: sums by direction, ignores clear", () => {
  const balances = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),   // they-owe 100
    debt({ type: "lend",   amount: 200, personId: "p2" }),   // they-owe 200
    debt({ type: "borrow", amount: 200, personId: "p2" }),   // clear
    debt({ type: "borrow", amount: 50,  personId: "p3" }),   // i-owe 50
  ]);
  const { totalLend, totalBorrow } = D.totalsAcrossPeople(balances);
  assert.equal(totalLend, 100);
  assert.equal(totalBorrow, 50);
});

test("totalsAcrossPeople: empty -> zeros", () => {
  const t = D.totalsAcrossPeople(new Map());
  assert.equal(t.totalLend, 0);
  assert.equal(t.totalBorrow, 0);
});

test("personBalances: direction flip — net flips, progress recalculated for new direction", () => {
  const b = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }), // lent 100
    debt({ type: "borrow", amount: 200, personId: "p1" }), // I now owe 100 net
  ]);
  const row = b.get("p1");
  assert.equal(row.outstanding, -100);
  assert.equal(row.direction, "i-owe");
  // progress = lent/back = 100/200 = 0.5 (you've paid half of what you borrowed back already, when measured against borrow total)
  assert.equal(row.progress, 0.5);
});
```

- [ ] **Step 3: Run tests, see them all pass**

Run: `node tests/run.js`
Expected: every new debts test passes alongside the existing 53. Total should be 66 passed, 0 failed.

- [ ] **Step 4: Save files. (No git in this project — skip commit.)**

---

### Task 2: Wire `debts.js` into the page + service worker SHELL

**Files:**
- Modify: `public/index.html`
- Modify: `public/sw.js`

- [ ] **Step 1: Add `<script>` for debts.js right before `app.js`**

In `public/index.html`, find the script block at the bottom:

```html
<script src="./recurring.js"></script>
<script src="./finance-helpers.js"></script>
<script src="./app.js"></script>
```

Insert `debts.js` immediately before `app.js`:

```html
<script src="./recurring.js"></script>
<script src="./finance-helpers.js"></script>
<script src="./debts.js"></script>
<script src="./app.js"></script>
```

- [ ] **Step 2: Add `./debts.js` to `sw.js` SHELL**

In `public/sw.js`, find the `SHELL` array and add `./debts.js` alphabetically near the other JS:

```js
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./debts.js",
  "./recurring.js",
  "./finance-helpers.js",
  "./styles.css",
  "./vendor/chart.umd.min.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon.png",
  "./chevron.svg",
  "./chevron-dark.svg",
];
```

- [ ] **Step 3: Syntax check**

Run: `node --check public/sw.js && node --check public/debts.js && echo OK`
Expected: `OK`.

- [ ] **Step 4: Browser smoke**

Run: `npm start`, open `http://localhost:3000`. In DevTools console:
```
typeof personBalances === "function" && typeof totalsAcrossPeople === "function"
```
Expected: `true`. (These globals come from `debts.js` UMD.)

- [ ] **Step 5: Save files.**

---

### Task 3: `loadStore` migration — debts, people, header-icon split

**Files:**
- Modify: `public/app.js` (function `loadStore`)

- [ ] **Step 1: Locate the migration block in `loadStore`**

In `public/app.js`, find `function loadStore()`. The migration block looks like:

```js
if (!Array.isArray(store.settings.recurring)) store.settings.recurring = [];
if (!Array.isArray(store.records)) store.records = [];
if (!store.profile) store.profile = { displayName: "Me" };

// Migration: createdAt / updatedAt on records must be numeric ms ...
let migratedTimestamps = false;
for (const r of store.records) { ... }
```

- [ ] **Step 2: Add the three new migrations BEFORE the timestamps loop**

Insert:

```js
if (!Array.isArray(store.settings.recurring)) store.settings.recurring = [];
if (!Array.isArray(store.settings.people)) store.settings.people = [];
if (!Array.isArray(store.records)) store.records = [];
if (!Array.isArray(store.debts)) store.debts = [];
if (!store.profile) store.profile = { displayName: "Me" };

// Header-icon split: an older version had a single `settings.headerIcon`.
// Move it into the MuniTrakr-mode slot and clear the old field.
if (store.settings.headerIcon !== undefined) {
  if (store.settings.headerIconFinance === undefined) {
    store.settings.headerIconFinance = store.settings.headerIcon;
  }
  delete store.settings.headerIcon;
}
if (store.settings.headerIconFinance === undefined) store.settings.headerIconFinance = null;
if (store.settings.headerIconDebt === undefined) store.settings.headerIconDebt = null;
```

- [ ] **Step 3: Syntax check**

Run: `node --check public/app.js && echo OK`
Expected: `OK`.

- [ ] **Step 4: Manual smoke**

Run: `npm start` and reload `http://localhost:3000`. In DevTools console:
```
loadStore(); JSON.stringify({people: store.settings.people, debts: store.debts, hiF: store.settings.headerIconFinance, hiD: store.settings.headerIconDebt})
```
Expected: `{"people":[],"debts":[],"hiF":null,"hiD":null}` (or `hiF` is your existing icon dataURL if you had one — that's correct).
Also confirm `store.settings.headerIcon` is now `undefined`.

- [ ] **Step 5: Save files.**

---

### Task 4: `PEOPLE_ICONS` constant + person icon SVG renderer

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add the `PEOPLE_ICONS` map and helper**

In `public/app.js`, find the existing `const ICONS = { ... }` block. Right AFTER `const ICON_IDS = Object.keys(ICONS);`, insert:

```js
// People-icon library — separate from the category ICONS map. Used by the
// Settings People section and the DebtTrakr "Who" picker.
const PEOPLE_ICONS = {
  person:    '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  man:       '<circle cx="12" cy="7" r="3.5"/><path d="M6 21v-5a6 6 0 0 1 12 0v5"/>',
  woman:     '<circle cx="12" cy="6.5" r="3"/><path d="M8 21l1.5-8h5L16 21M9.5 13l2.5 5 2.5-5"/>',
  child:     '<circle cx="12" cy="9" r="3"/><path d="M7 21v-4a5 5 0 0 1 10 0v4"/><path d="M10 9.5h.1M14 9.5h.1"/>',
  elder:     '<circle cx="12" cy="8" r="3.5"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M9 8.5h.1M14.5 8.5h.1M10 11.5q2 1 4 0"/>',
  couple:    '<circle cx="8" cy="7.5" r="2.8"/><circle cx="16" cy="7.5" r="2.8"/><path d="M3 21v-3a4.5 4.5 0 0 1 9 0v3M12 21v-3a4.5 4.5 0 0 1 9 0v3"/>',
  family:    '<circle cx="7" cy="7" r="2.6"/><circle cx="17" cy="7" r="2.6"/><circle cx="12" cy="14" r="2"/><path d="M3 18v-2.5a3.5 3.5 0 0 1 7 0V18M14 18v-2.5a3.5 3.5 0 0 1 7 0V18M9.5 21v-2a2.5 2.5 0 0 1 5 0v2"/>',
  friend:    '<circle cx="7" cy="8" r="2.8"/><circle cx="17" cy="8" r="2.8"/><path d="M3 21v-3a4.4 4.4 0 0 1 8 0M13 21v-3a4.4 4.4 0 0 1 8 0M11 12.5l1 1.5 1-1.5a1.4 1.4 0 1 0-2 0z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
  graduation:'<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5M22 9v6"/>',
  crown:     '<path d="M3 18h18M3 18l2-9 5 5 2-8 2 8 5-5 2 9"/>',
  star:      '<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>',
  paw:       '<circle cx="6" cy="11" r="1.8"/><circle cx="10" cy="7" r="1.8"/><circle cx="14" cy="7" r="1.8"/><circle cx="18" cy="11" r="1.8"/><path d="M7 19a5 5 0 0 1 10 0c0 1.5-1.5 2.5-5 2.5S7 20.5 7 19z"/>',
};
const PEOPLE_ICON_IDS = Object.keys(PEOPLE_ICONS);

function personIconSvg(id, cls) {
  const path = PEOPLE_ICONS[id] || PEOPLE_ICONS.person;
  return (
    '<svg class="' + (cls || "") + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    path +
    '</svg>'
  );
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/app.js && echo OK`
Expected: `OK`.

- [ ] **Step 3: Browser smoke**

Open localhost, in console:
```
document.body.insertAdjacentHTML("beforeend", "<div style='position:fixed;top:50px;left:50px;background:#222;padding:10px;color:#fff;z-index:9999'>" + PEOPLE_ICON_IDS.map(k => `<span style="display:inline-flex;width:32px;height:32px;background:#7c5cff;border-radius:8px;padding:6px;margin:3px;align-items:center;justify-content:center">${personIconSvg(k)}</span>`).join("") + "</div>")
```
Expected: a row of 13 colored icon tiles appears top-left of the page. Verify each looks reasonable (no broken/empty SVGs). Remove the test div: `document.querySelectorAll("div").forEach(d=>{if(d.style.position==="fixed"&&d.style.top==="50px")d.remove()})` (or just reload).

- [ ] **Step 4: Save files.**

---

### Task 5: `currentMode` state + topbar mode-switcher dropdown

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Make the topbar title a tappable element with a chevron**

Find the topbar in `public/index.html`. The current title element is rendered via `$("#helloName").textContent = "MuniTrakr"`. We need a wrapper that includes a chevron and a dropdown. Find the existing `<h1 id="helloName">` (or similar — search for `helloName`) and replace it with this:

```html
<div class="title-switcher">
  <button type="button" id="modeSwitcher" class="title-btn" aria-haspopup="true" aria-expanded="false">
    <span id="helloName">MuniTrakr</span>
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
  <div id="modeMenu" class="rn-menu hidden">
    <button type="button" data-mode="finance" class="mode-opt active">
      <span class="mode-ico">$</span><span>MuniTrakr</span>
    </button>
    <button type="button" data-mode="debt" class="mode-opt">
      <span class="mode-ico">⇄</span><span>DebtTrakr</span>
    </button>
  </div>
</div>
```

(If your current markup wraps the title differently, preserve sibling elements like `#todayDate`. Only swap the title node itself.)

- [ ] **Step 2: Add CSS for the title button + dropdown**

In `public/styles.css`, append:

```css
/* Topbar title switcher — clickable title with chevron + dropdown */
.title-switcher { position: relative; display: inline-block; }
.title-btn {
  display: inline-flex; align-items: center; gap: 6px;
  background: transparent !important; border: 0; padding: 0;
  color: inherit; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.title-btn svg { opacity: .75; }
#modeMenu {
  /* Anchored under the title (override the default bottom-positioning of .rn-menu). */
  position: absolute;
  top: calc(100% + 6px);
  bottom: auto;
  left: 0;
  right: auto;
  min-width: 180px;
}
.mode-opt {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  background: transparent !important; border: 0;
  padding: 13px 14px; border-radius: 11px;
  color: var(--text); font-size: 15px; font-weight: 600; text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.mode-opt .mode-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: 6px;
  background: var(--accent-soft); color: var(--accent); font-weight: 700;
}
.mode-opt.active { color: var(--accent); background: var(--accent-soft); }
.mode-opt:active { background: var(--card); }
```

- [ ] **Step 3: Add `currentMode` state and `setMode` orchestrator to app.js**

Near the top of `public/app.js`, just after the existing `let` block for state, add:

```js
/* ---- DebtTrakr mode state ----
   Not persisted. Every fresh boot starts in MuniTrakr. */
let currentMode = "finance"; // "finance" | "debt"
```

Then, near the other top-level functions (right after `loadStore` is a good neighbour), add:

```js
function setMode(next) {
  if (next !== "finance" && next !== "debt") return;
  if (next === currentMode) return;
  currentMode = next;
  // Topbar title text
  const title = next === "debt" ? "DebtTrakr" : "MuniTrakr";
  const helloEl = document.getElementById("helloName");
  if (helloEl) helloEl.textContent = title;
  // Mode-menu active-row highlight
  document.querySelectorAll("#modeMenu .mode-opt").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === next);
  });
  // Header icon — swap to the per-mode source
  applyHeaderIcon();
  // Force a clean dashboard re-render in the new mode.
  showView("dashboard");
}
```

- [ ] **Step 4: Wire the title button + dropdown click handlers**

Near the end of `public/app.js` (where other DOM bindings live), add:

```js
/* Mode switcher: title button toggles dropdown; outside click closes it. */
(function wireModeSwitcher() {
  const btn = document.getElementById("modeSwitcher");
  const menu = document.getElementById("modeMenu");
  if (!btn || !menu) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle("hidden");
    btn.setAttribute("aria-expanded", String(!open));
  });
  menu.querySelectorAll(".mode-opt").forEach((opt) => {
    opt.addEventListener("click", (e) => {
      e.stopPropagation();
      setMode(opt.dataset.mode);
      menu.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    });
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".title-switcher")) {
      menu.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    }
  });
})();
```

- [ ] **Step 5: Manual smoke**

Reload. Tap the topbar title — dropdown appears with MuniTrakr highlighted in accent and DebtTrakr below. Tap DebtTrakr — title swaps to "DebtTrakr", dropdown closes. The dashboard view may look broken now (no DebtTrakr dashboard yet) — that's expected; we add it next. Tap title again, pick MuniTrakr — back to normal.

- [ ] **Step 6: Save files.**

---

### Task 6: `applyHeaderIcon` per-mode + Theme section dual upload

**Files:**
- Modify: `public/app.js` (function `applyHeaderIcon` and the two settings handlers around it)
- Modify: `public/index.html` (Theme section)

- [ ] **Step 1: Update `applyHeaderIcon` to pick the right field per mode**

In `public/app.js`, replace the existing `applyHeaderIcon` function:

```js
function applyHeaderIcon() {
  const key = currentMode === "debt" ? "headerIconDebt" : "headerIconFinance";
  const src = (settings && settings[key]) || "./icon.png";
  const a = document.getElementById("headerIcon");
  if (a) a.src = src;
  // Live preview elements (Settings → Theme) — render whichever mode's preview
  // exists. We have two preview slots after Step 2 below.
  const bF = document.getElementById("hiPreviewFinance");
  const bD = document.getElementById("hiPreviewDebt");
  if (bF) bF.src = (settings && settings.headerIconFinance) || "./icon.png";
  if (bD) bD.src = (settings && settings.headerIconDebt) || "./icon.png";
}
```

- [ ] **Step 2: Replace the single header-icon row in Settings → Theme with two**

In `public/index.html`, find the existing Theme block. It contains an image preview `id="hiPreview"`, an upload input, and a restore button (search for `hiPreview` and `headerIcon`). Replace that block's CONTENTS (keep `<div class="settings-block">`/`<div class="block-title">Theme</div>`) with two parallel rows:

```html
<div class="block-title">Theme</div>

<label>Theme
  <select id="themeSelect">
    <option value="default">Default (dark purple)</option>
    <option value="aero">Aero (light)</option>
    <option value="yoimiya">Yoimiya (orange + fireworks)</option>
  </select>
</label>

<div class="hi-row">
  <div class="hi-preview-col">
    <span class="lbl">Header icon (MuniTrakr)</span>
    <img id="hiPreviewFinance" class="hi-preview" alt="" />
  </div>
  <div class="hi-actions-col">
    <label class="btn-secondary sm hi-upload">
      Upload
      <input type="file" id="hiUploadFinance" accept="image/*" hidden />
    </label>
    <button type="button" class="btn-secondary sm" id="hiRestoreFinance">Restore default</button>
  </div>
</div>

<div class="hi-row">
  <div class="hi-preview-col">
    <span class="lbl">Header icon (DebtTrakr)</span>
    <img id="hiPreviewDebt" class="hi-preview" alt="" />
  </div>
  <div class="hi-actions-col">
    <label class="btn-secondary sm hi-upload">
      Upload
      <input type="file" id="hiUploadDebt" accept="image/*" hidden />
    </label>
    <button type="button" class="btn-secondary sm" id="hiRestoreDebt">Restore default</button>
  </div>
</div>
```

**If your existing Theme block has additional controls (theme select, "Save" button, etc.), preserve them in place.** Only replace the single header-icon row with the two new rows.

- [ ] **Step 3: Update upload + restore handlers to wire both controls**

Find the existing upload + restore wiring in `app.js` (search for `headerIcon = url` and `headerIcon = null`). Replace with:

```js
function _wireHeaderIconControls(uploadId, restoreId, settingsKey, previewId) {
  const u = document.getElementById(uploadId);
  const r = document.getElementById(restoreId);
  if (u) u.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    fileToIconDataURL(file, (url) => {
      settings[settingsKey] = url;
      api("/settings", "PUT", buildSettingsPayload()).then(() => {
        applyHeaderIcon();
      });
    });
    e.target.value = "";
  });
  if (r) r.addEventListener("click", () => {
    settings[settingsKey] = null;
    api("/settings", "PUT", buildSettingsPayload()).then(() => {
      applyHeaderIcon();
    });
  });
}
_wireHeaderIconControls("hiUploadFinance", "hiRestoreFinance", "headerIconFinance", "hiPreviewFinance");
_wireHeaderIconControls("hiUploadDebt",    "hiRestoreDebt",    "headerIconDebt",    "hiPreviewDebt");
```

Delete the old single-upload / single-restore handlers that referenced `settings.headerIcon` directly. (Search and remove anything assigning to `settings.headerIcon`.)

- [ ] **Step 4: CSS for the new dual rows (append to styles.css)**

```css
.hi-row { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; }
.hi-preview-col { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; min-width: 0; }
.hi-preview-col .lbl { font-size: 13px; color: var(--muted); font-weight: 600; }
.hi-preview { width: 56px; height: 56px; border-radius: 14px; object-fit: cover; background: var(--card); border: 1px solid var(--line); }
.hi-actions-col { display: flex; gap: 8px; flex-wrap: wrap; }
.hi-upload { cursor: pointer; }
```

- [ ] **Step 5: Smoke**

Reload. Settings → Theme — two rows visible, each with its own preview + Upload + Restore. Upload an image while in MuniTrakr — topbar icon updates. Switch to DebtTrakr (mode dropdown) — topbar icon falls back to `./icon.png` (since DebtTrakr's slot is empty). Upload a different image — only DebtTrakr's topbar changes. Switch back — MuniTrakr's custom icon returns.

- [ ] **Step 6: Save files.**

---

### Task 7: DebtTrakr dashboard scaffold + render

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Add the DebtTrakr dashboard `<main>` after the existing MuniTrakr dashboard**

In `public/index.html`, find `<main id="view-dashboard">`. After its closing `</main>`, add:

```html
<!-- DEBTTRAKR DASHBOARD (only visible when currentMode === "debt") -->
<main id="view-debt-dashboard" class="view hidden">
  <div class="summary-row">
    <div class="summary-card" id="dbtTotalLendCard">
      <span class="muted">Total Lend</span>
      <strong id="dbtTotalLend" class="amt-in">0</strong>
    </div>
    <div class="summary-card" id="dbtTotalBorrowCard">
      <span class="muted">Total Borrow</span>
      <strong id="dbtTotalBorrow" class="amt-out">0</strong>
    </div>
  </div>
  <div id="dbtPersonList" class="dbt-person-list"></div>
  <div id="dbtEmpty" class="empty hidden">No outstanding debts. Tap + to add one.</div>
</main>
```

- [ ] **Step 2: Hook up `showView` to also know about `view-debt-dashboard`**

In `public/app.js`, find `function showView(v)`. The current pattern toggles the three existing views by class. Update it to also handle the debt dashboard AND honor the active mode for the "dashboard" key:

```js
function showView(v) {
  if (v !== "records" && multiSelect) {
    multiSelect = false;
    selected.clear();
  }
  currentView = v;
  // In "dashboard" we route to the mode-appropriate dashboard.
  const onDebtMode = currentMode === "debt";
  document.getElementById("view-dashboard").classList.toggle("hidden", !(v === "dashboard" && !onDebtMode));
  document.getElementById("view-debt-dashboard").classList.toggle("hidden", !(v === "dashboard" && onDebtMode));
  document.getElementById("view-records").classList.toggle("hidden", v !== "records");
  document.getElementById("view-settings").classList.toggle("hidden", v !== "settings");
  if (v !== "settings")
    document.querySelectorAll("#view-settings .settings-block").forEach((b) =>
      b.classList.add("collapsed")
    );
  // Range dock — hidden in debt mode and on Settings
  document.getElementById("rangeDock").classList.toggle("hidden", v === "settings" || onDebtMode);
  document.getElementById("recFilterMenu").classList.add("hidden");
  if (v === "settings") renderRecurringSection();
  if (v === "dashboard") {
    if (onDebtMode) renderDebtDashboard();
    else renderConfirmBanner();
  }
  updateFabs();
  updateSettingsBtn();
  updateDockTheme();
  savePrefs();
}
```

- [ ] **Step 3: Add `renderDebtDashboard()` function**

Append to `public/app.js` (near the other render functions):

```js
function renderDebtDashboard() {
  loadStore();
  const peopleById = {};
  for (const p of (store.settings.people || [])) peopleById[p.id] = p;
  const balances = personBalances(store.debts || [], peopleById);
  const { totalLend, totalBorrow } = totalsAcrossPeople(balances);

  const cur = (store.settings.defaultCurrency || "THB");
  document.getElementById("dbtTotalLend").textContent = fmt(totalLend);
  document.getElementById("dbtTotalBorrow").textContent = fmt(totalBorrow);
  document.querySelector("#dbtTotalLendCard .muted").textContent = "Total Lend · " + cur;
  document.querySelector("#dbtTotalBorrowCard .muted").textContent = "Total Borrow · " + cur;
  fitText(document.getElementById("dbtTotalLend"), 22, 11);
  fitText(document.getElementById("dbtTotalBorrow"), 22, 11);

  // Build per-person cards for everyone with direction !== "clear"
  const list = document.getElementById("dbtPersonList");
  const empty = document.getElementById("dbtEmpty");
  list.innerHTML = "";
  const rows = [];
  for (const [pid, row] of balances) {
    if (row.direction === "clear") continue;
    const p = peopleById[pid];
    if (!p) continue;
    rows.push({ p, row });
  }
  // Sort: bigger absolute outstanding first.
  rows.sort((a, b) => Math.abs(b.row.outstanding) - Math.abs(a.row.outstanding));

  if (!rows.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  for (const { p, row } of rows) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "dbt-person-card " + (row.direction === "they-owe" ? "is-in" : "is-out");
    card.dataset.personId = p.id;
    const sign = row.direction === "they-owe" ? "+" : "-";
    const amt  = Math.abs(row.outstanding);
    const pct  = Math.round(row.progress * 100);
    card.innerHTML =
      '<div class="dbt-ic" style="background:' + p.color + '">' +
        personIconSvg(p.icon || "person", "dbt-ic-svg") +
      '</div>' +
      '<div class="dbt-body">' +
        '<div class="dbt-row1">' +
          '<span class="dbt-name">' + escapeHtml(p.name) + '</span>' +
          '<span class="dbt-amt">' + sign + fmt(amt, cur) + '</span>' +
        '</div>' +
        '<div class="dbt-bar"><span style="width:' + pct + '%"></span></div>' +
      '</div>';
    card.addEventListener("click", () => openPersonHistory(p.id));
    list.appendChild(card);
  }
}

// Placeholder; full impl in Task 11.
function openPersonHistory(_personId) { console.log("openPersonHistory stub", _personId); }
```

- [ ] **Step 4: CSS for the dashboard cards + progress bar**

Append to `public/styles.css`:

```css
.dbt-person-list { display: flex; flex-direction: column; gap: 10px; }
.dbt-person-card {
  -webkit-appearance: none; appearance: none;
  display: flex; align-items: center; gap: 12px;
  background: var(--card); border: 1px solid var(--line);
  border-radius: 16px; padding: 12px 14px;
  cursor: pointer; text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.dbt-person-card:active { transform: scale(.99); }
.dbt-ic {
  flex: 0 0 auto; width: 40px; height: 40px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12px; color: #fff;
}
.dbt-ic-svg { width: 20px; height: 20px; }
.dbt-body { flex: 1; min-width: 0; }
.dbt-row1 { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.dbt-name { font-weight: 700; font-size: 15px; color: var(--text); }
.dbt-amt { font-weight: 800; font-size: 15px; }
.dbt-person-card.is-in  .dbt-amt { color: var(--in); }
.dbt-person-card.is-out .dbt-amt { color: var(--out); }
.dbt-bar {
  margin-top: 8px; height: 6px; border-radius: 3px;
  background: rgba(255,255,255,.06); overflow: hidden;
}
.dbt-person-card.is-in  .dbt-bar { background: rgba(61,220,151,.12); }
.dbt-person-card.is-out .dbt-bar { background: rgba(255,107,129,.12); }
.dbt-bar > span { display: block; height: 100%; border-radius: 3px; }
.dbt-person-card.is-in  .dbt-bar > span { background: var(--in); }
.dbt-person-card.is-out .dbt-bar > span { background: var(--out); }
```

- [ ] **Step 5: Manual smoke (empty state for now)**

Reload. Switch to DebtTrakr via mode dropdown. Expected: top buttons show "Total Lend · THB 0" and "Total Borrow · THB 0", below them the empty state "No outstanding debts. Tap + to add one."

Then in console, seed one person + two debts to see a card:
```js
loadStore();
store.settings.people.push({ id: "p1", name: "Alice", color: "#7c5cff", icon: "woman" });
store.debts.push({ id:"d1", type:"lend",   personId:"p1", date:"2026-05-21", amount:100, currency:"THB", notes:"", createdAt:Date.now(), updatedAt:Date.now() });
store.debts.push({ id:"d2", type:"borrow", personId:"p1", date:"2026-05-22", amount: 30, currency:"THB", notes:"", createdAt:Date.now(), updatedAt:Date.now() });
saveStore();
renderDebtDashboard();
```
Expected: a single card "Alice +THB 70" with a progress bar 30% filled, in green (`--in`) color.

Clean up:
```js
store.settings.people = []; store.debts = []; saveStore(); renderDebtDashboard();
```

- [ ] **Step 6: Save files.**

---

### Task 8: Settings People section CRUD + icon picker

**Files:**
- Modify: `public/index.html` (add a new `<div class="settings-block">` for People)
- Modify: `public/app.js` (renderPeopleSection + handlers + add/edit modal)
- Modify: `public/styles.css` (People rows + icon picker grid)

- [ ] **Step 1: Add the People settings block markup**

In `public/index.html`, inside `<main id="view-settings">`, add a new block. It should appear BEFORE Recurring (top of Settings) — but it should only be visible in debt mode. We control visibility from JS in Task 12; for now just add the markup. Place it as the FIRST block inside the settings view:

```html
<div class="settings-block" id="settingsPeople">
  <div class="block-title">People</div>
  <div class="muted" style="margin-bottom:12px">
    Track debts to/from specific people. Drag to reorder.
  </div>
  <div id="peopleList" class="people-list"></div>
  <div class="add-cat-label">Add a new person</div>
  <div class="add-cat add-person-row">
    <input id="newPersonColor" type="color" value="#7c5cff" />
    <input id="newPersonName" type="text" placeholder="Person name" />
    <button class="btn-mini" id="addPersonBtn">Add</button>
  </div>
</div>

<!-- Person icon-picker modal (also reused by the Add Debt person mini-form) -->
<div id="personIconModal" class="modal-overlay hidden">
  <div class="modal modal-narrow">
    <div class="modal-head">
      <h3>Choose icon</h3>
      <button type="button" class="ghost-btn" id="personIconClose">✕</button>
    </div>
    <div id="personIconGrid" class="icon-grid"></div>
  </div>
</div>
```

- [ ] **Step 2: CSS for the People rows + icon grid**

Append to `public/styles.css`:

```css
.people-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.people-row {
  display: flex; align-items: center; gap: 10px;
  background: var(--card); border-radius: 12px; padding: 10px 12px;
  border: 1px solid rgba(255,255,255,.08);
}
.people-row .pp-ic {
  width: 36px; height: 36px; border-radius: 10px; flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center; color: #fff;
}
.people-row .pp-ic svg { width: 18px; height: 18px; }
.people-row .pp-name { flex: 1; min-width: 0; font-weight: 600; color: var(--text); }
.people-row input[type="text"] { flex: 1; min-width: 0; margin: 0; padding: 8px 10px; font-size: 14px; }
.people-row input[type="color"] { width: 36px; height: 36px; padding: 0; border-radius: 8px; background: none; border: 0; }
.people-row .pp-icon-edit {
  -webkit-appearance: none; appearance: none;
  background: transparent !important; border: 1px solid var(--accent); color: var(--accent);
  border-radius: 8px; padding: 6px 10px; font-weight: 600; font-size: 12px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.people-row .pp-del {
  -webkit-appearance: none; appearance: none;
  background: transparent !important; border: 0; color: var(--out);
  font-size: 18px; line-height: 1; padding: 6px 10px; cursor: pointer; border-radius: 8px;
  -webkit-tap-highlight-color: transparent;
}

.icon-grid {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;
  padding: 4px 0 8px;
}
.icon-grid button {
  -webkit-appearance: none; appearance: none;
  width: 100%; aspect-ratio: 1/1;
  display: flex; align-items: center; justify-content: center;
  background: var(--accent-soft); color: var(--accent);
  border: 1px solid transparent; border-radius: 12px;
  cursor: pointer; padding: 0;
  -webkit-tap-highlight-color: transparent;
}
.icon-grid button.active { border-color: var(--accent); }
.icon-grid button svg { width: 22px; height: 22px; }
```

- [ ] **Step 3: Render + CRUD logic for People**

Append to `public/app.js`:

```js
function renderPeopleSection() {
  const root = document.getElementById("peopleList");
  if (!root) return;
  loadStore();
  root.innerHTML = "";
  const people = store.settings.people || [];
  if (!people.length) {
    root.innerHTML = '<div class="recurring-empty">No people yet. Add one below.</div>';
    return;
  }
  for (const p of people) {
    const row = document.createElement("div");
    row.className = "people-row";
    row.dataset.personId = p.id;
    row.innerHTML =
      '<span class="pp-ic" style="background:' + p.color + '">' + personIconSvg(p.icon || "person") + '</span>' +
      '<input type="color" value="' + (p.color || "#7c5cff") + '" />' +
      '<input type="text" value="' + escapeHtml(p.name) + '" />' +
      '<button type="button" class="pp-icon-edit">Icon</button>' +
      '<button type="button" class="pp-del" aria-label="Delete">×</button>';

    const [colorIn, nameIn, iconBtn, delBtn] = [
      row.querySelector('input[type="color"]'),
      row.querySelector('input[type="text"]'),
      row.querySelector(".pp-icon-edit"),
      row.querySelector(".pp-del"),
    ];

    colorIn.addEventListener("change", () => {
      p.color = colorIn.value;
      row.querySelector(".pp-ic").style.background = p.color;
      saveStore();
    });
    nameIn.addEventListener("change", () => {
      p.name = nameIn.value.trim() || "(unnamed)";
      nameIn.value = p.name;
      saveStore();
    });
    iconBtn.addEventListener("click", () => {
      openPersonIconPicker(p.icon || "person", (next) => {
        p.icon = next;
        row.querySelector(".pp-ic").innerHTML = personIconSvg(p.icon);
        saveStore();
      });
    });
    delBtn.addEventListener("click", () => {
      if (!confirm("Delete this person? Their debt records will remain but become orphaned.")) return;
      store.settings.people = store.settings.people.filter((x) => x.id !== p.id);
      saveStore();
      renderPeopleSection();
    });

    root.appendChild(row);
  }
}

// Add button — wired at script-load time.
(function wirePeopleAdd() {
  const btn = document.getElementById("addPersonBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const name = document.getElementById("newPersonName").value.trim();
    if (!name) return;
    const color = document.getElementById("newPersonColor").value || "#7c5cff";
    loadStore();
    store.settings.people.push({
      id: "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      name, color, icon: "person",
    });
    saveStore();
    document.getElementById("newPersonName").value = "";
    renderPeopleSection();
  });
})();

// Icon picker modal — reusable.
function openPersonIconPicker(currentIconId, onPick) {
  const m = document.getElementById("personIconModal");
  const grid = document.getElementById("personIconGrid");
  if (!m || !grid) return;
  grid.innerHTML = PEOPLE_ICON_IDS.map((id) =>
    '<button type="button" data-id="' + id + '" class="' + (id === currentIconId ? "active" : "") + '">' +
      personIconSvg(id) +
    '</button>'
  ).join("");
  grid.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      grid.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
      onPick(b.dataset.id);
      closePersonIconPicker();
    });
  });
  m.classList.remove("hidden");
  document.body.classList.add("modal-open");
}
function closePersonIconPicker() {
  const m = document.getElementById("personIconModal");
  if (m) m.classList.add("hidden");
  // Don't blindly remove modal-open — another modal may be up.
  const anyOpen =
    !document.getElementById("modal").classList.contains("hidden") ||
    !document.getElementById("ruleModal").classList.contains("hidden");
  if (!anyOpen) document.body.classList.remove("modal-open");
}
document.getElementById("personIconClose")?.addEventListener("click", closePersonIconPicker);
```

- [ ] **Step 4: Have `showView` render People when Settings opens**

Find the `if (v === "settings") renderRecurringSection();` line you added in Task 7 (or earlier) and replace with:

```js
if (v === "settings") {
  renderRecurringSection();
  renderPeopleSection();
}
```

- [ ] **Step 5: Manual smoke**

Reload. Settings → People — empty state visible. Add a person ("Alice", purple). Row appears with default `person` icon. Tap "Icon" → modal opens with grid of 13 icons. Pick "woman" → modal closes, the row's icon updates. Change name to "Bob" — saves. Change color — tile background changes. Delete — confirm prompt → row removed.

- [ ] **Step 6: Save files.**

---

### Task 9: Add Debt modal — markup + open/close + form scaffolding

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

- [ ] **Step 1: Add the modal markup**

In `public/index.html`, near the other modals (after the rule editor modal is a good spot), add:

```html
<!-- ADD DEBT MODAL -->
<div id="debtModal" class="modal-overlay hidden">
  <div class="modal">
    <div class="modal-head">
      <h3 id="debtModalTitle">Add Debt</h3>
      <button type="button" class="ghost-btn" id="debtModalClose">✕</button>
    </div>
    <form id="debtForm" onsubmit="return false">

      <div class="type-toggle" id="debtTypeToggle">
        <button type="button" data-type="lend"   class="active">Lend</button>
        <button type="button" data-type="borrow">Borrow</button>
      </div>

      <label class="amount-label">Amount *
        <div class="amount-input big">
          <select id="dbtCurrency" aria-label="Currency"></select>
          <input id="dbtAmount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" required />
        </div>
      </label>

      <button type="button" id="dbtMatchOutstanding" class="btn-secondary sm hidden" style="margin-bottom:10px"></button>

      <label>Date *
        <input id="dbtDate" type="date" required />
      </label>

      <div class="field">
        <span class="lbl">Who *</span>
        <div class="picker" id="dbtPersonPicker">
          <button type="button" class="picker-btn" id="dbtPersonBtn">
            <span class="picker-val placeholder" id="dbtPersonVal">Select a person</span>
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="picker-menu hidden" id="dbtPersonMenu"></div>
        </div>
        <input type="hidden" id="dbtPersonId" />
        <button type="button" id="dbtAddPersonBtn" class="btn-secondary sm" style="margin-top:8px">+ Add new person</button>
        <div id="dbtAddPersonForm" class="add-person-inline hidden">
          <input type="color" id="dbtNewPersonColor" value="#7c5cff" />
          <input type="text" id="dbtNewPersonName" placeholder="Name" />
          <button type="button" class="btn-mini" id="dbtNewPersonSave">Save</button>
          <button type="button" class="btn-mini" id="dbtNewPersonCancel">Cancel</button>
        </div>
      </div>

      <label>Notes
        <textarea id="dbtNotes" rows="2" placeholder="Optional notes"></textarea>
      </label>

      <div id="debtError" class="form-error"></div>

      <div class="modal-actions">
        <button type="button" id="dbtDelete" class="btn-danger hidden">Delete</button>
        <button type="button" id="dbtSave" class="btn-primary">Save Debt</button>
      </div>
    </form>
  </div>
</div>
```

- [ ] **Step 2: CSS for the inline add-person form**

Append to `public/styles.css`:

```css
.add-person-inline {
  display: flex; gap: 8px; align-items: center; margin-top: 8px;
  background: var(--card-2); padding: 8px; border-radius: 10px;
}
.add-person-inline.hidden { display: none; }
.add-person-inline input[type="color"] { width: 36px; height: 36px; padding: 0; border-radius: 8px; background: none; border: 0; flex: 0 0 auto; }
.add-person-inline input[type="text"] { flex: 1; min-width: 0; padding: 8px 10px; font-size: 14px; margin: 0; }
```

- [ ] **Step 3: Open / close handlers + form-state init**

Append to `public/app.js`:

```js
let editingDebtId = null;
let debtDraftType = "lend";

function openDebtModal(debt /* nullable */) {
  loadStore();
  editingDebtId = debt ? debt.id : null;
  debtDraftType = debt ? debt.type : "lend";
  document.getElementById("debtModalTitle").textContent = debt ? "Edit Debt" : "Add Debt";
  document.getElementById("dbtDelete").classList.toggle("hidden", !debt);
  document.getElementById("debtError").textContent = "";

  // Direction toggle
  document.querySelectorAll("#debtTypeToggle button").forEach((b) =>
    b.classList.toggle("active", b.dataset.type === debtDraftType)
  );

  // Currency select — reuse the same population helper used elsewhere if it exists.
  fillCurrencySelects();
  document.getElementById("dbtCurrency").value = (debt && debt.currency) || (store.settings.defaultCurrency || "THB");

  document.getElementById("dbtAmount").value = debt && debt.amount > 0 ? debt.amount : "";
  document.getElementById("dbtDate").value = debt ? debt.date : ymd(new Date());
  document.getElementById("dbtNotes").value = debt ? debt.notes : "";

  // Person picker
  buildDebtPersonMenu();
  setDebtPerson(debt ? debt.personId : "");

  // Hide inline add-person form by default
  document.getElementById("dbtAddPersonForm").classList.add("hidden");

  // Match-outstanding chip (re-evaluated whenever person changes; initial pass below)
  refreshMatchOutstanding();

  document.getElementById("debtModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
}
function closeDebtModal() {
  document.getElementById("debtModal").classList.add("hidden");
  editingDebtId = null;
  // syncModalLock won't know about #debtModal — release directly if nothing else is open.
  const anyOpen =
    !document.getElementById("modal").classList.contains("hidden") ||
    !document.getElementById("ruleModal").classList.contains("hidden") ||
    !document.getElementById("personIconModal").classList.contains("hidden");
  if (!anyOpen) document.body.classList.remove("modal-open");
}

document.getElementById("debtModalClose")?.addEventListener("click", closeDebtModal);
document.getElementById("debtModal")?.addEventListener("click", (e) => {
  if (e.target.id === "debtModal") closeDebtModal();
});

// Direction-toggle clicks
document.querySelectorAll("#debtTypeToggle button").forEach((b) => {
  b.addEventListener("click", () => {
    debtDraftType = b.dataset.type;
    document.querySelectorAll("#debtTypeToggle button").forEach((x) =>
      x.classList.toggle("active", x === b)
    );
    refreshMatchOutstanding();
  });
});

// Stubs — full impls below.
function buildDebtPersonMenu() { /* in Step 4 */ }
function setDebtPerson(_id) { /* in Step 4 */ }
function refreshMatchOutstanding() { /* in Task 10 */ }
```

- [ ] **Step 4: Implement `buildDebtPersonMenu` + `setDebtPerson` + picker wiring**

Replace the two stubs with:

```js
function buildDebtPersonMenu() {
  const menu = document.getElementById("dbtPersonMenu");
  if (!menu) return;
  const people = store.settings.people || [];
  menu.innerHTML = people.map((p) =>
    '<button type="button" class="picker-opt" data-id="' + p.id + '">' +
      '<span class="pick-ico" style="background:' + p.color + '">' + personIconSvg(p.icon || "person") + '</span>' +
      '<span>' + escapeHtml(p.name) + '</span>' +
    '</button>'
  ).join("");
  menu.querySelectorAll(".picker-opt").forEach((b) => {
    b.addEventListener("click", () => {
      setDebtPerson(b.dataset.id);
      menu.classList.add("hidden");
    });
  });
}

function setDebtPerson(id) {
  document.getElementById("dbtPersonId").value = id || "";
  const val = document.getElementById("dbtPersonVal");
  const people = store.settings.people || [];
  const p = id ? people.find((x) => x.id === id) : null;
  if (p) {
    val.classList.remove("placeholder");
    val.innerHTML =
      '<span class="pick-ico" style="background:' + p.color + '">' + personIconSvg(p.icon || "person") + '</span>' +
      '<span>' + escapeHtml(p.name) + '</span>';
  } else {
    val.classList.add("placeholder");
    val.textContent = "Select a person";
  }
  refreshMatchOutstanding();
}

// Picker button open/close + outside-click close
(function wireDebtPersonPicker() {
  const btn = document.getElementById("dbtPersonBtn");
  const menu = document.getElementById("dbtPersonMenu");
  if (!btn || !menu) return;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#dbtPersonPicker")) menu.classList.add("hidden");
  });
})();

// Inline add-person from within the debt modal
(function wireInlineAddPerson() {
  const open  = document.getElementById("dbtAddPersonBtn");
  const form  = document.getElementById("dbtAddPersonForm");
  const save  = document.getElementById("dbtNewPersonSave");
  const cancel= document.getElementById("dbtNewPersonCancel");
  if (!open || !form || !save || !cancel) return;
  open.addEventListener("click", () => form.classList.toggle("hidden"));
  cancel.addEventListener("click", () => form.classList.add("hidden"));
  save.addEventListener("click", () => {
    const name = document.getElementById("dbtNewPersonName").value.trim();
    if (!name) return;
    const color = document.getElementById("dbtNewPersonColor").value || "#7c5cff";
    loadStore();
    const newId = "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
    store.settings.people.push({ id: newId, name, color, icon: "person" });
    saveStore();
    document.getElementById("dbtNewPersonName").value = "";
    form.classList.add("hidden");
    buildDebtPersonMenu();
    setDebtPerson(newId);
  });
})();
```

- [ ] **Step 5: Smoke test the modal**

Open localhost. Switch to DebtTrakr. We don't have a FAB dispatch yet (Task 12), but we can invoke from console:
```js
openDebtModal(null)
```
Expected: modal opens with empty fields, Lend selected, currency = THB. Tap the Person picker — empty menu (no people yet) — tap "+ Add new person" — inline form appears, type "Alice", Save. The picker value should update to "Alice" with the colored icon. Tap close.

- [ ] **Step 6: Save files.**

---

### Task 10: Match-outstanding chip + Save Debt handler

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Implement `refreshMatchOutstanding`**

Replace the existing stub with:

```js
function refreshMatchOutstanding() {
  const btn = document.getElementById("dbtMatchOutstanding");
  if (!btn) return;
  const pid = document.getElementById("dbtPersonId").value;
  if (!pid) { btn.classList.add("hidden"); return; }
  loadStore();
  const peopleById = {};
  for (const p of (store.settings.people || [])) peopleById[p.id] = p;
  const balances = personBalances(store.debts || [], peopleById);
  const row = balances.get(pid);
  if (!row || row.direction === "clear") { btn.classList.add("hidden"); return; }
  const cur = store.settings.defaultCurrency || "THB";
  const oppDir = row.direction === "they-owe" ? "borrow" : "lend";
  btn.classList.remove("hidden");
  btn.textContent = "Match outstanding (" + fmt(Math.abs(row.outstanding), cur) + ")";
  btn.onclick = () => {
    document.getElementById("dbtAmount").value = Math.abs(row.outstanding);
    debtDraftType = oppDir;
    document.querySelectorAll("#debtTypeToggle button").forEach((b) =>
      b.classList.toggle("active", b.dataset.type === oppDir)
    );
  };
}
```

- [ ] **Step 2: Wire `dbtSave` + `dbtDelete` and `saveDebtFromModal`**

Append:

```js
async function saveDebtFromModal() {
  const err = document.getElementById("debtError");
  err.textContent = "";

  const personId = document.getElementById("dbtPersonId").value;
  const amount = Number(document.getElementById("dbtAmount").value);
  const date = document.getElementById("dbtDate").value;
  const currency = document.getElementById("dbtCurrency").value;
  const notes = document.getElementById("dbtNotes").value.trim();

  if (!personId) { err.textContent = "Person is required."; return; }
  if (!(amount > 0)) { err.textContent = "Amount must be greater than 0."; return; }
  if (!date) { err.textContent = "Date is required."; return; }

  loadStore();
  if (editingDebtId) {
    const idx = store.debts.findIndex((d) => d.id === editingDebtId);
    if (idx === -1) { err.textContent = "Debt not found."; return; }
    const existing = store.debts[idx];
    const updated = Object.assign({}, existing, {
      type: debtDraftType, personId, amount, currency, date, notes,
      updatedAt: Date.now(),
    });
    // Clear stale FX fields before re-attaching.
    delete updated.convertedAmount; delete updated.convertedCurrency;
    delete updated.rate; delete updated.rateDate; delete updated.rateUnavailable; delete updated.manualRate;
    try { await attachConversion(updated); } catch (_e) { updated.rateUnavailable = true; }
    store.debts[idx] = updated;
  } else {
    const now = Date.now();
    const rec = {
      id: "debt_" + now.toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      type: debtDraftType, personId, amount, currency, date, notes,
      createdAt: now, updatedAt: now,
    };
    try { await attachConversion(rec); } catch (_e) { rec.rateUnavailable = true; }
    store.debts.push(rec);
  }
  saveStore();
  closeDebtModal();
  // Re-render the active view (dashboard OR per-person history)
  if (currentView === "dashboard" && currentMode === "debt") {
    renderDebtDashboard();
  } else if (currentView === "person-history") {
    renderPersonHistory(_currentHistoryPersonId);
  }
}

function deleteDebtFromModal() {
  if (!editingDebtId) return;
  if (!confirm("Delete this debt record?")) return;
  loadStore();
  store.debts = store.debts.filter((d) => d.id !== editingDebtId);
  saveStore();
  closeDebtModal();
  if (currentView === "dashboard" && currentMode === "debt") {
    renderDebtDashboard();
  } else if (currentView === "person-history") {
    renderPersonHistory(_currentHistoryPersonId);
  }
}

document.getElementById("dbtSave")?.addEventListener("click", saveDebtFromModal);
document.getElementById("dbtDelete")?.addEventListener("click", deleteDebtFromModal);

// Will be set in Task 11
let _currentHistoryPersonId = null;
function renderPersonHistory(_pid) { /* in Task 11 */ }
```

- [ ] **Step 3: Manual smoke**

Open debt mode. From console `openDebtModal(null)`. Add a person via inline form ("Alice"). Pick Alice. Fill 100 THB today, type = Lend. Save Debt. Modal closes. Dashboard shows one card: "Alice +THB 100", bar 0%.

`openDebtModal(null)` again. Pick Alice — Match-outstanding chip appears with "Match outstanding (THB 100)". Tap it — amount fills to 100, direction toggles to Borrow. Save → dashboard updates: Alice +THB 0 → card disappears (direction = clear).

- [ ] **Step 4: Save files.**

---

### Task 11: Per-Person History view

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/styles.css`

- [ ] **Step 1: Add the History view markup**

In `public/index.html`, after `<main id="view-debt-dashboard">`'s closing `</main>`, add:

```html
<!-- PER-PERSON HISTORY (DebtTrakr drill-in) -->
<main id="view-person-history" class="view hidden">
  <div class="history-head">
    <button type="button" id="phBack" class="rec-back" aria-label="Back">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
    <span class="ph-ic" id="phIc"></span>
    <div class="ph-meta">
      <h2 id="phName">—</h2>
      <span id="phOutstanding" class="ph-outstanding">—</span>
    </div>
  </div>
  <div id="phList" class="records-list"></div>
  <div id="phEmpty" class="empty hidden">No debt records with this person yet.</div>
</main>
```

- [ ] **Step 2: CSS for the history header + record rows**

Append to `public/styles.css`:

```css
#view-person-history .history-head {
  display: flex; align-items: center; gap: 12px; margin-bottom: 14px;
}
#view-person-history .ph-ic {
  width: 44px; height: 44px; border-radius: 14px; flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center; color: #fff;
}
#view-person-history .ph-ic svg { width: 22px; height: 22px; }
#view-person-history .ph-meta { flex: 1; min-width: 0; }
#view-person-history .ph-meta h2 { font-size: 20px; letter-spacing: -.3px; margin: 0; }
#view-person-history .ph-outstanding { font-size: 14px; font-weight: 700; margin-top: 2px; display: block; }
#view-person-history .ph-outstanding.is-in  { color: var(--in); }
#view-person-history .ph-outstanding.is-out { color: var(--out); }

.dbt-history-row {
  display: flex; align-items: center; gap: 10px;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  padding: 12px 14px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.dbt-history-row .dbt-dir {
  flex: 0 0 auto; padding: 3px 9px; border-radius: 8px;
  font-size: 12px; font-weight: 700; letter-spacing: .2px;
}
.dbt-history-row.is-in  .dbt-dir { background: rgba(61,220,151,.18); color: var(--in); }
.dbt-history-row.is-out .dbt-dir { background: rgba(255,107,129,.18); color: var(--out); }
.dbt-history-row .dbt-amt { font-weight: 800; }
.dbt-history-row.is-in  .dbt-amt { color: var(--in); }
.dbt-history-row.is-out .dbt-amt { color: var(--out); }
.dbt-history-row .dbt-mid { flex: 1; min-width: 0; }
.dbt-history-row .dbt-date { font-size: 12px; color: var(--muted); }
.dbt-history-row .dbt-notes { font-size: 12px; color: var(--muted); margin-top: 2px; }
```

- [ ] **Step 3: Implement `openPersonHistory` + `renderPersonHistory`**

Replace the placeholder `openPersonHistory` and the `renderPersonHistory` stub from earlier tasks:

```js
function openPersonHistory(personId) {
  _currentHistoryPersonId = personId;
  showView("person-history");
  renderPersonHistory(personId);
}

function renderPersonHistory(personId) {
  if (!personId) return;
  loadStore();
  const p = (store.settings.people || []).find((x) => x.id === personId);
  if (!p) {
    // Person was deleted while open — bounce back to dashboard.
    showView("dashboard");
    return;
  }
  document.getElementById("phName").textContent = p.name;
  const phIc = document.getElementById("phIc");
  phIc.style.background = p.color;
  phIc.innerHTML = personIconSvg(p.icon || "person");

  // Outstanding label
  const peopleById = {};
  for (const x of store.settings.people) peopleById[x.id] = x;
  const balances = personBalances(store.debts || [], peopleById);
  const row = balances.get(personId);
  const cur = store.settings.defaultCurrency || "THB";
  const out = document.getElementById("phOutstanding");
  out.classList.remove("is-in", "is-out");
  if (!row || row.direction === "clear") {
    out.textContent = "All clear";
  } else if (row.direction === "they-owe") {
    out.textContent = "They owe you " + fmt(Math.abs(row.outstanding), cur);
    out.classList.add("is-in");
  } else {
    out.textContent = "You owe " + fmt(Math.abs(row.outstanding), cur);
    out.classList.add("is-out");
  }

  // Records list
  const list = document.getElementById("phList");
  const empty = document.getElementById("phEmpty");
  list.innerHTML = "";
  const rows = (store.debts || [])
    .filter((d) => d.personId === personId)
    .sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0)
    );
  if (!rows.length) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  for (const d of rows) {
    const card = document.createElement("div");
    card.className = "dbt-history-row " + (d.type === "lend" ? "is-in" : "is-out");
    const amtStr = fmt(d.convertedAmount != null ? d.convertedAmount : d.amount, cur);
    card.innerHTML =
      '<span class="dbt-dir">' + (d.type === "lend" ? "Lend" : "Borrow") + '</span>' +
      '<div class="dbt-mid">' +
        '<div class="dbt-date">' + formatDate(d.date) + '</div>' +
        (d.notes ? '<div class="dbt-notes">' + escapeHtml(d.notes) + '</div>' : '') +
      '</div>' +
      '<span class="dbt-amt">' + amtStr + '</span>';
    card.addEventListener("click", () => openDebtModal(d));
    list.appendChild(card);
  }
}
```

- [ ] **Step 4: Wire the back button and update showView to know about the new view**

In `showView`, add the history view to the visibility logic. Update it to:

```js
function showView(v) {
  if (v !== "records" && multiSelect) {
    multiSelect = false;
    selected.clear();
  }
  currentView = v;
  const onDebtMode = currentMode === "debt";
  document.getElementById("view-dashboard").classList.toggle("hidden", !(v === "dashboard" && !onDebtMode));
  document.getElementById("view-debt-dashboard").classList.toggle("hidden", !(v === "dashboard" && onDebtMode));
  document.getElementById("view-records").classList.toggle("hidden", v !== "records");
  document.getElementById("view-settings").classList.toggle("hidden", v !== "settings");
  document.getElementById("view-person-history").classList.toggle("hidden", v !== "person-history");
  if (v !== "settings")
    document.querySelectorAll("#view-settings .settings-block").forEach((b) =>
      b.classList.add("collapsed")
    );
  document.getElementById("rangeDock").classList.toggle("hidden", v === "settings" || v === "person-history" || onDebtMode);
  document.getElementById("recFilterMenu").classList.add("hidden");
  if (v === "settings") {
    renderRecurringSection();
    renderPeopleSection();
  }
  if (v === "dashboard") {
    if (onDebtMode) renderDebtDashboard();
    else renderConfirmBanner();
  }
  if (v === "person-history") renderPersonHistory(_currentHistoryPersonId);
  updateFabs();
  updateSettingsBtn();
  updateDockTheme();
  savePrefs();
}
```

Wire the back button:

```js
document.getElementById("phBack")?.addEventListener("click", () => {
  _currentHistoryPersonId = null;
  showView("dashboard");
});
```

- [ ] **Step 5: Smoke**

Reload. In debt mode, dashboard with at least one outstanding person. Tap their card → history view opens: header shows name + outstanding amount in green or red. Records list shows all their debts. Tap a row → debt modal opens in edit mode. Edit amount, Save. Back to history view (re-rendered with new amount). Tap back arrow → dashboard.

- [ ] **Step 6: Save files.**

---

### Task 12: FAB dispatch by mode + settings-section mode-aware visibility

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Make the FAB dispatch to the right modal**

Find the existing `$("#fab").addEventListener("click", () => openModal(null))` line. Replace with:

```js
document.getElementById("fab").addEventListener("click", () => {
  if (currentMode === "debt") {
    // If we're in person-history, pre-fill the person.
    if (currentView === "person-history" && _currentHistoryPersonId) {
      openDebtModal(null);
      setDebtPerson(_currentHistoryPersonId);
    } else {
      openDebtModal(null);
    }
  } else {
    openModal(null);
  }
});
```

- [ ] **Step 2: Tag each Settings block with a `data-mode` attribute, then toggle visibility on entry**

In `public/index.html`, add a `data-mode="finance"` attribute to the Recurring AND Categories blocks (they're MuniTrakr-only). Add `data-mode="debt"` to the People block (debt-only). Shared blocks (Preferences, Currencies, Theme, Backup, App version) get `data-mode="any"` — they show in either mode.

Find each existing `<div class="settings-block">` opening tag and modify:

```html
<div class="settings-block" data-mode="debt" id="settingsPeople"> <!-- People -->
<div class="settings-block" data-mode="finance"> <!-- Recurring -->
<div class="settings-block" data-mode="finance"> <!-- Categories -->
<div class="settings-block" data-mode="any">  <!-- Preferences -->
<div class="settings-block" data-mode="any">  <!-- Currencies -->
<div class="settings-block" data-mode="any">  <!-- Theme -->
<div class="settings-block" data-mode="any">  <!-- Backup & Restore -->
<div class="settings-block" data-mode="any">  <!-- App version -->
```

- [ ] **Step 3: In `showView`, hide blocks that don't match the current mode**

Update the `if (v === "settings")` branch:

```js
if (v === "settings") {
  // Show only blocks matching the active mode (or any-mode).
  document.querySelectorAll("#view-settings .settings-block").forEach((block) => {
    const m = block.dataset.mode || "any";
    block.style.display = (m === "any" || m === currentMode) ? "" : "none";
  });
  if (currentMode === "finance") renderRecurringSection();
  if (currentMode === "debt") renderPeopleSection();
}
```

- [ ] **Step 4: Hide MuniTrakr-only floating UI when in debt mode**

In `setMode`, after `showView("dashboard")`, ensure non-dashboard MuniTrakr UI is hidden:

```js
function setMode(next) {
  if (next !== "finance" && next !== "debt") return;
  if (next === currentMode) return;
  currentMode = next;
  const title = next === "debt" ? "DebtTrakr" : "MuniTrakr";
  const helloEl = document.getElementById("helloName");
  if (helloEl) helloEl.textContent = title;
  document.querySelectorAll("#modeMenu .mode-opt").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === next)
  );
  applyHeaderIcon();
  // Hide the dashboard confirm banner in debt mode (banner is MuniTrakr-only)
  const cb = document.getElementById("confirmBanner");
  if (cb) cb.classList.toggle("hidden", next === "debt" || !pendingConfirmations.length);
  showView("dashboard");
}
```

- [ ] **Step 5: Smoke**

Reload. In MuniTrakr, Settings shows Recurring, Categories, Preferences, Currencies, Theme, Backup, App version. Switch to DebtTrakr (mode dropdown), open Settings — shows People, Preferences, Currencies, Theme, Backup, App version (Recurring + Categories hidden). FAB in MuniTrakr opens Add Record; in DebtTrakr it opens Add Debt. In Per-Person History, FAB pre-fills the person.

- [ ] **Step 6: Save files.**

---

### Task 13: Full smoke + backup-restore + multi-theme sweep

**Files:** None modified — manual integration check.

- [ ] **Step 1: Clean slate**

In DevTools console: `localStorage.clear(); location.reload();`. Expected: lands in MuniTrakr, empty state.

- [ ] **Step 2: Build a small dataset**

In MuniTrakr: add 2 expense records (any category, THB), add 1 investment record. Switch to DebtTrakr: add 3 people (Alice, Bob, Charlie) with different icons/colors. Add 4 debts: Alice +100 (Lend), Alice -30 (Borrow → repayment), Bob -200 (Borrow), Charlie +50 (Lend).

- [ ] **Step 3: Verify dashboard math**

In DebtTrakr dashboard:
- Total Lend = 70 (Alice) + 50 (Charlie) = 120 THB
- Total Borrow = 200 THB
- 3 cards: Alice +70 (30% progress), Bob -200 (0%), Charlie +50 (0%).

In MuniTrakr dashboard: expenses & investments untouched, donut renders, range dock visible.

- [ ] **Step 4: Backup / Restore round-trip**

Settings → Backup & Restore → Share/download backup. Clear localStorage (`localStorage.clear()`). Reload — empty state. Restore from the backup file. Expected: both modes have ALL their data back (records, debts, people, both header icons).

- [ ] **Step 5: Theme sweep**

Cycle through all three themes in each mode. Verify:
- Default — purple accent everywhere; person cards in green/red.
- Aero — light glass; debt cards still legible.
- Yoimiya — fireworks running on top of debt dashboard too.
- All custom-themed surfaces (mode dropdown, person picker, debt modal) match their theme.

- [ ] **Step 6: Run unit tests once more**

Run: `node tests/run.js`
Expected: all 66 tests pass.

- [ ] **Step 7: Save (no files changed).**

---

### Task 14: Version bump v46 → v47

**Files:**
- Modify: `public/app.js` (`APP_VERSION`)
- Modify: `public/sw.js` (`CACHE`)

- [ ] **Step 1: Bump `APP_VERSION`**

```js
// BEFORE
const APP_VERSION = "v46";
// AFTER
const APP_VERSION = "v47";
```

- [ ] **Step 2: Bump `CACHE`**

```js
// BEFORE
const CACHE = "munitrakr-v46";
// AFTER
const CACHE = "munitrakr-v47";
```

- [ ] **Step 3: Syntax check both files**

Run: `node --check public/app.js && node --check public/sw.js && echo OK`
Expected: `OK`.

- [ ] **Step 4: Run unit tests one final time**

Run: `node tests/run.js`
Expected: 66/66 pass.

- [ ] **Step 5: Local smoke**

Reload localhost. Settings → App version → should display `MuniTrakr v47`. DevTools → Application → Cache Storage shows `munitrakr-v47`.

- [ ] **Step 6: Deploy**

Drag `public/` onto Netlify (same site). Hard-reload on phone — settings → App version → Check for updates.

- [ ] **Step 7: Save (already saved — this is just the deploy step).**

---

## Done

After Task 14, the DebtTrakr mode is live alongside MuniTrakr with:
- Title-dropdown mode switcher (lands on MuniTrakr every boot)
- Per-person ledger with Lend/Borrow events
- Dashboard cards with repayment progress bars
- Per-person history view
- Inline person creation from Add Debt
- Match-outstanding quick action
- Per-mode header icons (with migration of any existing icon to MuniTrakr's slot)
- Backup/restore covers everything (debts + people + both icons ride along automatically)
- 13 new unit tests covering balance math and edge cases
