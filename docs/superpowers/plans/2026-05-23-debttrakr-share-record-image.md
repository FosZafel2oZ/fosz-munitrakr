# DebtTrakr · Per-record Share-as-Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-tap share icon to every debt row in DebtTrakr's per-person history view that renders the record as an Aero-themed PNG card (1080×1080, expanding only if content overflows) and opens the iOS / Web share sheet so the user can send it to LINE / WhatsApp / Messages / etc.

**Architecture:** Pure-function balance-before helper in `debts.js` (testable in Node). Canvas-2D card renderer + share orchestrator added to `app.js` (renderer uses an offscreen `<canvas>`, person icon is rasterized via `Blob` → `Image`). Share trigger is a small inline-SVG button on each row in the existing `renderPersonHistory` function. Fallback to direct PNG download when `navigator.canShare({ files })` is false, mirroring the existing Backup flow.

**Tech Stack:** Vanilla JS, Canvas 2D API, Web Share API, Node test runner (existing `tests/run.js`).

**Note on this project:** there is no git repo (handover §9). "Commit" steps below are replaced with a single **save point** at the end of each task: run `node --check public/app.js && node --check public/sw.js && node tests/run.js` (or the subset relevant to the task) and confirm pass before moving on.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `public/debts.js` | Pure balance/cycle math (UMD). Add `balanceBefore(debts, recordId, peopleById)`. | Modify |
| `tests/debts.test.js` | Unit tests for `debts.js`. Add tests for `balanceBefore`. | Modify |
| `public/app.js` | Adds `renderDebtCard()` (canvas renderer), `shareDebtRecord()` (orchestrator), `_aeroCardPalette` constant, and share button in `renderPersonHistory`. Bumps `APP_VERSION`. | Modify |
| `public/styles.css` | Tiny rule for the share button (positioning + hit target). | Modify |
| `public/sw.js` | Bump `CACHE` const in lockstep with `APP_VERSION`. | Modify |

No new files. The renderer lives in `app.js` because the canvas API is browser-only and not unit-testable in Node without heavy mocking. Only the testable math piece is in `debts.js`.

---

## Task 1: Add `balanceBefore` to `debts.js`

**Files:**
- Modify: `public/debts.js` (append a new exported function inside the IIFE, before the `return` at line 108)
- Test: `tests/debts.test.js` (append new tests)

**What `balanceBefore` does:** Given the full `debts` array, a target `recordId`, and `peopleById`, returns the running outstanding for that record's person *immediately before* that record was applied. Uses the same cycle-reset logic as `personBalances`. Returns `0` if the record is the first chronologically for that person (or if record/person is missing).

**Sort order matches `_chronoCmp` in `debts.js`:** by `date` ASC, then `createdAt` ASC.

- [ ] **Step 1: Write the failing test**

Append to `tests/debts.test.js` (after the existing tests, before any final closing):

