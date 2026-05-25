# DebtTrakr · Context-aware directions + auto-split overshoots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Add Debt modal show only the two direction options that make sense for the selected person's current outstanding balance, introduce a new `pay-back` type so "I paid them back" reads correctly in history, auto-split overshoot settle records into a clean settle + new-cycle pair after explicit user confirmation, block edits that would create overshoots, and standardise badge grammar to past tense.

**Architecture:** Pure cycle-math helpers (`planSplit`, `wouldOvershoot`, plus the updated existing helpers) live in `public/debts.js` (UMD, Node-testable). Add Debt modal direction selector becomes JS-rendered from the chosen person's outstanding balance. Save flow funnels through a single `saveDebtWithMaybeSplit` orchestrator that decides single-record vs split-with-confirmation. Edit Save uses `wouldOvershoot` as an inline guard. Display layer updates ripple through three `dirLabel` sites.

**Tech Stack:** Vanilla JS (no build), Canvas 2D (for share image), Node test runner at `tests/run.js`.

**Note on this project:** there is no git repo (handover §9). "Commit" steps below are replaced with a single **save point** at the end of each task: run `node --check public/app.js && node --check public/sw.js && node tests/run.js` (or the subset relevant to the task) and confirm pass before moving on.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `public/debts.js` | Pure cycle/balance math (UMD). Add `pay-back` arm to existing helpers; add `planSplit` + `wouldOvershoot`. | Modify |
| `tests/debts.test.js` | Unit tests for `debts.js`. Add tests for new `pay-back` math + `planSplit` + `wouldOvershoot`. | Modify |
| `public/index.html` | Add `#debtSplitModal` overlay scaffold. The `#debtTypeToggle` becomes empty (populated by JS); also drop the 3 hardcoded buttons. | Modify |
| `public/styles.css` | Tiny rule for `.dbt-split-preview` rows. | Modify |
| `public/app.js` | Three `dirLabel` callsites updated; modal direction selector rebuilt as `renderDebtDirectionToggle`; `refreshMatchOutstanding` updated to use new types; `saveDebtFromModal` refactored to route through split orchestrator; edit-overshoot guard; bump `APP_VERSION`. | Modify |
| `public/sw.js` | Bump `CACHE`. | Modify |
| `handover.md` | Version refs, type-set update in §3, Add-Debt-modal update in §5, glossary additions. | Modify |

No new files.

---

## Task 1: `debts.js` — add `pay-back` arm to existing helpers + tests

**Files:**
- Modify: `public/debts.js` (three functions: `personBalances`, `annotateSettlements`, `balanceBefore`)
- Test: `tests/debts.test.js`

The current cycle-math arms read:
```js
if (d.type === "lend") lent += amt;
else if (d.type === "borrow" || d.type === "paid-back") back += amt;
```

After this task they read:
```js
if (d.type === "lend" || d.type === "pay-back") lent += amt;
else if (d.type === "borrow" || d.type === "paid-back") back += amt;
```

Same change in all three functions.

- [ ] **Step 1: Write the failing tests**

Append to `tests/debts.test.js`:

```js
test("personBalances: pay-back behaves identically to lend in cycle math", () => {
  // I owe Mama 100 (one borrow record). I pay back 100 via pay-back -> cycle resets to 0.
  const debts = [
    { id: "a", type: "borrow",   personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
    { id: "b", type: "pay-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 100 },
  ];
  const peopleById = { p1: { id: "p1" } };
  const b = D.personBalances(debts, peopleById);
  const row = b.get("p1");
  assert.equal(row.lent, 0);
  assert.equal(row.back, 0);
  assert.equal(row.outstanding, 0);
  assert.equal(row.direction, "clear");
});

test("annotateSettlements: pay-back can close a cycle", () => {
  const debts = [
    { id: "a", type: "borrow",   personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
    { id: "b", type: "pay-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 100 },
  ];
  const map = D.annotateSettlements(debts);
  assert.equal(map.get("b").settled, true);
  assert.equal(!!(map.get("a") && map.get("a").settled), false);
});

test("balanceBefore: pay-back contributes to lent before the target", () => {
  const debts = [
    { id: "a", type: "borrow",   personId: "p1", date: "2026-01-01", createdAt: 1, amount: 200 },
    { id: "b", type: "pay-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50 },
    { id: "c", type: "borrow",   personId: "p1", date: "2026-01-10", createdAt: 3, amount: 100 },
  ];
  const peopleById = { p1: { id: "p1" } };
  // Before "c": back=200, lent=50, outstanding = lent - back = -150.
  assert.equal(D.balanceBefore(debts, "c", peopleById), -150);
});
```

- [ ] **Step 2: Run tests to verify they fail**

`Bash: node tests/run.js`
Expected: the three new tests fail (pay-back records being ignored, so balances stay wrong). Existing 79 tests still pass.

- [ ] **Step 3: Update the three functions in `public/debts.js`**

Edit `public/debts.js`. In `personBalances` (around line 36-39), change:
```js
if (d.type === "lend") lent += amt;
else if (d.type === "borrow" || d.type === "paid-back") back += amt;
```
to:
```js
if (d.type === "lend" || d.type === "pay-back") lent += amt;
else if (d.type === "borrow" || d.type === "paid-back") back += amt;
```

In `annotateSettlements` (around line 76-79), same change.

In `balanceBefore` (around line 121-122), same change. The `balanceBefore` block is:
```js
if (d.type === "lend") lent += amt;
else if (d.type === "borrow" || d.type === "paid-back") back += amt;
```
to:
```js
if (d.type === "lend" || d.type === "pay-back") lent += amt;
else if (d.type === "borrow" || d.type === "paid-back") back += amt;
```

- [ ] **Step 4: Run tests to verify they pass**

`Bash: node tests/run.js`
Expected: `82/82 passed, 0 failed`.

- [ ] **Step 5: Save point**

`Bash: node --check public/debts.js && node tests/run.js`
Expected: clean parse, all tests pass.

---

## Task 2: `debts.js` — add `planSplit` pure function + tests

**Files:**
- Modify: `public/debts.js`
- Test: `tests/debts.test.js`

