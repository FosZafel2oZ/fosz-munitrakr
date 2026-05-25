# Dashboard Total Buttons — Currency Layout Tweak

**Project:** MuniTrakr
**Date:** 2026-05-21
**Status:** Approved (pending user review of this written spec)
**Target version:** `v32` (lockstep `app.js APP_VERSION` and `sw.js CACHE`) — can ride along with the recurring-records release or ship separately.

---

## 1. Summary

On the dashboard, the two top buttons (`#cardExpense`, `#cardInvest`) currently render the period total as `"THB 1,234,567"` inside a single `<strong>` element. When the number is large, the whole line wraps to two lines.

This change moves the currency code out of the big number and into the small muted label above it, so the layout reads:

```
2026 Expenses · THB
1,234,567
```

The big number stays on one line at any reasonable amount size.

The Records-view buttons (`#recCardExpense`, `#recCardInvest`) are intentionally left untouched.

---

## 2. Goals & non-goals

**Goals**
- Stop the big-number line from wrapping when the total grows.
- Keep currency visible on the button without losing information.
- Stay within the existing layout — no new CSS rules.

**Non-goals**
- Changing the donut chart center total (`#chartTotal`).
- Changing per-record currency display in the records list.
- Changing the Records-view summary buttons.
- Changing the shared `fmt()` helper (it already handles the no-currency case).

---

## 3. Change

### 3.1 File: `public/app.js` (dashboard render path, currently lines 777–780)

```js
// Before
$("#sumExpense").textContent = fmt(yearTotal("expense"), cur);
$("#sumInvest").textContent  = fmt(yearTotal("investment"), cur);
$("#cardExpense .muted").textContent = yr + " Expenses";
$("#cardInvest .muted").textContent  = yr + " Investments";

// After
$("#sumExpense").textContent = fmt(yearTotal("expense"));        // no currency arg
$("#sumInvest").textContent  = fmt(yearTotal("investment"));     // no currency arg
$("#cardExpense .muted").textContent = yr + " Expenses"   + (cur ? " · " + cur : "");
$("#cardInvest .muted").textContent  = yr + " Investments" + (cur ? " · " + cur : "");
```

### 3.2 Files NOT changed

- `public/index.html` — no markup change needed; same elements, different text content.
- `public/styles.css` — no style change; existing flex layout absorbs both shifts.
- `app.js` records-view render path (lines 990–993) — left as-is per scope.
- `app.js` `fmt()` helper — already returns the bare number when `cur` is omitted (`cur ? cur + " " + s : s`), so it works as-is.

### 3.3 Edge cases

- **No currency available** (e.g. brand-new install, no records yet): `cur` is falsy → the muted line falls back to plain `"2026 Expenses"` / `"2026 Investments"` with no dangling `· undefined`.
- **Mixed currencies in the period**: `primaryCurrency(list)` continues to determine which currency is shown — unchanged behavior.
- **Year text in Thai-locale buddhist year**: the muted-line width grows by ~5–8 characters from adding `· THB`. At 320px width with two buttons side by side this still fits without wrapping; if a future locale change makes it tight, the muted line can wrap onto two lines and the big number stays single-line, which is still better than today.

---

## 4. Versioning

Bump `APP_VERSION` in `app.js` and `CACHE` in `sw.js` (`v31 → v32`) when shipping. If shipped together with the recurring-records release, the bump happens once for both.

---

## 5. Testing

Manual smoke test on localhost and iOS PWA:

1. **Large total** — add (or temporarily edit) records to push the year total past 7 digits. Confirm the big number stays single-line on iPhone-width.
2. **Small total / fresh install** — wipe localStorage, open the app. Confirm muted line reads `"2026 Expenses"` (no `· undefined`).
3. **Currency switch** — change default currency in Settings. Confirm the suffix updates on next render.
4. **Records view untouched** — switch to Records view, confirm `#totExp`/`#totInv` still render with currency in the big number as before.

No unit tests needed — change is a string-concat tweak in a render function.

---

## 6. Risks

Essentially none. The two `<strong>` elements get shorter text, the two `<span class="muted">` elements get slightly longer text. Existing flex layout absorbs both. No CSS, no markup, no helper changes.
