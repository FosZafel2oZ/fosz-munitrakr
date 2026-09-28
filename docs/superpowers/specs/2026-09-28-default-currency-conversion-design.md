# Default-currency change: convert-or-exclude (v86) — design

Status: draft for Bill's review (2026-09-28).

## Problem

Every foreign-currency record (`store.records`) and debt (`store.debts`) is converted into
`settings.defaultCurrency` once, at save time, and the result is stored (`convertedAmount`,
`convertedCurrency`, `rate`, `rateDate`, `fxMarkupPct`, legacy `manualRate`; or `rateUnavailable: true` when
offline). Changing the default currency never touches existing items, so afterwards totals, charts, debt
balances, statements and share cards silently add amounts that are in different currencies. Separately, a
`rateUnavailable` item is counted today at its raw number (USD 100 counted as ฿100).

## What Bill asked for

- Changing the default currency asks whether to convert the old items.
- **No** → the default still changes; items not in the new currency are **left out of every total** —
  including debt balances (Bill chose this explicitly over "debts always convert").
- A way to convert later must always exist: Settings → Currencies keeps a notice with the count and a
  Convert button.

## 1. The counting rule (one definition)

`amountInDefault(item, def)` — pure, in `public/finance-helpers.js`, the ONLY definition in the codebase:

- `item.currency === def` → `Number(item.amount)`
- else `item.convertedCurrency === def && item.convertedAmount != null` → `Number(item.convertedAmount)`
- else → `null` = **not counted**

An item with `null` is "not counted". This covers both the default-change leftovers and offline
`rateUnavailable` items. Switching back to the old default makes its items count again automatically — no flag
is stored anywhere; "not counted" is always derived.

`debts.js` and `debt-card.js` must use this same function (browser: global, since `finance-helpers.js` loads
first; Node: `require("./finance-helpers")` inside their UMD wrapper). The existing local `amountInDefault` in
`debt-card.js` (whose last branch falls back to a stale amount) is deleted.

Also pure in `finance-helpers.js`: `countNotCounted(items, def)` → number of items with `null`.

## 2. Every total skips not-counted items

Sites (file:line as of v85; implementers re-locate by name):

**MuniTrakr (records)**
- `dispAmt`/`dispCur` (app.js ~825) — replaced for sums by `amountInDefault(r, def)`; `sum()` / `yearTotal()`
  (~834–844) → dashboard `#sumExpense`/`#sumInvest` and Records `#totExp`/`#totInv`.
- Category chart groups, sub-category groups and chart total in `renderDashboard` (~973, ~982, ~991).

**DebtTrakr (debts)** — these debts.js functions gain a `defaultCurrency` parameter and use
`amountInDefault`, skipping `null` items entirely (they don't move the balance and don't take part in the
cycle/settlement math):
- `personBalances` → Total Lend/Borrow (debt dashboard + All Debt Records), people list, person-history
  Outstanding, Match-outstanding button.
- `annotateSettlements` → "Settled" badges.
- `balanceBefore`, `balanceAfterRecord` → Add Debt / split / paid-by netting, overshoot, share footers.
- `wouldOvershoot`, `planSplit`, `planPaidBy` — their reads of the entered/edited item's amount use
  `amountInDefault` too (a freshly saved item is always converted to the current default or in it, so this
  only matters for edits of old items).
Every caller in app.js passes `store.settings.defaultCurrency || "THB"`.

**Share images (debt-card.js)** — `debtCardModel` footer math and `statementModel` rows/net/subtotal/footer use
the shared `amountInDefault`.

