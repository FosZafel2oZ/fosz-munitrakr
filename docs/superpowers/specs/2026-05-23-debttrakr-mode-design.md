# DebtTrakr Mode — Design

**Project:** MuniTrakr → adds a sibling mode "DebtTrakr"
**Date:** 2026-05-23
**Status:** Approved (pending user review of this written spec)
**Target version:** `v47` (lockstep `app.js APP_VERSION` and `sw.js CACHE`)

---

## 1. Summary

Add a second mode to the PWA: **DebtTrakr**, a lightweight ledger for IOUs. The app boots into the existing **MuniTrakr** mode by default; the user can switch to DebtTrakr (and back) via a dropdown that opens from the app title in the topbar. The mode choice is per-session — every fresh app launch lands on MuniTrakr.

DebtTrakr tracks two kinds of events per person: **Lend** (I gave them money — they owe me) and **Borrow** (they gave me money — I owe them). Per-person outstanding is the signed net of all Lend/Borrow events. The dashboard shows one card per person with a non-zero outstanding balance, with a repayment progress bar. Tapping a person card drills into a per-person history. Repayments are recorded as ordinary opposite-direction events (no per-record settlement state).

DebtTrakr **shares** most settings with MuniTrakr — theme, currencies, default currency, backup, version — but each mode has its own header icon, its own taxonomy (Categories vs People), and its own records array. The Recurring system is MuniTrakr-only.

---

## 2. Goals & non-goals

**Goals**
- One additional mode in the same PWA, accessible from the topbar.
- Per-person outstanding balances and history.
- Quick repayment entry via a "Match outstanding" shortcut in the Add Debt modal.
- Zero regression on MuniTrakr (dashboard, records, recurring, charts, FX).
- Per-mode header icons.
- Backup/restore covers DebtTrakr data automatically.

**Non-goals (YAGNI)**
- Recurring rules for debts.
- Per-record settlement / partial-payment tracking.
- Donut chart for DebtTrakr dashboard (people cards + bars cover the visualization).
- Date-range filtering on the dashboard (debts are not time-bound — outstanding is outstanding).
- Splitting debts across multiple people.
- "Reminders" / notifications.

---

## 3. Modes & boot behavior

A single in-memory variable `currentMode: "finance" | "debt"` drives the active mode. It is **not persisted** — every fresh boot resets it to `"finance"`. (If we ever want to persist, it can go into `fin_prefs.mode` later. Keeping unpersisted intentionally avoids the "I closed the app while in DebtTrakr and now I'm confused why it opens there" surprise.)

The mode is changed by the function `setMode(next)` which:
1. Updates `currentMode`.
2. Updates the topbar title text (`MuniTrakr` ↔ `DebtTrakr`) and the header icon source (`settings.headerIconFinance` ↔ `settings.headerIconDebt`).
3. Re-renders the active view from scratch (`showView("dashboard")` for the new mode).
4. Hides MuniTrakr-only UI (range dock, Recurring section) and shows DebtTrakr-only UI when applicable, and vice versa.

---

## 4. Data model

### 4.1 Shared (unchanged)
- `store.settings.theme`
- `store.settings.defaultCurrency`
- `store.settings.currencies`
- `store.settings.recurring` (MuniTrakr-only consumer)
- `store.settings.expense`, `store.settings.investment` (MuniTrakr-only)
- `store.records` (MuniTrakr-only)
- `store.profile`

### 4.2 New
```ts
// settings
type Person = {
  id: string;          // stable, e.g. "p_<uuid>"
  name: string;
  color: "#rrggbb";
  icon: string;        // key into the new PEOPLE_ICONS map (see §6.4)
};
store.settings.people: Person[];           // new
store.settings.headerIconFinance: dataURL | null;   // new (replaces existing settings.headerIcon)
store.settings.headerIconDebt:    dataURL | null;   // new

// top-level
type Debt = {
  id: string;                 // "debt_<uuid>"
  type: "lend" | "borrow";    // direction
  personId: string;
  date: "YYYY-MM-DD";
  amount: number;
  currency: string;
  notes: string;
  // FX (filled by attachConversion, same helper MuniTrakr uses)
  convertedAmount?: number;
  convertedCurrency?: string;
  rate?: number;
  rateDate?: string;
  rateUnavailable?: boolean;
  manualRate?: boolean;
  createdAt: number;          // ms (matches records' shape)
  updatedAt: number;          // ms
};
store.debts: Debt[];          // new
```

