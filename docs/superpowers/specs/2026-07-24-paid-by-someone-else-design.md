# "Paid by someone else" — Design Spec

**Date:** 2026-07-24 · **Approved by:** Bill (design walked through in chat, Approach A chosen)
**Ships as:** v79

## Problem

Sometimes someone else (typically Bill's brother) pays for Bill's stuff. Today that takes two manual entries: the expense in MuniTrakr, then a debt in DebtTrakr. The debt side should happen automatically, netting against anything that person still owes Bill first.

## Decisions already made (do not re-open)

- **Approach A**: reuse the Add Debt modal's machinery (`balanceBefore` sentinel walk → settling-type entry → `planSplit` overshoot split), inserted silently on save. No confirmation modal.
- **Mutually exclusive** with both *Split the bill* and *Make this recurring* — checking one hides the others, both directions.
- **Debt note = user's notes + auto tag**, middle-dot separated (split-bill convention): `<notes> · Paid for <myName> — <category> <amount>`; auto tag alone when the user typed no notes.
- The expense itself saves **unchanged**: full amount, Bill's category/date/currency. It is still Bill's spending; the payer only fronted the money.

## UI (Add Record modal)

- New section under the *Split the bill* section: a `row-toggle` checkbox **"Paid by someone else"** (`#paidByToggle`), with body `#paidByBody` revealed when checked.
- Visible only when `!editingId && modalType === "expense"` and neither split nor recurring is active — exactly the split section's gating pattern, extended three-way:
  - paidBy checked → split section AND recurring section hidden;
  - split or recurring checked → paidBy section hidden;
  - any hide-path also unchecks + resets the hidden feature's state (mirror `syncSplitSection`'s `!allowed` reset).
- Body content: a person picker (`#paidByPersonBtn` opening `#paidByPersonMenu`) listing all DebtTrakr people (colored icon tile + name, same row markup as split's menu) plus **"+ New person"**, which opens an inline name+color mini-form (`#paidByNewPersonForm`, same pattern as `#splitNewPersonForm`; Enter saves the person, not the record form; new person is auto-selected).
- The selected person renders next to the button as icon + name. No amount input — the debt amount is always the expense amount.
- State: `paidByPersonId: string|null`. Reset to null (and checkbox unchecked, mini-form hidden) on every `openModal`, and whenever the section is force-hidden.
- Unlike split, the toggle is **not** disabled by an empty amount (it needs no live math); the transiently-empty-total rule from v77 applies: never wipe paidBy state because `#fAmount` reads blank mid-edit.

## Save flow (`#recordForm` submit handler)

Ordering within the existing handler:

1. Existing validations run first (category/date/amount, split block untouched).
2. **New validation, before anything saves:** if paidBy is active (`!editingId && modalType === "expense" && #paidByToggle checked`) and `paidByPersonId` is null → visible error `"Choose who paid for you"`, save blocked. If the stored person no longer exists at save time (deleted mid-entry), same error.
3. Expense saves exactly as today (`POST /records`).
4. Then, if paidBy is active, create the debt side **silently, batched in one `saveStore()`**:

```
myName  = store.profile.displayName || "Me"
autoTag = "Paid for " + myName + " — " + category + " " + fmt(amount, currency)
notes   = userNotes ? userNotes + " · " + autoTag : autoTag

entered = { personId, date: payload.date, amount: payload.amount,
            currency: payload.currency, notes }          // type set by planPaidBy
attachConversion(entered)  catch → entered.rateUnavailable = true
loadStore()
balanceBeforeSigned = balanceBefore(store.debts + sentinel-copy-of-entered, sentinel)
                      // identical sentinel construction to the Add Debt ADD branch
records = planPaidBy(entered, balanceBeforeSigned, defaultCurrency).records
stamp ids/createdAt (first = Date.now(), second = +1ms), push all, ONE saveStore()
```

- `fmt` is the existing app-wide money formatter.
- Backdated expenses inherit the Add Debt modal's behavior: the sentinel sorts by the record's date, so the balance is computed as of that date.
- Offline/conversion failure: if the expense currency differs from the default AND the payer's balance requires netting (balance > 0 as of the expense date), the save is blocked pre-save with a visible message — planSplit's halves are minted in the default currency and a rate-less conversion would store wrong money unrepairably. Otherwise (same currency, or no netting needed) the single debt inserts carrying `rateUnavailable`, same as the Add Debt modal offline.

## `planPaidBy` (new pure function, `public/debts.js`)

```
planPaidBy(entered, balanceBeforeSigned, defaultCurrency) -> { records: Debt[] }
```

- Invalid input (`entered` not an object, or `Number(entered.amount)` not finite and > 0) → `{ records: [] }`.
- `balanceBeforeSigned > 0` (they owe me): set `entered.type = "paid-back"`, delegate to `planSplit(entered, balanceBeforeSigned, defaultCurrency)` → `records = [plan.a]` or `[plan.a, plan.b]` (overshoot: paid-back settles the cycle, borrow opens the new one, both halves in default currency — `planSplit`'s existing convention).
- `balanceBeforeSigned <= 0` (clear, or I already owe them): `entered.type = "borrow"` → `records = [entered]`.
- Pure: no store/DOM access; does not mutate its inputs beyond returning new/typed records (implementation may copy `entered` rather than mutate — either way the RETURNED records carry the type).
- Exported from the UMD return object; consumed by `app.js` as a browser global.

**Tests (TDD, `tests/debts.test.js`):** clear balance → single borrow; they-owe > amount → single paid-back (full amount, original currency kept); they-owe == amount exactly → single paid-back (no split — settles the cycle); they-owe < amount → two records with the exact split amounts/types in default currency; I-owe (negative balance) → single borrow; converted amount used for the math when `convertedAmount` present; invalid amount → empty. Suite grows 129 → 136 (7 new).

## Non-goals (v1)

- No combining with Split the bill or recurring rules (mutually exclusive; a recurring rule never carries a payer).
- No edit-flow support (Add only, like split); editing the expense later does NOT touch the debt records — they are independent once created, exactly like split-bill debts.
- No investment-type support.
- No new share-card or history UI — the created records are ordinary debts and render with all existing machinery.

## Release

- Lockstep bump `APP_VERSION` / `CACHE` to v79 / `munitrakr-v79`.
- Handover: §4 gains a "Paid by someone else" bullet (mirroring the split-bill bullet's level of detail); §10 glossary gains `planPaidBy` and the `paidByPersonId` state global; test counts 129 → 136.
- All existing gates: `node --check` on touched files, full suite green before every commit, push only on Bill's say-so.