**What `planSplit` does:** Given the user's intended record (as typed in the modal), the person's signed outstanding (in default currency), and the default currency code, decide whether to save as a single record or split into two. Returns:
```ts
{ split: false, a: Record }
  | { split: true, a: Record, b: Record }
```

**When `split: true`:** triggered when the entered record's type is a "settling type" (`paid-back` for they-owe context, `pay-back` for i-owe context) AND the entered amount in default currency strictly exceeds `|outstanding|`.

**Record IDs and timestamps** are NOT assigned by `planSplit` — it returns lightweight "intended record" objects without `id`, `createdAt`, `updatedAt`. Those are stamped in `app.js` at save time. This keeps `planSplit` pure and trivially testable. The `createdAt` offset rule (`b = a + 1ms`) is enforced in `app.js`.

**Currency rules** (in default currency, `D = defaultCurrency`):
- Let `enteredAmtDefault` = `entered.convertedAmount != null ? entered.convertedAmount : entered.amount`.
- Let `overshoot = enteredAmtDefault - Math.abs(outstanding)`.
- If `overshoot <= 0` OR `entered.type` is NOT a settling type → `{ split: false, a: entered }` (passes the record through unchanged).
- Otherwise split:
  - **Same-currency** (`entered.currency === D`, no `convertedAmount`/`convertedCurrency` set or both equal to D):
    - `a.type = entered.type`, `a.amount = |outstanding|`, `a.currency = D`.
    - `b.type` = opposite-cycle type (`paid-back`→`borrow`, `pay-back`→`lend`), `b.amount = overshoot`, `b.currency = D`.
    - Notes/date copied from `entered`. No `convertedAmount`/`convertedCurrency`/`rate` fields on either half.
  - **Cross-currency** (`entered.currency !== D`):
    - Same as same-currency: both halves expressed entirely in default currency (`D`). Drop the original currency info. `a.amount = |outstanding|`, `b.amount = overshoot`. No `convertedAmount`/`convertedCurrency`/`rate` fields.

- [ ] **Step 1: Write the failing tests**

Append to `tests/debts.test.js`:

```js
test("planSplit: no split when entered amount equals outstanding (they-owe exact)", () => {
  const entered = { type: "paid-back", personId: "p1", date: "2026-05-24", amount: 100, currency: "THB", notes: "lunch" };
  const out = D.planSplit(entered, +100, "THB");
  assert.equal(out.split, false);
  assert.equal(out.a, entered);  // pass-through
});

test("planSplit: no split when entered is a non-settling type", () => {
  const entered = { type: "lend", personId: "p1", date: "2026-05-24", amount: 999, currency: "THB", notes: "" };
  const out = D.planSplit(entered, +50, "THB");
  assert.equal(out.split, false);
});

test("planSplit: same-currency overshoot in they-owe context splits into paid-back + borrow", () => {
  const entered = { type: "paid-back", personId: "p1", date: "2026-05-24", amount: 250, currency: "THB", notes: "rent + extra" };
  const out = D.planSplit(entered, +100, "THB");
  assert.equal(out.split, true);
  assert.equal(out.a.type, "paid-back");
  assert.equal(out.a.amount, 100);
  assert.equal(out.a.currency, "THB");
  assert.equal(out.a.notes, "rent + extra");
  assert.equal(out.a.date, "2026-05-24");
  assert.equal(out.a.personId, "p1");
  assert.equal(out.b.type, "borrow");
  assert.equal(out.b.amount, 150);
  assert.equal(out.b.currency, "THB");
  assert.equal(out.b.notes, "rent + extra");
  assert.equal(out.b.date, "2026-05-24");
  assert.equal(out.b.personId, "p1");
});

test("planSplit: same-currency overshoot in i-owe context splits into pay-back + lend", () => {
  const entered = { type: "pay-back", personId: "p1", date: "2026-05-24", amount: 250, currency: "THB", notes: "" };
  const out = D.planSplit(entered, -100, "THB");
  assert.equal(out.split, true);
  assert.equal(out.a.type, "pay-back");
  assert.equal(out.a.amount, 100);
  assert.equal(out.b.type, "lend");
  assert.equal(out.b.amount, 150);
});

test("planSplit: cross-currency overshoot drops original-currency info, halves in default currency", () => {
  // USD 8 with conversion to THB 280, settling THB 100 outstanding -> split into THB 100 + THB 180.
  const entered = {
    type: "paid-back", personId: "p1", date: "2026-05-24",
    amount: 8, currency: "USD",
    convertedAmount: 280, convertedCurrency: "THB", rate: 35,
    notes: "trip refund",
  };
  const out = D.planSplit(entered, +100, "THB");
  assert.equal(out.split, true);
  assert.equal(out.a.amount, 100);
  assert.equal(out.a.currency, "THB");
  assert.equal(out.a.convertedAmount, undefined);
  assert.equal(out.a.convertedCurrency, undefined);
  assert.equal(out.a.rate, undefined);
  assert.equal(out.b.type, "borrow");
  assert.equal(out.b.amount, 180);
  assert.equal(out.b.currency, "THB");
  assert.equal(out.b.convertedAmount, undefined);
});

test("planSplit: outstanding 0 with paid-back type is a split (full amount goes to record B)", () => {
  // Edge case: someone with no prior debt "paid back" — really a borrow. But this is technically
  // an overshoot (amount > 0 == |outstanding|), so it splits with a 0-amount A. That's silly,
  // so planSplit should NOT split when outstanding === 0 — the caller's modal-level guard
  // already prevents this by hiding the Paid-back button in the clear context.
  const entered = { type: "paid-back", personId: "p1", date: "2026-05-24", amount: 100, currency: "THB", notes: "" };
  const out = D.planSplit(entered, 0, "THB");
  assert.equal(out.split, false);
  assert.equal(out.a, entered);
});
```

- [ ] **Step 2: Run tests to verify they fail**

`Bash: node tests/run.js`
Expected: six new `planSplit` tests fail with `TypeError: D.planSplit is not a function`. Earlier tests still pass.

- [ ] **Step 3: Implement `planSplit` in `public/debts.js`**