```js
const { test } = require("./_lib");
const { balanceBefore } = require("../public/debts.js");

test("balanceBefore: returns 0 for first record of a person", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
  ];
  const peopleById = { p1: { id: "p1" } };
  if (balanceBefore(debts, "a", peopleById) !== 0)
    throw new Error("expected 0 for first record");
});

test("balanceBefore: returns running outstanding before the named record", () => {
  const debts = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 200 },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50 },
    { id: "c", type: "lend",      personId: "p1", date: "2026-01-10", createdAt: 3, amount: 100 },
  ];
  const peopleById = { p1: { id: "p1" } };
  // Before "c": 200 lent - 50 paid back = 150 outstanding.
  if (balanceBefore(debts, "c", peopleById) !== 150)
    throw new Error("expected 150, got " + balanceBefore(debts, "c", peopleById));
});

test("balanceBefore: respects cycle reset", () => {
  const debts = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 100 }, // cycle closes here
    { id: "c", type: "lend",      personId: "p1", date: "2026-01-10", createdAt: 3, amount:  80 },
  ];
  const peopleById = { p1: { id: "p1" } };
  // Before "c": cycle reset by "b", so 0.
  if (balanceBefore(debts, "c", peopleById) !== 0)
    throw new Error("expected 0 after cycle reset, got " + balanceBefore(debts, "c", peopleById));
});

test("balanceBefore: uses convertedAmount when present", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1,
      amount: 10, currency: "USD", convertedAmount: 360, convertedCurrency: "THB" },
    { id: "b", type: "lend", personId: "p1", date: "2026-01-02", createdAt: 2,
      amount: 5,  currency: "USD", convertedAmount: 180, convertedCurrency: "THB" },
  ];
  const peopleById = { p1: { id: "p1" } };
  if (balanceBefore(debts, "b", peopleById) !== 360)
    throw new Error("expected 360, got " + balanceBefore(debts, "b", peopleById));
});

test("balanceBefore: ignores records for other people", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
    { id: "x", type: "lend", personId: "p2", date: "2026-01-02", createdAt: 2, amount: 999 },
    { id: "b", type: "lend", personId: "p1", date: "2026-01-03", createdAt: 3, amount:  50 },
  ];
  const peopleById = { p1: { id: "p1" }, p2: { id: "p2" } };
  if (balanceBefore(debts, "b", peopleById) !== 100)
    throw new Error("expected 100, got " + balanceBefore(debts, "b", peopleById));
});

test("balanceBefore: returns 0 when record id not found", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
  ];
  if (balanceBefore(debts, "missing", { p1: { id: "p1" } }) !== 0)
    throw new Error("expected 0 for missing id");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/run.js`
Expected: the six new `balanceBefore` tests fail with `TypeError: balanceBefore is not a function` (or similar). Existing tests still pass.

- [ ] **Step 3: Implement `balanceBefore` in `debts.js`**

Edit `public/debts.js`. Add this function inside the IIFE just before the existing `return { personBalances, totalsAcrossPeople, annotateSettlements };` line, and include it in the exports:

```js
  // Returns the person's outstanding amount IMMEDIATELY BEFORE the given record,
  // using the same cycle-reset logic as personBalances. Returns 0 if the record
  // isn't found, has no person, or is the first chronological record for the person.
  // The "outstanding" is signed (positive = they owe you).
  function balanceBefore(debts, recordId, peopleById) {
    if (!Array.isArray(debts) || !recordId) return 0;
    const target = debts.find((d) => d && d.id === recordId);
    if (!target || !target.personId) return 0;
    if (peopleById && !peopleById[target.personId]) return 0;
    const list = debts
      .filter((d) => d && d.personId === target.personId)
      .sort(_chronoCmp);
    let lent = 0, back = 0;
    for (const d of list) {
      if (d.id === recordId) break;
      const amt = Number(d.convertedAmount != null ? d.convertedAmount : d.amount) || 0;
      if (d.type === "lend") lent += amt;
      else if (d.type === "borrow" || d.type === "paid-back") back += amt;
      if (lent === back && lent > 0) { lent = 0; back = 0; }
    }
    return lent - back;
  }
```

And update the return statement at the bottom of the IIFE:

```js
  return { personBalances, totalsAcrossPeople, annotateSettlements, balanceBefore };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/run.js`
Expected: ALL tests pass. Total count goes from `72/72` to `78/78`. Update mental note of the new total — handover §1 says `72/72` and may be revised after this work.

- [ ] **Step 5: Save point**

Run: `node --check public/debts.js && node tests/run.js`
Expected: no syntax errors, all tests pass.

---

## Task 2: Add Aero palette constant + canvas card renderer to `app.js`

**Files:**
- Modify: `public/app.js` — add `_aeroCardPalette` constant + `_loadImageFromSvg()` helper + `renderDebtCard()` function. Place these as a new section just above the `function renderPersonHistory(personId)` declaration at line 3847.

The renderer is pure (input → output PNG `Blob`) so it can be developed and visually tested by hand once integrated.

**Aero palette (taken from `public/styles.css:549-566`, hardcoded so the user's currently-active theme doesn't bleed in):**

