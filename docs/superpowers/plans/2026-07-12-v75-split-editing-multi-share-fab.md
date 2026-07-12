# v75 — Split UX polish, DebtTrakr multi-share, floating-button position — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v75: auto-scroll when a split participant is added, editable self-share in split-the-bill, multi-select PNG sharing in DebtTrakr All Records (chronological), and lower floating buttons in dock-less (DebtTrakr) views.

**Architecture:** All changes live in the static PWA under `public/` — `app.js` (single-file client logic), `index.html` (one new button), `styles.css` (two positioning rules + one input style). No new pure logic → no new unit tests; the existing 107 must keep passing.

**Tech Stack:** Vanilla JS / CSS. Verify with `node --check` + `node tests/run.js`. No build step.

**Spec:** `docs/superpowers/specs/2026-07-12-v75-split-editing-multi-share-fab-design.md`

## Global Constraints

- Work directly on `main`. Commit per task; **do NOT push** (user pushes explicitly).
- Windows PowerShell environment; repo root is the working directory.
- No Unicode glyph icons in UI — inline SVG only (iOS emoji substitution, handover §9).
- Every task ends with: `node --check public/app.js` clean AND `node tests/run.js` printing `107/107 passed, 0 failed`.
- Line numbers below are from the v74 state (commit 25cb184) and drift as tasks land — match on the quoted code, not the number.
- Do not bump versions until Task 5 (single lockstep bump to v75).

---

### Task 1: Auto-scroll when a split participant is added

**Files:**
- Modify: `public/app.js` (~2330 helper insertion; ~2354–2363 menu pick; ~2370–2377 toggle handler; ~2422–2434 new-person save)

**Interfaces:**
- Produces: `scrollSplitIntoView()` — module-level function, no args, no return. (No later task consumes it; listed for name stability.)

- [ ] **Step 1: Add the helper**

In `public/app.js`, directly after the `updateSplitMyAmt` function (after its closing `}`, ~line 2336), insert:

```js
// Bring the bottom of the form (where the split section lives) into view.
function scrollSplitIntoView() {
  const form = document.getElementById("recordForm");
  if (form) form.scrollTo({ top: form.scrollHeight, behavior: "smooth" });
}
```

- [ ] **Step 2: Use it in the split-toggle handler**

In `wireSplitSection` (~2370), replace:

```js
  toggle.addEventListener("change", () => {
    syncSplitSection();
    // The section expands near the bottom of the form — bring it into view.
    if (toggle.checked) {
      const form = document.getElementById("recordForm");
      if (form) form.scrollTo({ top: form.scrollHeight, behavior: "smooth" });
    }
  });
```

with:

```js
  toggle.addEventListener("change", () => {
    syncSplitSection();
    // The section expands near the bottom of the form — bring it into view.
    if (toggle.checked) scrollSplitIntoView();
  });
```

- [ ] **Step 3: Scroll after picking a person from the menu**

In `buildSplitPersonMenu`'s option click handler (~2354), replace:

```js
      splitPeople.push({ personId: b.dataset.pid, amount: null });
      renderSplitRows();
```

with:

```js
      splitPeople.push({ personId: b.dataset.pid, amount: null });
      renderSplitRows();
      scrollSplitIntoView();
```

- [ ] **Step 4: Scroll after inline new-person save**

In the `#splitNewPersonSave` click handler (~2422–2434), replace:

```js
    splitPeople.push({ personId: newId, amount: null });
    renderSplitRows();
```

with:

```js
    splitPeople.push({ personId: newId, amount: null });
    renderSplitRows();
    scrollSplitIntoView();
```

