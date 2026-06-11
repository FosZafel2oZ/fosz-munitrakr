# Split the Bill — Design

**Date:** 2026-06-11
**Status:** Approved
**Target version:** v69

## Summary

When adding an expense record in MuniTrakr, the user can optionally split the bill
with people from DebtTrakr. The saved expense uses only the user's own share; one
`lend` debt record per other participant is created automatically on the DebtTrakr
side. Notes on both sides record the full breakdown.

## Decisions (user-approved)

| Question | Decision |
|---|---|
| User's own row amount | Auto-remainder: `total − sum(others)`, read-only. Red + save blocked if negative. |
| Recurring × split | Mutually exclusive. Checking one hides the other section. |
| Expense ↔ debts linkage | Independent after creation. No cross-references; later edits/deletes don't sync. |
| Edit flow | Split section appears in Add flow only; hidden when editing an existing record. |
| User's share = 0 | Allowed (expense of 0, all lends). |
| Even-split rounding | 2 decimals; remainder goes to the user's share so friends' debts are clean. |
| Investment type | Split section hidden when type = Investment. |

## UI

Location: inside `#recordForm` in the Add Record modal, after Notes, above the
recurring section. Follows the existing "Make this recurring" `row-toggle` pattern.

- **Checkbox "Split the bill"** — disabled with muted hint "Enter the total amount
  first" until `fAmount > 0`. Hidden when editing or when type = Investment.
- Expanded body:
  - **User's row first**: display name from `store.profile.displayName` (default
    "Me") + read-only auto-remainder amount.
  - **Person rows**: colored person icon (`personIconSvg`) + name + amount input
    (`type=number`, same styling as other inputs) + remove ×.
  - **"+ Add person"**: picker menu listing `settings.people` not yet added, plus
    an inline new-person mini-form (color + name) matching `#dbtAddPersonForm` in
    the Add Debt modal. New people are persisted to `settings.people` immediately.
  - **"Split evenly" button**: `evenShares(total, 1 + N)` — overwrites all rows.
- Live recompute of the user's remainder on any amount change (total or shares).
- Styling uses only existing theme variables (`--card`, `--line`, `--accent`,
  `--muted`, `--out`) so all three themes (default / Aero / Yoimiya) work without
  per-theme overrides.

## Save flow (Add branch of `#recordForm` submit)

1. Validations (in addition to existing ones), only when split is checked:
   - at least one other person;
   - every person share > 0;
   - `sum(others) ≤ total` (user remainder ≥ 0).
2. Expense payload `amount = user's share` (not the total). Existing FX /
   manual-rate path runs unchanged on the reduced amount.
3. Auto-appended to expense notes (own line, after user's notes):
   `Split bill — total 1,000 THB: Me 333.34 · Boat 333.33 · Mama 333.33`
4. Per other participant, one debt record:
   - `type: "lend"`, `personId`, `amount = share`, same `currency`, same `date`;
   - same manual rate when the manual-rate field is visible;
   - `attachConversion` per debt (rate service cache ⇒ one network call);
   - notes: `Split bill (Category / Sub) — total 1,000 THB` + user notes if any;
   - inserted via `insertSingleDebt` (no overshoot/planSplit involvement —
     `lend` is math-identical to `pay-back`, always safe).
5. Modal closes and records list refreshes as usual.

## Pure helpers (in `public/debts.js`, UMD)

- `evenShares(total, count)` → array of `count` 2-decimal amounts summing exactly
  to `total`; index 0 (the user) absorbs the rounding remainder.
- Share-sum / remainder math used by the live UI where practical.

## Tests

- New unit tests in `tests/debts.test.js` for `evenShares`: exact sum, remainder
  to index 0, count = 1, fractional totals, large counts.
- Suite must stay green; update the test count in `handover.md`.

## Release

- Bump `APP_VERSION` (app.js) and `CACHE` (sw.js) to `v69` in lockstep.
- `node --check` both files; `node tests/run.js`; push to deploy via Cloudflare
  Pages.

## Out of scope

- Editing/re-splitting an existing split record.
- Cross-links or cascade deletes between the expense and its debts.
- Split on investment records or recurring rules.