Inside the IIFE, just before the existing `return { ... }` at the bottom, add:

```js
  // Returns either a single-record plan or a two-record split plan for an entered debt.
  // `entered` is the user's intended record (no id/createdAt — caller stamps those).
  // `balanceBeforeSigned` is the person's outstanding immediately before this record,
  // signed (positive = they owe me, negative = I owe them).
  // `defaultCurrency` is store.settings.defaultCurrency.
  function planSplit(entered, balanceBeforeSigned, defaultCurrency) {
    if (!entered || typeof entered !== "object") return { split: false, a: entered };
    const settlingType = entered.type === "paid-back" || entered.type === "pay-back";
    if (!settlingType) return { split: false, a: entered };

    const outstandingAbs = Math.abs(balanceBeforeSigned);
    if (outstandingAbs === 0) return { split: false, a: entered };

    const enteredAmtDefault = Number(
      entered.convertedAmount != null ? entered.convertedAmount : entered.amount
    ) || 0;
    const overshoot = enteredAmtDefault - outstandingAbs;
    if (overshoot <= 0) return { split: false, a: entered };

    // Opposite-cycle type for record B: paid-back -> borrow, pay-back -> lend.
    const oppositeType = entered.type === "paid-back" ? "borrow" : "lend";

    // Always record both halves in default currency. Drop original-currency info on split.
    const a = {
      type: entered.type,
      personId: entered.personId,
      date: entered.date,
      amount: outstandingAbs,
      currency: defaultCurrency,
      notes: entered.notes || "",
    };
    const b = {
      type: oppositeType,
      personId: entered.personId,
      date: entered.date,
      amount: overshoot,
      currency: defaultCurrency,
      notes: entered.notes || "",
    };
    return { split: true, a, b };
  }
```

And add `planSplit` to the exports at the bottom of the IIFE:
```js
  return { personBalances, totalsAcrossPeople, annotateSettlements, balanceBefore, planSplit };
```

- [ ] **Step 4: Run tests to verify they pass**

`Bash: node tests/run.js`
Expected: `88/88 passed, 0 failed`.

- [ ] **Step 5: Save point**

`Bash: node --check public/debts.js && node tests/run.js`
Expected: clean parse, all tests pass.

---

## Task 3: `debts.js` — add `wouldOvershoot` pure function + tests

**Files:**
- Modify: `public/debts.js`
- Test: `tests/debts.test.js`

**What `wouldOvershoot` does:** Used by the edit-overshoot guard. Returns `true` if applying the edited record (replacing its old version in the debts array) would result in a settling-type record whose amount overshoots its cycle's open balance — i.e., the same situation that would have triggered the split modal on Add.

**Signature:** `wouldOvershoot(debts, editedRecord, defaultCurrency) → boolean`

**Algorithm:**
1. If `editedRecord.type` is not `paid-back` or `pay-back` → `false` (only settling types can overshoot).
2. Build a debts array with `editedRecord` substituted in place of the existing record with the same `id` (if no match, append).
3. Compute `balanceBefore(arrayWithoutEdited, editedRecord.id, peopleById = null)` using the SAME logic the spec already has — get the person's signed outstanding immediately before this record. Actually `balanceBefore` already takes `debts` and excludes the target record from the walk by `break`. So we can just call `balanceBefore(arrayWithEditedSwapped, editedRecord.id)` and it'll walk other records and stop at the edited one — giving us the balance before.
4. Compute the edited record's amount in default currency: `editedRecord.convertedAmount ?? editedRecord.amount`.
5. Check: if (`paid-back` AND `balanceBefore <= 0`) OR (`pay-back` AND `balanceBefore >= 0`) → no cycle to settle, this would be an "anti-direction" record; treat as overshoot? Actually NO — paid-back when balanceBefore<=0 means there's no open cycle in the right direction. The user's settling type doesn't match the cycle. Treat as overshoot (block edit), because applying it would either (a) reset a zero cycle weirdly or (b) push further negative.
6. Otherwise: `overshoot = amountInDefault > |balanceBefore|`. Return that boolean.

- [ ] **Step 1: Write the failing tests**

Append to `tests/debts.test.js`:

```js
test("wouldOvershoot: amount bump that pushes paid-back past outstanding -> true", () => {
  const debts = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50 },
  ];
  // edit b: amount 50 -> 200. Outstanding before b is +100. Bumping to 200 overshoots by 100.
  const edited = { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 200, currency: "THB" };
  assert.equal(D.wouldOvershoot(debts, edited, "THB"), true);
});

test("wouldOvershoot: amount decrease still within outstanding -> false", () => {
  const debts = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50 },
  ];
  const edited = { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 30, currency: "THB" };
  assert.equal(D.wouldOvershoot(debts, edited, "THB"), false);
});

test("wouldOvershoot: editing a non-settling record (lend) -> always false", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
  ];
  const edited = { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 9999, currency: "THB" };
  assert.equal(D.wouldOvershoot(debts, edited, "THB"), false);
});

test("wouldOvershoot: pay-back when no i-owe cycle exists -> true (mismatched direction)", () => {
  // Person has +100 outstanding (they owe me). A pay-back here makes no sense — treat as overshoot.
  const debts = [
    { id: "a", type: "lend",     personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
    { id: "x", type: "pay-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50 },
  ];
  const edited = { id: "x", type: "pay-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 50, currency: "THB" };
  assert.equal(D.wouldOvershoot(debts, edited, "THB"), true);
});

test("wouldOvershoot: uses convertedAmount when present", () => {
  const debts = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50 },
  ];
  // Edit b: USD 10 ~ THB 350 — that overshoots THB 100 outstanding.
  const edited = {
    id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2,
    amount: 10, currency: "USD", convertedAmount: 350, convertedCurrency: "THB",
  };
  assert.equal(D.wouldOvershoot(debts, edited, "THB"), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

`Bash: node tests/run.js`
Expected: five new tests fail with `TypeError: D.wouldOvershoot is not a function`. All earlier tests still pass.

- [ ] **Step 3: Implement `wouldOvershoot` in `public/debts.js`**

Inside the IIFE, just before the `return { ... }`, add:

```js
  // Returns true if applying `editedRecord` to `debts` (replacing the existing record with the
  // same id, or appending if none) would produce a settling-type record whose amount overshoots
  // the cycle's open balance — i.e. the equivalent of an Add-time overshoot that the split modal
  // would handle. Edits that would trigger this are blocked in the UI.
  function wouldOvershoot(debts, editedRecord, defaultCurrency) {
    if (!editedRecord || (editedRecord.type !== "paid-back" && editedRecord.type !== "pay-back")) {
      return false;
    }
    if (!Array.isArray(debts)) return false;
    const swapped = debts.map((d) => (d && d.id === editedRecord.id) ? editedRecord : d);
    if (!swapped.some((d) => d && d.id === editedRecord.id)) swapped.push(editedRecord);

    const before = balanceBefore(swapped, editedRecord.id);

    const amt = Number(
      editedRecord.convertedAmount != null ? editedRecord.convertedAmount : editedRecord.amount
    ) || 0;

    // Direction-cycle mismatch: paid-back assumes they-owe (before > 0); pay-back assumes i-owe (before < 0).
    // Anything else is an "anti-direction" edit -> treat as overshoot.
    if (editedRecord.type === "paid-back" && before <= 0) return true;
    if (editedRecord.type === "pay-back" && before >= 0) return true;

    return amt > Math.abs(before);
  }