### 4.3 Migration (in `loadStore`)
- `store.settings.people = store.settings.people || [];`
- `store.debts = store.debts || [];`
- **Header icon split:** if `store.settings.headerIcon` exists and `store.settings.headerIconFinance` is unset, copy it over (the existing icon was uploaded under MuniTrakr-only times). Then delete `store.settings.headerIcon`. `store.settings.headerIconDebt` defaults to `null`.
- All migrations are additive; no destructive changes to existing fields.

---

## 5. Per-person math

For each person `p`:
- `lent  = sum( d.convertedAmount ?? d.amount for d in store.debts where d.personId === p.id && d.type === "lend"   )`
- `back  = sum( d.convertedAmount ?? d.amount for d in store.debts where d.personId === p.id && d.type === "borrow" )`
- `outstanding = lent - back`   (signed; positive = they owe me, negative = I owe them, zero = clear)
- `direction = outstanding > 0 ? "they-owe" : outstanding < 0 ? "i-owe" : "clear"`
- `progress` (0..1, only shown when direction !== clear):
  - if `they-owe`: `clamp(back / lent, 0, 1)` — fraction of what they've paid back of what I've lent.
  - if `i-owe`: `clamp(lent / back, 0, 1)` — fraction of what I've paid back of what I've borrowed.

Display amount uses the **converted amount** when present, so all totals roll up in the user's default currency. This reuses the existing `attachConversion()` pipeline — every saved debt runs through it the same way an expense record does.

Dashboard totals:
- `Total Lend = sum(outstanding) for people with direction = "they-owe"`
- `Total Borrow = -sum(outstanding) for people with direction = "i-owe"`   (shown unsigned)

---

## 6. UI

### 6.1 Topbar
- Title text: `MuniTrakr` in finance mode, `DebtTrakr` in debt mode.
- Title text becomes a tap target — tapping it opens a small dropdown menu (uses the same `.rn-menu` solid-popover style we just hardened). Two rows: **MuniTrakr** and **DebtTrakr**, each with a small icon. Active mode highlighted with accent. Tap a row → `setMode(...)` and dropdown closes.
- Header icon `<img>` element keeps its current shape — only its `src` changes per mode.

### 6.2 DebtTrakr Dashboard (only visible when `currentMode === "debt"`)
Structure (top to bottom):
1. **Summary row** — same `.summary-card` shell as MuniTrakr's dashboard:
   - Left: `Total Lend` (with currency label) + outstanding amount.
   - Right: `Total Borrow` (with currency label) + outstanding amount.
   - No active/highlighted state (no concept of "active type" in debt mode).
2. **People-with-outstanding list** — vertical list of cards. One card per person with `direction !== "clear"`:
   - Left: colored icon tile (24×24, using `person.color` + `person.icon`).
   - Middle: person name (top, bold) + outstanding amount with currency (bottom, color-coded — `--in` for "they owe me", `--out` for "I owe them").
   - Bottom: full-width progress bar — `<div class="dbt-bar"><span style="width:Nx%"></span></div>`. Bar color matches the direction.
   - Whole card is tappable → opens Per-Person History.
3. **Empty state** when no people have outstanding balances: `"No outstanding debts. Tap + to add one."`
4. No range dock, no donut chart, no records list directly on the dashboard.

### 6.3 Per-Person History view
A view that replaces the dashboard contents (or layered above) when a person card is tapped:
- Header: back arrow + person icon + name + outstanding amount with direction-colored color.
- Records list: every debt involving this person, sorted newest-first by `createdAt`.
- Each row: a small direction badge (`Lend` in `--in` color, `Borrow` in `--out` color), amount with original currency on the right, date and notes on the left.
- Tap a row → opens the Add Debt modal in edit mode for that record.
- A `+` FAB pre-fills the person when tapped from this view.

