# MuniTrakr / DebtTrakr — Handover

A 100% offline static PWA with two modes:
- **MuniTrakr** — expense & investment tracker
- **DebtTrakr** — per-person IOU ledger

Vanilla JS + CSS + Chart.js (vendored). No backend, no build step. All data lives in `localStorage`. Deployed at **https://fosz-munitrakr.pages.dev** (Cloudflare Pages, auto-deploys on push to `main`). Source: **https://github.com/FosZafel2oZ/fosz-munitrakr**. Current version: **v87**.

---

## 1. Architecture & files

```
ProjectExpenses/
├─ public/                         <— THIS folder is the deployable PWA
│  ├─ index.html                   markup for all views + modals
│  ├─ app.js                       all client logic (~5,950 lines, single file)
│  ├─ recurring.js                 UMD: cadence math + rule helpers (pure)
│  ├─ debts.js                     UMD: per-person balance math + cycle reset (pure); every balance function counts only items in the default currency (via `amountInDefault`)
│  ├─ debt-card.js                 UMD: share-card model (pure) + canvas renderer (uses the shared `amountInDefault`)
│  ├─ finance-helpers.js           UMD: reconcileRenames + FX rate service factory + the default-currency counting rule (`amountInDefault`), reconversion planner, and the Summary page's `summarizeTotals` / `summaryAverage` / `yearsAverage`
│  ├─ styles.css                   all styles incl. per-theme overrides
│  ├─ sw.js                        service worker (stale-while-revalidate)
│  ├─ manifest.webmanifest         PWA manifest — icon entries point at icon-wallet.png only
│  ├─ icon-wallet.png              Wallet icon (512×512) — default favicon/apple-touch-icon/manifest icon; also the default Wallet tile for the home-screen icon picker and the MuniTrakr header-icon picker
│  ├─ icon-wallet-red.png          Rose wallet icon (512×512) — the default Wallet tile for the DebtTrakr header-icon picker only (caption is still "Wallet")
│  ├─ icon.png                     Yoimiya icon — the Yoimiya tile shared by all three icon pickers (home-screen icon and both header icons); no longer any picker's default
│  ├─ icon.svg                     old "₿" icon — dropped from the manifest, but the file still exists and is still cached in sw.js's SHELL
│  ├─ chevron.svg / chevron-dark.svg   white/dark select arrows
│  └─ vendor/chart.umd.min.js      Chart.js (vendored for offline)
├─ design/
│  ├─ icon-wallet.svg              source drawing for icon-wallet.png — not deployed, not read by the app
│  └─ icon-wallet-red.svg          source drawing for icon-wallet-red.png — not deployed, not read by the app
├─ tests/                          node tests/run.js — 277 unit tests
│  ├─ run.js                       runner
│  ├─ _lib.js                      test() + assert helpers (async-aware)
│  ├─ recurring.test.js            cadence + rule logic
│  ├─ finance-helpers.test.js      reconcileRenames + FX caching + iconHref/homeIconHref/effectiveIconChoice/headerIconHref/iconChoiceFromPicture/migrateIconChoices + amountInDefault/countNotCounted/applyMarkup/clearConversionFields/planReconversion/reconversionMarkupPct/dedupeGetRate/mapLimit + summarizeTotals/summaryAverage/yearsAverage
│  ├─ debts.test.js                personBalances + cycle reset + settlements (incl. not-counted items skipped, cent-exact closure) + planDebtReconversion
│  └─ debt-card.test.js          share-card model wording + balance math
├─ serve.js                        zero-dep static server (local preview)
├─ docs/superpowers/               specs + plans archive
└─ HANDOVER.md                     this file
```

- **No backend, no auth.** Everything runs in the browser; data lives in `localStorage`.
- **Local preview:** `npm start` → http://localhost:3000.
- **Deploy:** `git push origin main` → Cloudflare Pages auto-pulls and rebuilds. SW auto-updates on next open. (No manual upload needed — the live site at `fosz-munitrakr.pages.dev` mirrors `main`.)
- **Tests:** `node tests/run.js` → must print `277/277 passed, 0 failed`.

---

## 2. Modes

A single in-memory `currentMode: "finance" | "debt"` drives which UI surfaces are active. Mode is **not persisted** — every fresh boot lands on MuniTrakr. Tap the topbar title or header icon to toggle modes (no dropdown).

`showView()` enforces mode-compatibility: requesting a debt-only view (`person-history`, `debt-records`) while in finance mode auto-redirects to dashboard (and vice versa for the finance-only views `records` and `summary`). Prevents orphaned states on app reopen.

---

## 3. Data model (localStorage `fin_store`)

```ts
{
  profile: { displayName: "Me" },          // displayName unused in UI
  settings: {
    // Shared between modes
    theme: "default" | "aero" | "yoimiya",
    defaultCurrency: "THB",
    currencies: ["THB","USD","EUR",...],   // user-editable, ISO-validated
    headerIconFinance: dataURL | null,     // MuniTrakr header's uploaded picture only (160×160 PNG); default null
    headerIconDebt:    dataURL | null,     // DebtTrakr header's uploaded picture only (160×160 PNG); default null
    headerIconFinanceChoice: "wallet" | "yoimiya" | "custom",  // default "wallet"; which MuniTrakr header tile is picked
    headerIconDebtChoice:    "wallet" | "yoimiya" | "custom",  // default "wallet"; which DebtTrakr header tile is picked (its "wallet" is the rose PNG)
    homeIcon: "wallet" | "yoimiya" | "custom",  // default "wallet"; picks the apple-touch-icon
    homeIconCustom: dataURL | null,        // "custom" pick's uploaded picture (180×180 PNG); default null
    fxMarkupPct: number,                   // global card FX markup % applied to fetched rates

    // MuniTrakr-only
    expense:    Category[],
    investment: Category[],
    recurring:  Rule[],

    // DebtTrakr-only
    people:     Person[],
  },
  records: Record[],                       // MuniTrakr — expense/investment events
  debts:   Debt[],                         // DebtTrakr — Lend/Borrow/Paid-back events
}

type Category = { id, name, color, icon, subs: { id, name, color }[] }

type Record = {
  id, userId?, type: "expense"|"investment",
  category, subcategory, date: "YYYY-MM-DD",
  amount, currency, notes,
  convertedAmount?, convertedCurrency?, rate?, rateDate?,
  rateUnavailable?, manualRate?, fxMarkupPct?,
  ruleId?,                                 // set when generated by a recurring rule
  createdAt: number, updatedAt: number,    // ms; numeric, sorted by this
}

type Rule = {                              // recurring (MuniTrakr only)
  id, type, category, subcategory, amount, currency, notes,
  cadence: { kind: "daily"|"weekly"|"monthly"|"yearly", weekday?, dayOfMonth?, month?, day? },
  startDate, endDate?, maxOccurrences?, occurrenceCount,
  autoConfirm: bool, paused: bool, lastGeneratedDate?,
  createdAt, updatedAt,
}

type Person = { id, name, color, icon }    // icon key into PEOPLE_ICONS map

type Debt = {
  id, type: "lend"|"borrow"|"paid-back"|"pay-back",  // pay-back is math-identical to lend; borrow/paid-back to each other
  personId, date: "YYYY-MM-DD",
  amount, currency, notes,
  convertedAmount?, convertedCurrency?, rate?, rateDate?,
  rateUnavailable?, manualRate?, fxMarkupPct?,
  createdAt: number, updatedAt: number,
}
```

Migrations in `loadStore()` cover: array defaults (`people`, `debts`, `recurring`), legacy `headerIcon` → `headerIconFinance` split, and one call to `migrateIconChoices(store.settings)` (`finance-helpers.js` — mutates and returns its argument) that normalizes `headerIconFinanceChoice` / `headerIconDebtChoice` / `homeIcon` / `homeIconCustom` together: a missing/invalid header choice becomes `"custom"` when that header's stored picture is a `data:image/` string, else `"wallet"` (so a header that was never touched switches from the old implicit Yoimiya default to Wallet), `homeIcon` is coerced to one of the three known values (default `"wallet"`) and `homeIconCustom` defaults to `null`. Separately, `loadStore()` also walks `store.records` doing its own numeric coercion of any stale string `createdAt` / `updatedAt` — that step is unrelated to `migrateIconChoices`, which only touches `store.settings`.

---

## 4. MuniTrakr — features