```

Add to the exports:
```js
  return { personBalances, totalsAcrossPeople, annotateSettlements, balanceBefore, planSplit, wouldOvershoot };
```

- [ ] **Step 4: Run tests to verify they pass**

`Bash: node tests/run.js`
Expected: `93/93 passed, 0 failed`.

- [ ] **Step 5: Save point**

`Bash: node --check public/debts.js && node tests/run.js`
Expected: clean parse, all tests pass.

---

## Task 4: Badge grammar — past tense in 3 places

**Files:**
- Modify: `public/app.js` (three `dirLabel` definitions)

The three sites have slightly different forms; update each precisely.

- [ ] **Step 1: Update the share-image renderer's `dirLabel` (around line 3898)**

Locate:
```js
  const dirLabel =
    debt.type === "lend" ? "Lent" :
    debt.type === "paid-back" ? "Paid back" : "Borrow";
```

Replace with:
```js
  const dirLabel =
    debt.type === "lend" ? "Lent" :
    debt.type === "paid-back" ? "Paid back" :
    debt.type === "pay-back" ? "Paid back" :
    "Borrowed";
```

Also locate (~ same function, ~line 3901):
```js
  const dirColor = debt.type === "lend" ? P.out : P.in;
```

Change so `pay-back` shares the in-color (since it represents "I paid them" — money going out in real-world sense, but mathematically goes into the `lent` accumulator. For visual consistency with the existing `lend` color logic — which uses `--out` red for lend — the simplest mapping is: types that go to `lent` use `--out`, types that go to `back` use `--in`).

Replace with:
```js
  const dirColor = (debt.type === "lend" || debt.type === "pay-back") ? P.out : P.in;
```

- [ ] **Step 2: Update `renderPersonHistory`'s `dirLabel` and `dirClass` (around line 4214-4215)**

Locate:
```js
  const dirLabel = (t) => t === "lend" ? "Lend" : t === "paid-back" ? "Paid back" : "Borrow";
  const dirClass = (t) => t === "lend" ? "is-in" : "is-out";
```

Replace with:
```js
  const dirLabel = (t) =>
    t === "lend" ? "Lent" :
    t === "paid-back" ? "Paid back" :
    t === "pay-back" ? "Paid back" :
    "Borrowed";
  const dirClass = (t) => (t === "lend" || t === "pay-back") ? "is-in" : "is-out";
```

(`is-in` and `is-out` map onto the existing `.dbt-dir.is-in / .is-out` CSS — `is-in` for they-owe-style coloring, `is-out` for i-owe-style.)

- [ ] **Step 3: Update `renderDebtRecords`'s `dirLabel` and `dirClass` (around line 4319-4320)**

Locate:
```js
  const dirLabel = (t) => t === "lend" ? "Lend" : t === "paid-back" ? "Paid back" : "Borrow";
  const dirClass = (t) => t === "lend" ? "is-in" : "is-out";
```

Replace with the same block as Step 2 (identical helpers — they could be hoisted into a single module helper later, but that's out of scope for this task):
```js
  const dirLabel = (t) =>
    t === "lend" ? "Lent" :
    t === "paid-back" ? "Paid back" :
    t === "pay-back" ? "Paid back" :
    "Borrowed";
  const dirClass = (t) => (t === "lend" || t === "pay-back") ? "is-in" : "is-out";
```

- [ ] **Step 4: Syntax check + save point**

`Bash: node --check public/app.js && node tests/run.js`
Expected: silent parse, `93/93 passed, 0 failed`.

---

## Task 5: Split-confirm modal HTML scaffold + CSS

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`

The modal is hidden by default; it's shown by JS in Task 7. This task adds only the markup + styles so Task 7 can wire it up.

- [ ] **Step 1: Locate `#debtModal` in `public/index.html`**

Grep `id="debtModal"`. It opens around line 733. The modal closing tag is followed by other unrelated content. Insert the new split modal scaffold IMMEDIATELY AFTER the closing `</div>` of `#debtModal` (the outermost overlay `<div>`).

- [ ] **Step 2: Insert the split modal markup**

Add this block right after `#debtModal`'s closing `</div>`:

```html
<div id="debtSplitModal" class="modal-overlay hidden">
  <div class="modal modal-narrow">
    <div class="modal-head">
      <h3>Split into 2 records?</h3>
      <button type="button" class="ghost-btn" id="debtSplitClose">✕</button>
    </div>
    <p id="debtSplitMsg" class="floodgate-body"></p>
    <div id="debtSplitPreview" class="dbt-split-preview"></div>
    <div class="floodgate-actions" style="margin-top:14px">
      <button type="button" class="btn-secondary" id="debtSplitCancel">Cancel</button>
      <button type="button" class="btn-primary" id="debtSplitConfirm">Split</button>
    </div>
  </div>
</div>
```