| Token | Hex | Use |
|-------|-----|-----|
| `bg` | `#cfeede` | Card outer background |
| `card` | `#ffffff` | Inner card surface (with alpha applied via canvas) |
| `text` | `#0e2a3f` | Primary text |
| `muted` | `#4d6e86` | Secondary text (date, "Outstanding:" label) |
| `accent` | `#1f8bff` | Generic accent (not heavily used in this card) |
| `out` | `#ff5a6a` | Lend badge color (money out) |
| `in` | `#0fae5e` | Borrow / Paid back badge color (money in) |
| `line` | `rgba(120,170,210,0.38)` | Hairline separators |

- [ ] **Step 1: Add palette constant**

Insert just above `function renderPersonHistory(personId) {` (line 3847):

```js
/* ================================================================
   DebtTrakr — Share record as image
   Renders an Aero-themed PNG card and hands it to the share sheet.
   ================================================================ */
const _aeroCardPalette = {
  bg:     "#cfeede",
  card:   "#ffffff",
  text:   "#0e2a3f",
  muted:  "#4d6e86",
  accent: "#1f8bff",
  out:    "#ff5a6a",
  in:     "#0fae5e",
  line:   "rgba(120,170,210,0.38)",
};
```

- [ ] **Step 2: Add SVG-to-Image helper**

Add immediately after the palette constant:

```js
// Rasterizes an SVG string into an HTMLImageElement at the given pixel size.
// The SVG must be wrapped (or wrappable) into a <svg xmlns="..."> root.
// Used to draw person icons into the canvas card.
function _loadImageFromSvg(svgStr, sizePx) {
  return new Promise((resolve, reject) => {
    // personIconSvg() doesn't include xmlns — patch it in if missing.
    let s = svgStr;
    if (!/xmlns=/.test(s)) {
      s = s.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
    }
    // Force width/height so the rasterizer knows the target size.
    s = s.replace("<svg ", '<svg width="' + sizePx + '" height="' + sizePx + '" ');
    const blob = new Blob([s], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
```

- [ ] **Step 3: Add the card renderer**

Add immediately after `_loadImageFromSvg`. This is the meat — fully drawn out, no placeholders:

