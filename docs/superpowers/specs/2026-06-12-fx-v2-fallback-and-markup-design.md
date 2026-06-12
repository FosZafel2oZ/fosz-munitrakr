# FX v2 — Universal Currency Fallback + Card Markup — Design

**Date:** 2026-06-12
**Status:** Approved
**Target version:** v71

## Summary

Two changes to the FX pipeline (`public/finance-helpers.js` `makeRateService`,
consumed by both MuniTrakr records and DebtTrakr debts):

1. **Fallback rate source** so every ISO currency auto-converts (VND, LAK,
   KHR, TWD, MMK, …), not just the 31 ECB currencies Frankfurter serves.
2. **Global "Card FX markup %" setting** applied on top of every fetched rate
   to match credit-card statement amounts (user pays with KTC; Thai cards add
   up to 2.5%).

## Decisions (user-approved)

| Question | Decision |
|---|---|
| Currency scope | All ~200 ISO currencies. Frankfurter stays primary for the 31 ECB codes; currency-api covers the rest. |
| Markup mode | Global, always applied to every auto-conversion. No per-record toggle. |
| Markup on debts | Yes — same global markup, no toggle. |
| Manual rates | Markup is NOT applied to manually-typed rates (they come from statements). |
| Markup default | 0 (off). User sets 2.5 in Settings. |
| Offline behavior | Unchanged from today's ECB-pair behavior: save marks `rateUnavailable`; re-save/edit later converts. The pre-emptive manual-rate field is removed (its trigger condition — a currency with no data source — no longer exists). |

## A. Rate source chain (`makeRateService.getRate`)

Verified facts about the fallback API (probed 2026-06-12):
- `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{YYYY-MM-DD}/v1/currencies/{from}.json`
  and `@latest` for today; mirror host `https://{date|latest}.currency-api.pages.dev/v1/currencies/{from}.json`.
- Currency codes are **lowercase** in URLs and payload keys.
- Payload shape: `{ "date": "YYYY-MM-DD", "{from}": { "{to}": rate, ... } }` —
  rate is "how many `to` per 1 `from`" (multiply, same direction as Frankfurter).
- CORS `access-control-allow-origin: *`; no rate limits; daily updates;
  VND/LAK/KHR/TWD/MMK all present. Historical data exists from ~2024 onward.

New chain in `getRate(from, to, date)` (after the same-currency and cache
checks, which are unchanged):

1. **Frankfurter** when `isEcb(from) && isEcb(to)` — current code path,
   unchanged URL.
2. **currency-api** otherwise (and NOT as a retry when Frankfurter itself
   fails — ECB pairs keep today's fail-to-`rateUnavailable` behavior):
   - tag = `latest` when the (already-clamped) date equals today, else the
     date string;
   - try jsDelivr URL; on any failure try the pages.dev mirror;
   - read `json[from.toLowerCase()][to.toLowerCase()]`; missing/non-finite →
     null.
3. Any failure → `null` → `rateUnavailable` (existing semantics).

Cache: unchanged key `date:from:to`, stores the **base** (pre-markup) rate.

Dependency rename in `makeRateService(deps)`: `isConvertible` becomes `isEcb`
(it now selects the source rather than gating convertibility).
`pairAutoConvertible(from, to)` becomes `from !== to && both truthy` and is
kept only for the one UI call site that needs it (see §C).

## B. Card FX markup

- New setting `settings.fxMarkupPct` (number, percent). `loadStore()`
  migration defaults it to `0`.
- `attachConversion(r, manualRate, defaultCurrency, markupPct)` applies:
  `effective = baseRate * (1 + markupPct / 100)` — only on the fetched-rate
  path, never on the manual-rate path.
- Stored on the record: `r.rate = effective` (so the existing "original
  currency × rate" display line stays truthful), `r.convertedAmount =
  round2(amount * effective)`, plus `r.fxMarkupPct = markupPct` when
  `markupPct > 0` (provenance).
- Applies everywhere `attachConversion` runs: Add/Edit Record, recurring
  backfill, Add/Edit Debt, split-the-bill debts.

### Settings UI (Preferences block, below Default currency)

Label: `Card FX markup %` — `<input type="number" step="0.1" min="0" max="10">`
+ Save button + hint: "Added on top of market rates so converted amounts match
your credit-card statement (Thai cards charge up to 2.5%). 0 = off." Follows
the existing Preferences row pattern (`saveDefCurrency` style: save → PUT
/settings → confirmation message).

## C. app.js changes

- `CONVERTIBLE` set renamed `ECB_CURRENCIES`; `isConvertible` renamed `isEcb`;
  passed to `makeRateService` as the `isEcb` dep.
- All `attachConversion(...)` call sites pass
  `Number(settings.fxMarkupPct) || 0` (records side reads the `settings`
  global; debts side reads `store.settings` — both refreshed before use as
  today).
- **Manual-rate field removal:** `updateManualRateField()` (records) and the
  debt-modal equivalent now always hide the field; their internal logic and
  the `manualRate` parameter plumbing stay (existing records with
  `manualRate: true` still render their badge/lines; the service still honors
  a manual rate if passed). The Add-Record/Add-Debt validation branches that
  required a manual rate when the field was visible become dead and are
  removed.
- Currency-add validation (`isRealCurrency`, ISO check) unchanged — it is what
  guarantees every listed currency is fetchable.
- Settings → Currencies hint text ("not auto-convertible" message at
  app.js:2151-2152) updated: every ISO currency now auto-converts, so the
  negative message changes to a neutral "will auto-convert" confirmation.

## Tests (`tests/finance-helpers.test.js`)

Reworked/new (injected `fetch` controls all outcomes):
- ECB pair (EUR→THB) fetches the Frankfurter URL (assert URL prefix).
- Non-ECB pair (VND→THB) fetches the jsDelivr currency-api URL with lowercase
  codes and `@latest` tag for today / `@{date}` for past dates.
- jsDelivr failure → pages.dev mirror URL tried; success returns its rate.
- Both fallback hosts fail → null → `rateUnavailable`.
- Markup: `markupPct = 2.5` → `rate` on record = base × 1.025, convertedAmount
  rounded to 2dp; `fxMarkupPct` stored.
- Markup NOT applied when manual rate is used.
- Cache stores the base rate (fetch once, attach twice with different markups
  → same cached base, different effective rates).
- Existing tests referencing old "non-convertible pair" semantics updated to
  the new chain.

Suite count grows; update `handover.md` count accordingly.

## Release

- Lockstep bump to **v71**.
- handover.md: §4 Currency & FX rewrite (source chain, markup, manual-field
  removal note), data-model note for `fxMarkupPct` on records + settings,
  test count, version refs.

## Out of scope

- Per-record card/cash toggle (rejected: global always-on chosen).
- Visa/Mastercard official rates (no public CORS API; settlement-date rates
  unknowable at entry time).
- Re-converting existing saved records when the markup setting changes
  (records keep the rate they were saved with; edit a record to re-convert).
- Offline manual-rate entry escape hatch (explicitly accepted by user).
