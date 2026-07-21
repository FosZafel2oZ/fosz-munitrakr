# Split-the-Bill Fill UX Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make split-share entry self-solving (2-person bidirectional remainder, 3+ people "Auto" button that fills blank fields evenly) and eliminate every silent path that blocks saving the record.

**Architecture:** Replace the fragile `splitMineManual` flag (inferred from input emptiness — misfires on number-input badInput states and causes the field to snap back / go dead) with explicit state: `splitMine` (number|null, null = blank) and `splitLastEdited`. In 2-person mode, typing either field solves the counterpart DOM-directly (no re-render, focus preserved). In 3+ mode nothing auto-solves; a new "Auto" button distributes the remaining amount cent-exact across blank fields via a new pure helper `fillBlanks` in `debts.js` (TDD'd in Node). Dead-saves are eliminated by adding `novalidate` to the record form (JS validation already shows visible messages for everything native validation silently blocked) and by making the share-sum validation cent-exact on the values actually stored.

**Tech Stack:** Vanilla JS (single-file `public/app.js`), UMD pure-logic module `public/debts.js`, Node test runner `node tests/run.js` (currently 107 tests).

## Global Constraints

- 100% offline static PWA — no new dependencies, no build step.
- Work directly on `main`. Commit after each task; **never push** (user pushes explicitly).
- All dates are `YYYY-MM-DD` strings; money math is done in integer cents (`Math.round(v * 100)`).
- `node --check public/app.js` and `node --check public/sw.js` must pass before any commit touching them.
- `node tests/run.js` must pass 100% before any commit (107 existing + 8 new = 115 after Task 1).
- Version lockstep on release: `APP_VERSION` in `public/app.js` and `CACHE` in `public/sw.js` both become `v77` / `munitrakr-v77` (Task 5 only — do NOT bump in earlier tasks).
- iOS quirk that motivated this work: a `type="number"` input mid-edit ("250.", "250,", cleared) reports `.value === ""` (badInput). Never infer user intent from `.value` emptiness; never rewrite a focused input.

---

### Task 1: `fillBlanks` pure helper in debts.js (TDD)

**Files:**
- Modify: `public/debts.js` (add function after `evenShares`, ~line 213; add to exports line 215)
- Test: `tests/debts.test.js` (append after the `evenShares` block, ~line 467)

**Interfaces:**
- Consumes: `evenShares(total, count)` — existing, returns cent-exact array, largest share at index 0, `[]` on invalid input.
- Produces: `fillBlanks(total, filled, blankCount)` → `number[]` of length `blankCount` splitting `total − sum(filled)` cent-exact (largest share at index 0), or `[]` when: remaining ≤ 0, `blankCount < 1`, `total` ≤ 0 / non-finite, `filled` is not an array, or any filled entry is negative / non-finite. Task 3's Auto button calls exactly this signature via the browser global `fillBlanks`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/debts.test.js`:

```js
/* ---------------- fillBlanks (split-the-bill Auto button) ---------------- */

test("fillBlanks: splits remaining evenly across blanks", () => {
  assert.deepEqual(D.fillBlanks(300, [100], 2), [100, 100]);
});

test("fillBlanks: no filled fields behaves like evenShares", () => {
  assert.deepEqual(D.fillBlanks(1000, [], 3), [333.34, 333.33, 333.33]);
});

test("fillBlanks: rounding remainder goes to the first blank", () => {
  assert.deepEqual(D.fillBlanks(100, [50.01], 2), [25, 24.99]);
});

test("fillBlanks: cent-exact — blanks + filled always reach the total", () => {
  const filled = [10.1, 20.2];
  const shares = D.fillBlanks(123.45, filled, 4);
  assert.equal(shares.length, 4);
  const cents = shares.concat(filled).reduce((s, v) => s + Math.round(v * 100), 0);
  assert.equal(cents, 12345);
});

test("fillBlanks: filled already reach the total -> empty", () => {
  assert.deepEqual(D.fillBlanks(100, [60, 40], 1), []);
});

test("fillBlanks: filled exceed the total -> empty", () => {
  assert.deepEqual(D.fillBlanks(100, [150], 2), []);
});

test("fillBlanks: invalid inputs -> empty", () => {
  assert.deepEqual(D.fillBlanks(0, [], 2), []);
  assert.deepEqual(D.fillBlanks(NaN, [], 2), []);
  assert.deepEqual(D.fillBlanks(100, [], 0), []);
  assert.deepEqual(D.fillBlanks(100, [NaN], 2), []);
  assert.deepEqual(D.fillBlanks(100, [-5], 2), []);
  assert.deepEqual(D.fillBlanks(100, "nope", 2), []);
});

test("fillBlanks: float-drift totals stay cent-exact", () => {
  // 0.1 + 0.2 style drift must not break the cents math.
  assert.deepEqual(D.fillBlanks(0.3, [0.1], 1), [0.2]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/run.js`
Expected: FAIL — 8 failures mentioning `D.fillBlanks is not a function`; the 107 existing tests still pass.

- [ ] **Step 3: Implement `fillBlanks`**

In `public/debts.js`, insert after the `evenShares` function (after its closing `}` at line 213):

```js
  // Split the REMAINING amount (total − already-filled shares) evenly across
  // blankCount blank fields, cent-exact, largest share at index 0. Returns []
  // when nothing positive is left to distribute or any input is invalid
  // (negative or non-finite filled entries are invalid — the caller's save
  // validation rejects them anyway).
  function fillBlanks(total, filled, blankCount) {
    const t = Number(total);
    const n = Math.floor(Number(blankCount));
    if (!Number.isFinite(t) || !(t > 0) || !Number.isFinite(n) || !(n >= 1)) return [];
    if (!Array.isArray(filled)) return [];
    let filledCents = 0;
    for (const f of filled) {
      const v = Number(f);
      if (!Number.isFinite(v) || v < 0) return [];
      filledCents += Math.round(v * 100);
    }
    const remainingCents = Math.round(t * 100) - filledCents;
    if (remainingCents <= 0) return [];
    return evenShares(remainingCents / 100, n);
  }
```

Update the exports line (line 215) from:

```js
  return { personBalances, totalsAcrossPeople, annotateSettlements, balanceBefore, planSplit, wouldOvershoot, evenShares };
```

to:

```js
  return { personBalances, totalsAcrossPeople, annotateSettlements, balanceBefore, planSplit, wouldOvershoot, evenShares, fillBlanks };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/run.js`
Expected: `115/115 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add public/debts.js tests/debts.test.js
git commit -m "feat: fillBlanks helper — cent-exact remainder split for blank share fields"
```

---

### Task 2: Replace splitMineManual with explicit blank-capable state + 2-person bidirectional solve

**Files:**
- Modify: `public/app.js:2249-2270` (state + share helpers), `public/app.js:2274-2309` (`syncSplitSection` resets), `public/app.js:2311-2375` (`renderSplitRows` + delete `updateSplitMyAmt`), `public/app.js:2413-2452` (wireSplitSection handlers), `public/app.js:2194-2195` (openModal reset)

**Interfaces:**
- Consumes: `evenShares` (browser global from debts.js), `splitTotalAmount()`, `personIconSvg`, `escapeHtml`, `loadStore`.
- Produces (used by Tasks 3–4): globals `splitMine` (number|null), `splitLastEdited` (`"me"` | personId | null), `splitPeople` (`[{personId, amount: number|null}]` — `null` = blank, never NaN), `splitMyShare()` (returns cents-rounded `splitMine`, 0 when null), `solve2p()`, and `renderSplitRows()` which renders blank fields as `""`. `splitOthersSum()` remains until Task 4 removes its last caller.

- [ ] **Step 1: Replace the state block and share helpers (`app.js:2249-2270`)**

Replace:

```js
/* ---------------- Split the bill (Add Record modal) ---------------- */
// Others' shares only — the user's own share is always the remainder.
let splitPeople = []; // [{ personId, amount|null }]
let splitMineManual = false; // user typed their own share (stop auto-remainder)

function splitTotalAmount() {
  return parseFloat($("#fAmount").value) || 0;
}
function splitOthersSum() {
  return splitPeople.reduce((s, r) => s + (Number(r.amount) || 0), 0);
}
function splitRemainder() {
  return Math.round((splitTotalAmount() - splitOthersSum()) * 100) / 100;
}
function splitMyShare() {
  if (splitMineManual) {
    const el = document.getElementById("splitMyAmt");
    const v = parseFloat(el && el.value);
    return isNaN(v) ? 0 : Math.round(v * 100) / 100;
  }
  return splitRemainder();
}
```

with:

```js
/* ---------------- Split the bill (Add Record modal) ---------------- */
// Every share field (mine included) is either typed (number) or blank (null).
// State mirrors exactly what's visible — save reads state, never the DOM, so
// number-input badInput quirks ("250." reads as "") can't desync anything.
let splitPeople = []; // [{ personId, amount: number|null }] — null = blank
let splitMine = null; // my share; null = blank
let splitLastEdited = null; // "me" | personId — which side 2-person solve mirrors

function splitTotalAmount() {
  return parseFloat($("#fAmount").value) || 0;
}
function splitOthersSum() {
  return splitPeople.reduce((s, r) => s + (Number(r.amount) || 0), 0);
}
function splitMyShare() {
  return splitMine == null ? 0 : Math.round(Number(splitMine) * 100) / 100;
}

// 2-person mode only: the side the user did NOT just edit mirrors
// total − edited side. DOM-direct (no re-render) so the focused input keeps
// its caret; blank edited side leaves the counterpart untouched.
function solve2p() {
  if (splitPeople.length !== 1 || !splitLastEdited) return;
  const total = splitTotalAmount();
  if (!(total > 0)) return;
  if (splitLastEdited === "me") {
    if (splitMine == null) return;
    splitPeople[0].amount = Math.round((total - splitMine) * 100) / 100;
    const el = document.querySelector('#splitRows .split-row[data-pid] .split-amt');
    if (el) el.value = splitPeople[0].amount.toFixed(2);
  } else {
    if (splitPeople[0].amount == null) return;
    splitMine = Math.round((total - splitPeople[0].amount) * 100) / 100;
    const el = document.getElementById("splitMyAmt");
    if (el) {
      el.value = splitMine.toFixed(2);
      el.classList.toggle("neg", splitMine < 0);
    }
  }
}
```

- [ ] **Step 2: Update the three resets in `syncSplitSection` (`app.js`, was 2274-2309)**

Replace each of the two occurrences of:

```js
    toggle.checked = false;
    splitPeople = [];
    splitMineManual = false;
```

with:

```js
    toggle.checked = false;
    splitPeople = [];
    splitMine = null;
    splitLastEdited = null;
```

and in the toggle-off `else` branch replace:

```js
    const rows = document.getElementById("splitRows");
    if (rows) rows.innerHTML = "";
    splitMineManual = false;
```

with:

```js
    const rows = document.getElementById("splitRows");
    if (rows) rows.innerHTML = "";
    splitMine = null;
    splitLastEdited = null;
```

- [ ] **Step 3: Rewrite `renderSplitRows` and delete `updateSplitMyAmt` (was `app.js:2311-2375`)**

Replace both functions with this single function (`updateSplitMyAmt` is deleted — `solve2p` from Step 1 owns counterpart updates now):

```js
function renderSplitRows() {
  const box = document.getElementById("splitRows");
  if (!box) return;
  loadStore();
  const peopleById = {};
  for (const p of (store.settings.people || [])) peopleById[p.id] = p;
  const myName = (store.profile && store.profile.displayName) || "Me";
  const mineNeg = splitMine != null && splitMine < 0;
  let html =
    '<div class="split-row split-row-me">' +
      '<span class="pick-ico" style="background:var(--accent)">' + personIconSvg("person") + '</span>' +
      '<span class="split-name">' + escapeHtml(myName) + ' <span class="split-you">(you)</span></span>' +
      '<input type="number" class="split-amt split-amt-me' + (mineNeg ? " neg" : "") + '" id="splitMyAmt" inputmode="decimal" step="0.01" placeholder="0.00" value="' + (splitMine == null ? "" : Number(splitMine).toFixed(2)) + '" />' +
    '</div>';
  for (const row of splitPeople) {
    const p = peopleById[row.personId];
    if (!p) continue;
    html +=
      '<div class="split-row" data-pid="' + p.id + '">' +
        '<span class="pick-ico" style="background:' + p.color + '">' + personIconSvg(p.icon || "person") + '</span>' +
        '<span class="split-name">' + escapeHtml(p.name) + '</span>' +
        '<input type="number" class="split-amt" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="' + (row.amount != null ? Number(row.amount).toFixed(2) : "") + '" />' +
        '<button type="button" class="split-remove" aria-label="Remove">✕</button>' +
      '</div>';
  }
  box.innerHTML = html;
  box.querySelectorAll(".split-row[data-pid]").forEach((rowEl) => {
    const pid = rowEl.dataset.pid;
    // Partial update on input (no re-render — keeps the input focused).
    rowEl.querySelector(".split-amt").addEventListener("input", (e) => {
      const rec = splitPeople.find((r) => r.personId === pid);
      if (!rec) return;
      const v = parseFloat(e.target.value);
      rec.amount = Number.isFinite(v) ? v : null;
      splitLastEdited = pid;
      solve2p();
    });
    rowEl.querySelector(".split-remove").addEventListener("click", () => {
      splitPeople = splitPeople.filter((r) => r.personId !== pid);
      renderSplitRows();
    });
  });
  const myInput = box.querySelector("#splitMyAmt");
  if (myInput) {
    myInput.addEventListener("input", () => {
      const v = parseFloat(myInput.value);
      splitMine = Number.isFinite(v) ? v : null;
      splitLastEdited = "me";
      myInput.classList.toggle("neg", splitMine != null && splitMine < 0);
      solve2p();
    });
  }
}
```

Note: there is deliberately NO blur handler and NO auto-remainder on render — a blank field stays blank until the user or a button fills it. This is what kills the snap-back bug.

- [ ] **Step 4: Update `wireSplitSection` handlers (was `app.js:2413-2452`)**

(a) Replace the `#fAmount` input listener:

```js
  $("#fAmount").addEventListener("input", () => {
    syncSplitSection();
    if (toggle.checked) updateSplitMyAmt();
  });
```

with:

```js
  $("#fAmount").addEventListener("input", () => {
    solve2p(); // 2-person mode: re-mirror the counterpart to the new total
    syncSplitSection();
  });
```

(b) Delete the `#fCurrency` listener entirely (currency choice never changes share numbers):

```js
  $("#fCurrency").addEventListener("change", () => {
    if (toggle.checked) updateSplitMyAmt();
  });
```

(c) Replace the Split-evenly handler:

```js
  // Split evenly: total / (me + others), remainder to me (index 0).
  document.getElementById("splitEvenBtn").addEventListener("click", () => {
    const total = splitTotalAmount();
    if (!(total > 0) || splitPeople.length === 0) return;
    const shares = evenShares(total, splitPeople.length + 1);
    splitPeople.forEach((r, i) => { r.amount = shares[i + 1]; });
    splitMineManual = false; // mine returns to auto = shares[0]
    renderSplitRows();
  });
```

with:

```js
  // Split evenly: total / (me + others), remainder cent to me (index 0).
  document.getElementById("splitEvenBtn").addEventListener("click", () => {
    const total = splitTotalAmount();
    if (!(total > 0) || splitPeople.length === 0) return;
    const shares = evenShares(total, splitPeople.length + 1);
    splitMine = shares[0];
    splitPeople.forEach((r, i) => { r.amount = shares[i + 1]; });
    splitLastEdited = null;
    renderSplitRows();
  });
```

- [ ] **Step 5: Update the openModal reset (`app.js:2194-2195`)**

Replace:

```js
  splitPeople = [];
  splitMineManual = false;
```

with:

```js
  splitPeople = [];
  splitMine = null;
  splitLastEdited = null;
```

- [ ] **Step 6: Verify no stale references and syntax-check**

Run: `node --check public/app.js` → expected: no output (exit 0).
Run (Grep tool or): `grep -n "splitMineManual\|updateSplitMyAmt\|splitRemainder" public/app.js` → expected: no matches.
Run: `node tests/run.js` → expected: `115/115 passed, 0 failed`.

- [ ] **Step 7: Commit**

```bash
git add public/app.js
git commit -m "fix: split shares track typed state, 2-person split solves both directions"
```

---

### Task 3: "Auto" button — fill blank fields evenly (3+ people only)

**Files:**
- Modify: `public/index.html:553` (add button), `public/styles.css:1442` (allow wrap), `public/app.js` (`renderSplitRows` visibility toggle + click handler in `wireSplitSection`)

**Interfaces:**
- Consumes: `fillBlanks(total, filled, blankCount)` (Task 1, browser global), `splitMine` / `splitPeople` / `splitTotalAmount()` / `renderSplitRows()` (Task 2).
- Produces: `#splitAutoBtn` — visible only when `splitPeople.length >= 2` (3+ participants including the user).

- [ ] **Step 1: Add the button to `public/index.html`**

After line 553 (`<button ... id="splitEvenBtn">Split evenly</button>`), add:

```html
            <button type="button" class="btn-secondary sm hidden" id="splitAutoBtn">Auto</button>
```

- [ ] **Step 2: Let `.split-actions` wrap on narrow screens (`public/styles.css:1442`)**

Replace:

```css
.split-actions { display: flex; gap: 8px; margin-bottom: 10px; }
```

with:

```css
.split-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
```

- [ ] **Step 3: Toggle visibility in `renderSplitRows`**

At the end of `renderSplitRows` (after the `myInput` block from Task 2), add:

```js
  // Auto button: only meaningful with 3+ participants (2-person solves live).
  const autoBtn = document.getElementById("splitAutoBtn");
  if (autoBtn) autoBtn.classList.toggle("hidden", splitPeople.length < 2);
```

- [ ] **Step 4: Add the click handler in `wireSplitSection`**

Directly after the Split-evenly handler block, add:

```js
  // Auto: split the REMAINING amount evenly across the blank fields only.
  document.getElementById("splitAutoBtn").addEventListener("click", () => {
    const err = $("#modalError");
    const total = splitTotalAmount();
    if (!(total > 0) || splitPeople.length < 2) return;
    const blanks = [];
    if (splitMine == null) blanks.push("me");
    for (const r of splitPeople) if (r.amount == null) blanks.push(r.personId);
    if (!blanks.length) {
      err.textContent = "All shares are filled — clear one to use Auto.";
      return;
    }
    const filled = [];
    if (splitMine != null) filled.push(splitMine);
    for (const r of splitPeople) if (r.amount != null) filled.push(r.amount);
    const shares = fillBlanks(total, filled, blanks.length);
    if (!shares.length) {
      err.textContent = "Nothing left to split — the filled shares already reach the total.";
      return;
    }
    err.textContent = "";
    blanks.forEach((key, i) => {
      if (key === "me") splitMine = shares[i];
      else {
        const rec = splitPeople.find((r) => r.personId === key);
        if (rec) rec.amount = shares[i];
      }
    });
    splitLastEdited = null;
    renderSplitRows();
  });
```

- [ ] **Step 5: Verify**

Run: `node --check public/app.js` → exit 0.
Run: `node tests/run.js` → `115/115 passed, 0 failed`.
Manual sanity (open `public/index.html` via file://): total 1000, split on, add 1 person → no Auto button; add a 2nd person → Auto appears; type 500 in one person → tap Auto → the two blank fields (you + other) show 250.00 each; save succeeds.

- [ ] **Step 6: Commit**

```bash
git add public/index.html public/styles.css public/app.js
git commit -m "feat: Auto button splits the remaining amount across blank share fields (3+ people)"
```

---

### Task 4: Kill every silent dead-save path

**Files:**
- Modify: `public/index.html:478` (novalidate), `public/app.js:2499-2537` (submit split validation, cent-exact on stored values), `public/app.js` (delete now-unused `splitOthersSum`)

**Interfaces:**
- Consumes: `splitMyShare()` / `splitPeople` (Task 2 semantics: blank = null).
- Produces: the record form never blocks submission silently — every rejection prints a visible message in `#modalError`.

- [ ] **Step 1: Add `novalidate` to the form (`public/index.html:478`)**

Replace:

```html
    <form id="recordForm">
```

with:

```html
    <form id="recordForm" novalidate>
```

Why this is safe: native validation on this form could only silently block submits (badInput on any `type="number"` field, `step="0.01"` mismatches like 83.333, `min="0"`, `required`). The JS submit handler already re-checks everything natively enforced with visible `#modalError` messages: category ("Category is required"), date ("Date is required"), amount (`!(payload.amount >= 0)` catches empty/NaN/negative → "Enter a valid amount"), and the split checks below.

- [ ] **Step 2: Make the split share-sum validation cent-exact on stored values (`app.js`, submit handler, was 2505-2537)**

Replace the body of `if (splitOn) { ... }` :

```js
    if (splitPeople.length === 0)
      return ($("#modalError").textContent = "Add at least one person to split with");
    for (const r of splitPeople) {
      if (!(Number(r.amount) > 0))
        return ($("#modalError").textContent = "Every person needs a share greater than 0");
    }
    const mine = splitMyShare();
    if (mine < 0)
      return ($("#modalError").textContent = "Shares exceed the total amount");
    const shareSum = Math.round((mine + splitOthersSum()) * 100) / 100;
    const shareDiff = Math.round((payload.amount - shareSum) * 100) / 100;
    if (shareDiff !== 0)
      return ($("#modalError").textContent =
        "Shares must add up to the total (off by " + fmt(Math.abs(shareDiff), payload.currency) + ")");
    loadStore();
    const peopleById = {};
    for (const p of (store.settings.people || [])) peopleById[p.id] = p;
    const myName = (store.profile && store.profile.displayName) || "Me";
    const parts = splitPeople.map((r) => ({
      personId: r.personId,
      name: (peopleById[r.personId] || {}).name || "?",
      amount: Math.round(Number(r.amount) * 100) / 100,
    }));
```

with:

```js
    if (splitPeople.length === 0)
      return ($("#modalError").textContent = "Add at least one person to split with");
    for (const r of splitPeople) {
      if (!(Number(r.amount) > 0))
        return ($("#modalError").textContent = "Every person needs a share greater than 0");
    }
    const mine = splitMyShare(); // blank = 0 (paying nothing yourself is fine)
    if (mine < 0)
      return ($("#modalError").textContent = "Shares exceed the total amount");
    loadStore();
    const peopleById = {};
    for (const p of (store.settings.people || [])) peopleById[p.id] = p;
    const myName = (store.profile && store.profile.displayName) || "Me";
    const parts = splitPeople.map((r) => ({
      personId: r.personId,
      name: (peopleById[r.personId] || {}).name || "?",
      amount: Math.round(Number(r.amount) * 100) / 100,
    }));
    // Cent-exact check on the values that will actually be stored (parts are
    // rounded above; a typed 83.333 must not pass validation yet store 83.33).
    const partCents = parts.reduce((s, p) => s + Math.round(p.amount * 100), 0);
    const diffCents = Math.round(payload.amount * 100) - Math.round(mine * 100) - partCents;
    if (diffCents !== 0)
      return ($("#modalError").textContent =
        "Shares must add up to the total (off by " + fmt(Math.abs(diffCents) / 100, payload.currency) + ")");
```

(The lines after this — `const breakdown = ...`, `splitPlan = { parts };`, `payload.amount = mine;`, `payload.notes = ...` — stay exactly as they are.)

- [ ] **Step 3: Delete the now-unused `splitOthersSum`**

Remove from `app.js` (state block, Task 2 Step 1 location):

```js
function splitOthersSum() {
  return splitPeople.reduce((s, r) => s + (Number(r.amount) || 0), 0);
}
```

Verify: `grep -n "splitOthersSum" public/app.js` → no matches.

- [ ] **Step 4: Verify**

Run: `node --check public/app.js` → exit 0.
Run: `node tests/run.js` → `115/115 passed, 0 failed`.
Manual sanity (file://): with split on and a person share left at 0 → Save shows "Every person needs a share greater than 0" (not a silent no-op); amount field emptied → "Enter a valid amount".

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js
git commit -m "fix: no more silent dead-saves — novalidate + cent-exact split validation on stored values"
```

---

### Task 5: Version bump v77 + handover refresh

**Files:**
- Modify: `public/app.js` (`APP_VERSION`), `public/sw.js` (`CACHE`), `handover.md` (§1 version + tests count, §4 "Split the bill", §10 glossary)

**Interfaces:**
- Consumes: everything above, finished and committed.
- Produces: releasable v77.

- [ ] **Step 1: Bump versions in lockstep**

In `public/app.js`: `APP_VERSION` `"v76"` → `"v77"`.
In `public/sw.js`: `CACHE` `"munitrakr-v76"` → `"munitrakr-v77"`.

- [ ] **Step 2: Refresh `handover.md`**

- §1 header line: `Current version: **v76**` → `**v77**`; `tests/ — 107 unit tests` → `115 unit tests`; §1 test-run line `107/107` → `115/115` (same in §8's release-flow line if present).
- §4 "Split the bill": replace the second paragraph (the one describing `#splitMyAmt` live-tracking the remainder, `splitMineManual`, and blur-refill) with:

```markdown
- Share fields (the user's own included) are typed-or-blank; state mirrors the visible fields exactly (`splitMine`, `splitPeople[].amount`, `null` = blank — number-input badInput can't desync save). With exactly 2 participants, typing either field auto-fills the other with `total − typed` (`solve2p()`, DOM-direct so focus/caret survive; also re-mirrors when the total changes). With 3+ participants nothing solves live; an **Auto** button (visible only then) splits the remaining amount cent-exact across the blank fields via `fillBlanks` (debts.js). "Split evenly" overwrites all fields with `evenShares`. The record form is `novalidate` — every save rejection is a visible `#modalError` message (share sums are validated cent-exact on the rounded values that get stored).
```

- §10 glossary: replace the `splitPeople / splitMineManual / syncSplitSection / renderSplitRows` row with `splitPeople / splitMine / splitLastEdited / solve2p / syncSplitSection / renderSplitRows`; add `fillBlanks` to the `evenShares` row (`pure (from debts.js) — cent-exact splits: evenShares over everyone, fillBlanks over blank fields only`).

- [ ] **Step 3: Final verification**

Run: `node --check public/app.js && node --check public/sw.js` → exit 0.
Run: `node tests/run.js` → `115/115 passed, 0 failed`.
Run: `git status` → only the three edited files modified.

- [ ] **Step 4: Commit (do NOT push)**

```bash
git add public/app.js public/sw.js handover.md
git commit -m "chore: bump to v77 + refresh handover (split fill rework)"
```