(`modal-narrow`, `floodgate-body`, `floodgate-actions` are existing class hooks reused from the recurring-rule floodgate modal — same visual treatment.)

- [ ] **Step 3: Add the preview rows CSS to `public/styles.css`**

Append at the end of the file:

```css
/* Split-confirm modal preview rows (DebtTrakr) */
.dbt-split-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px 0 4px;
}
.dbt-split-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--card-2, rgba(255,255,255,0.05));
  border: 1px solid var(--line);
  border-radius: 12px;
  font-size: 14px;
}
.dbt-split-row .dbt-split-idx {
  font-weight: 700;
  color: var(--muted);
  min-width: 18px;
}
.dbt-split-row .dbt-split-type { font-weight: 700; }
.dbt-split-row .dbt-split-amt { margin-left: auto; font-weight: 700; }
.dbt-split-row.is-settled .dbt-split-tag {
  color: var(--in);
  font-size: 12px;
  font-weight: 700;
  margin-left: 8px;
}
.dbt-split-row.is-new .dbt-split-tag {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
  margin-left: 8px;
}
```

- [ ] **Step 4: Sanity check the HTML**

`Bash: node --check public/app.js && node tests/run.js`
Expected: silent + `93/93 passed`. (HTML isn't syntax-checked; this just confirms we didn't break JS.)

---

## Task 6: Add Debt modal — context-aware direction selector

**Files:**
- Modify: `public/index.html` (`#debtTypeToggle` becomes empty)
- Modify: `public/app.js` (`openDebtModal`, button-click wiring, `refreshMatchOutstanding`; add `renderDebtDirectionToggle`)

Currently `#debtTypeToggle` has three hardcoded buttons. We replace those with JS-rendered buttons that depend on the selected person's outstanding balance.

- [ ] **Step 1: Empty the hardcoded buttons in `public/index.html`**

Locate (around line 741):
```html
      <div class="type-toggle three-col" id="debtTypeToggle">
        <button type="button" data-type="lend"      class="active">Lend</button>
        <button type="button" data-type="borrow">Borrow</button>
        <button type="button" data-type="paid-back">Paid back</button>
      </div>
```

Replace with:
```html
      <div class="type-toggle" id="debtTypeToggle"></div>
```

(`three-col` removed because the new toggle always has exactly 2 buttons.)

- [ ] **Step 2: Add `renderDebtDirectionToggle` in `public/app.js`**

Insert this function in `public/app.js` immediately above the `openDebtModal` function declaration (around line 3559):

```js
// Render the 2-button context-aware direction toggle in the Add Debt modal.
// Decides which two types to show based on the selected person's current outstanding.
// `personId` may be empty (no person picked yet -> clear-context default).
// `preferType` (optional) is the type to mark active if it's one of the two options;
// otherwise the context's default is selected and `debtDraftType` is updated to match.
function renderDebtDirectionToggle(personId, preferType) {
  const toggle = document.getElementById("debtTypeToggle");
  if (!toggle) return;
  loadStore();
  let direction = "clear";
  if (personId) {
    const peopleById = {};
    for (const p of (store.settings.people || [])) peopleById[p.id] = p;
    const row = personBalances(store.debts || [], peopleById).get(personId);
    if (row) direction = row.direction;
  }

  // Each entry: [type, label]
  let options;
  let defaultType;
  if (direction === "they-owe") {
    options = [["lend", "Lend (more)"], ["paid-back", "Paid back"]];
    defaultType = "paid-back";
  } else if (direction === "i-owe") {
    options = [["pay-back", "Pay back"], ["borrow", "Borrow (more)"]];
    defaultType = "pay-back";
  } else {
    options = [["lend", "Lend"], ["borrow", "Borrow"]];
    defaultType = "lend";
  }

  const valid = options.some(([t]) => t === preferType);
  const active = valid ? preferType : defaultType;
  debtDraftType = active;

  toggle.innerHTML = options.map(([t, label]) =>
    '<button type="button" data-type="' + t + '"' +
    (t === active ? ' class="active"' : '') + '>' +
    label + '</button>'
  ).join("");

  // Wire clicks (replaces any prior handlers via innerHTML reset).
  toggle.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      debtDraftType = b.dataset.type;
      toggle.querySelectorAll("button").forEach((x) =>
        x.classList.toggle("active", x === b)
      );
      refreshMatchOutstanding();
    });
  });
}
```

- [ ] **Step 3: Remove the old static toggle wiring and update `openDebtModal`**

In `openDebtModal` (around line 3568-3571), locate and DELETE:
```js
  // Direction toggle visual state
  document.querySelectorAll("#debtTypeToggle button").forEach((b) =>
    b.classList.toggle("active", b.dataset.type === debtDraftType)
  );
```

Replace it with a call to the new renderer, using the editing record's type as preference when editing:
```js
  // Direction toggle — context-aware, populated by JS based on the person's balance.
  renderDebtDirectionToggle(debt ? debt.personId : "", debt ? debt.type : null);
```

Also, just below `openDebtModal` there's a top-level wiring block (around line 3627-3635):
```js
// Direction-toggle clicks
document.querySelectorAll("#debtTypeToggle button").forEach((b) => {
  b.addEventListener("click", () => {
    debtDraftType = b.dataset.type;
    document.querySelectorAll("#debtTypeToggle button").forEach((x) =>
      x.classList.toggle("active", x === b)
    );
    refreshMatchOutstanding();
  });
});
```

DELETE this whole block. (Click wiring now lives inside `renderDebtDirectionToggle` since the buttons are recreated each time the toggle re-renders.)

- [ ] **Step 4: Re-render the toggle when the person changes**

In `setDebtPerson` (around line 3672), locate the line:
```js
  refreshMatchOutstanding();
```

Add a call to re-render the toggle BEFORE that line, preserving the current draft type as preference so the user's pick is kept when valid:
```js
  renderDebtDirectionToggle(id || "", debtDraftType);
  refreshMatchOutstanding();
```

- [ ] **Step 5: Update `refreshMatchOutstanding` to use `pay-back` for i-owe context**