```js
// Renders an Aero-themed PNG card for a single debt record.
// `debt`     — the Debt object being shared.
// `person`   — the Person object (name, color, icon). May be a synthetic
//              "(deleted person)" object if the person was removed.
// `balanceBeforeAmt` — signed outstanding for this person immediately
//              before this record (use balanceBefore() from debts.js).
// `defaultCurrency` — store.settings.defaultCurrency, used for the math line.
// Resolves with a PNG Blob, ready for share/download.
async function renderDebtCard(debt, person, balanceBeforeAmt, defaultCurrency) {
  const P = _aeroCardPalette;
  const WIDTH = 1080;
  const DPR = 2;
  const PAD = 72;

  // ---- Compute lines first to measure required height ----
  const dirLabel =
    debt.type === "lend" ? "Lent" :
    debt.type === "paid-back" ? "Paid back" : "Borrow";
  const dirColor = debt.type === "lend" ? P.out : P.in;

  const amountLine = (debt.currency || "") + " " +
    Number(debt.amount).toLocaleString(undefined, { maximumFractionDigits: 2 });

  const showConverted =
    debt.convertedAmount != null && debt.convertedCurrency &&
    debt.convertedCurrency !== debt.currency;
  const convertedLine = showConverted
    ? "≈ " + debt.convertedCurrency + " " +
      Number(debt.convertedAmount).toLocaleString(undefined, { maximumFractionDigits: 2 }) +
      (debt.rate ? " @ " + Number(debt.rate).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "")
    : null;

  const dateLine = debt.date || "";
  const notesLine = debt.notes ? debt.notes.trim() : "";

  // Math line uses converted amount when record currency differs from default.
  const recordAmtInDefault =
    (debt.convertedAmount != null && debt.convertedCurrency === defaultCurrency)
      ? Number(debt.convertedAmount)
      : (debt.currency === defaultCurrency ? Number(debt.amount) : Number(debt.convertedAmount || debt.amount));

  const delta = (debt.type === "lend" ? +1 : -1) * recordAmtInDefault;
  const newBalance = balanceBeforeAmt + delta;

  const fmtAmt = (v) => defaultCurrency + " " +
    Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const sign = delta >= 0 ? "+" : "−";
  const mathLine = "Outstanding:  " +
    fmtAmt(balanceBeforeAmt) + " " + sign + " " + fmtAmt(delta) + " = " + fmtAmt(newBalance) +
    (newBalance === 0 ? "  ✓ Settled" : "");

  // ---- Measure content height ----
  // Rough vertical layout (in CSS px before DPR scaling):
  //   PAD (top) + 160 (icon row) + 32 + 48 (badge) + 24 + 88 (amount)
  //   + (44 if converted line) + 16 + 32 (date) + (notes ? 24+32 : 0)
  //   + 40 (separator gap) + 72 (math line) + PAD (bottom)
  const baseHeight =
    PAD + 160 + 32 + 48 + 24 + 88 +
    (convertedLine ? 44 : 0) +
    16 + 32 +
    (notesLine ? 24 + 32 : 0) +
    40 + 72 + PAD;
  const HEIGHT = Math.max(1080, baseHeight);

  // ---- Set up canvas ----
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH * DPR;
  canvas.height = HEIGHT * DPR;
  const ctx = canvas.getContext("2d");
  ctx.scale(DPR, DPR);

  // Background (Aero gradient, simplified — radial glows on a green base)
  const bgGrad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bgGrad.addColorStop(0, "#bfe6ff");
  bgGrad.addColorStop(0.5, P.bg);
  bgGrad.addColorStop(1, "#e9fbef");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Inner glass card
  const cardX = PAD * 0.5;
  const cardY = PAD * 0.5;
  const cardW = WIDTH - PAD;
  const cardH = HEIGHT - PAD;
  const radius = 36;
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  _roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 2;
  _roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.stroke();

  // ---- Person icon tile + name ----
  let y = PAD + 40;
  const iconSize = 120;
  const iconX = PAD + 20;
  ctx.fillStyle = person.color || "#888";
  _roundRect(ctx, iconX, y, iconSize, iconSize, 28);
  ctx.fill();

  // Rasterize the person SVG and draw it centered + scaled inside the tile.
  // personIconSvg uses currentColor=white-ish via tile background; we want
  // the stroke to be white for contrast. Force stroke color in the SVG:
  const rawSvg = personIconSvg(person.icon || "person");
  const whiteSvg = rawSvg.replace('stroke="currentColor"', 'stroke="#ffffff"');
  try {
    const iconImg = await _loadImageFromSvg(whiteSvg, iconSize - 24);
    ctx.drawImage(iconImg, iconX + 12, y + 12, iconSize - 24, iconSize - 24);
  } catch (_) { /* if SVG fails, the colored tile alone is fine */ }

  // Name to the right of the tile
  ctx.fillStyle = P.text;
  ctx.font = "600 56px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.textBaseline = "middle";
  const nameMaxW = WIDTH - (iconX + iconSize + 24) - PAD;
  ctx.fillText(_clipText(ctx, person.name || "(deleted person)", nameMaxW), iconX + iconSize + 24, y + iconSize / 2);

  // ---- Direction badge ----
  y += iconSize + 32;
  ctx.font = "700 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const badgeText = dirLabel;
  const badgeMetrics = ctx.measureText(badgeText);
  const badgePadX = 22, badgePadY = 10;
  const badgeW = badgeMetrics.width + badgePadX * 2;
  const badgeH = 28 + badgePadY * 2;
  ctx.fillStyle = dirColor;
  _roundRect(ctx, PAD, y, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(badgeText, PAD + badgePadX, y + badgeH / 2 + 1);

  // ---- Amount + (optional) converted + date + (optional) notes ----
  y += badgeH + 24;
  ctx.fillStyle = P.text;
  ctx.font = "700 72px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(amountLine, PAD, y);
  y += 88;

  if (convertedLine) {
    ctx.fillStyle = P.muted;
    ctx.font = "500 32px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(convertedLine, PAD, y);
    y += 44;
  }

  ctx.fillStyle = P.muted;
  ctx.font = "500 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(dateLine, PAD, y);
  y += 32;

  if (notesLine) {
    y += 24;
    ctx.fillStyle = P.text;
    ctx.font = "400 28px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    const notesMaxW = WIDTH - PAD * 2;
    ctx.fillText('"' + _clipText(ctx, notesLine, notesMaxW - ctx.measureText('""').width) + '"', PAD, y);
    y += 32;
  }

  // ---- Separator + math line ----
  y += 40;
  ctx.strokeStyle = P.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y - 24);
  ctx.lineTo(WIDTH - PAD, y - 24);
  ctx.stroke();

  ctx.fillStyle = P.text;
  ctx.font = "600 36px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(mathLine, PAD, y);

  // ---- Export as PNG Blob ----
  return await new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

// Rounded-rect path helper (no fill/stroke — caller decides).
function _roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// Truncates `str` with an ellipsis so its rendered width <= maxW.
// `ctx.font` must be set before calling.
function _clipText(ctx, str, maxW) {
  if (ctx.measureText(str).width <= maxW) return str;
  const ell = "…";
  let lo = 0, hi = str.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(str.slice(0, mid) + ell).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return str.slice(0, lo) + ell;
}
```