### 6.4 Add Debt modal
A standalone modal `#debtModal` (NOT a reuse of `#modal`, to avoid tangling the existing Add Record code). Fields top-to-bottom:
1. Direction segmented control — `Lend` / `Borrow`. Defaults to `Lend` for a new debt.
2. Amount row — `.amount-input` (currency select + amount input). Same big-font treatment as Add Record.
3. **Match-outstanding chip** — hidden by default. Appears only when (a) a person is selected and (b) that person has `direction !== "clear"`. Shows: `Match outstanding (THB 70)` as an accent-outlined chip. Tapping it:
   - Fills the amount input with the outstanding absolute value.
   - Sets the direction segmented control to the **opposite** of the outstanding (if they owe me, switch to `Borrow` to record their repayment).
4. Date input — defaults today.
5. **Who** picker — same `.picker-btn` + `.picker-menu` component used by Category picker. Menu items: `[colored icon tile] Name`. Below the picker, a `"+ Add new person"` button opens an inline mini-form (name + color + icon) — same vibe as the existing "Add new category" row in Settings. Saving the mini-form creates the person in `store.settings.people` and selects them.
6. Notes (single-line input).
7. Footer: `Delete` (only when editing) + `Save Debt`.

**Validation** (mirrors rule modal):
- Person required (`Person is required.`)
- Amount > 0 (`Amount must be greater than 0.`)

### 6.5 Settings — mode-aware sections
The Settings view layout reorders/conditions sections based on `currentMode`:

**In MuniTrakr mode** (current order, unchanged):
1. Recurring
2. Categories
3. Preferences
4. Currencies
5. Theme  (header-icon upload labelled "Header icon (MuniTrakr)")
6. Backup & Restore
7. App version

**In DebtTrakr mode**:
1. **People** (new)
2. Preferences
3. Currencies
4. Theme  (header-icon upload labelled "Header icon (DebtTrakr)")
5. Backup & Restore
6. App version

The **People** section uses the same drag-reorder + add pattern as Categories: each row shows `[icon tile] Name [edit/delete actions]`. "+ Add a new person" inputs at the bottom of the section. Editing opens an inline editor for name + color picker + icon grid. No subs, no recurring concept here.

### 6.6 People icon library

A new constant `PEOPLE_ICONS` (separate from the existing `ICONS` used for categories) shipped in `app.js`. ~12 simple monochrome SVG paths designed to read at 24×24:

| key | concept |
|---|---|
| `person` | Generic silhouette (default for new people) |
| `man` | Male silhouette |
| `woman` | Female silhouette |
| `child` | Child / kid |
| `elder` | Older adult |
| `couple` | Two figures side by side |
| `family` | Two adults + child |
| `friend` | Two figures + heart |
| `briefcase` | Colleague |
| `graduation` | Classmate |
| `crown` | VIP / boss |
| `star` | Favorite |
| `paw` | Pet |

The icon picker UI for People uses a grid layout identical to the Category icon picker.

---

## 7. Mode-aware behavior summary

| Concern | MuniTrakr | DebtTrakr |
|---|---|---|
| Topbar title | "MuniTrakr" | "DebtTrakr" |
| Header icon source | `headerIconFinance` | `headerIconDebt` |
| Dashboard primary data | records → expense/investment | debts → people |
| Range dock | visible | hidden |
| Donut chart | yes | no |
| FAB → opens | Add Record modal | Add Debt modal |
| Records page | visible (View all records) | hidden |
| Recurring rules | usable | hidden |
| Settings — mode-only sections | Recurring, Categories | People |
| Settings — shared sections | Preferences, Currencies, Theme, Backup, Version | (same) |
| Backup format | unchanged JSON (now includes `debts` + `people` + split header icons) | (same) |
| FX (`attachConversion`) | used | used |
| Multi-select bulk actions | yes | NO (Per-Person History uses inline edit) |
| Confirm banner (recurring) | yes (on dashboard) | hidden in debt mode |

---

## 8. Files touched

**Created**
- (Optional refactor) `public/debts.js` (UMD) — pure helpers: `personBalances(debts, peopleById)` returning `Map<personId, {lent, back, outstanding, direction, progress}>`, `totalsAcrossPeople(balances)` returning `{totalLend, totalBorrow}`. Pure data → unit-testable.
- `tests/debts.test.js` — unit tests for the helpers above.