Locate the `oppDir` assignment in `refreshMatchOutstanding` (around line 3728):
```js
  // When they owe me, the natural "match outstanding" action is recording
  // their repayment — that's "paid-back", not a fresh borrow.
  // When I owe them, the natural match action is recording my repayment — "lend".
  const oppDir = row.direction === "they-owe" ? "paid-back" : "lend";
```

Replace with:
```js
  // When they owe me, the settling action is recording their repayment — "paid-back".
  // When I owe them, the settling action is recording my repayment — "pay-back".
  const oppDir = row.direction === "they-owe" ? "paid-back" : "pay-back";
```

Also locate the chip's `onclick` handler in the same function (around line 3731-3737):
```js
  btn.onclick = () => {
    document.getElementById("dbtAmount").value = Math.abs(row.outstanding);
    debtDraftType = oppDir;
    document.querySelectorAll("#debtTypeToggle button").forEach((b) =>
      b.classList.toggle("active", b.dataset.type === oppDir)
    );
  };
```

Replace with (re-renders the toggle to ensure `oppDir` is rendered as one of the two options + active):
```js
  btn.onclick = () => {
    document.getElementById("dbtAmount").value = Math.abs(row.outstanding);
    debtDraftType = oppDir;
    const pid = document.getElementById("dbtPersonId").value;
    renderDebtDirectionToggle(pid, oppDir);
  };
```

- [ ] **Step 6: Sanity check**

`Bash: node --check public/app.js && node tests/run.js`
Expected: silent + `93/93 passed`.

- [ ] **Step 7: Manual smoke test**

`Bash: npm start` (run in background; check stdout to find the port — usually `http://localhost:3000`).

Open the app → switch to DebtTrakr → tap Add. Without picking a person, the toggle shows `Lend / Borrow`. Pick an existing person who owes you → toggle re-renders to `Lend (more) / Paid back`, default `Paid back`. Pick one you owe → `Pay back / Borrow (more)`, default `Pay back`. Tap Match outstanding chip → amount fills, settling direction becomes active. (Stop the dev server after this check.)

---

## Task 7: Save flow — route through `planSplit` + open Split-confirm modal

**Files:**
- Modify: `public/app.js` (`saveDebtFromModal`; add `openSplitConfirmModal`, `runSplitSave`, helpers)

