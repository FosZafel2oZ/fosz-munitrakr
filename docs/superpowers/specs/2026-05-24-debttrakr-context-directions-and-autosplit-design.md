# DebtTrakr · Context-aware directions + auto-split overshoots

**Date:** 2026-05-24
**Mode:** DebtTrakr
**Status:** Approved (design)

## Goal

Make the Add Debt modal show only the direction options that make sense for the selected person's current outstanding balance, standardise badge grammar across the app, and handle the case where a settle-style record exceeds the outstanding balance by auto-splitting into two records (one that closes the cycle, one that opens a fresh cycle in the opposite direction).

## Motivation

Today the modal always shows three direction buttons (Lend / Borrow / Paid back) regardless of context. This leads to category errors — e.g. recording a "Lend" when you meant "Paid back" (as seen in the v55 share-card screenshot). Picking the wrong direction produces a valid-but-wrong cycle in the math and a misleading badge in shared images.

A second long-standing footgun: a `paid-back` record larger than the person's outstanding can drive the running net past zero, leaving the relationship in a weird state where the cycle-reset logic doesn't fire (the reset requires `lent === back`, not `back > lent`) and the next record gets messy math.

The fix is to (a) narrow the modal options to what's legal given the current balance, and (b) on overshoot, ask the user to confirm a clean two-record split that settles the existing cycle and opens a new one in the opposite direction.

## 1. Modal direction options (context-aware)

The Add Debt modal computes the selected person's current outstanding balance via `personBalances(...)` and renders **two** direction buttons:

| Person's outstanding | Options shown | Default selected |
|---|---|---|
| Clear (0) | `Lend` / `Borrow` | `Lend` |
| They owe you (positive) | `Lend (more)` / `Paid back` | `Paid back` |
| You owe them (negative) | `Pay back` / `Borrow (more)` | `Pay back` |

- Newly-added people via the inline `+ Add Person` form fall into the **Clear** bucket (their balance is 0).
- Changing the selected person re-evaluates the context and re-renders the two buttons. If the user has typed an amount, the amount is preserved; the selected direction defaults to the new context's default.
- The `(more)` modifier on `Lend (more)` / `Borrow (more)` is shown only when outstanding ≠ 0 in the same direction. The plain `Lend` / `Borrow` labels are shown in the Clear bucket.

## 2. Match outstanding chip (kept, unchanged behaviour beyond labelling)

- Only renders when outstanding ≠ 0.
- Tapping the chip fills the amount field with the outstanding value AND auto-selects the **settling** direction:
  - they-owe → `Paid back`
  - i-owe → `Pay back`
- Overrides any previous direction selection.
- Label text unchanged: `Match outstanding`.

## 3. Auto-split on overshoot

### When it triggers

On Save in the Add Debt modal, if **all** of the following hold:

1. Direction is `Paid back` (they-owe context) or `Pay back` (i-owe context).
2. The entered amount, expressed in the user's default currency, is **strictly greater** than the person's current outstanding (also in default currency, using `convertedAmount` where available).

### What happens

A confirmation modal pops up showing a preview of the two records that would be created:

```
┌────────────────────────────────────────┐
│  Split into 2 records?                 │
│                                        │
│  This is more than what Mama owes you. │
│  We'll split it into:                  │
│                                        │
│   1. Paid back  THB 100   ✓ Settled    │
│   2. Borrow     THB 150   (new)        │
│                                        │
│            [ Cancel ]   [ Split ]      │
└────────────────────────────────────────┘
```

- **Cancel** closes the confirm modal, leaves the Add Debt modal open with the user's input intact so they can adjust.
- **Split** creates two records and closes both modals.

### How records are split

Given the user's entered record `R` (type, amount, currency, notes, date, etc.) and the person's current `outstanding` (signed, in default currency):

- **Record A (settle):**
  - `type` = the user's chosen settling type (`paid-back`)
  - `amount` = `|outstanding|` (closes exactly to zero)
  - `currency` = see "Currency rules" below
  - `notes` = `R.notes` (copied verbatim)
  - `date` = `R.date`
  - `createdAt` = `now()` ms
  - Converted fields populated normally via the existing `attachConversion` pipeline.

- **Record A (settle), `type` clarification:**
  - User picked `Paid back` (they-owe context, type `paid-back`) → Record A is `paid-back`.
  - User picked `Pay back` (i-owe context, type `pay-back`) → Record A is `pay-back`.

- **Record B (new cycle):**
  - `type` = opposite direction:
    - User was `Paid back` in they-owe context → Record B is `borrow` (they over-paid; you now owe them the remainder).
    - User was `Pay back` in i-owe context → Record B is `lend` (you over-paid; they now owe you the remainder).
  - `amount` = `enteredAmount − |outstanding|` (in the unit the user typed; see "Currency rules")
  - `currency` = same as Record A
  - `notes` = `R.notes` (copied verbatim — same physical event)
  - `date` = `R.date`
  - `createdAt` = `recordA.createdAt + 1` ms (guarantees A sorts before B per `_chronoCmp`)
  - Converted fields populated normally.

