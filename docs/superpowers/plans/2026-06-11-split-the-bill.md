# Split the Bill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user split an expense across DebtTrakr people at Add-Record time: the saved expense holds only the user's share, and one `lend` debt per participant is auto-created with full breakdown notes on both sides.

**Architecture:** Pure split math (`evenShares`) goes in the UMD module `public/debts.js` with Node unit tests. UI is a new expandable section inside the existing Add Record modal (`#recordForm`), mirroring the "Make this recurring" pattern. The form submit handler swaps the payload amount for the user's share and inserts debts via the existing `attachConversion` + `insertSingleDebt` path.

**Tech Stack:** Vanilla JS (no build step), localStorage, existing UMD test harness (`node tests/run.js`).

**Spec:** `docs/superpowers/specs/2026-06-11-split-the-bill-design.md`

**Key existing code (read these before starting):**
- `public/app.js:2148` `openModal(record)` — modal reset path
- `public/app.js:2226` `#recordForm` submit handler — save path
- `public/app.js:1952` type-toggle buttons (expense/investment)
- `public/app.js:3327` `setRecRecurringSection` — the pattern this feature mirrors
- `public/app.js:3808` `buildDebtPersonMenu` — person-menu markup pattern (`.picker-opt`, `.pick-ico`)
- `public/app.js:3861` `wireInlineAddPerson` — inline new-person mini-form pattern
- `public/app.js:4016` `insertSingleDebt(rec)` — stamps id/createdAt, pushes, saves
- `public/debts.js` — UMD module; globals land on `window` in browser, `module.exports` in Node
- Globals available in app.js: `evenShares` (after Task 1), `personIconSvg`, `escapeHtml`, `fmt`, `loadStore`, `saveStore`, `store`, `editingId`, `modalType`, `attachConversion`

---

### Task 1: `evenShares` pure helper (TDD)

**Files:**
- Modify: `public/debts.js` (add function + export)
- Test: `tests/debts.test.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to the END of `tests/debts.test.js`:

```js
/* ---------------- evenShares (split-the-bill) ---------------- */

test("evenShares: splits evenly with no remainder", () => {
  assert.deepEqual(D.evenShares(300, 3), [100, 100, 100]);
});

test("evenShares: rounding remainder goes to index 0", () => {
  assert.deepEqual(D.evenShares(1000, 3), [333.34, 333.33, 333.33]);
});

test("evenShares: shares sum exactly to total (cent-exact)", () => {
  const shares = D.evenShares(123.45, 7);
  assert.equal(shares.length, 7);
  const cents = shares.reduce((s, v) => s + Math.round(v * 100), 0);
  assert.equal(cents, 12345);
});

test("evenShares: count 1 returns the whole total", () => {
  assert.deepEqual(D.evenShares(55.5, 1), [55.5]);
});

