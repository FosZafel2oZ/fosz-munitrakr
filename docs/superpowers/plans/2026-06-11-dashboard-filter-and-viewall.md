# Dashboard Chart-Filter + View-All Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the MuniTrakr dashboard's recent-records list follow the donut-chart selection (category → drill → sub-category), and replace both dashboards' full-width bottom "View all records" buttons with a compact pill in the list header row.

**Architecture:** Pure render-logic change inside `renderDashboard()` in `public/app.js` reusing the existing selection state (`selectedSlice`, `drillCategory`) — no new state. Markup restructure in `public/index.html` (both dashboard views) keeps the existing button ids so the click listeners (app.js:1795 and app.js:5079, both attached at script load) work untouched. New `.view-all-btn` / `.dash-head` styles use only theme variables.

**Tech Stack:** Vanilla JS (no build step), localStorage PWA. Tests: `node tests/run.js` (98 — unchanged by this feature; render logic isn't unit-tested in this codebase).

**Spec:** `docs/superpowers/specs/2026-06-11-dashboard-filter-and-viewall-design.md`

---

### Task 1: Chart-selection filter for the recent list (app.js)

**Files:**
- Modify: `public/app.js:1010-1017` (the recent-list block inside `renderDashboard`)

- [ ] **Step 1: Replace the recent-list derivation**

In `public/app.js`, inside `renderDashboard`, find:

```js
  // 10 most recent of the active type below the chart
  const recent = typed.slice(0, 10);
  $("#dashListTitle").textContent = "Recent " + label + " Records";
  $("#dashRecordCount").textContent =
    typed.length > 10 ? "10 of " + typed.length : typed.length;
  const wrap = $("#dashRecordsList");
  $("#dashRecordsEmpty").classList.toggle("hidden", typed.length > 0);
```

Replace with:

```js
  // Recent records below the chart — follows the chart selection:
  // category tap (selectedSlice) or drill (drillCategory) filters by category;
  // a sub-slice tap inside the drill narrows to that sub-category. The
  // "No Sub-category" slice matches records with an empty subcategory.
  let listFiltered = typed;
  let listTitle = "Recent " + label + " Records";
  if (drillCategory) {
    listFiltered = typed.filter((r) => r.category === drillCategory);
    listTitle = "Recent: " + drillCategory;
    if (selectedSlice) {
      listFiltered = listFiltered.filter(
        (r) => (r.subcategory || "No Sub-category") === selectedSlice
      );
      listTitle = "Recent: " + drillCategory + " / " + selectedSlice;
    }
  } else if (selectedSlice) {
    listFiltered = typed.filter((r) => r.category === selectedSlice);
    listTitle = "Recent: " + selectedSlice;
  }
  const recent = listFiltered.slice(0, 10);
  $("#dashListTitle").textContent = listTitle;
  $("#dashRecordCount").textContent =
    listFiltered.length > 10 ? "10 of " + listFiltered.length : listFiltered.length;
  const wrap = $("#dashRecordsList");
  $("#dashRecordsEmpty").classList.toggle("hidden", listFiltered.length > 0);
```

The lines after this block (`wrap.innerHTML = ""` and the `recent.forEach(...)` loop) are unchanged — do not touch them.

Why no guards are needed: `renderDashboard` already resets `drillCategory` when it has no records in range (app.js:948-949) and `selectedSlice` when it's not among the current labels (app.js:980), so every selection state reaching this block is guaranteed non-empty.

- [ ] **Step 2: Verify**

Run: `node --check public/app.js && node tests/run.js`
Expected: clean check, `98/98 passed, 0 failed`

- [ ] **Step 3: Commit**

```bash
git add public/app.js
git commit -m "feat: dashboard recent list follows donut selection (category/sub filter)"
```

---

### Task 2: View-all pill in both dashboard headers (index.html + styles.css)

**Files:**
- Modify: `public/index.html` (two dashboard views)
- Modify: `public/styles.css` (one selector extension + appended block)

- [ ] **Step 1: MuniTrakr dashboard header + remove bottom button**

In `public/index.html`, find (inside `<main id="view-dashboard">`):

```html
    <div class="records-head">
      <h2 id="dashListTitle">Expense Records</h2>
      <span class="muted" id="dashRecordCount">0</span>
    </div>
    <div id="dashRecordsList" class="records-list"></div>
    <div id="dashRecordsEmpty" class="empty hidden">No records here yet. Tap + to add one.</div>
    <button class="btn-primary" id="viewAllBtn" style="width:100%;margin-top:14px">View all records</button>
```

Replace with:

```html
    <div class="records-head dash-head">
      <h2 id="dashListTitle">Expense Records</h2>
      <span class="muted" id="dashRecordCount">0</span>
      <button type="button" class="view-all-btn" id="viewAllBtn">
        View all
        <svg viewBox="0 0 24 24" width="13" height="13"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <div id="dashRecordsList" class="records-list"></div>
    <div id="dashRecordsEmpty" class="empty hidden">No records here yet. Tap + to add one.</div>
```

(The id `viewAllBtn` moves to the pill; the existing listener at app.js:1795 attaches at script load and keeps working. The bottom button is gone.)

- [ ] **Step 2: DebtTrakr dashboard header + remove bottom button**

In `public/index.html`, find (inside `<main id="view-debt-dashboard">`):

```html
    <div id="dbtPersonList" class="dbt-person-list"></div>
    <div id="dbtEmpty" class="empty hidden">No outstanding debts. Tap + to add one.</div>
    <button class="btn-primary" id="viewAllDebtBtn" style="width:100%;margin-top:14px">View all records</button>
```

Replace with:

```html
    <div class="records-head dash-head">
      <h2>People</h2>
      <button type="button" class="view-all-btn" id="viewAllDebtBtn">
        View all
        <svg viewBox="0 0 24 24" width="13" height="13"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <div id="dbtPersonList" class="dbt-person-list"></div>
    <div id="dbtEmpty" class="empty hidden">No outstanding debts. Tap + to add one.</div>
```

(Listener at app.js:5079 keeps working — id moves with the element.)

- [ ] **Step 3: Extend the dashboard header margin selector**

In `public/styles.css`, find:

```css
#view-dashboard .records-head{margin-top:24px}
```

Replace with:

```css
#view-dashboard .records-head,#view-debt-dashboard .records-head{margin-top:24px}
```

- [ ] **Step 4: Append the new styles**

Append at the END of `public/styles.css`:

```css
/* ---- Dashboard list header: title + count left, view-all pill right ---- */
.dash-head { gap: 8px; }
.dash-head h2 { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dash-head .muted { margin-right: auto; flex: 0 0 auto; }
.view-all-btn {
  -webkit-appearance: none; appearance: none;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 12px; border-radius: 999px; flex: 0 0 auto; align-self: center;
  background: var(--card); color: var(--accent);
  border: 1px solid var(--line);
  font-size: 13px; font-weight: 600; line-height: 1;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.view-all-btn:active { transform: scale(.96); }
```

- [ ] **Step 5: Verify nothing else references the old buttons**

Run: `grep -n "viewAllBtn\|viewAllDebtBtn" public/index.html public/app.js public/styles.css`
Expected: exactly four hits — the two new pill buttons in index.html and the two listeners in app.js (~1795, ~5079). No styles.css hits.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/styles.css
git commit -m "feat: view-all pill in dashboard list headers (both modes), drop bottom buttons"
```

---

### Task 3: v70 bump + handover + final verification

**Files:**
- Modify: `public/app.js:6`, `public/sw.js:2`, `handover.md`

- [ ] **Step 1: Lockstep version bump**

`public/app.js` line 6: `const APP_VERSION = "v69";` → `const APP_VERSION = "v70";` (keep the trailing comment).
`public/sw.js` line 2: `const CACHE = "munitrakr-v69";` → `const CACHE = "munitrakr-v70";`

- [ ] **Step 2: handover.md**

1. Header sentence: `Current version: **v69**` → `Current version: **v70**`.
2. §8 lockstep line: `` Current: `v69` / `munitrakr-v69` `` → `` Current: `v70` / `munitrakr-v70` ``.
3. §4 Views — replace the Dashboard bullet:

From:
```markdown
- **Dashboard** — top buttons (Expenses / Investments, year total for selected range), donut chart with two-tap drill (category → subcategory), 10 most recent records of active type, "View all records" button, confirmation banner for pending recurring occurrences.
```

To:
```markdown
- **Dashboard** — top buttons (Expenses / Investments, year total for selected range), donut chart with two-tap drill (category → subcategory), recent-records list (last 10) that follows the chart selection (category or sub-category filter; title shows `Recent: Food / Coffee`), compact "View all" pill in the list header, confirmation banner for pending recurring occurrences.
```

4. §5 DebtTrakr Views — in the Dashboard bullet, replace the trailing `"View all records" button at bottom.` with `"People" header row with a compact "View all" pill.`

- [ ] **Step 3: Full verification**

Run: `node --check public/app.js && node --check public/sw.js && node tests/run.js`
Expected: clean, `98/98 passed, 0 failed`

- [ ] **Step 4: Commit**

```bash
git add public/app.js public/sw.js handover.md
git commit -m "chore: bump to v70 + handover update for dashboard filter/view-all"
```

---

## Manual verification checklist (file:// preview)

1. No selection → list/title/count unchanged from before; pill sits right of the header on both dashboards; no bottom buttons.
2. Tap Food slice → title `Recent: Food`, list shows only Food, count `10 of N` (or `N`).
3. Tap Food again (drills) → list still Food-only.
4. Tap a sub-slice → title `Recent: Food / Coffee`, list narrows; tap the `No Sub-category` slice → only records without a sub.
5. ← Back / tap-to-deselect → unfiltered list returns.
6. Switch Expense↔Investment → resets sanely.
7. Pills navigate: finance → Records view, debt → Debt Records view.
8. Long category name → h2 truncates with ellipsis, pill stays visible.
9. Aero + Yoimiya themes: pill colors come from theme variables.

## Out of scope

- Carrying the filter into the Records view; any Records/Debt-Records page changes.