Out of scope (not totals of stored items): split-bill share validation (same currency by construction),
recurring-rule rows and the confirmation banner (show the rule's own amount, unconverted).

## 3. How not-counted items look

- **Rows** — records list (`recordCardHTML`), All Debt Records rows, person-history rows: a not-counted item
  shows its **original** amount and currency (never a stale converted number) with the existing small warning
  sub-line style, text `not counted · not in USD` (USD = current default). This replaces today's
  `· rate n/a` line for those items.
- **Screen warning** — one small tappable line, same style on every screen that shows a total, only when the
  count > 0: `N records not counted — not in USD. Convert` (singular `1 record`). Tapping opens Settings and
  scrolls to the Currencies block. Placement and count scope:
  - MuniTrakr dashboard (under the Expense/Investment cards) — count of records.
  - Records page (under its total cards) — count of records.
  - Debt dashboard (under Total Lend/Borrow) — count of debts.
  - All Debt Records (under its total cards) — count of debts.
  - Person history (under Outstanding) — count of that person's debts.
- **Sharing** — a single debt card or a statement that includes a not-counted debt is refused with a visible
  message: `This record isn't in USD yet, so its balance can't be shown. Convert it in Settings → Currencies
  first.` (statement: `N selected records aren't in USD yet …`). This replaces the statement's current
  "no exchange rate" alert; the single card gets the guard for the first time.

## 4. Settings → Currencies notice

When the count of not-counted records + debts > 0, a notice block sits at the top of the Currencies block:

`12 records and 3 debts aren't in USD, so they're left out of totals.` + a full-width `Convert now` button +
its own message line. Counts use the same singular/plural rules; a zero part is omitted ("3 debts aren't…").
The notice disappears when the count reaches 0. It is re-rendered whenever Settings opens and after every
currency save or conversion.

## 5. Changing the default currency

Either Save that can change the default (`#saveDefCurrency`, and `#saveCurrencies`, which also carries the
select's value) behaves as today, and then — only if the default actually changed AND the not-counted count is
> 0 — opens an in-app confirm modal built like the existing "Backfill past records?" / "Split into 2 records?"
modals:

- Title `Convert old records to USD?`
- Body `12 records and 3 debts are in other currencies. Convert them using each record's own date's exchange
  rate? This needs internet. If you skip, they're left out of totals until you convert them in Settings →
  Currencies.`
- Buttons `Convert` (primary) and `Not now`.

`Not now` closes the modal; the Settings notice (section 4) shows. `Convert` runs section 6. Both Save handlers
also re-render the debt views (today they only refresh the MuniTrakr side).

## 6. Converting (all or nothing)

A pure planner in `finance-helpers.js`, e.g. `planReconversion(items, def, getRate, currentMarkupPct)`, returns
either `{ ok: true, updates }` (new conversion fields per item id) or `{ ok: false, failed: n }`. It never
mutates the input. The app then writes ALL updates in one `saveStore()`, or writes NOTHING.

Per not-counted item:
- **Legacy manual-rate item** (`manualRate` true, has `convertedAmount` in some other currency X): chain —
  `convertedAmount × rate(X → def, item date)`, rounded to cents; keeps the user-typed charge.
  Fields afterwards: `convertedCurrency = def`, `convertedAmount`, `rate = convertedAmount / amount` (to 10
  significant digits), `rateDate`, `manualRate: true`, no markup.
- **Any other item**: same maths as saving it today (`attachConversion` logic): rate(item currency → def,
  item date) with markup = the item's own stored `fxMarkupPct` if it was converted before, else the current
  `settings.fxMarkupPct`. Clears `rateUnavailable`.
- Items whose currency equals the new default are already counted — never touched.

Rates come from the existing rate service (`getRate`, cached per `date:from:to` in memory + `fin_rates`), fetched
with at most 6 requests in flight. Any `null`/throw → the whole run fails, nothing is written, and the Settings
message line (and the modal, if open) shows `Couldn't get exchange rates for N records — check your connection
and try again.` During the run the button shows `Converting… 40 / 120` and is disabled. Success message:
`Converted 12 records and 3 debts to USD.`

Recurring rules are untouched (they convert when they generate a record).

## 7. Testing

Node tests (the app.js UI has no harness; keep logic in the pure modules):
- `amountInDefault`, `countNotCounted`: in-default, converted-to-default, converted-to-other (stale),
  `rateUnavailable`, missing fields.
- debts.js: every changed function with a stale `convertedCurrency` item (skipped) next to counted ones;
  existing "uses convertedAmount" tests updated to pass `defaultCurrency`.
- debt-card.js: `statementModel` / `debtCardModel` with the shared helper; the deleted local helper's cases move.
- `planReconversion`: success (normal, markup kept, markup from settings for never-converted, manual-rate
  chain), any failure → `ok:false` + count and no updates, items already in default ignored, input not mutated.
Headless-Edge screenshots (375px, three themes) in `C:\Users\FosZ-Desktop\Desktop\mockups\currency\`: the
confirm modal, the Settings notice, a not-counted row + screen warning on the dashboard and debt dashboard, and
the success/failure messages.

## 8. Release

v86: bump `APP_VERSION` (`public/app.js` line 6) and `CACHE` (`public/sw.js` line 2); refresh `handover.md`
(Currency & FX section, data-flow notes, debts.js signatures, gotchas: "not counted" is derived, never stored).

## Not included

- Converting recurring rules' amounts.
- Automatic background retry of not-counted items.
- Per-currency sub-totals (showing several currencies side by side).