### Views
- **Dashboard** — top buttons (Expenses / Investments, year total for selected range), donut chart with two-tap drill (category → subcategory), recent-records list (last 10) that follows the chart selection (category or sub-category filter; title shows `Recent: Coffee`), compact "View all" pill in the list header, confirmation banner for pending recurring occurrences.
- **Records** — full bulk list filtered by range. Filter button → multi-select category filter. Multi-select mode: Cancel / Change Category / Delete / Switch Type / Select-all.
- **Summary** (`#view-summary`, MuniTrakr only) — spent (expenses) vs invested (investments) per month of one year, or per year. `summary` is in `showView`'s `FINANCE_ONLY` set, so a persisted `summary` view reopened in DebtTrakr mode falls back to the dashboard; the range dock is hidden on it (as on Settings). Title `Summary`, then a `Months` | `Years` segmented toggle (`#sumSeg`) whose last choice is `summaryMode`, remembered per device in `fin_prefs`.
  - **Months:** a year selector (`#sumYearSel`, `‹ 2026 ›`) steps from `firstYear` to `lastYear` of `summarizeTotals` (the first year with a counted record … max(current year, last counted record year)); the arrow at either end of that range is disabled. It opens on the current year (`enterSummary()` resets `summaryYear`), and the shown year is clamped into the range because every counted record can be future-dated. Rows are Jan–Dec; the table header reads `Month · Spent · Invested`.
  - **Years:** the selector is hidden; one row per year, `firstYear`…`lastYear`; header `Year · Spent · Invested`.
  - **Common:** two read-only total cards (`.summary-card.sum-card`, red `--out` spent / green `--in` invested, labelled `2026 spent` / `2026 invested` or `All years spent` / `All years invested`) in the default currency; the shared `.nc-warn` (`#sumNcWarn`, the count of not-counted records over the whole store) sits under them; then the table. The spent number is right-aligned and the invested number left-aligned so they meet in the middle, with a translucent bar behind each (`--out-bar` growing left, `--in-bar` growing right; width = value ÷ the largest single spent-or-invested value in the table). Zero shows a dim `–`; a row with both zero is dimmed; the current month (in the current year) / current year row has the `--accent-soft` background. Amounts and the totals shrink their font to fit (`fitInside`).
  - **Average line** (`#sumAvg`, centred, muted, hidden when the store has no records at all): Months → `Average per month: <money> spent` (`summaryAverage`: the year's spent total ÷ the current month number for the current year, ÷ 12 for any other year); Years → `Average per year: <money> spent` (`yearsAverage` over the years shown). No invested averages.
  - **Counting:** every figure comes from `summarizeTotals(records, def, currentYear)` (`finance-helpers.js`), which reads each record through `amountInDefault` — not-counted records are left out (and flagged by the warning). Records whose date isn't `YYYY-MM-DD` with month 01–12, whose type isn't `expense`/`investment`, or whose amount isn't finite are skipped. Sums are rounded to cents.
  - **Not included:** tapping a row to filter records, DebtTrakr summaries.
- **Top-bar buttons.** Two floating buttons: `#settingsBtn` (gear) and, immediately left of it, `#summaryBtn` (bar-chart icon, `aria-label="Summary"`, same `.float-btn` look). `updateSettingsBtn()` shows `#summaryBtn` only in MuniTrakr mode and never on Settings. On the Summary page the chart button is lit (`.is-on`: accent colour + border, `aria-pressed` kept in sync by `updateSettingsBtn()`) and `#settingsBtn` becomes the Back arrow (`.is-back`, aria-label "Back"); both buttons return to `summaryPrev`, the view the chart button was tapped from (`enterSummary()` records it; a stored `summary` or `settings` there falls back to the dashboard). `.topbar` has `padding-right: 118px` and the date subtitle ellipsises, so neither button covers it. The date uses `weekday: "short"` ("Wed, September 30, 2026") so the longest case fits at 375px without ellipsis. The Months/Years buttons carry `aria-pressed` (synced in `renderSummary()`) and `#sumYear` is `aria-live="polite"`. The v86/v87 top-level bindings (`#convert*`, `#summaryBtn`, `#sumYearPrev/Next`) are null-guarded so a newer `app.js` on an older cached `index.html` still boots.
- **Settings** — collapsible sections (see §6).

### Currency & FX
- Each record has its own currency, auto-converted into `defaultCurrency` on save. Source chain: **Frankfurter** (ECB) when both codes are in the 31-currency `ECB_CURRENCIES` set, otherwise the **fawazahmed0 currency-api** (jsDelivr CDN with a Cloudflare mirror — ~200 ISO codes, daily, lowercase URLs). Rates cached per `date:from:to` in `fin_rates` (base rate, pre-markup).
- **Card FX markup** (`settings.fxMarkupPct`, Preferences → "Card FX markup %", default 0): applied on top of every fetched rate everywhere (records, debts, recurring, splits) so converted amounts match credit-card statements. Stored on converted records as `fxMarkupPct`; `rate` is the effective (marked-up) rate. Never applied to manual rates.
- The pre-emptive manual-rate field is retired (every ISO currency converts). Offline saves mark `rateUnavailable`; re-save/edit when online (or use Convert, below). Legacy `manualRate` records still render correctly.
- All FX logic lives in `public/finance-helpers.js` (`makeRateService` factory with injectable `fetch` / `storage` / `now` / `isEcb` — testable in Node).
- **The counting rule — one definition.** `amountInDefault(item, def)` (`finance-helpers.js`, pure) is the ONLY place that decides what an item contributes in the default currency `def`: `item.currency === def` → `Number(item.amount)`; else `item.convertedCurrency === def` and `convertedAmount != null` → `Number(item.convertedAmount)`; otherwise `null` = **not counted** (a non-object item is also `null`). So a foreign item whose stored conversion targets an *older* default, an offline `rateUnavailable` item, and an item never converted all read `null`; `rateUnavailable` itself is never consulted. `countNotCounted(items, def)` returns how many items are `null` (non-array → 0). "Not counted" is **derived on every read, never stored on an item** — switching the default back to a currency an item was converted to makes it count again with no write. `debts.js` and `debt-card.js` receive the function through their UMD wrapper (Node: `require("./finance-helpers")`; browser: the globals, because `finance-helpers.js` loads first) and never define their own; `app.js` calls the global. Their only extra is a **transition guard** for a mixed service-worker cache: if the browser global is missing (an older cached `finance-helpers.js`) or a caller passes no `defaultCurrency` (an older cached `app.js`), they count every item the pre-v86 way (`convertedAmount ?? amount`) instead of throwing — the old behaviour, not a second copy of the rule.
- **Totals skip not-counted items.** `sum()` (dashboard `#sumExpense`/`#sumInvest`, Records `#totExp`/`#totInv`) and the dashboard donut's category and sub-category groups add only non-`null` `amountInDefault` values (the old `dispAmt`/`dispCur` helpers are gone). `defCur()` in `app.js` is the current default (`store.settings.defaultCurrency || "THB"`). On the debt side the balance functions in `debts.js` skip a `null` item entirely (see §5 Direction & cycle math).
- **Rows.** `rowAmount(item, origCls)` (`app.js`) is what the records list (`recordCardHTML`), All Debt Records and Person History rows use. Counted: the amount in the default currency, with the original amount on a sub-line when the item's own currency differs. Not counted: the item's ORIGINAL amount and currency (never a stale converted number) plus a warning sub-line `not counted · not in <DEF>` (`rec-orig warn` / `dbt-orig warn`, non-breaking spaces so it wraps after the "·"). This replaced the old `· rate n/a` line.
- **Screen warning.** `renderNcWarn(id, n)` fills one tappable `.nc-warn` button — `N records not counted — not in <DEF>. Convert` (`1 record` singular; hidden at 0) — on six screens: MuniTrakr dashboard (`#dashNcWarn`, count of records), Records (`#recNcWarn`, records), Summary (`#sumNcWarn`, records — every record in the store, not just the year on screen), debt dashboard (`#dbtNcWarn`, debts of existing people — the same scope as the totals above it), All Debt Records (`#dbtRecNcWarn`, likewise) and Person History (`#phNcWarn`, that person's debts). The Settings notice still counts every debt. The dashboard donut also leaves a drilled-in category when it has no counted record left (no empty sub-category chart). The wording says "record(s)" on the debt screens too. Tapping any of them (bound once via `$$(".nc-warn")`) opens Settings if not already there (`enterSettings()`, which also remembers the screen to return to), expands `#currencyBlock` and scrolls it into view.
- **Settings → Currencies notice.** While `countNotCounted` over records plus debts is above 0, `#convertNotice` sits at the top of `#currencyBlock`: "12 records and 3 debts aren't in USD, so they're left out of totals." (singular "1 record isn't in USD, so it's left out of totals."; a zero part is omitted via `ncCountPhrase`) with a full-width **Convert now** button (`#convertNowBtn`) and a message line (`#convertMsg`). `renderConvertNotice()` re-renders it on `openSettings()`, after each currency Save and after a conversion; its body hides at 0 but the message line stays visible while it holds text, so a success/failure message still shows.
- **Changing the default.** Only `#saveDefCurrency` and `#saveCurrencies` send the `#setDefCurrency` select's value (`buildSettingsPayload(true)`); every other Settings save sends the saved `settings.defaultCurrency`, and `syncDraftsFromSettings()` puts the select back on the saved default after any save, so an unsaved pick can never change the default behind the user's back. Both currency Saves call `afterCurrencySave(prevDef)` after a successful save. It clears the notice's message, re-renders the notice, and — only when the default actually changed — re-renders the DebtTrakr screen on display (`rerenderDebtViews()`) and, if anything is not counted, opens `#convertModal`: title `Convert old records to <DEF>?`, a body with the counts ("12 records and 3 debts are in other currencies. Convert them? Records use each record's own date's exchange rate; debts use today's rate. This needs internet. If you skip, they're left out of totals until you convert them in Settings → Currencies."; a total of 1: "… is in another currency. Convert it? Records use each record's own date's exchange rate; debts use today's rate. This needs internet. If you skip, it's left out of totals until you convert it in Settings → Currencies."), **Convert** (`#convertGo`) and **Not now** (`#convertNotNow`; `#convertClose` ✕ and a backdrop tap do the same). Not now just closes it; the notice stays.
- **The conversion run (`runConversion`) is all-or-nothing.** Shared by Convert and Convert now. One run at a time (`_converting`). It disables both Convert buttons and both currency Save buttons for the duration (a default change mid-run would write conversions into the wrong currency), shows `Converting… 40 / 120` on the clicked button, then runs two pure planners one after the other, sharing one `dedupeGetRate(getRate)` wrapper (each `date:from:to` is fetched once; at most 6 requests in flight):
  - **Records** — `planReconversion(records, def, { getRate, markupPct, today, concurrency = 6, onProgress })`: each record at its OWN date's rate. A legacy manual-rate item chains `convertedAmount × rate(convertedCurrency → def, item date)` rounded to cents and keeps `manualRate: true` with no markup; any other item is `rate(item currency → def, item date)` with markup per `reconversionMarkupPct`: the item's own stored `fxMarkupPct` if it was converted before (`convertedAmount` set); else the current `settings.fxMarkupPct` ONLY for a `rateUnavailable` item (a failed foreign conversion — its save would have applied it); else 0, so an item that was simply in the old default never gets a card markup (Bill, 2026-10-01).
  - **Debts** — `planDebtReconversion(allDebts, def, opts)` (`debts.js`, where the cycle rules live): every debt at TODAY's rate so settled cycles stay settled (Bill, 2026-10-01). See §5 Direction & cycle math for the rules. Accepted (Bill, 2026-10-01): a converted debt's stored `rate` is `m × V / amount`, the effective original-currency → default rate actually applied before cent rounding — so a chained EUR→THB debt shows an EUR→USD rate ("≈ 23.01 USD @ 1.1505"), not the THB rate; a `rateUnavailable` debt gets the current card markup (the records rule), so the residue pin requires one old currency AND one markup per person; the pin rounds half away from zero (not plain `Math.round`), keeping "I owe" and "they owe" balances symmetric (they differ only on exact half-cent ties).
  Both never mutate their input and return `{ ok: true, updates: [{ item, fields }] }` or `{ ok: false, failed, total, failedItems }` — one null/non-finite rate or thrown `getRate` fails the whole run. On failure NOTHING is written and `#convertMsg` (and the modal's `#convertModalMsg`, if that prompt is still this run's; both `role="status"`) shows "Couldn't get exchange rates for N records (e.g. 5 Jan 2025 · 1,000 THB). Check your connection, or edit those records and try again." — N counts records and debts together (`1 record` singular), the example is the oldest failed item in its own amount and currency (`convertFailedMsg`, using `formatDate` and `fmt`). On success the app re-reads the store, writes each update into the freshly loaded item (`clearConversionFields` then the new fields), and calls `saveStore()` once for the whole run — if that write fails (`saveStore()` returns `false`), the in-memory changes are dropped (`loadStore()`) and the message is "Couldn't save — your phone's storage may be full. Nothing was converted."; an item deleted or edited while the rates were fetched (compared against a JSON snapshot taken before the fetch) is skipped and simply stays not counted. Success message: "Converted 12 records and 3 debts to USD." Backstop: if the default changed during the run, nothing is written and the notice says "Your default currency changed while converting, so nothing was converted. Tap Convert now to try again." Items already counted are never touched; recurring rules are untouched (they convert when they generate a record).
- **Sharing refuses not-counted debts.** `notCountedShareMsg(list, def)` (`app.js`) is checked first by `shareDebtRecords` and `shareDebtStatement`: a share that includes a not-counted debt is refused with an alert — "This record isn't in USD yet, so its balance can't be shown. Convert it in Settings → Currencies first." (several: "N selected records aren't in USD yet, so their balance can't be shown. Convert them in Settings → Currencies first."). It replaced the old statement-only "no exchange rate" alert; the single card has the guard for the first time.
- **A removed currency stays selectable for items that use it.** `currencyChoices(list, current)` (`finance-helpers.js`, pure) returns a new array — `list` plus `current` appended when it's a non-empty string not already in `list` — so an item keeps its own currency even after it's dropped from `settings.currencies`. `withCurrencyOption(sel, code)` (`app.js`) patches that missing option into an *already-filled* `<select>`; it's called for `#fCurrency` (record editor) and `#dbtCurrency` (debt editor) right after those selects are populated for an existing item — without it the select would read `""` and saving would silently change the item's currency. `#ruleCurrency` (recurring-rule editor) never needs patching: `populateRuleCurrency` builds its options straight from `currencyChoices` in the first place, so the removed currency is present from the start. All three editors also reject a blank currency on save with a visible message (`#modalError` "Choose a currency", `#debtError` "Currency is required.", `#ruleError` "Currency is required.").

### Recurring rules
- Settings → Recurring section. Each rule has: type (expense/investment), category/sub, amount/currency, notes, cadence (daily/weekly/monthly/yearly + sub-controls), start date, end condition (none / end date / after N), auto-confirm toggle, pause.
- **Cadence math** in `recurring.js`. Edge cases handled: day-31 → last-day-of-month fallback, Feb 29 → Feb 28 in non-leap years, end date / max-occurrences cap mid-backfill (auto-pauses the rule).
- **Pause semantics:** while paused, no records generate. Unpausing sets `lastGeneratedDate = today` so the pause window does NOT backfill (matches user mental model of "skip" not "queue").
- **Backfill:** on app boot, `processRecurring()` walks all rules. For `autoConfirm: true` rules, every missed occurrence inserts a record immediately (FX runs in parallel via `Promise.all`). For `autoConfirm: false`, occurrences land in the dashboard confirmation banner (Confirm / Edit / Skip per row + Confirm-all / Skip-all when more than 3).
- **Banner Edit & Confirm:** the confirmation banner's **Edit** button (`editPending`) opens the Add Record modal (title "Edit & Confirm") pre-filled from the rule, with the draft's `id` stripped — the draft was never inserted, so keeping it would PUT to a record that doesn't exist. Delete and Duplicate stay hidden and the recurring toggle section is suppressed for the duration (both gated on the armed `window.__pendingOnSaved` callback), so the save can only be a plain POST — but split-the-bill and paid-by-someone-else stay available, since the stripped-id draft is Add-mode as far as `editingId` is concerned; using either alongside a confirm creates its debt record(s) (lend / borrow) right along with the confirmed occurrence. On save, the armed callback stamps the new record's `ruleId`, advances the rule (`lastGeneratedDate` / `occurrenceCount` / `applyEndChecks`), and clears the banner row. Two bugs fixed here: the old flow dead-saved with "Record not found" (the draft's phantom id was never in the store, so the PUT 404'd), and an abandoned banner-edit used to leave `__pendingOnSaved` armed — the next unrelated save would then wrongly advance the rule and stamp its `ruleId`; `closeModal` now always clears the callback.
- **Floodgate:** newly-created rules with past-dated start dates show a modal — "Backfill N past records?" with **Generate all** / **Start from today** / **×** options. Triggers whenever any past records would be generated.
- **Recreate from orphan:** if a record's `ruleId` points to a deleted rule, the Add Record modal shows a warning chip with a "Make a new rule from this record" button (or a × to dismiss).
- **Link badge:** records generated by a rule get a `↻` badge next to the date. Tap → jumps to Settings → opens that rule's editor.

### Dashboard auto-fit
- Big totals on the dashboard cards + donut center auto-shrink font when text overflows (so `THB 1,000,000,000,000,000` doesn't blow out the layout). Currency moved into the muted label (`"2026 Expenses · THB"`) to leave more horizontal room for the number itself.

### Split the bill
- Add Record modal (expense type, Add flow only): "Split the bill" checkbox above the recurring section (mutually exclusive with it). User's share is the auto-computed remainder; "Split evenly" uses `evenShares` (debts.js) with the rounding remainder going to the user. On save: the expense stores only the user's share (notes auto-append the full breakdown), and one `lend` debt per participant is created on the DebtTrakr side in a single batched `saveStore()` (same currency/date; debt notes are identical to the expense notes — the user's own notes and the auto-generated breakdown are joined by a middle dot (` · `), not a newline, so the note reads as one line everywhere it appears). Checking the toggle auto-scrolls the form to the section; the person menu opens upward. Expense and debts are independent after creation.
- Share fields (the user's own included) are typed-or-blank; state mirrors the visible fields exactly (`splitMine`, `splitPeople[].amount`, `null` = blank — number-input badInput can't desync save). With exactly 2 participants, typing either field auto-fills the other with `total − typed` (`solve2p()`, DOM-direct so focus/caret survive; also re-mirrors when the total changes). With 3+ participants nothing solves live; an **Auto** button (visible only then) splits the remaining amount cent-exact across the blank fields via `fillBlanks` (debts.js). "Split evenly" overwrites all fields with `evenShares`. The record form is `novalidate` — every save rejection is a visible `#modalError` message (share sums are validated cent-exact on the rounded values that get stored). Save also cents-rounds `payload.amount` and bounds-checks the recurring day/occurrences fields with visible errors (novalidate follow-ups). Split state survives a transiently-empty total (a number input mid-edit reads as blank), so editing the amount never silently discards typed shares.

### Paid by someone else
- Add Record modal (expense type, Add flow only): "Paid by someone else" checkbox, mutually exclusive with both split AND recurring (three-way exclusion — `syncPaidBySection` hides itself when either of the other two is on, and the extended `syncSplitSection` does the same in reverse). Choosing a payer uses the same person-picker pattern as split: a "Choose person" button opens a menu of `settings.people` plus an inline **+ New person** mini-form; the new person is auto-selected on save. The picked `paidByPersonId` survives the user manually toggling the section off (state stays, section just hides) but resets to `null` whenever the modal opens fresh or the section is force-hidden by split/recurring turning on.
- On save the expense record is unaffected — it stores the full entered amount, same as any normal expense (unlike split, which shrinks the expense to the user's share). The payer's debt side is created silently and atomically: `attachConversion` runs first, then one batched `saveStore()` pushes the resulting debt record(s), mirroring split's and Add Debt's atomicity convention. The plan is computed via a sentinel `balanceBefore` trick (a synthetic debt carrying the expense's own date — the `createdAt` bump only makes it sort last within that date — is appended so the balance is "as of this expense's date", not "as of now") feeding `planPaidBy(entered, balanceBeforeSigned, defaultCurrency)` in `debts.js`: if the payer already owed the user, it settles that cycle first as `paid-back`, delegating to `planSplit` for the overshoot case (splits into paid-back + a fresh borrow, default-currency halves, same convention as `planSplit` elsewhere); otherwise (balance clear or the user already owes them) it's simply a new `borrow`. The debt note is the user's own notes, then a middle dot, then an auto-generated tag: `Paid for <user's display name> — <category> <amount>`.
- Validation (visible `#modalError`, novalidate-style): requires `payload.amount > 0` ("Enter an amount greater than 0 to record who paid") and a `paidByPersonId` that resolves to a real person ("Choose who paid for you"). FX conversion failure on the debt side is caught and marks `rateUnavailable` on the record — the debt still inserts (same fallback as every other conversion path), it just isn't converted yet. Foreign-currency saves that would need netting (payer's balance > 0 as of the expense date) are blocked pre-save with a visible message when no rate is available (e.g. offline); no-netting foreign saves still insert with `rateUnavailable`.

### Duplicate
- Edit Record modal only: an outlined **Duplicate** button (`.btn-secondary`, copy-icon SVG) sits between Delete and Save. Unlike a plain `.btn-secondary`, it has an opaque per-theme base — a `--btn-base` custom property (`var(--card)` in the default theme, `#eef4f6` in Aero, `#2a1832` in Yoimiya) that its `:active` state layers `--accent-soft` over — because the record form's action row is sticky and transparent and relies on opaque buttons so form content can't scroll visibly through them (`--card` itself is translucent in Aero/Yoimiya, hence the per-theme override; see `styles.css`, grep `btn-base`). Clicking it saves nothing: it reads the on-screen form into a `prefill` object (type, category, sub, amount, currency, notes), calls `closeModal()`, then `openModal(null, prefill)` reopens the modal as a fresh Add New Record pre-filled from that prefill. The date resets to today (a copy on the original's date was rarely wanted and tedious to fix afterwards), and the form scrolls back to the top (`#recordForm.scrollTop = 0`) so the user lands on the fields, not the action row. The original record is completely untouched — nothing is written until the new copy is itself saved. Because it reopens via Add (not Edit), the copy carries no `ruleId` and the recurring section starts in State A (no rule, toggle visible/unchecked); split-the-bill and paid-by-someone-else are both available on the copy (their guards gate on `!editingId`, which is `null` in Add mode); legacy manual-rate values are not copied (the manual-rate field is only populated from `record.manualRate`, and `record` is `null` for a duplicate).
- Note the Save button: check-icon, label "Save" lives in `#saveBtnLabel` (`openModal` writes the span's `textContent`, never the button's own — writing the button's `textContent` would erase the icon); the new-category color-confirmation detour still relabels it to "Confirm & Save".
- The split-bill breakdown is stripped from the copied notes (`stripSplitBreakdown`, debts.js) — the breakdown is tied to the original save's debts, so a copy must not inherit it, whether or not it's split again.
- The modal replays its slide-up animation so the copy visibly pops in: between `closeModal()` and `openModal(null, prefill)` the handler forces a reflow (`void $("#modal").offsetWidth`), which restarts `.modal`'s `slideUp` entrance animation instead of it being skipped (close and reopen otherwise run in the same task with no style flush between them).
- Under 390px viewport width the action row tightens its spacing (icons and labels kept) so all three buttons fit down to 320px — see `styles.css`, the `@media (max-width: 389px)` block after the Duplicate `--btn-base` rules.

---

## 5. DebtTrakr — features

### Views
- **Dashboard** — top buttons (Total Lend / Total Borrow, signed totals across people). Vertical list of person cards (only those with non-zero outstanding). Each card: colored person icon + name, signed outstanding amount, repayment progress bar. "People" header row with a compact "View all" pill.
- **Per-Person History** — drill in by tapping a person card. Header shows name + outstanding + direction-colored "They owe you / You owe" label. Records list shows every debt for that person newest-first, with direction badge, the amount via `rowAmount` (default-currency amount + original currency line when converted; a not-counted debt shows its original amount with "not counted · not in <DEF>"), and "Settled" badge on records that closed a cycle. The Outstanding line is followed by the `#phNcWarn` screen warning when that person has not-counted debts. Tap a row → edit modal. FAB pre-fills the person. Each row has a small share button that exports the record as a PNG card (with running outstanding math) via the iOS share sheet. A second FAB (`#phShareBtn`, share icon) enters select mode on this view — the same `#dbtMultiBar` bar that All Debt Records uses, generalised via `debtSelectRows()` (returns `lastPhRows` while `currentView === "person-history"`, `lastDbtRows` otherwise) so Cancel / Delete / Share / Select-all all act on whichever of the two screens is open. Row taps go through `blockSelect` (`debts.js`), so the selection is always one gap-free block in display order (top-to-bottom = newest-to-oldest), never an arbitrary set: tapping a row outside the current block extends the block to cover it (filling any gap); tapping the top (newest) row of the block drops only that row; tapping any other row inside the block (middle or bottom) drops it and everything older below it; Select-all toggles — it selects every visible row, but clears the selection instead when everything is already selected; Delete and Share both act on whatever block is currently selected. Selecting 2+ records and tapping "Share N" sends them as ONE statement image (`shareDebtStatement`, see below) — every record on this screen already belongs to the open person, so 2+ always qualifies; selecting exactly 1 record falls back to the ordinary single-record card via `shareDebtRecords`.
- **All Debt Records** — bulk list across all people. Filter by person (multi-select); changing the filter while select mode is on clears the current selection — select mode itself stays on, but a new filtered view is a new list, so a fresh selection starts rather than risk a block with a gap. Multi-select mode: Cancel / Delete / Share / Select-all (`#dbtMsShare`; no Change-Person — kept clean intentionally); the second FAB that enters select mode (`#dbtMultiBtn`) is now the same share icon as Per-Person History's `#phShareBtn`. Row selection uses the same `blockSelect` gap-free block described under Per-Person History above, so a scattered (non-contiguous) set of records can no longer be bulk-deleted in one go — open each one and use its own Delete instead. Share is the same wide "Share N" button Per-Person History uses (`#dbtMsShare` grew from a fixed 52px icon button to `flex:1` with a label span, `#dbtMsShareLabel`, once the button started doing double duty) and now follows the identical rule on both screens: 2+ selected rows that all belong to one person go as ONE statement image (`shareDebtStatement`); a selection spanning more than one person, or a single selected row, goes through `shareDebtRecords` instead — separate cards when it spans people (this screen only, since Per-Person History's block is always one person), the single card for one row. `shareDebtRecords` renders every selected record to a PNG card and opens ONE share sheet with all files, always oldest-first (`date` asc, `createdAt` asc — inverse of the display sort); multi-file names get a zero-padded index prefix (`debt-01-…`) so name-sorted receivers keep the order, single-record filenames unchanged, with a per-file download fallback when Web Share with files is unavailable. Each row also has a share button (hidden in multi-select mode) that exports the record as a PNG card via the iOS share sheet (`shareDebtRecord(d)` is now a 1-element wrapper around `shareDebtRecords`; per-row buttons unchanged). Card layout: identity (icon tile, name, direction pill) on the left of the header with the amount, date and any FX line right-aligned opposite it; notes in their own white card; the running balance in a dark card that turns green with a checkmark when the record settles the cycle. Note text wraps onto up to 4 lines (the card grows to fit, and Thai — which has no inter-word spaces — breaks mid-word); amounts render with no decimals when whole and exactly two when fractional.
- **Statement image** (`statementModel` + `renderStatementCard`, `debt-card.js`) — the PNG `shareDebtStatement` sends for a 2+ record, single-person selection on either debt screen. `statementModel` re-sorts the selected debts chronologically (date asc, then `createdAt` asc) regardless of on-screen selection order and turns them into one row per record: a short date, a kind sentence ("`<Name> borrowed`" / "`<Name> paid back`" / "`<Me> borrowed`" / "`<Me> paid back`"), the note (wraps up to 2 lines), and the amount in the default currency. The card header's right column (record count + date range) is placed by measuring the text and drawing it left-aligned at `rightEdge − measuredWidth` — never with `textAlign` — because WebKit (Safari/iOS) mispositions text containing Thai when `textAlign` isn't left/start; the single card uses the same measured-placement technique, but only for its amount+currency line — its date and FX lines still use `textAlign = "right"`, which is safe there because both are ASCII-only (an ISO date and "≈ n CUR @ r"). A subtotal row is drawn only when every selected record points the same direction ("Total of N records" + the net magnitude); a mixed-direction selection shows only the per-row amounts, no subtotal. The footer reuses the single card's shared `drawOutstanding` helper (`renderDebtCard` and `renderStatementCard` both pass it a model with the same `outstandingLabel` / `mathText` / `totalText` / `totalCurrency` / `isSettled` fields): `shareDebtStatement` computes `balanceAfter` via `balanceAfterRecord` (`debts.js`) — the running balance right after the newest selected record, deliberately computed WITHOUT a people map so a since-deleted person's full remaining history still counts instead of the statement contradicting its own rows — and inside the model `previous = balanceAfter − the selected net`; because `blockSelect` guarantees the selection is one gap-free block, `previous` is always the true balance before the first (oldest) selected record. The "previous + selected" math line is omitted when `previous` is 0 (fresh cycle) or when applying the selected net crosses zero (magnitudes alone can't show a true sum then) — a broader omission rule than the single card, which omits only when its own `balanceBefore` is 0. The footer turns green with a checkmark when the resulting balance is exactly 0 (no "Settled" / "เคลียร์แล้ว" text is drawn on the statement, unlike the history-row badge). Every string (pill "Statement"/"สรุปรายการ", record count, kind sentences, outstanding labels) follows the same `settings.debtShareLanguage` English/Thai split as the single card. The canvas is 1080px wide at up to 2× device-pixel ratio; a long statement (many rows) steps the DPR down (`Math.sqrt(16e6 / (WIDTH * HEIGHT))`) to stay under iOS's ~16-megapixel canvas-area cap, floored at 1×, and beyond that the share is refused up front (`STATEMENT_TOO_TALL`) with a "select fewer and share them in parts" message rather than clipping or failing to render. A selected record that isn't counted (`amountInDefault` is `null`: its `currency` and `convertedCurrency` both differ from the default) never reaches the image: `shareDebtStatement` refuses the whole share up front with `notCountedShareMsg`'s visible message. If one did reach `statementModel` anyway, its row shows the original amount + currency, it adds nothing to the net, and it suppresses the subtotal (which would no longer be the sum of the rows shown). The share button (`#phShareBtn`) also hides whenever the open person has no records (`lastPhRows` empty), not just while multi-select is active.

### Bottom-edge layout (no-dock)
- `showView` mirrors the range-dock's hidden state onto a `body.no-dock` class — set whenever the range dock is absent (settings, summary, person-history, debt-records, or any view while in DebtTrakr mode, which has no dock at all). Under `body.no-dock`, CSS lowers `.fab` to `calc(24px + var(--safe-b))` and `.multi-bar` to `calc(28px + var(--safe-b))`, so DebtTrakr's floating add button and multi-select bar sit near the bottom edge instead of hovering where the (absent) range dock would be.

### Direction & cycle math (`debts.js`)
- Two context-aware directions in the Add Debt modal, based on the selected person's outstanding: **clear** → `Lend` / `Borrow`; **they owe you** → `Lend (more)` / `Paid back`; **you owe them** → `Pay back` / `Borrow (more)`. The button you tap maps to the underlying type — `lend`, `borrow`, `paid-back`, or `pay-back` — and history badges always render past-tense (`Lent` / `Borrowed` / `Paid back`).
- **Only default-currency items count.** Every function below takes the default currency and reads each item through `amountInDefault`; an item that returns `null` (not counted) is skipped entirely — it moves no balance and takes no part in the cycle/settlement math. Callers in `app.js` pass `store.settings.defaultCurrency || "THB"`.
- **Cycle reset:** when the running net for a person hits exactly zero, the accumulators reset. A new lend after a full repayment starts fresh at 0% progress instead of showing inflated historical ratios.
- **Whole cents.** Every balance walk accumulates and compares integer cents (`_cents(x) = Math.round(x * 100)`), so float sums of 2-decimal amounts close a cycle exactly (14.6 + 0.15 vs 14.75); `lent`/`back`/`outstanding`, `balanceBefore`/`balanceAfterRecord` and `planSplit`'s halves come back cent-exact, and `wouldOvershoot` compares cents. `debtCardModel`'s new balance is rounded to cents too. Integer (THB) data behaves exactly as before. One sign rule, `_signOf(type)` (+1 lend/pay-back, −1 borrow/paid-back, 0 otherwise), drives the walks and the converter.
- **`planDebtReconversion(debts, def, { getRate, markupPct, today, concurrency, onProgress })`** — the debt half of a conversion run. Pass the whole debt list (counted debts are read, never updated). Per not-counted debt: old currency `P` = `convertedCurrency` when it has a conversion, else its own `currency`; old value `V = amountInDefault(debt, P)`; the new amount comes from `V` with ONE rate per pair, `rate(P → def, today)` — never from the original foreign amount. Markup: none for a debt converted before (V already carries it) or one in the old default; the current setting only for a `rateUnavailable` debt. **Residue pin:** per person, in `_chronoCmp` order with `_signOf`, `newBalC_i = roundHalfAway(oldBalC_i × m)` and each debt's `convertedAmount = |newBalC_i − newBalC_(i−1)| / 100` — wherever the old running balance was exactly 0 the new one is exactly 0 (settled cycles stay settled), every balance equals round2(old × m), and a debt that rounds to 0 keeps `convertedAmount: 0` (still counted). The pin applies only to a person whose debts are all not counted and share one `P` and one markup; otherwise (a debt already counted in the new default, or mixed old currencies) that person's debts fall back to per-debt `round2(V × m)`. Fields: `convertedCurrency = def`, `convertedAmount`, `rate = m × V / amount` (10 significant digits), `rateDate = today`, `manualRate: true` kept when set, `fxMarkupPct` only for a marked-up `rateUnavailable` debt.
- `annotateSettlements(debts, defaultCurrency)` flags the specific record that closed each cycle → "Settled" badge in history; a not-counted record gets `{ settled: false }` and doesn't touch the running net.
- `personBalances(debts, peopleById, defaultCurrency)` returns `Map<personId, { lent, back, outstanding, direction, progress }>` — used by every debt view.
- `totalsAcrossPeople(balances)` returns `{ totalLend, totalBorrow }` for the top dashboard cards.
- The trailing `defaultCurrency` parameter was added to `personBalances(debts, peopleById, defaultCurrency)`, `annotateSettlements(debts, defaultCurrency)`, `balanceBefore(debts, recordId, peopleById, defaultCurrency)` and `balanceAfterRecord(debts, recordId, defaultCurrency)`; `planSplit`, `planPaidBy` and `wouldOvershoot` already took it and now read the entered/edited item through `amountInDefault` (a not-counted entry contributes 0, so it never overshoots or splits and never throws; `wouldOvershoot`'s direction-mismatch rule still applies, and `planPaidBy`'s positivity check still validates the typed amount). `debtCardModel` and `statementModel` use the same shared helper: a not-counted debt moves no balance and gets no math line on the single card.

### Add Debt modal
- Currency populated from shared `settings.currencies`. Same `attachConversion` pipeline as MuniTrakr (every ISO currency auto-converts since v71; card markup applies here too).
- **Match outstanding** chip — appears when the selected person has a non-zero balance. Defaults to **Paid back** when they owe you, **Lend** when you owe them. Fills amount with the outstanding value.
- Inline **+ Add new person** form — name + color, no need to leave the modal. New person is auto-selected.
- Validates: person required, amount > 0, date required.

### People
- Stored in `settings.people`. Each has color + icon (`PEOPLE_ICONS` map, 22 icons: silhouettes by age/gender, gender symbols, relationships, occupations, tokens).
- People settings row: colored icon tile (tap → icon picker grid) + color input + name + delete. Icon picker reused by the Add Debt mini-form.

---

## 6. Settings (mode-aware)

In MuniTrakr mode:
1. Recurring (rule list + Add rule)
2. Categories (drag-reorder, icon picker modal + color, add-form with icon picker)
3. Preferences (Your name, Debt share image language, Card FX markup %)
4. Currencies (`#currencyBlock`: the not-counted notice + Convert now when any item isn't in the default — see §4 Currency & FX; Default currency + ISO-validated add/remove + reorder; every valid code auto-converts)
5. Theme (theme select, then three identical icon pickers, in order: Home-screen icon, Header icon (MuniTrakr), Header icon (DebtTrakr) — each a row of three tiles, Wallet / Yoimiya / Your picture, no upload/reset buttons)
6. Backup & Restore ("Back up" via Web Share / download, "Restore" from file)
7. App version (current version + Check for updates + "Vibe coded by FosZ")

In DebtTrakr mode: **People** replaces Recurring + Categories; everything else is identical and shared.

Section visibility is driven by `data-mode` attributes on each `.settings-block` (`"finance"`, `"debt"`, or `"any"`); `showView` toggles `display` per-block when entering Settings.

### Icon pickers (home-screen icon + both header icons)

One generic component (`app.js`) serves all three pickers in Settings → Theme, in this order: Home-screen
icon, Header icon (MuniTrakr), Header icon (DebtTrakr). Each is a row of three tiles — Wallet, Yoimiya,
Your picture — with no upload/reset buttons: tapping Wallet or Yoimiya selects it directly; tapping "Your
picture" opens the file picker when no picture is stored yet, selects the already-stored picture when it
isn't the current pick, or opens the file picker to replace it when it's already selected.

The `ICON_PICKERS` array configures the three instances, each naming its wrapper element, title, message
line, the settings keys it edits, and its upload size/fill:
- `{ wrap: "iconPickHome", title: "Home-screen icon", msg: "homeIconMsg", choiceKey: "homeIcon", picKey: "homeIconCustom", size: 180, fill: "#ffffff", apply: () => applyHomeIcon(), home: true }`
- `{ wrap: "iconPickFinance", title: "MuniTrakr header icon", msg: "hiFinanceMsg", choiceKey: "headerIconFinanceChoice", picKey: "headerIconFinance", size: 160, fill: null, apply: () => applyHeaderIcon() }`
- `{ wrap: "iconPickDebt", title: "DebtTrakr header icon", msg: "hiDebtMsg", choiceKey: "headerIconDebtChoice", picKey: "headerIconDebt", size: 160, fill: null, apply: () => applyHeaderIcon() }`

Each wrapper's markup (`.iconpick` div containing a `.iconpick-row` of three `.iconpick-tile` buttons plus
a hidden `.iconpick-input` file input) is identical across the three; only the tile hrefs differ — the
DebtTrakr Wallet tile points at the rose `./icon-wallet-red.png` (caption is still "Wallet"), the other two
Wallet tiles point at `./icon-wallet.png`.

`renderIconPickers()` walks `ICON_PICKERS` and, per entry: highlights the tile matching
`_iconPickerChoice(p)` (wraps `effectiveIconChoice()`, so a `"custom"` pick with no valid stored picture
highlights Wallet instead), shows/hides the picture image and the `+` placeholder on the "Your picture"
tile, and — only for the `home: true` entry — hides the whole wrapper (tiles + file input) in standalone
mode and refreshes `#homeIconHint`. It runs once at boot in `enterApp()` (right after `applyHomeIcon()`),
again in `openSettings()`, and after every pick.

Picking a tile or finishing an upload both go through `_setIconChoice(p, choice)`: sets
`settings[p.choiceKey]` (and, for uploads, `settings[p.picKey]` first), calls the entry's `apply()`
(`applyHomeIcon` or `applyHeaderIcon`), re-renders, persists, then sets the message. Header choices apply
immediately to the live top-bar `#headerIcon` for the mode currently on screen — `applyHeaderIcon()` sets
`#headerIcon.src` via `headerIconHref(settings, currentMode === "debt" ? "debt" : "finance")`; there are no
more per-mode Settings preview images (`hiPreviewFinance`/`hiPreviewDebt` were removed with the old
Upload/Reset controls). Upload failures (any of the three) show the shared "Couldn't read that image."
via `_showIconReadError`. Successful picks/uploads show `"<Title> set to Wallet."` /
`"…Yoimiya."` / `"…your picture."` in each picker's own message line, where `<Title>` is
`"Home-screen icon"`, `"MuniTrakr header icon"`, or `"DebtTrakr header icon"`.

**Resolving a pick to a URL.** `iconHref(choice, custom, walletSrc)` (`finance-helpers.js`, pure) is the
shared resolver: `"yoimiya"` → `./icon.png`; `"custom"` → `custom` only when it's a valid
`data:image/...` string; anything else → `walletSrc`. `homeIconHref(s)` calls it with
`s.homeIcon`/`s.homeIconCustom`/`"./icon-wallet.png"`. `headerIconHref(s, mode)` calls it per mode with
that mode's choice/picture/default wallet PNG — `"./icon-wallet-red.png"` for `mode === "debt"`,
`"./icon-wallet.png"` otherwise. `effectiveIconChoice(choice, custom)` runs the same resolution but names
the tile instead of the href, so the UI and the applied icon can never disagree.

**iOS home-screen icon specifics.** iOS reads the home-screen icon from `<link rel="apple-touch-icon">`
only at the moment the user taps Share → Add to Home Screen, and the icon is then fixed — editing the app
afterwards can't change it. `applyHomeIcon()` removes the `apple-touch-icon` link and appends a fresh
`<link>` element (the approach reported to work on iOS) at every app startup and on every change of
`settings.homeIcon`/`homeIconCustom`, so the tag reflects the current pick when the user does Add to Home
Screen. The fresh-link approach is reported to work on iOS; the custom-upload (data URL) path through it
has not yet been verified on a real iPhone.

**Storage separation (why switching the home-screen icon needs a backup).** On iOS a home-screen web app
has its own localStorage, separate from Safari's and from any other home-screen copy, and all MuniTrakr
data lives only in localStorage. Removing the icon and adding it again gives a new, empty copy. So the
only way to change the home-screen icon is: back up (Backup & Restore) → remove the app from the Home
Screen → open the site in Safari and pick an icon → Add to Home Screen again → restore the backup in the
new copy. (This limitation is specific to the home-screen icon's apple-touch-icon lock; the two header
icons apply live and don't need any of this.)

**Hint + standalone mode.** `renderIconPickers()` picks the home-screen picker's hint by `_isStandalone()`
(`navigator.standalone === true` or `(display-mode: standalone)`):
- In Safari: "Pick this before Safari → Share → Add to Home Screen. Once added, the icon can't change. To
  switch later, back up first (Backup & Restore below) — a re-added app starts empty — then remove it, pick
  again here in Safari, add it again, and restore your backup."
- Standalone: "Your Home Screen icon is already set. To change it: back up (Backup & Restore below), remove
  the app from your Home Screen, open the site in Safari, pick an icon here, add it again, then restore your
  backup in the new copy — it starts empty."

Only the Home-screen picker's tiles (and its upload input) are hidden in standalone mode — its label, hint
and message line stay visible, unchanged from v84. The two header pickers always show, in every mode: a
header pick applies immediately to the running app and isn't subject to the apple-touch-icon lock, so
hiding them would serve no purpose. `styles.css` has an explicit `.iconpick[hidden]{display:none}` so no
future display rule on the wrapper can override `[hidden]`.

**Save check.** Because `saveStore()` swallows write errors, `_setIconChoice()` reads `fin_store` back
from localStorage after `persistSettings()` via `_iconChoiceSaved(p, choice, pic)`, and checks that the
saved `settings[p.choiceKey]` equals the pick (and, for `"custom"`, that the saved `settings[p.picKey]`
equals the picture). This read-back check now covers all three pickers, not just the home-screen one. If
it fails, that picker's own message line shows "Couldn't save your choice — storage may be full. It's used
for now but won't be remembered." in the default error colour instead of the success message; the icon is
still applied to the live page.

---

## 7. Theming

Three themes, toggled by class on both `<body>` and `<html>` (so the HTML solid background fills iOS overscroll without flashes).

| Theme    | HTML base       | Vibe                                              |
|----------|-----------------|---------------------------------------------------|
| default  | `#0b0d12`       | dark purple/blue accent split per type            |
| aero     | `#cfeede`       | Frutiger-glass light theme, blue/green accent     |
| yoimiya  | `#1c1030`       | warm orange with animated fireworks canvas        |

- Per-theme variables (`--accent`, `--out`, `--in`, `--out-bar` / `--in-bar` (translucent `--out` / `--in`, the Summary bars), `--card`, `--ring-empty`, etc.) drive every new UI surface automatically.
- **Fireworks** (Yoimiya only): `Fireworks` IIFE in `app.js`, fixed canvas at z-index `-1`, pauses on `visibilitychange`.
- Background layer (`#bgLayer`) is `position: fixed` — never scrolls with content.

---

## 8. Service worker & versioning

- **Stale-while-revalidate** strategy: serves cached response immediately, refreshes cache in background. First load after a deploy shows the OLD version, the next load shows the new one. "Check for updates" forces an immediate swap.
- FX API calls bypass the SW (explicit early-out for `frankfurter`; the currency-api hosts are cross-origin so the handler's same-origin guard skips them too). Note: sw.js's line-1 comment says "network-first" but the fetch handler is stale-while-revalidate — the comment is stale, the description here is correct.
- **Lockstep version bump on every release:** `APP_VERSION` in `app.js` AND `CACHE` in `sw.js` must match. Current: `v87` / `munitrakr-v87`.
- Release flow: edit → bump both versions → `node --check public/app.js && node --check public/sw.js` → `node tests/run.js` → `git add -A && git commit && git push` → Cloudflare Pages auto-deploys → on phone, Settings → App version → Check for updates.

---

## 9. Key conventions & gotchas

- **Git repo at https://github.com/FosZafel2oZ/fosz-munitrakr** (public, `main` branch). Cloudflare Pages auto-deploys from `main` on every push (project setting: build output directory = `public`).
- **Session workflow (user preference):** work directly on `main`; user previews by opening `public/index.html` via `file://` (no server needed except SW/manifest testing); commit freely but **push only when the user says "push it"**. Plans are executed via subagent-driven development (see memory).
- **String dates everywhere** (`YYYY-MM-DD`). Cadence math in `recurring.js` is string-based to avoid `new Date(string)` UTC-vs-local pitfalls that bit the iOS date input.
- **`createdAt` is numeric ms** — sort comparator uses arithmetic. Migration in `loadStore` coerces any legacy string values.
- **Categories matched by NAME on records**, but renames propagate via stable `id` through `reconcileRenames(oldS, newS, records)` (in `finance-helpers.js`) inside the shim `PUT /settings`.
- **API shim** (`api()` in `app.js`) preserves the original Express endpoint signatures (`/me`, `/account`, `/settings`, `/records`, `/records/:id`, `/records/bulk`) but is backed entirely by localStorage. Debts skip the shim (direct `store.debts` access since there's no legacy contract).
- **Modal scroll lock:** `body.modal-open { overflow: hidden }` + `overscroll-behavior: contain` to block iOS scroll-chaining. Each modal's open/close path must update the body class.
- **Drag-reorder** in Settings (Categories, Currencies, recurring rule rows): pointer-events based via `makeDraggable(container, rowSel, handleSel, arr, render)`.
- **Backup uses Web Share API** with `{ files: [file] }` only (no `text`/`title` — those cause iOS targets to save extra files). Falls back to direct download when `canShare(files)` is false.
- **iOS emoji rendering:** Unicode characters like ⏸ ▶ get substituted with Apple's emoji font. All icon buttons use inline SVG instead. The share card follows the same rule: its checkmark and note glyph are canvas paths, and the person icon is a rasterized SVG injected by the caller.
- **iOS PWA cold start:** mode is reset to `"finance"`, but persisted `currentView` is restored. `showView`'s mode-compatibility gate redirects orphaned debt-only views to dashboard.
- **`saveStore()` / `persistSettings()` swallow localStorage write errors app-wide** (never throw; `saveStore()` returns `false` on a failed write, which almost every caller ignores) — a known limitation. The conversion run checks that result (see §4 Currency & FX); the three icon pickers (home-screen + both header icons) are the other exception that notices: `_setIconChoice` reads the saved store back (`_iconChoiceSaved`) and, if the pick or picture didn't land (e.g. a custom picture too large for the remaining quota), shows "Couldn't save your choice — storage may be full. It's used for now but won't be remembered." in that picker's own message line instead of its success message (see §6 Icon pickers). Everywhere else a failed save still looks like success, and the live page keeps the change in memory until the next reload.
- **Never re-implement the counting rule.** `amountInDefault` in `finance-helpers.js` is the only definition; any new total, row, balance or share that needs "what does this item contribute in the default currency" must call it (an old local copy in `debt-card.js` fell back to a stale amount and was deleted). Plain `convertedAmount ?? amount` reads are wrong.
- **"Not counted" is derived, never stored.** Don't add a flag to records/debts; `amountInDefault(item, def) === null` is computed on every render, so changing the default currency back un-excludes items automatically.
- **`planReconversion` / `planDebtReconversion` never mutate their input.** They only plan; `runConversion` applies the updates to a freshly loaded store. Keep that split.
- **Records convert at their own dates' rates, debts at today's.** Converting debts per date would turn a cycle that summed to 0 (lend ฿1000, paid back ฿1000) into a residual balance in the new currency. Never route debts through `planReconversion`, and keep `planDebtReconversion`'s per-person running-balance rounding.
- **Conversion is all-or-nothing.** One failed rate aborts the run and writes nothing; all updates land in a single `saveStore()`. Don't make it partial or write items one by one.
- **`saveStore()` returns `true`/`false`.** It still never throws; callers that ignore the result behave as before. `runConversion` checks it and shows the storage-full message instead of "Converted …".
- **Known limitation: an offline Add Debt of a foreign settling entry saves unsplit and not counted.** With no rate the entry has no value in the default currency, so `planSplit` can't see an overshoot and `saveDebtFromModal` inserts the single record (`rateUnavailable`); it shows as not counted until it's converted. (Paid-by-someone-else is different: it blocks the save pre-flight when netting would need a rate it can't get.)
- **Aero's `.settings-block > *{position:relative}`** (see `styles.css`, the "Make sure normal content stacks above the gloss" rule) overrides `position:absolute` on any direct child, which would silently un-hide a `.visually-hidden` element placed directly inside a `.settings-block`. Each icon picker's `<input type="file" class="visually-hidden iconpick-input">` is wrapped inside its own `.iconpick` wrapper (`#iconPickHome`/`#iconPickFinance`/`#iconPickDebt`; the home one is also what standalone mode hides) for this reason, so the input itself is a grandchild, not a direct child.

---

## 10. Glossary of key globals in `app.js`

| Name | Purpose |
|------|---------|
| `currentMode` | `"finance" \| "debt"` — drives mode-specific UI |
| `currentView` | last-active view (persisted in `fin_prefs`; `settings` is saved as `dashboard`, `summary` is saved as is) |
| `summaryMode` | `"months" \| "years"` — the Summary toggle; persisted in `fin_prefs` (key `summaryMode`, next to `view`, `activeType`, `range`) and restored by `loadPrefs` only when it is one of the two values |
| `summaryYear` / `summaryShownYear` / `summaryPrev` | Summary state, not persisted: the year picked in Months view (`null` = current year), the year actually on screen after clamping, and the view the Summary page returns to |
| `renderSummary()` / `enterSummary()` / `leaveSummary()` / `fitInside(el, maxPx, minPx)` | `app.js` — draws the Summary page (also called from `refresh()` while it is on screen); opens it remembering `summaryPrev`; returns to it; shrinks an element's font until its text fits its own clipped box |
| `store` | the persisted `fin_store` object |
| `settings` | alias to `store.settings`, refreshed via `api("/me")` |
| `records` | in-memory copy of MuniTrakr records (sorted desc by date) |
| `multiSelect` / `selected` / `lastTyped` | MuniTrakr records-page selection state |
| `debtMultiSelect` / `debtSelected` / `lastDbtRows` / `debtRecFilter` | DebtTrakr records-page selection + filter state |
| `debtSelectRows()` / `lastPhRows` | `debtSelectRows()` returns whichever row set the shared `#dbtMultiBar` select mode should act on — `lastPhRows` (that person's records, display order) on Per-Person History, `lastDbtRows` on All Debt Records |
| `blockSelect(ids, selected, tappedId)` | pure (from `debts.js`) — returns the new selection as a gap-free block in display order: tapping outside the current block extends it to cover the tap (filling any gap), tapping the block's top (newest) row drops only that row, tapping any other row in the block drops it and everything older; used by both debt screens so a shared statement's "previous" balance is always the true balance before the first selected record |
| `pendingConfirmations` | recurring banner queue (derived, not persisted) |
| `_currentHistoryPersonId` | which person's history is open |
| `PEOPLE_ICONS` / `personIconSvg(id, cls)` | people-icon library (separate from category `ICONS`) |
| `THEMES` / `applyTheme()` / `applyHeaderIcon()` | theming |
| `applyHomeIcon()` | replaces the `apple-touch-icon` `<link>` with a fresh element pointing at `homeIconHref(settings)`; called at startup and on every home-screen-icon change, since iOS only reads the tag at Add-to-Home-Screen time |
| `Fireworks` | IIFE — `.start()` / `.stop()` (Yoimiya only) |
| `setMode(next)` | mode switcher orchestrator |
| `showView(v)` | view router with mode-compatibility gate |
| `personBalances(debts, peopleById, defaultCurrency)` / `totalsAcrossPeople` / `annotateSettlements(debts, defaultCurrency)` | debt math (from `debts.js`); the first and third count only items in the default currency |
| `balanceBefore(debts, recordId, peopleById, defaultCurrency)` | pure (from `debts.js`) — the person's signed outstanding immediately before a record, in the default currency, not-counted items skipped; the Add Debt / split / paid-by sentinel trick calls it with `peopleById` undefined |
| `balanceAfterRecord(debts, recordId, defaultCurrency)` | pure (from `debts.js`) — the person's signed outstanding immediately after a given record: `balanceBefore` (called WITHOUT a people map, so a since-deleted person's history still counts) plus that record's own signed amount (a not-counted target adds nothing); used by `shareDebtStatement` for the footer's `balanceAfter` |
| `planSplit` | pure (from `debts.js`) — decides single-record vs two-record split for an entered debt + computes the split halves |
| `wouldOvershoot` | pure (from `debts.js`) — used by edit guard; true if applying an edit would have triggered the split modal on Add |
| `computeOccurrences` / `applyEndChecks` / `buildRecordFromRule` / `unpauseRule` | recurring math (from `recurring.js`) |
| `reconcileRenames` / `makeRateService` | shared helpers (from `finance-helpers.js`) |
| `amountInDefault(item, def)` / `countNotCounted(items, def)` | pure (from `finance-helpers.js`) — the ONE counting rule (a Number in `def`, or `null` = not counted) and the number of `null` items; used by `app.js`, `debts.js` and `debt-card.js` (see §4 Currency & FX) |
| `applyMarkup(base, pct)` / `clearConversionFields(item)` | pure / in-place (from `finance-helpers.js`) — the card-markup maths and the FX-field wipe, shared by `attachConversion` and `planReconversion` / `runConversion` |
| `summarizeTotals(records, def, currentYear)` | pure (from `finance-helpers.js`) — the Summary page's sums: `{ firstYear, lastYear, years }`, every year in the range present (zeros when empty), `years[y] = { spent, invested, months: [12 × { spent, invested }] }`; counts through `amountInDefault`, rounds to cents (see §4 Views) |
| `summaryAverage(total, year, currentYear, currentMonth)` / `yearsAverage(totals)` | pure (from `finance-helpers.js`) — the average-per-month (÷ current month number for the current year, else ÷ 12) and the mean of yearly totals (0 for an empty list), both rounded to cents |
| `planReconversion(items, def, opts)` | pure, async (from `finance-helpers.js`) — plans the RECORDS half of a convert run (own-date rates); never mutates; resolves `{ ok: true, updates: [{ item, fields }] }` or `{ ok: false, failed, total, failedItems }` |
| `planDebtReconversion(debts, def, opts)` | pure, async (from `debts.js`) — plans the DEBTS half (today's rate, per-person residue pin so settled cycles stay settled); same result shape |
| `reconversionMarkupPct(item, pct)` / `dedupeGetRate(getRate)` / `mapLimit(list, n, fn)` | pure (from `finance-helpers.js`) — the convert run's markup rule, one-request-per-`date:from:to` wrapper, and worker pool |
| `defCur()` / `rowAmount(item, origCls)` / `renderNcWarn(id, n)` / `notCountedShareMsg(list, def)` | `app.js` — current default currency; a row's `{ main, sub }` under the counting rule; the `.nc-warn` screen line; the share-refusal text |
| `renderConvertNotice()` / `afterCurrencySave(prevDef)` / `openConvertModal(c)` / `runConversion(btn)` | `app.js` — Settings notice (`#convertNotice`), post-Save hook, prompt (`#convertModal`), and the all-or-nothing conversion run (guarded by `_converting`) |
| `currencyChoices(list, current)` | pure (from `finance-helpers.js`) — returns `list` plus `current` appended when it's a non-empty string not already in `list`; never mutates `list` — lets an item keep its own currency after it's removed from Settings |
| `iconHref(choice, custom, walletSrc)` | pure (from `finance-helpers.js`) — generic icon-choice resolver shared by all three icon pickers: `"yoimiya"` → `./icon.png`; `"custom"` → `custom` only when it's a valid `data:image/...` string; anything else (including an unrecognized choice) → `walletSrc` |
| `homeIconHref(s)` | pure (from `finance-helpers.js`), built on `iconHref` — resolves `settings.homeIcon`/`homeIconCustom` to an icon URL against `"./icon-wallet.png"` as the wallet default |
| `effectiveIconChoice(choice, custom)` | pure (from `finance-helpers.js`) — names the tile really in effect for a `(choice, custom)` pair, using the same resolution as `iconHref`; a `"custom"` pick with no valid stored picture resolves to `"wallet"` |
| `headerIconHref(s, mode)` | pure (from `finance-helpers.js`), built on `iconHref` — resolves the header icon for `mode` (`"debt"` or finance) against that mode's own choice/picture/wallet default: `"./icon-wallet-red.png"` for `mode === "debt"`, `"./icon-wallet.png"` otherwise |
| `iconChoiceFromPicture(pic)` | pure (from `finance-helpers.js`) — the header-choice inference rule standalone: `"custom"` when `pic` is a `data:image/` string, else `"wallet"`; shared by `migrateIconChoices` and by `buildSettingsPayload`'s fallback for a missing header choice |
| `migrateIconChoices(s)` | mutates-and-returns (from `finance-helpers.js`), built on `iconChoiceFromPicture` — normalizes `headerIconFinanceChoice`/`headerIconDebtChoice`/`homeIcon`/`homeIconCustom` on settings object `s` in place; a missing/invalid header choice becomes `"custom"` when that header's stored picture is a `data:image/` string, else `"wallet"` |
| `ICON_PICKERS` / `renderIconPickers()` | `ICON_PICKERS` is the 3-entry config (home-screen icon + both header icons) driving the shared icon-picker component; `renderIconPickers()` re-renders all three (tile selection, picture/plus visibility) and, for the home entry only, the standalone-mode hiding + hint text |
| `_setIconChoice(p, choice)` / `_iconChoiceSaved(p, choice, pic)` | `_setIconChoice` applies a pick for one `ICON_PICKERS` entry (sets the choice, calls the entry's `apply()`, re-renders, persists, sets the message); `_iconChoiceSaved` is the post-persist read-back check it uses to detect a swallowed storage-write failure |
| `withCurrencyOption(sel, code)` | patches a missing option into an already-filled currency `<select>` via `currencyChoices`; called for `#fCurrency` and `#dbtCurrency` after those are populated — without it a removed currency would read as `""` and silently change on save. `#ruleCurrency` doesn't call it: `populateRuleCurrency` builds its options from `currencyChoices` directly |
| `processRecurring()` | runs at boot + after Restore — generates due records & queues banners |
| `evenShares` / `fillBlanks` | pure (from `debts.js`) — cent-exact splits: evenShares over everyone, fillBlanks over blank fields only |
| `stripSplitBreakdown` | pure (from `debts.js`) — strips the auto-generated "Split bill — total …" breakdown from a notes string, leaving the user's own notes; used by Duplicate so a copy doesn't inherit a breakdown tied to the original save's debts |
| `splitPeople` / `splitMine` / `splitLastEdited` / `solve2p` / `syncSplitSection` / `renderSplitRows` | split-the-bill state + UI (Add Record modal) |
| `planPaidBy` | pure (from `debts.js`) — picks paid-back vs borrow from the payer's balance and delegates overshoot to planSplit; returns `{ records }` |
| `paidByPersonId` / `syncPaidBySection` / `buildPaidByPersonMenu` | paid-by-someone-else state + UI (Add Record modal) |
| `openModal(record, prefill)` | Add/Edit modal opener; `record` with an id → Edit (PUT); `prefill` → Add pre-filled (used by Duplicate). Optional `prefill` opens Add mode with fields copied from it (type, category, sub, amount, currency, notes); never carries a date, id, or ruleId, so the copy starts today, unsaved, and unlinked |
| `window.__pendingOnSaved` | one-shot post-save callback; armed by banner Edit & Confirm (`editPending`) to stamp `ruleId` and advance the rule; `closeModal` always clears it so an abandoned edit can't leak into the next unrelated save |
| `shareDebtRecords(list)` | renders + shares N debt PNGs oldest-first in one share sheet; `shareDebtRecord(d)` is a 1-element wrapper |
| `shareDebtStatement(debtList)` | shares 2+ of ONE person's records as a single statement PNG (Per-Person History select mode, 2+ selected); same busy guard, alerts and share/fallback rules as `shareDebtRecords` |
| `debtCardModel` | pure (from debt-card.js) — every string + flag the share card draws (wording, FX line, balance math, settled) |
| `renderDebtCard(opts)` | canvas renderer (from debt-card.js); takes an options object and the person's icon SVG injected by the caller |
| `statementModel` | pure (from `debt-card.js`) — content model for the multi-record statement image: chronologically-sorted rows, the same-direction subtotal, and the running-balance footer math (`previous = balanceAfter − the selected net`) |
| `renderStatementCard(opts)` | canvas renderer (from `debt-card.js`) for the statement image; steps its device-pixel ratio down for a long statement to stay under iOS's canvas-area cap |
| `drawOutstanding(ctx, y, m)` | (from `debt-card.js`) — draws the shared Outstanding footer (dark card, green + checkmark when settled); used by both `renderDebtCard` and `renderStatementCard`, whose models expose the same field names |
| `ECB_CURRENCIES` / `isEcb` | 31-code ECB set — selects Frankfurter vs currency-api in the rate service |
| `NO_SUB_LABEL` | "No Sub-category" — shared donut-slice + list-filter key for records without a sub |