(Do NOT add a scroll to the remove handler or the Split-evenly handler — the list doesn't grow there.)

- [ ] **Step 5: Verify**

Run: `node --check public/app.js` → no output (exit 0).
Run: `node tests/run.js` → `107/107 passed, 0 failed`.

- [ ] **Step 6: Commit**

```powershell
git add public/app.js; git commit -m "feat: auto-scroll split section when a participant is added"
```

---

### Task 2: Editable self-share in split-the-bill

**Files:**
- Modify: `public/app.js` (~2247 state; ~2249–2257 share math; ~2288–2336 render + update; ~2191 modal reset; ~2261–2286 syncSplitSection; ~2402–2408 split-evenly; ~2460–2487 submit validation)
- Modify: `public/styles.css` (~1432–1435 split input styles)

**Interfaces:**
- Consumes: nothing from Task 1 (independent).
- Produces: `splitRemainder()` → number (total − others, cents-rounded); `splitMyShare()` → number (manual input value when `splitMineManual`, else remainder); module flag `splitMineManual: boolean`. `#splitMyAmt` is now an `<input type="number">` (was a `<span>`).

Behavior contract: the "(you)" amount is auto-computed (remainder) until the user types in it; clearing the field returns it to auto (refilled on blur or next recompute). On save, all shares (mine + participants) must sum exactly to the total.

- [ ] **Step 1: Add the manual flag + split the math helpers**

At ~2247, replace:

```js
let splitPeople = []; // [{ personId, amount|null }]
```

with:

```js
let splitPeople = []; // [{ personId, amount|null }]
let splitMineManual = false; // user typed their own share (stop auto-remainder)
```

Then replace `splitMyShare` (~2255–2257):

```js
function splitMyShare() {
  return Math.round((splitTotalAmount() - splitOthersSum()) * 100) / 100;
}
```

with:

```js
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

- [ ] **Step 2: Render the "(you)" row as an input**

In `renderSplitRows` (~2297–2302), replace the me-row html:

```js
  let html =
    '<div class="split-row split-row-me">' +
      '<span class="pick-ico" style="background:var(--accent)">' + personIconSvg("person") + '</span>' +
      '<span class="split-name">' + escapeHtml(myName) + ' <span class="split-you">(you)</span></span>' +
      '<span class="split-amt-fixed' + (mine < 0 ? " neg" : "") + '" id="splitMyAmt">' + fmt(mine, cur) + '</span>' +
    '</div>';
```

with:

```js
  let html =
    '<div class="split-row split-row-me">' +
      '<span class="pick-ico" style="background:var(--accent)">' + personIconSvg("person") + '</span>' +
      '<span class="split-name">' + escapeHtml(myName) + ' <span class="split-you">(you)</span></span>' +
      '<input type="number" class="split-amt split-amt-me' + (mine < 0 ? " neg" : "") + '" id="splitMyAmt" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="' + mine + '" />' +
    '</div>';
```

Note: `const cur = $("#fCurrency").value || "";` (~2295) becomes unused in this function after this change — remove that line.

- [ ] **Step 3: Wire the input's auto/manual behavior**

Still in `renderSplitRows`, after the `box.querySelectorAll(".split-row[data-pid]").forEach(...)` block (~2315–2327), append:

```js
  const myInput = box.querySelector("#splitMyAmt");
  if (myInput) {
    // Typing → manual (auto-remainder stops). Clearing → back to auto,
    // refilled on blur or on the next total/participant change.
    myInput.addEventListener("input", () => {
      splitMineManual = myInput.value.trim() !== "";
      if (splitMineManual)
        myInput.classList.toggle("neg", (parseFloat(myInput.value) || 0) < 0);
    });
    myInput.addEventListener("blur", () => {
      if (!splitMineManual) updateSplitMyAmt();
    });
  }
```

- [ ] **Step 4: Make `updateSplitMyAmt` respect manual mode and write `value`**

Replace `updateSplitMyAmt` (~2330–2336):

```js
function updateSplitMyAmt() {
  const el = document.getElementById("splitMyAmt");
  if (!el) return;
  const mine = splitMyShare();
  el.textContent = fmt(mine, $("#fCurrency").value || "");
  el.classList.toggle("neg", mine < 0);
}
```

with:

```js
function updateSplitMyAmt() {
  const el = document.getElementById("splitMyAmt");
  if (!el) return;
  if (splitMineManual) {
    el.classList.toggle("neg", (parseFloat(el.value) || 0) < 0);
    return;
  }
  const mine = splitRemainder();
  el.value = mine;
  el.classList.toggle("neg", mine < 0);
}
```

- [ ] **Step 5: Reset the flag on every splitPeople reset**

Three places:

(a) `openModal` (~2191) — replace:

```js
  splitPeople = [];
```

with:

```js
  splitPeople = [];
  splitMineManual = false;
```

(b) + (c) `syncSplitSection` — BOTH clear paths (~2270–2273 and ~2277–2280) currently read:

```js
    toggle.checked = false;
    splitPeople = [];
```

Each becomes:

```js
    toggle.checked = false;
    splitPeople = [];
    splitMineManual = false;
```

- [ ] **Step 6: Split-evenly resets to auto**

In the `#splitEvenBtn` handler (~2402–2408), replace:

```js
    const shares = evenShares(total, splitPeople.length + 1);
    splitPeople.forEach((r, i) => { r.amount = shares[i + 1]; });
    renderSplitRows();
```

with:

```js
    const shares = evenShares(total, splitPeople.length + 1);
    splitPeople.forEach((r, i) => { r.amount = shares[i + 1]; });
    splitMineManual = false; // mine returns to auto = shares[0]
    renderSplitRows();
```

- [ ] **Step 7: Enforce sum == total on save**

In the `#recordForm` submit handler's split block (~2460–2470), replace:

```js
    const mine = splitMyShare();
    if (mine < 0)
      return ($("#modalError").textContent = "Shares exceed the total amount");
```

with:

```js
    const mine = splitMyShare();
    if (mine < 0)
      return ($("#modalError").textContent = "Shares exceed the total amount");
    const shareSum = Math.round((mine + splitOthersSum()) * 100) / 100;
    const shareDiff = Math.round((payload.amount - shareSum) * 100) / 100;
    if (shareDiff !== 0)
      return ($("#modalError").textContent =
        "Shares must add up to the total (off by " + fmt(Math.abs(shareDiff), payload.currency) + ")");
```

(`payload.amount` is still the full bill total at this point — it is reassigned to `mine` a few lines below; do not move that.)

- [ ] **Step 8: CSS — style the me-input, drop the dead span styles**

In `public/styles.css` (~1434–1435), replace:

```css
.split-amt-fixed { flex: 0 0 auto; font-weight: 700; font-variant-numeric: tabular-nums; }
.split-amt-fixed.neg { color: var(--out); }
```

with:

```css
.split-row input.split-amt-me { font-weight: 700; }
.split-row input.split-amt-me.neg { color: var(--out); border-color: var(--out); }
```

(The width/padding/text-align comes from the existing `.split-row input.split-amt` rule at ~1432.)

- [ ] **Step 9: Verify**

Run: `node --check public/app.js` → exit 0.
Run: `node tests/run.js` → `107/107 passed, 0 failed`.
Grep sanity: `.split-amt-fixed` must have zero remaining references in `public/` (`grep -rn "split-amt-fixed" public/` → no hits).

- [ ] **Step 10: Commit**

```powershell
git add public/app.js public/styles.css; git commit -m "feat: editable self-share in split the bill (auto-remainder until typed)"
```

---

### Task 3: Multi-select share in All Debt Records (chronological)

**Files:**
- Modify: `public/index.html` (~424–434, `#dbtMultiBar`)
- Modify: `public/app.js` (~4698–4739 `shareDebtRecord`; ~5035–5049 `dbtUpdateSelUI`; ~5090–5108 multi-select wiring)

**Interfaces:**
- Consumes: existing `renderDebtCard(debt, person, before, defaultCurrency, userName, lang)` → `Promise<Blob>`; `balanceBefore(debts, id, peopleById)`; `_downloadBlob(blob, filename)`; `lastDbtRows`; `debtSelected`.
- Produces: `shareDebtRecords(debtList: Debt[])` → `Promise<void>` (sorts oldest-first internally); `shareDebtRecord(debt)` kept as a thin wrapper so the two per-row call sites (~4848, ~4978) are untouched. New button `#dbtMsShare`.

- [ ] **Step 1: Add the Share button to the debt multi-bar**

In `public/index.html`, inside `#dbtMultiBar` (~424), insert between the Cancel button and the Delete button:

```html
    <button id="dbtMsShare" class="ms-btn" disabled aria-label="Share selected">
      <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
```

(Same arrow-out-of-tray glyph as the per-row `.dbt-share` button. Resulting order: Cancel / Share / Delete / Select-all.)

- [ ] **Step 2: Generalize the share function**

In `public/app.js`, replace the whole `shareDebtRecord` function (~4698–4739) with:

```js
// Share one or more debt records as PNGs via the system share sheet.
// Multiple records always go oldest-first (date asc, createdAt asc) so the
// receiver reads the history in chronological order; filenames get an index
// prefix so name-sorted galleries keep that order too.
// Falls back to per-file downloads when Web Share with files is unavailable.
async function shareDebtRecords(debtList) {
  const list = (debtList || []).filter((d) => d && d.id);
  if (!list.length) return;
  loadStore();
  const peopleById = {};
  for (const p of (store.settings.people || [])) peopleById[p.id] = p;
  const defaultCurrency = (store.settings.defaultCurrency || "THB");
  const userName = (store.profile && store.profile.displayName) || "Me";
  const debtShareLanguage = store.settings.debtShareLanguage || "en";

  const ordered = list.slice().sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)
  );

  // Render sequentially — each card is a full-size canvas; parallel rendering
  // of a big selection would spike memory on iOS.
  const files = [];
  for (let i = 0; i < ordered.length; i++) {
    const debt = ordered[i];
    const person = (store.settings.people || []).find((x) => x.id === debt.personId)
      || { name: "(deleted person)", color: "#888", icon: "person" };
    const before = balanceBefore(store.debts || [], debt.id, peopleById);
    let blob;
    try {
      blob = await renderDebtCard(debt, person, before, defaultCurrency, userName, debtShareLanguage);
    } catch (err) {
      console.error("renderDebtCard failed:", err);
      alert("Couldn't generate the image — try again.");
      return;
    }
    if (!blob) return;
    const safeName = (person.name || "person").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
    const prefix = ordered.length > 1 ? String(i + 1).padStart(2, "0") + "-" : "";
    const filename = "debt-" + prefix + safeName + "-" + (debt.date || "record") + ".png";
    files.push(new File([blob], filename, { type: "image/png" }));
  }

  try {
    if (navigator.canShare && navigator.canShare({ files })) {
      // files only — adding title/text causes some iOS targets to save extra files
      await navigator.share({ files });
      return;
    }
    // Share with files genuinely unsupported → download fallback (oldest first).
    files.forEach((f) => _downloadBlob(f, f.name));
  } catch (err) {
    // Don't auto-download on AbortError (user cancelled the share sheet).
    if (err && err.name === "AbortError") return;
    files.forEach((f) => _downloadBlob(f, f.name));
  }
}

// Back-compat wrapper — the per-row share buttons call this with one record.
async function shareDebtRecord(debt) {
  return shareDebtRecords([debt]);
}
```

(Single-record filenames are unchanged: no index prefix when only one file.)

- [ ] **Step 3: Enable/disable the button with the selection**

In `dbtUpdateSelUI` (~5035–5049), after the `delBtn` lines:

```js
  const delBtn = document.getElementById("dbtMsDelete");
  if (delBtn) delBtn.disabled = n === 0;
```

add:

```js
  const shareBtn = document.getElementById("dbtMsShare");
  if (shareBtn) shareBtn.disabled = n === 0;
```

- [ ] **Step 4: Wire the click**

Next to the `#dbtMsDelete` wiring (~5099), add:

```js
document.getElementById("dbtMsShare")?.addEventListener("click", () => {
  if (!debtSelected.size) return;
  // Selection survives the share (non-destructive) — stay in multi-select.
  shareDebtRecords(lastDbtRows.filter((r) => debtSelected.has(r.id)));
});
```

- [ ] **Step 5: Verify**

Run: `node --check public/app.js` → exit 0.
Run: `node tests/run.js` → `107/107 passed, 0 failed`.
Grep sanity: both per-row call sites still say `shareDebtRecord(d)` (`grep -n "shareDebtRecord(d)" public/app.js` → 2 hits).

- [ ] **Step 6: Commit**

```powershell
git add public/index.html public/app.js; git commit -m "feat: share multiple selected debt records at once, oldest-first"
```

---

### Task 4: Lower the floating buttons when the range dock is absent

**Files:**
- Modify: `public/app.js` (~1532–1533 in `showView`)
- Modify: `public/styles.css` (after the `.multi-bar.fab-raised` rule, ~202)

**Interfaces:**
- Produces: body class `no-dock` — set exactly when `#rangeDock` is hidden. CSS keys off it.

- [ ] **Step 1: Mirror the dock's hidden state onto a body class**

In `showView` (~1532), replace:

```js
  document.getElementById("rangeDock").classList.toggle("hidden",
    v === "settings" || v === "person-history" || v === "debt-records" || onDebtMode);
```

with:

```js
  const dockHidden =
    v === "settings" || v === "person-history" || v === "debt-records" || onDebtMode;
  document.getElementById("rangeDock").classList.toggle("hidden", dockHidden);
  // No dock → nothing to clear; let the floating buttons sit lower.
  document.body.classList.toggle("no-dock", dockHidden);
```

- [ ] **Step 2: CSS overrides**

In `public/styles.css`, directly after the `.multi-bar.fab-raised` rule (~202):

```css
.multi-bar.fab-raised{bottom:calc(160px + var(--safe-b))}
```

insert:

```css
/* No bottom range dock (all DebtTrakr views) — drop the floats down */
body.no-dock .fab{bottom:calc(24px + var(--safe-b))}
body.no-dock .multi-bar{bottom:calc(28px + var(--safe-b))}
```

(24/28 keeps the FAB and bar centers aligned the same way 87/94 does today. `body.no-dock .fab` outranks `.fab.fab-raised`, but `fab-raised` only ever applies with the finance custom-range dock visible, so they never co-occur.)

- [ ] **Step 3: Verify**

Run: `node --check public/app.js` → exit 0.
Run: `node tests/run.js` → `107/107 passed, 0 failed`.

- [ ] **Step 4: Commit**

```powershell
git add public/app.js public/styles.css; git commit -m "fix: lower floating buttons in DebtTrakr (no range dock to clear)"
```

---

### Task 5: v75 version bump + handover refresh

**Files:**
- Modify: `public/app.js:6` (`APP_VERSION`)
- Modify: `public/sw.js:2` (`CACHE`)
- Modify: `handover.md` (§ header version, §4 Split the bill, §5 All Debt Records, §8 version line, §10 glossary)

**Interfaces:**
- Consumes: all prior tasks landed.

- [ ] **Step 1: Lockstep bump**

`public/app.js` line 6:

```js
const APP_VERSION = "v75"; // keep in step with sw.js CACHE
```

`public/sw.js` line 2:

```js
const CACHE = "munitrakr-v75";
```

- [ ] **Step 2: Update handover.md**

- Header (~line 7): `Current version: **v75**.`
- §4 "Split the bill" paragraph: append two sentences — participants added from the person menu (or created inline) also auto-scroll the form; the user's own share is an editable input that live-tracks the remainder until manually typed (clearing returns it to auto), and save requires all shares to sum exactly to the total.
- §5 "All Debt Records" bullet: change multi-select description to `Cancel / Share / Delete / Select-all` and note: Share exports every selected record as PNG cards in one share sheet, oldest-first (`date` asc, `createdAt` asc) with index-prefixed filenames; per-file download fallback.
- §5 or §9: note that all DebtTrakr views set `body.no-dock` (no bottom range dock), which lowers `.fab` / `.multi-bar` to 24px / 28px above the safe area.
- §8: `Current: **v75** / `munitrakr-v75``.
- §10 glossary: add `shareDebtRecords` next to the debt share entry (or add a row: `shareDebtRecords(list)` — renders + shares N debt PNGs oldest-first; `shareDebtRecord` is a 1-element wrapper); add `splitMineManual` to the split state row (`splitPeople / splitMineManual / syncSplitSection / renderSplitRows`).

- [ ] **Step 3: Full verify**

Run: `node --check public/app.js` → exit 0.
Run: `node --check public/sw.js` → exit 0.
Run: `node tests/run.js` → `107/107 passed, 0 failed`.
Grep: `grep -n "v74" public/app.js public/sw.js` → no hits.

- [ ] **Step 4: Commit**

```powershell
git add public/app.js public/sw.js handover.md; git commit -m "chore: bump to v75 + refresh handover"
```

(Do NOT push — the user pushes explicitly.)

---

## Manual smoke checklist (for the user's file:// preview)

1. MuniTrakr → + → expense, enter amount → check "Split the bill" → form scrolls down. Add person from menu → scrolls again. "+ New person" → save → scrolls again.
2. In the split rows, type into the "(you)" input → participants unchanged; clear it → refills with remainder on blur. Set shares that don't sum to total → Save shows "Shares must add up to the total (off by …)".
3. Split evenly → all rows filled, "(you)" back to auto remainder.
4. DebtTrakr → View all → multi-select ✓ → select 3 records → Share (between ✕ and 🗑) → share sheet with 3 images, oldest record first, filenames `debt-01-…`, `debt-02-…`, `debt-03-…`.
5. DebtTrakr dashboard / history / records: + FAB and multi-select buttons sit near the bottom edge (≈24px + safe area). MuniTrakr dashboard/records: unchanged (above the dock).