- [ ] **Step 4: Syntax check**

Run: `node --check public/app.js`
Expected: no output (clean parse).

- [ ] **Step 5: Save point**

Run: `node --check public/app.js && node tests/run.js`
Expected: clean parse, all tests still pass (tests don't exercise the canvas code, just confirm nothing was broken elsewhere).

---

## Task 3: Add `shareDebtRecord()` orchestrator

**Files:**
- Modify: `public/app.js` — add `shareDebtRecord(debt)` immediately after `renderDebtCard` / `_clipText` from Task 2.

This is the function the share button calls. It looks up the person, computes `balanceBefore`, renders the card, and hands the resulting PNG to the share sheet (or downloads it as fallback). Mirrors the existing Backup share pattern at `app.js:2350`.

- [ ] **Step 1: Add the orchestrator**

Insert right after `_clipText` (end of the Task 2 block):

```js
// Share a single debt record as a PNG via the system share sheet.
// Falls back to a direct download when Web Share with files is unavailable.
async function shareDebtRecord(debt) {
  if (!debt || !debt.id) return;
  loadStore();
  const person = (store.settings.people || []).find((x) => x.id === debt.personId)
    || { name: "(deleted person)", color: "#888", icon: "person" };
  const peopleById = {};
  for (const p of (store.settings.people || [])) peopleById[p.id] = p;
  const before = balanceBefore(store.debts || [], debt.id, peopleById);
  const defaultCurrency = (store.settings.defaultCurrency || "THB");

  let blob;
  try {
    blob = await renderDebtCard(debt, person, before, defaultCurrency);
  } catch (err) {
    console.error("renderDebtCard failed:", err);
    alert("Couldn't generate the image — try again.");
    return;
  }
  if (!blob) return;

  const safeName = (person.name || "person").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  const filename = "debt-" + safeName + "-" + (debt.date || "record") + ".png";
  const file = new File([blob], filename, { type: "image/png" });

  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      // files only — adding title/text causes some iOS targets to save a 2nd file
      await navigator.share({ files: [file] });
      return;
    }
    // Share with files genuinely unsupported → download fallback.
    _downloadBlob(blob, filename);
  } catch (err) {
    // Don't auto-download on AbortError (user cancelled the share sheet).
    if (err && err.name === "AbortError") return;
    _downloadBlob(blob, filename);
  }
}

// Tiny shared helper for blob downloads (mirrors downloadBackup pattern).
function _downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/app.js`
Expected: no output. `balanceBefore` is referenced — it's a global injected by `debts.js`'s UMD wrapper (Object.assign on `window`), matching the existing pattern used for `personBalances` etc.

- [ ] **Step 3: Save point**

Run: `node --check public/app.js && node tests/run.js`
Expected: clean parse, all tests still pass.

---

## Task 4: Add share button to person-history rows

**Files:**
- Modify: `public/app.js` — `renderPersonHistory` function, lines 3899–3928 (the `for (const d of rows)` block).
- Modify: `public/styles.css` — add a small rule for the share button.

The share button is an inline SVG (handover §9: no Unicode emoji — iOS substitutes Apple emoji). Standard iOS-style share glyph: square with up-arrow.

- [ ] **Step 1: Modify the row template in `renderPersonHistory`**

Locate the `card.innerHTML = ...` block at line 3916. Replace it with this version (adds a `dbt-share` button on the right side):

```js
    card.innerHTML =
      '<span class="dbt-dir">' + dirLabel(d.type) + '</span>' +
      '<div class="dbt-mid">' +
        '<div class="dbt-date">' + formatDate(d.date) + settledBadge + '</div>' +
        (d.notes ? '<div class="dbt-notes">' + escapeHtml(d.notes) + '</div>' : '') +
      '</div>' +
      '<div class="dbt-right">' +
        '<span class="dbt-amt">' + amtStr + '</span>' +
        origLine +
      '</div>' +
      '<button type="button" class="dbt-share" aria-label="Share record">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
          'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M12 3v12"/>' +
          '<path d="M7 8l5-5 5 5"/>' +
          '<path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>' +
        '</svg>' +
      '</button>';
```

- [ ] **Step 2: Wire the share button's tap handler (isolated from the row click)**

Immediately after the existing `card.addEventListener("click", () => openDebtModal(d));` line (3926), add:

```js
    const shareBtn = card.querySelector(".dbt-share");
    if (shareBtn) {
      shareBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();   // don't trigger the row's edit handler
        shareDebtRecord(d);
      });
    }
```

- [ ] **Step 3: Add the CSS for the share button**

Append to `public/styles.css`. Pick a sensible location — near other `.dbt-*` rules. If you can't find them, append to the bottom of the file (any-theme rules):

```css
/* Share button on a person-history row (DebtTrakr) */
.dbt-share {
  margin-left: 8px;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  background: transparent;
  border: 1px solid var(--line);
  flex-shrink: 0;
}
.dbt-share svg { width: 18px; height: 18px; }
.dbt-share:active { background: var(--card-2, rgba(0,0,0,0.05)); }
```

- [ ] **Step 4: Syntax check**

Run: `node --check public/app.js`
Expected: no output.

- [ ] **Step 5: Manual sanity check (launch & click)**

Run: `npm start`
Open: `http://localhost:3000`
- Switch to DebtTrakr mode (topbar dropdown).
- Add a Person, then add 2–3 debt records of mixed direction so a person card appears on the dashboard.
- Tap into a person to open person-history.
- **Verify:** each row now has a small share icon on the right.
- **Verify:** tapping the icon does NOT open the edit modal — it triggers the share sheet (or downloads a PNG in desktop browsers without Web Share-with-files).
- **Verify:** opening the saved/shared PNG shows the card with the correct values, math line, and `✓ Settled` when applicable.

- [ ] **Step 6: Save point**

Run: `node --check public/app.js && node --check public/sw.js && node tests/run.js`
Expected: clean parse, all tests still pass.

---

## Task 5: Version bump + handover note + final verification

**Files:**
- Modify: `public/app.js` line 6 — `APP_VERSION`.
- Modify: `public/sw.js` line 2 — `CACHE`.
- Modify: `handover.md` — bump version mentions; add a one-line entry in §5 describing the share button; update the §1 test count from `72/72 passed` to `78/78 passed`.

Handover §8: **lockstep version bump on every release**. Both files must match.

- [ ] **Step 1: Bump `APP_VERSION` in `app.js`**

Edit `public/app.js:6`:

```js
const APP_VERSION = "v53"; // keep in step with sw.js CACHE
```

- [ ] **Step 2: Bump `CACHE` in `sw.js`**

Edit `public/sw.js:2`:

```js
const CACHE = "munitrakr-v53";
```

- [ ] **Step 3: Update `handover.md`**

Three small edits:

1. **§1 line ~7**: change `Current version: **v52**.` → `Current version: **v53**.`
2. **§1 line ~41**: change `must print `72/72 passed, 0 failed`.` → `must print `78/78 passed, 0 failed`.`
3. **§5 → Per-Person History bullet**: append at the end of that bullet's sentence: `Each row has a small share button that exports the record as an Aero-themed PNG card (with running outstanding math) via the iOS share sheet.`
4. **§8 line ~203**: change `Current: \`v52\` / \`munitrakr-v52\`.` → `Current: \`v53\` / \`munitrakr-v53\`.`

- [ ] **Step 4: Final verification — full release gate per handover §8**

Run: `node --check public/app.js && node --check public/sw.js && node tests/run.js`
Expected:
- Both `--check` commands silent (success).
- Tests print `78/78 passed, 0 failed`.

- [ ] **Step 5: End-to-end manual test before deploy**

Run: `npm start` → `http://localhost:3000`

Test matrix (each one opens the share sheet or downloads a PNG):

| Scenario | What to check |
|---|---|
| Lend record, single-currency (THB only), notes present | Math line: `Outstanding: THB X + Y = THB Z`. Notes appear in quotes on the card. |
| Paid-back record that closes a cycle | Math line ends with `✓ Settled`. |
| USD record on a THB-default user, with a successful conversion | Card shows `USD 20` on the amount line, `≈ THB 720 @ 36.00` on the converted line. Math line uses THB amounts and balances correctly. |
| Borrow direction | Badge reads `Borrow`, badge color is green (`--in`). |
| Very long notes (> ~40 chars) | Notes line ellipsises cleanly inside the card width. |
| Long person name | Name ellipsises next to the icon tile. |
| Desktop Chrome without share-with-files | Tapping share triggers a PNG download with filename `debt-<name>-YYYY-MM-DD.png`. |

- [ ] **Step 6: Deploy**

Drop the `public/` folder onto Netlify (existing site). On the phone, open the PWA → Settings → App version → Check for updates → confirm the version flips to `v53`.

---

## Self-review notes (informational)

- **Spec coverage:** every section of `2026-05-23-debttrakr-share-record-image-design.md` maps to a task:
  - "Trigger & UI placement" → Task 4
  - "Image content" / "Outstanding running-math" → Task 2 (renderer) + Task 1 (`balanceBefore`)
  - "Visual style (Aero always)" → Task 2 (palette constant)
  - "Dimensions" → Task 2 (WIDTH/HEIGHT computation)
  - "Rendering & sharing" → Task 3
  - "Code touch points" → File Structure table
  - "Edge cases" → covered in Task 1 tests, Task 2 logic, Task 5 manual matrix
  - "Out of scope" → preserved (no extra share surfaces added)
  - "Testing" → Task 1 (unit) + Task 5 (manual)
  - "Release" → Task 5
- **Placeholders:** none. Every code-bearing step has full code. No "TBD" / "handle errors" / "similar to above" hand-waves.
- **Type consistency:** `balanceBefore` is consistently spelled and consistently consumed in Tasks 1 → 3. `renderDebtCard` signature in Task 2 matches its call site in Task 3.
- **Project deviations from skill template:**
  - No git → "save point" with `node --check` + tests replaces `git commit`.
  - Canvas/DOM/share code is not unit-tested (no `jsdom`+`canvas` infra in this project, and handover precedent — `app.js` is exercised manually). Math piece is fully TDD'd in Task 1.