**Modified**
- `public/index.html` — add Debt modal (`#debtModal`), Add Person mini-form scaffold inside Settings, mode-switcher dropdown markup attached to the topbar title, People section scaffold, separate Header-icon upload controls for the two modes.
- `public/app.js` —
  - `currentMode` state + `setMode(next)` orchestrator
  - Mode-switcher dropdown open/close handlers
  - Migration in `loadStore()` (people array, debts array, header-icon split)
  - DebtTrakr dashboard render (`renderDebtDashboard()`) + per-person card builder
  - Per-Person History view (`renderPersonHistory(personId)`)
  - Add Debt modal: `openDebtModal(debt)`, save handler with match-outstanding logic, person mini-add
  - Settings: `renderPeopleSection()`, mode-aware show/hide of section blocks
  - FAB dispatch — taps route to `openModal(null)` in finance mode, `openDebtModal(null)` in debt mode
  - Header-icon plumbing reads the right field per mode
  - View visibility — DebtTrakr dashboard is a sibling `<main id="view-debt-dashboard">`
- `public/styles.css` — Debt dashboard cards, progress bar, mode-switcher dropdown styling, People icon picker grid (mirroring Categories'), Add Debt modal styles
- `public/sw.js` — bump `CACHE` to `munitrakr-v47`; if `debts.js` is created, add it to `SHELL`

---

## 9. Versioning

- `APP_VERSION`: `v46 → v47`
- `sw.js CACHE`: `munitrakr-v46 → munitrakr-v47`
- Both bumped in lockstep.

---

## 10. Testing

### 10.1 Automated
If `debts.js` is created:
- `personBalances` — empty debts → empty map; single lend → outstanding = +amount; lend + matching borrow → outstanding = 0 (and excluded from card list); mixed lend+borrow across multiple people.
- `progress` calc — clamp to [0,1]; `they-owe` direction; `i-owe` direction; direction flip mid-history.
- `totalsAcrossPeople` — sums by direction, ignores `clear` people.

### 10.2 Manual smoke tests
- Cold boot → lands in MuniTrakr; dashboard renders normally.
- Tap title → dropdown shows; pick DebtTrakr → topbar swaps title + icon, dashboard re-renders to empty state.
- Add a Person from Settings (or from inline mini-form in Add Debt) → appears in picker.
- Add a Lend $100 to that person → dashboard card appears, "they owe you $100", progress 0%.
- Add a Borrow $30 from same person → outstanding becomes $70, progress 30%.
- Add a Borrow $70 more → outstanding $0, card disappears.
- Use "Match outstanding" chip after lending $100 → fills amount $100, flips direction to Borrow.
- Backup → Restore on a fresh device → debts and people persist; both header icons persist.
- Switch back to MuniTrakr — Range dock visible again, recurring banner restored if pending, no leakage of debt UI.
- Theme switches across themes — both modes' dashboards style correctly.

---

## 11. Risks & gotchas

- **Existing `settings.headerIcon` migration**: if a user has a custom MuniTrakr header icon today, it must show up in MuniTrakr after upgrade. Migration in `loadStore()` handles this (copy → delete old field). DebtTrakr will start with the default `./icon.png` until uploaded.
- **FX on debts** uses the same `attachConversion()` as records — same offline / rate-unavailable behavior, same Frankfurter dependency. Direct reuse, no new failure surface.
- **Backup file compatibility**: an old MuniTrakr backup restored on the new version will not have `debts` or `people` — `loadStore()` migrations handle this. A new backup restored on an OLD version will silently ignore the new fields. No corruption risk either direction.
- **Mode dropdown discoverability**: making the title tappable is subtle. Mitigation: a small `▾` chevron rendered after the title text in the topbar so it's visibly interactive.
- **Empty state UX**: someone first opening DebtTrakr will see "No outstanding debts" with no obvious way to add a person. The `+ Add new person` flow inside Add Debt covers this — they tap the FAB, see the picker, hit "Add new person." Documented but worth a manual smoke test.
- **App.js size**: already ~3000 lines. The DebtTrakr code will add several hundred more. Extracting pure debt math to `debts.js` keeps app.js focused; further refactoring (per-view files) is out of scope.

---

## 12. Open questions

None at spec time. All wording, data, and UI decisions were resolved during brainstorming.
