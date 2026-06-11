# Dashboard Chart-Filtered Recent List + Relocated View-All — Design

**Date:** 2026-06-11
**Status:** Approved
**Target version:** v70

## Summary

Two related MuniTrakr dashboard changes, plus a consistency change in DebtTrakr:

1. The "Recent … Records" list under the donut follows the chart selection
   (category tap, drill-in, sub-category tap) instead of always showing the
   last 10 of the active type.
2. The full-width "View all records" button at the bottom of each dashboard
   moves into the list header row as a compact pill.

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Filter depth | Full depth: category tap → category filter; drilled → category filter; sub-slice tap → sub-category filter; deselect/back → unfiltered. |
| Button placement | List header row, right side; compact pill; bottom button removed entirely. |
| DebtTrakr | Same treatment: new "People" header row above person cards with the same pill; bottom button removed. |
| Title format | `Recent Expense Records` (unfiltered) → `Recent: Food` → `Recent: Food / Coffee`. |
| Pill wording | `View all` + inline-SVG right chevron (no unicode arrows — iOS emoji rule). |

## A. Recent list follows chart selection

In `renderDashboard` (public/app.js, "10 most recent of the active type" block),
derive the list from the existing selection state — no new state variables:

```js
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
```

- `#dashListTitle` shows `listTitle`.
- `#dashRecordCount` shows `10 of N` when `listFiltered.length > 10`, else
  `listFiltered.length`.
- `#dashRecordsEmpty` toggles on `listFiltered.length` (selection states can
  never produce an empty filtered list — slices only exist for records in
  range — but the guard is kept consistent anyway).
- Row click → `openModal(r)` unchanged. Existing deselect mechanics
  (`sliceTap`, `#chartBack`, stale-selection resets at the top of
  `renderDashboard`) need no changes.

## B. View-all pill in the header row

### MuniTrakr dashboard (index.html `#view-dashboard`)

Header row becomes title + count left, pill right:

```html
<div class="records-head dash-head">
  <h2 id="dashListTitle">Expense Records</h2>
  <span class="muted" id="dashRecordCount">0</span>
  <button type="button" class="view-all-btn" id="viewAllBtn">
    View all
    <svg viewBox="0 0 24 24" width="13" height="13"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
</div>
```

The old `<button class="btn-primary" id="viewAllBtn" …>View all records</button>`
below the list is deleted. The id moves with the new element, so the existing
`$("#viewAllBtn").addEventListener("click", () => showView("records"))`
listener keeps working untouched.

### DebtTrakr dashboard (index.html `#view-debt-dashboard`)

New header row inserted above `#dbtPersonList`:

```html
<div class="records-head dash-head">
  <h2>People</h2>
  <button type="button" class="view-all-btn" id="viewAllDebtBtn">
    View all
    <svg viewBox="0 0 24 24" width="13" height="13"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
</div>
```

Old bottom `#viewAllDebtBtn` deleted; listener untouched (id moves).

### CSS (styles.css)

```css
.dash-head { gap: 8px; }
.dash-head .muted { margin-right: auto; }
.view-all-btn {
  -webkit-appearance: none; appearance: none;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 6px 12px; border-radius: 999px; flex: 0 0 auto;
  background: var(--card); color: var(--accent);
  border: 1px solid var(--line);
  font-size: 13px; font-weight: 600; line-height: 1;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.view-all-btn:active { transform: scale(.96); }
```

`.records-head` is already `display:flex; align-items:baseline;
justify-content:space-between` — `.dash-head .muted { margin-right:auto }`
plus `gap` clusters title+count left and pushes the pill right. The pill gets
`align-self: center` (add to `.view-all-btn`) so it doesn't sit on the text
baseline.

The `#view-debt-dashboard` header needs the same top spacing as the finance
one: extend the existing selector at styles.css ~line 302 to
`#view-dashboard .records-head, #view-debt-dashboard .records-head { margin-top: 24px }`.

## Long-name overflow

`listTitle` can be long (`Recent: Transportation / Motorcycle Taxi`). The h2
must not push the pill off-screen: add `min-width:0; overflow:hidden;
text-overflow:ellipsis; white-space:nowrap` to `.dash-head h2` so it truncates.

## Tests & release

- Render/DOM logic only — no pure-module change, no new unit tests. The
  existing 98 must stay green (`node tests/run.js`).
- Lockstep bump to **v70** (`APP_VERSION` + `CACHE`).
- handover.md: version, §4 Views bullet for the dashboard (filter behavior +
  header pill), DebtTrakr §5 dashboard bullet (header pill).

## Manual checklist

1. No selection → unchanged list, title `Recent Expense Records`, pill right.
2. Tap Food → list = last 10 Food, title `Recent: Food`, count `10 of N`.
3. Tap Food again (drill) → list still Food-filtered.
4. Tap a sub-slice → list narrows, title `Recent: Food / Coffee`.
5. Tap the "No Sub-category" slice → only records without a sub.
6. ← Back / deselect → unfiltered list returns.
7. Switch Expense↔Investment cards → filter resets sanely (existing reset).
8. Pill navigates to Records view; DebtTrakr pill to debt records.
9. Long category name truncates with ellipsis; pill stays visible.
10. All three themes look right (pill uses theme variables).

## Out of scope

- Carrying the dashboard filter into the Records view.
- Any change to the Records / Debt Records pages themselves.
