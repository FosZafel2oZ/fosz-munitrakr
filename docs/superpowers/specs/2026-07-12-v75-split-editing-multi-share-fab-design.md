# v75 — Split UX polish, DebtTrakr multi-share, floating-button position

Date: 2026-07-12
Status: approved (requirements specified verbatim by user; non-interactive session)

Four independent changes, one release (v75):

1. Split the bill: auto-scroll when a participant is added
2. Split the bill: the user's own share becomes editable
3. DebtTrakr All Records: share multiple selected records at once (chronological)
4. DebtTrakr: floating buttons sit lower (no range dock in debt mode)

---

## 1. Auto-scroll on participant add

**Now:** checking "Split the bill" scrolls `#recordForm` to the bottom
(`wireSplitSection`, app.js ~2373). Picking a person from the "+ Add person"
menu does not scroll, so the newly added row can land off-screen.

**Change:** extract the two-line scroll into a helper:

```js
function scrollSplitIntoView() {
  const form = document.getElementById("recordForm");
  if (form) form.scrollTo({ top: form.scrollHeight, behavior: "smooth" });
}
```

Call it from:
- the existing split-toggle `change` handler (replaces the inline code),
- `buildSplitPersonMenu`'s option click handler after `renderSplitRows()`
  (person picked from menu),
- the inline new-person save handler after `renderSplitRows()` (person
  created via "+ New person").

No scroll on remove or on "Split evenly" (list doesn't grow).

## 2. Editable self-share

**Now:** the "(you)" row renders a fixed `<span id="splitMyAmt">` showing
`splitMyShare()` = total − sum(others). Only participants' inputs are editable.

**Change — auto/manual model:**

- The "(you)" row renders a number input (`.split-amt` + `.split-amt-me`,
  `id="splitMyAmt"`, same `inputmode/step/min/placeholder` as participant
  inputs). No remove button, keeps the "(you)" label. Plain number, no
  currency suffix (matches participant inputs).
- New module-level flag `splitMineManual = false`.
  - **Auto (default):** input value live-tracks the remainder exactly as the
    span did (`updateSplitMyAmt` writes `input.value`; `.neg` class when
    negative).
  - Typing in the input sets `splitMineManual = true`; from then on
    `updateSplitMyAmt` leaves the value alone.
  - Clearing the field (empty string) resets `splitMineManual = false` and
    refills with the remainder.
- `splitMyShare()` returns the manual value (rounded to cents) when
  `splitMineManual`, else the remainder. All downstream code (render, note
  breakdown, `payload.amount`) is unchanged.
- "Split evenly" resets `splitMineManual = false` (mine returns to
  auto-remainder, which equals `shares[0]` by construction).
- Flag resets to `false` everywhere `splitPeople` is reset: modal open/reset
  (~2191) and both clear paths in `syncSplitSection`.
- **Save validation** (submit handler, ~2460): keep existing checks (≥1
  person, every participant share > 0, mine ≥ 0). Add: mine + sum(others)
  must equal the total to the cent, else error
  `"Shares must add up to the total (off by X.XX)"`. In auto mode this holds
  by construction; only a manual edit can trip it.

CSS: `.split-amt-me` reuses `.split-amt` styling; keep the `.neg` red color
rule working on the input.

## 3. Multi-select share in All Debt Records

**Now:** each row has a share button (hidden in multi-select mode) that
exports one Aero-style PNG via `shareDebtRecord(debt)` →
`renderDebtCard(...)` → `navigator.share({ files: [file] })`.

**Change:**

- **HTML:** add `#dbtMsShare` to `#dbtMultiBar` between Cancel and Delete —
  same `.ms-btn` styling, same upload/share SVG used by the per-row
  `.dbt-share` button, `disabled` by default, `aria-label="Share selected"`.
- **JS:** generalize `shareDebtRecord` into `shareDebtRecords(debts)`:
  - `loadStore()` once; build `peopleById` once.
  - Sort a copy chronologically **ascending** — `date` asc, tiebreak
    `createdAt` asc (oldest first, newest last; the inverse of the list's
    display sort).
  - Render blobs **sequentially** (`for … await`) to bound canvas memory.
    `balanceBefore` is computed from the full store per record, so results
    are order-independent.
  - Filenames: single record keeps the existing
    `debt-<name>-<date>.png`; multiple records get a 1-based, zero-padded
    index prefix `debt-01-<name>-<date>.png` so receivers that sort by name
    preserve chronology.
  - One `navigator.share({ files })` with ALL files (iOS 15+ supports
    multi-file). `AbortError` → return silently. `canShare` false or share
    throwing (non-abort) → `_downloadBlob` each file, oldest first.
  - If any card render throws → same alert as today, abort the whole share.
  - `shareDebtRecord(d)` becomes `shareDebtRecords([d])` (thin wrapper) so
    the two existing per-row call sites are untouched.
- **Wiring:** `#dbtMsShare` click → `lastDbtRows.filter(r =>
  debtSelected.has(r.id))` → `shareDebtRecords(sel)`. Stays in multi-select
  with selection intact (share is non-destructive).
  `dbtUpdateSelUI` toggles `disabled` like the delete button.

## 4. Lower floating buttons when the range dock is absent

**Now:** `.fab` sits at `bottom: calc(87px + var(--safe-b))` and `.multi-bar`
at `calc(94px + var(--safe-b))` — sized to clear the bottom range dock. The
dock is hidden in all debt-mode views (`showView`, ~1532), so in DebtTrakr
the buttons float ~60px too high.

**Change:**

- In `showView`, mirror the dock's hidden condition onto a body class:
  ```js
  const dockHidden = v === "settings" || v === "person-history" ||
                     v === "debt-records" || onDebtMode;
  document.getElementById("rangeDock").classList.toggle("hidden", dockHidden);
  document.body.classList.toggle("no-dock", dockHidden);
  ```
- CSS (base styles, theme-independent):
  ```css
  body.no-dock .fab{bottom:calc(24px + var(--safe-b))}
  body.no-dock .multi-bar{bottom:calc(28px + var(--safe-b))}
  ```
  (Keeps the two centers aligned like today: 87+29≈94+26, 24+29≈28+26.)
- `fab-raised` only applies with the custom-range dock (finance mode), so no
  interaction. Finance settings gets `no-dock` too but the FAB is hidden
  there — harmless.

## Non-goals

- No change to MuniTrakr records multi-select bar behavior.
- No change to the PNG card design or `renderDebtCard`.
- No new unit-testable pure logic → test count stays 107.

## Release

Bump `APP_VERSION` (app.js) and `CACHE` (sw.js) to v75 in lockstep.
Verify: `node --check public/app.js && node --check public/sw.js` and
`node tests/run.js` → 107/107. Commit on `main`; push only when the user
says so.