test("evenShares: invalid input -> empty array", () => {
  assert.deepEqual(D.evenShares(0, 3), []);
  assert.deepEqual(D.evenShares(-5, 3), []);
  assert.deepEqual(D.evenShares(100, 0), []);
  assert.deepEqual(D.evenShares(NaN, 2), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/run.js`
Expected: 5 failures, each `✗ evenShares: ...` with `D.evenShares is not a function`. Existing 93 still pass.

- [ ] **Step 3: Implement `evenShares` in `public/debts.js`**

Insert BEFORE the final `return { ... }` line (after the `wouldOvershoot` function):

```js
  // Splits `total` into `count` shares, each rounded to 2 decimals, that sum
  // cent-exactly to `total`. Index 0 absorbs the rounding remainder — callers
  // put the payer there so other participants' shares stay clean numbers.
  // Returns [] when total is not a positive finite number or count < 1.
  function evenShares(total, count) {
    const t = Number(total);
    const n = Math.floor(Number(count));
    if (!Number.isFinite(t) || !(t > 0) || !(n >= 1)) return [];
    const cents = Math.round(t * 100);
    const base = Math.floor(cents / n);
    const first = cents - base * (n - 1);
    const out = [first / 100];
    for (let i = 1; i < n; i++) out.push(base / 100);
    return out;
  }
```

Then change the export line at the bottom from:

```js
  return { personBalances, totalsAcrossPeople, annotateSettlements, balanceBefore, planSplit, wouldOvershoot };
```

to:

```js
  return { personBalances, totalsAcrossPeople, annotateSettlements, balanceBefore, planSplit, wouldOvershoot, evenShares };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/run.js`
Expected: `98/98 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add public/debts.js tests/debts.test.js
git commit -m "feat: evenShares split math in debts.js (TDD)"
```

---

### Task 2: Split section markup + styles

**Files:**
- Modify: `public/index.html` (~line 517–527, between the Notes label and `#newColorPanel`)
- Modify: `public/styles.css` (append)

- [ ] **Step 1: Add the split section HTML**

In `public/index.html`, find:

```html
      <label>Notes
        <textarea id="fNotes" rows="2" placeholder="Optional notes"></textarea>
      </label>

      <!-- New category/sub colour assignment -->
```

Insert BETWEEN the closing `</label>` of Notes and the `<!-- New category/sub colour assignment -->` comment:

```html
      <!-- Split the bill (Add flow only; expense type only) -->
      <div id="splitSection" class="split-section">
        <label class="row-toggle">
          <input type="checkbox" id="splitToggle" />
          <span>Split the bill
            <span class="hint" id="splitHint">Enter the total amount first</span>
          </span>
        </label>
        <div id="splitBody" class="hidden">
          <div id="splitRows" class="split-rows"></div>
          <div class="split-actions">
            <div class="picker" id="splitPersonPicker">
              <button type="button" class="btn-secondary sm" id="splitAddPersonBtn">+ Add person</button>
              <div class="picker-menu hidden" id="splitPersonMenu"></div>
            </div>
            <button type="button" class="btn-secondary sm" id="splitEvenBtn">Split evenly</button>
          </div>
          <div id="splitNewPersonForm" class="add-person-inline hidden">
            <input type="color" id="splitNewPersonColor" value="#7c5cff" />
            <input type="text" id="splitNewPersonName" placeholder="Name" />
            <button type="button" class="btn-mini" id="splitNewPersonSave">Save</button>
            <button type="button" class="btn-mini" id="splitNewPersonCancel">Cancel</button>
          </div>
        </div>
      </div>
```

Note: the new-person inputs intentionally have NO `required` attribute — they sit inside `#recordForm` and must not block form submission.

- [ ] **Step 2: Append styles to `public/styles.css`**

Append at the end of the file:

```css
/* ---- Split the bill (Add Record modal) ---- */
.split-section { margin-top: 8px; padding: 6px 0 0; border-top: 1px solid rgba(255,255,255,0.08); }
.split-rows { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 10px; }
.split-row { display: flex; align-items: center; gap: 9px;
  background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  padding: 8px 10px; }
.split-row .pick-ico { width: 30px; height: 30px; border-radius: 9px; flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center; color: #fff; }
.split-row .pick-ico svg { width: 16px; height: 16px; }
.split-name { flex: 1; min-width: 0; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.split-name .split-you { color: var(--muted); font-weight: 400; font-size: .85em; }
.split-row input.split-amt { width: 110px; flex: 0 0 auto; margin: 0;
  padding: 8px 10px; font-size: 14px; text-align: right; }
.split-amt-fixed { flex: 0 0 auto; font-weight: 700; font-variant-numeric: tabular-nums; }
.split-amt-fixed.neg { color: var(--out); }
.split-remove { -webkit-appearance: none; appearance: none; background: transparent;
  border: 0; color: var(--out); font-size: 17px; line-height: 1; padding: 4px 6px;
  cursor: pointer; flex: 0 0 auto; -webkit-tap-highlight-color: transparent; }
.split-actions { display: flex; gap: 8px; margin-bottom: 10px; }
.split-actions .picker { flex: 0 0 auto; }
#splitPersonMenu { min-width: 210px; }
```

All colors come from existing theme variables (`--card`, `--line`, `--out`, `--muted`) — no per-theme overrides needed. The `border-top: rgba(255,255,255,.08)` treatment matches `.rec-recurring` exactly.

- [ ] **Step 3: Commit**

```bash
git add public/index.html public/styles.css
git commit -m "feat: split-the-bill section markup + styles"
```

---

### Task 3: Split UI logic in app.js

**Files:**
- Modify: `public/app.js` — three integration points + one new block

- [ ] **Step 1: Add the split state + functions block**

In `public/app.js`, insert the following block immediately BEFORE the line `$("#recordForm").addEventListener("submit", async (e) => {` (currently app.js:2226):

```js
/* ---------------- Split the bill (Add Record modal) ---------------- */
// Others' shares only — the user's own share is always the remainder.
let splitPeople = []; // [{ personId, amount|null }]

function splitTotalAmount() {
  return parseFloat($("#fAmount").value) || 0;
}
function splitOthersSum() {
  return splitPeople.reduce((s, r) => s + (Number(r.amount) || 0), 0);
}
function splitMyShare() {
  return Math.round((splitTotalAmount() - splitOthersSum()) * 100) / 100;
}

// Show/hide/enable the whole section based on: add-vs-edit, record type,
// recurring-toggle state (mutually exclusive), and whether a total is entered.
function syncSplitSection() {
  const section = document.getElementById("splitSection");
  const toggle = document.getElementById("splitToggle");
  const body = document.getElementById("splitBody");
  const hint = document.getElementById("splitHint");
  if (!section || !toggle || !body) return;
  const recOn = !!document.getElementById("recRecurringToggle")?.checked;
  const allowed = !editingId && modalType === "expense" && !recOn;
  section.classList.toggle("hidden", !allowed);
  if (!allowed && toggle.checked) {
    toggle.checked = false;
    splitPeople = [];
  }
  const hasAmount = splitTotalAmount() > 0;
  toggle.disabled = !hasAmount;
  if (hint) hint.classList.toggle("hidden", hasAmount);
  if (!hasAmount && toggle.checked) {
    toggle.checked = false;
    splitPeople = [];
  }
  body.classList.toggle("hidden", !toggle.checked);
  // Mutual exclusion: hide the recurring section while split is on.
  const recSection = document.getElementById("recRecurringSection");
  if (recSection) recSection.classList.toggle("hidden", toggle.checked);
  if (toggle.checked) renderSplitRows();
}

function renderSplitRows() {
  const box = document.getElementById("splitRows");
  if (!box) return;
  loadStore();
  const peopleById = {};
  for (const p of (store.settings.people || [])) peopleById[p.id] = p;
  const myName = (store.profile && store.profile.displayName) || "Me";
  const cur = $("#fCurrency").value || "";
  const mine = splitMyShare();
  let html =
    '<div class="split-row split-row-me">' +
      '<span class="pick-ico" style="background:var(--accent)">' + personIconSvg("person") + '</span>' +
      '<span class="split-name">' + escapeHtml(myName) + ' <span class="split-you">(you)</span></span>' +
      '<span class="split-amt-fixed' + (mine < 0 ? " neg" : "") + '" id="splitMyAmt">' + fmt(mine, cur) + '</span>' +
    '</div>';
  for (const row of splitPeople) {
    const p = peopleById[row.personId];
    if (!p) continue;
    html +=
      '<div class="split-row" data-pid="' + p.id + '">' +
        '<span class="pick-ico" style="background:' + p.color + '">' + personIconSvg(p.icon || "person") + '</span>' +
        '<span class="split-name">' + escapeHtml(p.name) + '</span>' +
        '<input type="number" class="split-amt" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="' + (row.amount != null ? row.amount : "") + '" />' +
        '<button type="button" class="split-remove" aria-label="Remove">✕</button>' +
      '</div>';
  }
  box.innerHTML = html;
  box.querySelectorAll(".split-row[data-pid]").forEach((rowEl) => {
    const pid = rowEl.dataset.pid;
    // Partial update on input (no re-render — keeps the input focused).
    rowEl.querySelector(".split-amt").addEventListener("input", (e) => {
      const rec = splitPeople.find((r) => r.personId === pid);
      if (rec) rec.amount = parseFloat(e.target.value);
      updateSplitMyAmt();
    });
    rowEl.querySelector(".split-remove").addEventListener("click", () => {
      splitPeople = splitPeople.filter((r) => r.personId !== pid);
      renderSplitRows();
    });
  });
}

function updateSplitMyAmt() {
  const el = document.getElementById("splitMyAmt");
  if (!el) return;
  const mine = splitMyShare();
  el.textContent = fmt(mine, $("#fCurrency").value || "");
  el.classList.toggle("neg", mine < 0);
}

// "+ Add person" menu: DebtTrakr people not yet added, plus "+ New person".
function buildSplitPersonMenu() {
  const menu = document.getElementById("splitPersonMenu");
  if (!menu) return;
  loadStore();
  const taken = new Set(splitPeople.map((r) => r.personId));
  const avail = (store.settings.people || []).filter((p) => !taken.has(p.id));
  menu.innerHTML =
    avail.map((p) =>
      '<button type="button" class="picker-opt" data-pid="' + p.id + '">' +
        '<span class="pick-ico" style="background:' + p.color + '">' + personIconSvg(p.icon || "person") + '</span>' +
        '<span>' + escapeHtml(p.name) + '</span>' +
      '</button>'
    ).join("") +
    '<button type="button" class="picker-opt" data-new="1">+ New person</button>';
  menu.querySelectorAll(".picker-opt").forEach((b) => {
    b.addEventListener("click", () => {
      menu.classList.add("hidden");
      if (b.dataset.new) {
        document.getElementById("splitNewPersonForm").classList.remove("hidden");
        document.getElementById("splitNewPersonName").focus();
        return;
      }
      splitPeople.push({ personId: b.dataset.pid, amount: null });
      renderSplitRows();
    });
  });
}

(function wireSplitSection() {
  const toggle = document.getElementById("splitToggle");
  if (!toggle) return;
  toggle.addEventListener("change", syncSplitSection);
  $("#fAmount").addEventListener("input", () => {
    syncSplitSection();
    if (toggle.checked) updateSplitMyAmt();
  });
  $("#fCurrency").addEventListener("change", () => {
    if (toggle.checked) updateSplitMyAmt();
  });
  // Mutual exclusion (other direction): recurring ON hides split.
  const recToggle = document.getElementById("recRecurringToggle");
  if (recToggle) recToggle.addEventListener("change", syncSplitSection);

  // "+ Add person" menu open/close
  const addBtn = document.getElementById("splitAddPersonBtn");
  const menu = document.getElementById("splitPersonMenu");
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    buildSplitPersonMenu();
    menu.classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#splitPersonPicker")) menu.classList.add("hidden");
  });

  // Split evenly: total / (me + others), remainder to me (index 0).
  document.getElementById("splitEvenBtn").addEventListener("click", () => {
    const total = splitTotalAmount();
    if (!(total > 0) || splitPeople.length === 0) return;
    const shares = evenShares(total, splitPeople.length + 1);
    splitPeople.forEach((r, i) => { r.amount = shares[i + 1]; });
    renderSplitRows();
  });

  // Inline new-person mini-form (same pattern as the Add Debt modal).
  const form = document.getElementById("splitNewPersonForm");
  document.getElementById("splitNewPersonCancel").addEventListener("click", () => {
    form.classList.add("hidden");
  });
  document.getElementById("splitNewPersonSave").addEventListener("click", () => {
    const name = document.getElementById("splitNewPersonName").value.trim();
    if (!name) return;
    const color = document.getElementById("splitNewPersonColor").value || "#7c5cff";
    loadStore();
    const newId = "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
    store.settings.people.push({ id: newId, name, color, icon: "person" });
    saveStore();
    document.getElementById("splitNewPersonName").value = "";
    form.classList.add("hidden");
    splitPeople.push({ personId: newId, amount: null });
    renderSplitRows();
  });
})();
```

- [ ] **Step 2: Reset split state in `openModal`**

In `openModal(record)` (app.js:2148), after the line `setRecRecurringSection(record);` add:

```js
  splitPeople = [];
  const splitToggleEl = document.getElementById("splitToggle");
  if (splitToggleEl) splitToggleEl.checked = false;
  const splitFormEl = document.getElementById("splitNewPersonForm");
  if (splitFormEl) splitFormEl.classList.add("hidden");
  syncSplitSection();
```

- [ ] **Step 3: Re-sync on type toggle**

In the type-toggle click handler (app.js:1952), after `setCategory("");` add:

```js
    syncSplitSection();
```

- [ ] **Step 4: Syntax check**

Run: `node --check public/app.js`
Expected: no output (exit 0)

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat: split-the-bill UI logic (rows, even split, person add)"
```

---

### Task 4: Save-flow integration

**Files:**
- Modify: `public/app.js` — `#recordForm` submit handler only

- [ ] **Step 1: Add split validation + payload mutation**

In the submit handler, find:

```js
  if (!(payload.amount >= 0))
    return ($("#modalError").textContent = "Enter a valid amount");
```

Immediately AFTER it (before the `// step 1: detect new category/sub...` comment), add:

```js
  // ----- Split the bill (Add flow only) -----
  const splitOn =
    !editingId &&
    modalType === "expense" &&
    !!document.getElementById("splitToggle")?.checked;
  let splitPlan = null;
  if (splitOn) {
    if (splitPeople.length === 0)
      return ($("#modalError").textContent = "Add at least one person to split with");
    for (const r of splitPeople) {
      if (!(Number(r.amount) > 0))
        return ($("#modalError").textContent = "Every person needs a share greater than 0");
    }
    const mine = splitMyShare();
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
    const breakdown =
      "Split bill — total " + fmt(payload.amount, payload.currency) + ": " +
      [myName + " " + fmt(mine, "")]
        .concat(parts.map((p) => p.name + " " + fmt(p.amount, "")))
        .join(" · ");
    splitPlan = { mine, parts, total: payload.amount };
    payload.amount = mine; // expense records the user's share only
    payload.notes = (payload.notes ? payload.notes + "\n" : "") + breakdown;
  }
```

Note: this block runs on EVERY submit attempt, including the second pass of the
new-category color flow (`pendingNew`). That is correct — `payload` is rebuilt
from the form fields each submit, so the amount swap and notes append never
double-apply.

- [ ] **Step 2: Create the debt records after the expense saves**

In the same handler's `try` block, find:

```js
    let savedRecord = null;
    if (editingId) savedRecord = await api("/records/" + editingId, "PUT", payload);
    else savedRecord = await api("/records", "POST", payload);
```

Immediately AFTER those lines, add:

```js
    // Split: one "lend" debt per participant (independent records — no links).
    if (splitPlan) {
      const mrVisible = !$("#manualRateField").classList.contains("hidden");
      const mr = mrVisible ? parseFloat($("#fManualRate").value) : null;
      const userNotes = $("#fNotes").value.trim();
      const debtNotes =
        "Split bill (" + payload.category +
        (payload.subcategory ? " / " + payload.subcategory : "") + ")" +
        " — total " + fmt(splitPlan.total, payload.currency) +
        (userNotes ? "\n" + userNotes : "");
      loadStore();
      for (const part of splitPlan.parts) {
        const d = {
          type: "lend",
          personId: part.personId,
          date: payload.date,
          amount: part.amount,
          currency: payload.currency,
          notes: debtNotes,
        };
        try { await attachConversion(d, mr); } catch (_e) { d.rateUnavailable = true; }
        insertSingleDebt(d);
      }
    }
```

Why `type: "lend"` unconditionally: lend is math-identical to pay-back in the
cycle logic (`debts.js`), so it is always correct regardless of the person's
current direction, and never triggers the overshoot/split-confirm modal (that
only applies to `paid-back`/`pay-back` types).

- [ ] **Step 3: Syntax check + full test suite**

Run: `node --check public/app.js && node tests/run.js`
Expected: `98/98 passed, 0 failed`

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat: split-the-bill save flow — reduced expense + auto lend debts"
```

---

### Task 5: Version bump, docs, final verification

**Files:**
- Modify: `public/app.js:6` (`APP_VERSION`)
- Modify: `public/sw.js:2` (`CACHE`)
- Modify: `handover.md` (version, test count, feature note)

- [ ] **Step 1: Bump versions in lockstep**

`public/app.js` line 6:

```js
const APP_VERSION = "v69"; // keep in step with sw.js CACHE
```

`public/sw.js` line 2:

```js
const CACHE = "munitrakr-v69";
```

- [ ] **Step 2: Update `handover.md`**

1. Header (§ top): change `Current version: **v68**` to `Current version: **v69**`.
   (If it still says v67, the v68 release note was missed — set it to v69 regardless.)
2. Replace both occurrences of `93 unit tests` / `93/93 passed` with `98 unit tests` / `98/98 passed`.
3. In §4 (MuniTrakr — features), add a bullet at the end:

```markdown
### Split the bill
- Add Record modal (expense type, Add flow only): "Split the bill" checkbox above the recurring section (mutually exclusive with it). User's share is the auto-computed remainder; "Split evenly" uses `evenShares` (debts.js) with the rounding remainder going to the user. On save: the expense stores only the user's share (notes auto-append the full breakdown), and one `lend` debt per participant is created on the DebtTrakr side (same currency/date/manual-rate, notes carry category + total). Expense and debts are independent after creation.
```

4. In §10 glossary table, add a row:

```markdown
| `evenShares` | pure (from `debts.js`) — cent-exact even split, remainder to index 0 (the user) |
| `splitPeople` / `syncSplitSection` / `renderSplitRows` | split-the-bill state + UI (Add Record modal) |
```

- [ ] **Step 3: Full verification**

Run: `node --check public/app.js && node --check public/sw.js && node tests/run.js`
Expected: both checks silent, `98/98 passed, 0 failed`

- [ ] **Step 4: Commit**

```bash
git add public/app.js public/sw.js handover.md
git commit -m "chore: bump to v69 + handover update for split-the-bill"
```

---

## Manual verification checklist (user previews via file://, no server needed)

1. Add Record (expense): checkbox disabled until Amount entered; hint shows.
2. Enter 1000 → check Split → your row shows full 1000; recurring section hides.
3. + Add person → pick someone → enter 300 → your row live-updates to 700.
4. + Add person → "+ New person" → create → appears in row list AND later in DebtTrakr Settings → People.
5. Split evenly with 2 others → 333.34 / 333.33 / 333.33.
6. Remove × works; your remainder updates.
7. Over-allocate (others > total) → your row red, save blocked with error.
8. Save → expense in Records list shows your share with breakdown in notes; switch to DebtTrakr → each person has a new `lend` with split notes.
9. Type → Investment hides the whole split section; back to Expense restores it.
10. Edit an existing record → no split section.
11. Check "Make this recurring" → split section hides (and vice versa).
12. Repeat a split save in Aero and Yoimiya themes — rows/buttons themed correctly.

## Out of scope (per spec)

- Re-splitting on edit; cross-links between expense and debts; split on investments or recurring rules.