The current `saveDebtFromModal` does validation → FX attach → either edits or inserts. We need to refactor the **insert (Add)** branch so it:
1. Builds the "entered record" object (no id/createdAt yet).
2. Calls `attachConversion` to populate `convertedAmount` etc.
3. Calls `planSplit(entered, balanceBefore, defaultCurrency)`.
4. If `split: false` → insert as a single record (same as today).
5. If `split: true` → open the confirm modal with a preview; on Confirm, stamp ids/createdAt on both halves (B's createdAt = A.createdAt + 1), insert both, close modals.

The edit branch keeps its current logic but adds a `wouldOvershoot` guard at the top.

- [ ] **Step 1: Refactor `saveDebtFromModal` — extract entered-record build + add edit guard**

Replace the entire `async function saveDebtFromModal()` body (currently around lines 3763-3823) with this version:

```js
async function saveDebtFromModal() {
  const err = document.getElementById("debtError");
  err.textContent = "";

  const personId = document.getElementById("dbtPersonId").value;
  const amount = Number(document.getElementById("dbtAmount").value);
  const date = document.getElementById("dbtDate").value;
  const currency = document.getElementById("dbtCurrency").value;
  const notes = document.getElementById("dbtNotes").value.trim();

  if (!personId) { err.textContent = "Person is required."; return; }
  if (!(amount > 0)) { err.textContent = "Amount must be greater than 0."; return; }
  if (!date) { err.textContent = "Date is required."; return; }

  const mrField = document.getElementById("dbtManualRateField");
  let manualRate = null;
  if (mrField && !mrField.classList.contains("hidden")) {
    manualRate = parseFloat(document.getElementById("dbtManualRate").value);
    if (!(manualRate > 0)) {
      const def = (store && store.settings && store.settings.defaultCurrency) || "THB";
      err.textContent = "Enter the conversion rate (1 " + currency + " = ? " + def + ").";
      return;
    }
  }

  loadStore();
  const defaultCurrency = (store.settings.defaultCurrency || "THB");

  if (editingDebtId) {
    // ----- EDIT branch -----
    const idx = store.debts.findIndex((d) => d.id === editingDebtId);
    if (idx === -1) { err.textContent = "Debt not found."; return; }
    const existing = store.debts[idx];
    const updated = Object.assign({}, existing, {
      type: debtDraftType, personId, amount, currency, date, notes,
      updatedAt: Date.now(),
    });
    delete updated.convertedAmount; delete updated.convertedCurrency;
    delete updated.rate; delete updated.rateDate; delete updated.rateUnavailable; delete updated.manualRate;
    try { await attachConversion(updated, manualRate); } catch (_e) { updated.rateUnavailable = true; }

    // Overshoot guard — blocks edits that would have triggered the split modal on Add.
    if (wouldOvershoot(store.debts, updated, defaultCurrency)) {
      err.textContent = "This edit would overshoot the outstanding balance. Delete this record and add a new one instead.";
      return;
    }

    store.debts[idx] = updated;
    saveStore();
    closeDebtModal();
    rerenderActiveDebtView();
    return;
  }

  // ----- ADD branch -----
  // Build the "entered record" — no id/createdAt yet (planSplit doesn't need them).
  const entered = {
    type: debtDraftType, personId, amount, currency, date, notes,
  };
  try { await attachConversion(entered, manualRate); } catch (_e) { entered.rateUnavailable = true; }

  // Compute balanceBefore for this person at "now" (the entered record will sit at the end
  // chronologically since createdAt = now). balanceBefore needs an id to stop at; we pass
  // a sentinel id that won't match any existing record so the walk processes every record.
  // The resulting outstanding IS the balance-before-this-new-record.
  const sentinel = "__entered_sentinel__";
  const debtsForCalc = (store.debts || []).concat([Object.assign({}, entered, {
    id: sentinel,
    date: entered.date,
    createdAt: Date.now() + 1000000,  // ensures sentinel sorts last
  })]);
  const balanceBeforeSigned = balanceBefore(debtsForCalc, sentinel);

  const plan = planSplit(entered, balanceBeforeSigned, defaultCurrency);
  if (!plan.split) {
    insertSingleDebt(plan.a);
    closeDebtModal();
    rerenderActiveDebtView();
    return;
  }
  // Show confirmation modal; if user confirms, commit both records.
  openSplitConfirmModal(plan, defaultCurrency, personId);
}
```

- [ ] **Step 2: Add `insertSingleDebt`, `rerenderActiveDebtView`, and `openSplitConfirmModal` helpers**

Insert these three helpers directly below `saveDebtFromModal`:

```js
function insertSingleDebt(rec) {
  const now = Date.now();
  rec.id = "debt_" + now.toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  rec.createdAt = now;
  rec.updatedAt = now;
  store.debts.push(rec);
  saveStore();
}

function rerenderActiveDebtView() {
  if (currentView === "dashboard" && currentMode === "debt") {
    renderDebtDashboard();
  } else if (currentView === "person-history") {
    renderPersonHistory(_currentHistoryPersonId);
  } else if (currentView === "debt-records") {
    renderDebtRecords();
  }
}

function openSplitConfirmModal(plan, defaultCurrency, personId) {
  const modal = document.getElementById("debtSplitModal");
  if (!modal) return;
  loadStore();
  const person = (store.settings.people || []).find((p) => p.id === personId);
  const personName = person ? person.name : "this person";

  const msg = document.getElementById("debtSplitMsg");
  const verb = plan.a.type === "paid-back" ? "owes you" : "you owe";
  msg.textContent = "This is more than what " + personName + " " + verb + ". We'll split it into:";

  const dirLabelForSplit = (t) =>
    t === "lend" ? "Lend" :
    t === "borrow" ? "Borrow" :
    t === "paid-back" ? "Paid back" :
    t === "pay-back" ? "Pay back" :
    t;

  const fmtSplit = (rec) => rec.currency + " " +
    Number(rec.amount).toLocaleString(undefined, { maximumFractionDigits: 2 });

  document.getElementById("debtSplitPreview").innerHTML =
    '<div class="dbt-split-row is-settled">' +
      '<span class="dbt-split-idx">1.</span>' +
      '<span class="dbt-split-type">' + dirLabelForSplit(plan.a.type) + '</span>' +
      '<span class="dbt-split-amt">' + fmtSplit(plan.a) + '</span>' +
      '<span class="dbt-split-tag">· Settled</span>' +
    '</div>' +
    '<div class="dbt-split-row is-new">' +
      '<span class="dbt-split-idx">2.</span>' +
      '<span class="dbt-split-type">' + dirLabelForSplit(plan.b.type) + '</span>' +
      '<span class="dbt-split-amt">' + fmtSplit(plan.b) + '</span>' +
      '<span class="dbt-split-tag">(new)</span>' +
    '</div>';

  // Wire buttons (rewire each open to avoid stacking listeners — we use onclick assignment).
  document.getElementById("debtSplitCancel").onclick = () => closeSplitConfirmModal();
  document.getElementById("debtSplitClose").onclick  = () => closeSplitConfirmModal();
  document.getElementById("debtSplitConfirm").onclick = () => {
    // Commit A then B, with B.createdAt = A.createdAt + 1.
    const nowA = Date.now();
    const recA = Object.assign({}, plan.a, {
      id: "debt_" + nowA.toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      createdAt: nowA, updatedAt: nowA,
    });
    const nowB = nowA + 1;
    const recB = Object.assign({}, plan.b, {
      id: "debt_" + nowB.toString(36) + "_" + Math.random().toString(36).slice(2, 6),
      createdAt: nowB, updatedAt: nowB,
    });
    loadStore();
    store.debts.push(recA, recB);
    saveStore();
    closeSplitConfirmModal();
    closeDebtModal();
    rerenderActiveDebtView();
  };

  modal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeSplitConfirmModal() {
  const modal = document.getElementById("debtSplitModal");
  if (modal) modal.classList.add("hidden");
  // If the Add Debt modal is also closed, drop the body class. Otherwise keep it.
  const addModalOpen = !document.getElementById("debtModal").classList.contains("hidden");
  if (!addModalOpen) document.body.classList.remove("modal-open");
}
```

Also: the existing `closeDebtModal` (around line 3610) references `modal` / `ruleModal` / `personIconModal` for its "any open?" check. Add `"debtSplitModal"` to that list so closing the Add Debt modal while the Split modal is also open doesn't strip `modal-open` from `body`. Locate:

```js
  const otherModalIds = ["modal", "ruleModal", "personIconModal"];
```

Replace with:
```js
  const otherModalIds = ["modal", "ruleModal", "personIconModal", "debtSplitModal"];
```

- [ ] **Step 3: Sanity check**

`Bash: node --check public/app.js && node tests/run.js`
Expected: silent + `93/93 passed`.

- [ ] **Step 4: Manual smoke test**

`Bash: npm start` → open the app.

Test matrix:
- Add to a clear-balance person, Lend 100 → record appears in history, type `lend`, badge `Lent`.
- Add a Borrow 100 against a person → they-owe shifts to i-owe-100, badge `Borrowed`.
- Open Add to the i-owe person → toggle reads `Pay back / Borrow (more)`, default `Pay back`. Type 100, Save → new record with badge `Paid back`, person now clear.
- Open Add to a they-owe person, Paid back 250 (overshooting by 150) → split modal pops up with preview rows `1. Paid back THB 100 · Settled` / `2. Borrow THB 150 (new)`. Confirm → two records appear in history; first has Settled badge, second starts a new i-owe cycle.
- Cross-currency overshoot: Paid back USD 8 (≈ THB 280) against THB 100 outstanding → split preview shows both halves as THB. Confirm → two THB records.
- Edit an existing paid-back record, bump amount to overshoot → error shown, Save blocked.

Stop the dev server.

- [ ] **Step 5: Save point**

`Bash: node --check public/app.js && node --check public/sw.js && node tests/run.js`
Expected: silent + `93/93 passed`.

---

## Task 8: Version bump + handover update

**Files:**
- Modify: `public/app.js` line 6 — `APP_VERSION`.
- Modify: `public/sw.js` line 2 — `CACHE`.
- Modify: `handover.md`.

The current version (per the previous feature) is `v56` / `munitrakr-v56`. Bumping to `v57`.

- [ ] **Step 1: Bump `APP_VERSION`**

Edit `public/app.js:6`:
```js
const APP_VERSION = "v57"; // keep in step with sw.js CACHE
```

- [ ] **Step 2: Bump `CACHE`**

Edit `public/sw.js:2`:
```js
const CACHE = "munitrakr-v57";
```

- [ ] **Step 3: Update `handover.md`**

Four edits (Grep each unique string before editing):

3a. `Current version: **v56**.` → `Current version: **v57**.`

3b. `must print \`79/79 passed, 0 failed\`.` → `must print \`93/93 passed, 0 failed\`.`

3c. In §3 (Data model), the `type Debt` block. The line:
```
id, type: "lend"|"borrow"|"paid-back",   // borrow + paid-back are math-identical
```
Replace with:
```
id, type: "lend"|"borrow"|"paid-back"|"pay-back",  // pay-back is math-identical to lend; borrow/paid-back to each other
```

3d. In §5 (DebtTrakr — features), find the "Add Debt modal" paragraph. The line that starts:
> Three directions in the Add Debt modal: **Lend**, **Borrow**, **Paid back**.

Replace the whole sentence with:
> Two context-aware directions in the Add Debt modal, based on the selected person's outstanding: **clear** → `Lend` / `Borrow`; **they owe you** → `Lend (more)` / `Paid back`; **you owe them** → `Pay back` / `Borrow (more)`. The button you tap maps to the underlying type — `lend`, `borrow`, `paid-back`, or `pay-back` — and history badges always render past-tense (`Lent` / `Borrowed` / `Paid back`).

3e. `Current: \`v56\` / \`munitrakr-v56\`.` → `Current: \`v57\` / \`munitrakr-v57\`.`

3f. In the §10 glossary table, add two new rows after the `personBalances` / `totalsAcrossPeople` / `annotateSettlements` row:
```
| `planSplit` | pure (from `debts.js`) — decides single-record vs two-record split for an entered debt + computes the split halves |
| `wouldOvershoot` | pure (from `debts.js`) — used by edit guard; true if applying an edit would have triggered the split modal on Add |
```

- [ ] **Step 4: Final release gate**

`Bash: node --check public/app.js && node --check public/sw.js && node tests/run.js`
Expected: silent x2 + `93/93 passed, 0 failed`.

- [ ] **Step 5: End-to-end manual test before deploy**

`Bash: npm start` → http://localhost:3000.

Test the full flow on a fresh person to validate everything together:

| # | Step | Expected |
|---|---|---|
| 1 | Add new person via inline form | Modal toggle shows `Lend / Borrow`. |
| 2 | Lend 200 → Save | Person card shows they-owe 200. History badge: `Lent`. |
| 3 | Add → toggle now reads `Lend (more) / Paid back`, default `Paid back` | ✓ |
| 4 | Match outstanding chip | Amount fills 200, direction = `Paid back`. |
| 5 | Bump amount to 350, Save | Split modal opens: `1. Paid back THB 200 · Settled` / `2. Borrow THB 150 (new)`. Confirm. |
| 6 | History | Two new rows: settled paid-back, then a borrow. Person card now i-owe 150. |
| 7 | Add → toggle reads `Pay back / Borrow (more)`, default `Pay back` | ✓ |
| 8 | Pay back 150, Save | Single record, badge `Paid back`. Person clear. |
| 9 | Open Add, pick same person → toggle reads `Lend / Borrow` | ✓ |
| 10 | Edit one of the older paid-back records, bump amount past outstanding, Save | Inline error: "This edit would overshoot…". Save blocked. |
| 11 | Share an i-owe `pay-back` record | Card badge reads `Paid back` (not Lent). Math line uses signed amounts correctly. |
| 12 | Theme = Yoimiya, then test split modal | Modal renders correctly under the active theme. |

- [ ] **Step 6: Deploy**

Drop the `public/` folder onto Netlify. On phone: open the PWA → Settings → App version → Check for updates → confirm `v57`.

---

## Self-review notes

- **Spec coverage:**
  - §1 (context-aware modal options) → Task 6.
  - §2 (Match outstanding chip behaviour) → Task 6 Step 5.
  - §3 (auto-split flow + currency rules) → Tasks 2 (math), 5 (UI scaffold), 7 (orchestration).
  - §4 (edit guard) → Tasks 3 (math), 7 (wired into edit branch).
  - §5 (new `pay-back` type + grammar cleanup) → Tasks 1 (math), 4 (badges), 6 (modal mapping).
  - §6 (code touch points) → covered across Tasks 1-7.
  - §7 (edge cases) → covered by `planSplit` tests in Task 2 and the modal-level guards (outstanding === 0 case explicitly tested).
  - §8 (out of scope) → preserved.
  - §9 (testing) → Tasks 1-3 unit tests; Task 7 Step 4 + Task 8 Step 5 manual matrix.
  - §10 (release) → Task 8.
- **Placeholders:** none — every code-bearing step shows the complete edit.
- **Type consistency:** `planSplit` and `wouldOvershoot` signatures match between debts.js and the app.js call sites. `renderDebtDirectionToggle`, `openSplitConfirmModal`, `insertSingleDebt`, `rerenderActiveDebtView`, `closeSplitConfirmModal` all defined exactly where referenced.
- **No git → "save point"** with `node --check` + tests at each task boundary instead of commits, matching the project convention.
- **One known carry-over from this project's architecture:** `app.js` is a 4000+ line single file. We're following the existing pattern by adding the new functions inline rather than extracting to a new file, except for the truly-pure math which lives in `debts.js`. If `app.js` continues to grow rapidly, a future task could extract a `debt-modal.js` module, but that's not in scope here.