### Currency rules

- **Same-currency overshoot** (record's `currency === defaultCurrency`, or the record has no conversion): both halves use the record's currency. Amounts in `R`'s original units split cleanly.
- **Cross-currency overshoot** (record's `currency !== defaultCurrency`): both halves are recorded **in the default currency only**. The original-currency info (`R.currency`, `R.amount` as USD etc.) is **dropped on the split**. Amounts are computed from the converted defaults so the math balances perfectly.
  - Concretely: `recordA.amount = |outstanding|` in default currency, `recordA.currency = defaultCurrency`. Same for B. No `convertedAmount`/`convertedCurrency`/`rate` fields (it's already in default currency).
  - Rationale: prorating original-currency amounts produces ugly fractional values the user didn't enter. Recording in default currency is cleaner at the cost of losing the "this was actually USD 8" provenance — accepted trade-off per design discussion.

## 4. Edit guard against overshoot

When the user opens the edit modal for an existing record:

- Edits that don't change the amount (e.g., editing notes or date) are unaffected — no overshoot check.
- Edits that change the amount are validated on Save:
  1. Take the person's full debts list **excluding the record being edited**.
  2. Compute the cycle state at this record's chronological position (date + createdAt) using the same logic as `personBalances`.
  3. Apply the edited record's new (type, amount) to that cycle state.
  4. If the resulting cycle would have triggered the auto-split confirm modal had it been an Add (i.e., a settling-type record with amount > the cycle's open balance), **block Save**.
- Inline error message in the modal:

  > "This edit would overshoot the outstanding balance. Delete this record and add a new one instead."

- No split modal on edit. Splits are an Add-only flow. This keeps editing simple and prevents edits from spawning new records that could ripple cycle state through subsequent history.

A new pure helper in `debts.js` — `wouldOvershoot(debts, editedRecord) → boolean` — encapsulates this check and is unit-testable.

## 5. New `pay-back` type + badge grammar cleanup

### New type

A fourth type is added: **`pay-back`**. It is mathematically identical to `lend` (both increment the cycle's `lent` accumulator), but semantically distinct: `pay-back` means "I paid them back," while `lend` means "I gave them money fresh." This split is needed so the history badge can read **Paid back** when the user logged a "Pay back" action in the i-owe context, instead of the misleading **Lent** that the existing single-type-for-both design produces.

Updated full type set (data model): `lend | borrow | paid-back | pay-back`

Cycle-math arms in `debts.js`:
- `lent` accumulator: `lend`, `pay-back`
- `back` accumulator: `borrow`, `paid-back`

`personBalances`, `annotateSettlements`, `balanceBefore`, and `wouldOvershoot` all update accordingly (one extra arm in each type-check).

### Data migration

None. Existing records keep their old type (`lend | borrow | paid-back`). New records may be `pay-back`. No legacy "I paid them back" records can be retroactively reclassified — they stay as `lend` and continue to render as **Lent** in history. This is accepted: rewriting historical types would silently change the meaning of existing rows.

### Direction → type mapping (Add Debt modal)

| Person's outstanding | Button | Saved `type` |
|---|---|---|
| Clear | `Lend` | `lend` |
| Clear | `Borrow` | `borrow` |
| They-owe | `Lend (more)` | `lend` |
| They-owe | `Paid back` | `paid-back` |
| I-owe | `Pay back` | **`pay-back`** |
| I-owe | `Borrow (more)` | `borrow` |

### Badge labels

| `type` | History row badge | Share-image badge |
|---|---|---|
| `lend` | **Lent** | **Lent** |
| `borrow` | **Borrowed** | **Borrowed** |
| `paid-back` | **Paid back** | **Paid back** |
| `pay-back` | **Paid back** | **Paid back** |

Modal buttons stay infinitive (`Lend` / `Borrow` / `Pay back` / `Paid back`). History badges all past tense.

The share-image renderer's `dirLabel` ternary updates to a 4-way branch matching the table above.

## 6. Code touch points

- `public/app.js`:
  - Add Debt modal direction renderer — rebuild to read `personBalances` for the selected person, render the two context-appropriate buttons. Re-render when person selection changes.
  - Match-outstanding chip behaviour — keep, but update the auto-selected direction to use the settling type relative to context.
  - Add Save-time overshoot detection: if overshoot, call `openSplitConfirmModal(preview)` instead of saving directly.
  - New helpers: `openSplitConfirmModal(preview)`, `saveDebtWithMaybeSplit(record)` (or inline equivalents).
  - Edit modal Save-time overshoot guard (inline error).
  - History row badge text: change `Borrow` → `Borrowed`.
  - Share-image renderer `dirLabel`: change `Borrow` → `Borrowed`.
- `public/index.html`:
  - Add the split-confirm modal scaffold (overlay + body + Cancel/Split buttons).
- `public/debts.js`:
  - Update `personBalances`, `annotateSettlements`, `balanceBefore` so the `lent` accumulator branch matches `lend || pay-back` and the `back` branch matches `borrow || paid-back`. One extra arm in each.
  - Add `planSplit(enteredRecord, balanceBeforeSigned, defaultCurrency) → { split: bool, a: Record, b?: Record }` — pure function that takes the user's intended record + the current outstanding (signed) + the default currency, and returns either a single-record plan or a two-record split plan. Encapsulates the currency rules, amount math, and createdAt offset. Handles the new `pay-back` type symmetrically with `paid-back` for overshoot detection.
  - Add `wouldOvershoot(debts, editedRecord) → boolean` — pure function used by the edit guard. Returns true if applying `editedRecord` (matched by id against `debts`) would produce a settling-type record whose amount exceeds its cycle's open balance.
- `tests/debts.test.js`:
  - Unit tests for `planSplit`:
    - they-owe + exact match → no split.
    - they-owe + overshoot, same currency → two records, both in that currency.
    - they-owe + overshoot, cross currency → two records, both in default currency, no `convertedAmount`/`convertedCurrency`.
    - i-owe symmetric cases.
    - i-owe + overshoot triggering `lend` Record B.
    - Edge: outstanding 0 → never splits (the entered direction is `Lend`/`Borrow`, not a settling type, so logic just returns single-record plan).
- `public/sw.js` + `public/app.js`: bump `CACHE` and `APP_VERSION` to `v57`.
- `handover.md`: bump version markers + update §5 (DebtTrakr — Add Debt modal) + glossary entry for `planSplit`.

## 7. Edge cases

- **Outstanding is 0:** modal shows `Lend` / `Borrow` only. No split path reachable (those types don't trigger split). Match chip not rendered.
- **Exact match (entered amount === |outstanding|):** no split modal. Record is created as a single record, settles cycle naturally via existing `personBalances` logic.
- **User cancels the split confirm modal:** Add Debt modal remains open with all fields intact (amount, notes, date, direction). User can adjust and re-save.
- **Person is deleted while modal is open:** existing behaviour — Save fails validation. Not introducing new logic for this race.
- **Currency conversion unavailable (`rateUnavailable: true`) and the record's currency ≠ default:** treat as cross-currency overshoot only if the manual rate has been entered; if manual rate is missing, the Save was already blocked by existing validation, so the split logic never runs.
- **Amount entered is less than outstanding:** never triggers split. Just shrinks the cycle.
- **Person changes between modal open and Save:** the direction selector re-renders on person-change, so by Save time the selected direction is always valid for the chosen person. If the user manually preserves a now-invalid selection through some race, the overshoot logic still works against the new person's balance.

## 8. Out of scope (this iteration)

- Multi-step splits (entered amount > 2× outstanding crossing into yet another cycle). The new cycle just starts at the remainder.
- "Undo" of an auto-split as a single action. User deletes the two records individually via the existing delete flow.
- Cross-currency split that preserves original-currency proration. Default-currency-only split is the chosen trade-off.
- Reverse-direction overshoot (e.g. `Lend more` with a huge amount that the user mentally splits as "lend + extra gift"). The `(more)` directions grow in one direction only; no overshoot possible.
- Edits that trigger splits. Edit always 1:1; overshoot blocked with error message.
- Bulk-edit overshoot validation in All Debt Records (no bulk edit exists for amount today).

## 9. Testing

- **Unit:** `tests/debts.test.js` covers:
  - `personBalances` + `annotateSettlements` + `balanceBefore` correctly handling the new `pay-back` type (math equivalence with `lend`).
  - `planSplit` across the cases listed in §6 (same-currency settle exact, same-currency overshoot they-owe, same-currency overshoot i-owe, cross-currency overshoot, no-overshoot single-record case).
  - `wouldOvershoot` for: amount-bump on a paid-back record into overshoot, amount-decrease that stays valid, type-change that creates overshoot, no-op edit.
  - Aim ~10-12 new tests.
- **Manual:**
  - Add new person → modal shows `Lend` / `Borrow`, default `Lend`. ✓
  - Existing person they-owe → modal shows `Lend (more)` / `Paid back`, default `Paid back`. ✓
  - Tap Match outstanding while in they-owe → amount fills, direction switches to `Paid back`. ✓
  - Type amount > outstanding with `Paid back` selected → confirm modal opens with correct preview. ✓
  - Click Split → two records appear in person history, settle record has Settled badge, new record opens new cycle. ✓
  - Cancel split → Add modal stays open with input preserved. ✓
  - Cross-currency overshoot (e.g. USD record, THB default): two halves appear with THB amounts, no original-currency line. ✓
  - Edit existing record, bump amount past outstanding → save blocked, error shown. ✓
  - All history badges show past tense (`Lent` / `Borrowed` / `Paid back`). ✓
  - Share image direction badge uses past tense.

## 10. Release

- Bump `APP_VERSION` in `app.js` and `CACHE` in `sw.js` together to `v57` (per handover §8).
- Update handover.md version markers, §5 Add Debt modal description, glossary entry.
- Verification gate: `node --check public/app.js && node --check public/sw.js && node tests/run.js`. Test count goes from `79/79` to roughly `85-87/85-87` depending on final `planSplit` test count.
