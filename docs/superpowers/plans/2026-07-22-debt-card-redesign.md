# Debt Share-Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the shared debt PNG card to a two-column, card-based layout (identity + pill on the left, amount + date on the right; notes in a white card; running balance in a dark card that turns green when settled).

**Architecture:** Extract the card renderer out of `public/app.js` into a new UMD module `public/debt-card.js`, split into `debtCardModel()` (pure — every string and flag the card shows, Node-testable) and `renderDebtCard()` (canvas drawing only). The module has zero app dependencies: the caller injects the person's icon SVG. This matches the existing pure-helper pattern (`recurring.js`, `debts.js`, `finance-helpers.js`) and makes the layout previewable in isolation.

**Tech Stack:** Vanilla JS, canvas 2D, UMD modules, Node test runner (`node tests/run.js`, currently 115 tests).

## Global Constraints

- 100% offline static PWA — no new dependencies, no build step.
- Work directly on `main`. Commit after each task; **never push** (user pushes explicitly).
- No Unicode/emoji glyphs for icons — iOS substitutes its emoji font (handover §9). Icons are canvas paths or rasterized SVG.
- Money formatting: `Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })`.
- `node --check public/app.js`, `node --check public/debt-card.js`, `node --check public/sw.js` must pass before any commit touching them.
- `node tests/run.js` must pass 100% before any commit (115 existing + 11 new = 126 after Task 1).
- Every new script file must be added to BOTH `public/index.html` (script tag) and the `SHELL` array in `public/sw.js` — a file missing from `SHELL` breaks offline use.
- Do NOT bump `APP_VERSION` / `CACHE` in Tasks 1–2 (Task 3 only, and only after the user approves the design).
- Design decisions already settled with the user — do not deviate:
  - Avatar tile keeps the person's chosen SVG icon (NOT an initial letter).
  - The FX conversion line goes in the right column, under the date.
  - "Settled" is expressed by turning the outstanding card green with a white checkmark beside the total — no extra row, no second pill.

---

### Task 1: `debtCardModel` pure module + tests (TDD)

**Files:**
- Create: `public/debt-card.js`
- Test: `tests/debt-card.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `debtCardModel(opts)` → model object. `opts` = `{ debt, personName, userName, defaultCurrency, balanceBefore, language }`. Task 2 adds `renderDebtCard()` to this same file and consumes this exact model shape:
  `{ name, tagSentence, direction: "out"|"in", amountText, currencyText, dateText, convertedText|null, notesText|null, notesLabel, outstandingLabel, mathText|null, totalText, totalCurrency, isSettled, settledLabel }`

- [ ] **Step 1: Write the failing tests**

Create `tests/debt-card.test.js`:

```js
const { test, assert } = require("./_lib");
const C = require("../public/debt-card");

function model(o) {
  return C.debtCardModel(Object.assign({
    debt: { type: "lend", amount: 450, currency: "THB", date: "2026-07-21", notes: "" },
    personName: "Boat",
    userName: "Bill",
    defaultCurrency: "THB",
    balanceBefore: 0,
    language: "en",
  }, o));
}

test("debtCardModel: lend reads as they-borrowed-from-me and points out", () => {
  const m = model({});
  assert.equal(m.tagSentence, "Boat borrowed from Bill");
  assert.equal(m.direction, "out");
});

test("debtCardModel: borrow reads as I-borrowed and points in", () => {
  const m = model({ debt: { type: "borrow", amount: 450, currency: "THB", date: "2026-07-21" } });
  assert.equal(m.tagSentence, "Bill borrowed from Boat");
  assert.equal(m.direction, "in");
});

test("debtCardModel: paid-back and pay-back carry their own sentences and directions", () => {
  const back = model({ debt: { type: "paid-back", amount: 100, currency: "THB", date: "2026-07-21" } });
  assert.equal(back.tagSentence, "Boat paid back to Bill");
  assert.equal(back.direction, "in");
  const pay = model({ debt: { type: "pay-back", amount: 100, currency: "THB", date: "2026-07-21" } });
  assert.equal(pay.tagSentence, "Bill paid back to Boat");
  assert.equal(pay.direction, "out");
});

test("debtCardModel: Thai switches every label and the sentence", () => {
  const m = model({ language: "th" });
  assert.equal(m.tagSentence, "Boat ยืมเงินจาก Bill");
  assert.equal(m.notesLabel, "โน้ต");
  assert.equal(m.outstandingLabel, "ยอดคงค้าง");
  assert.equal(m.settledLabel, "เคลียร์แล้ว");
});

test("debtCardModel: amount and currency are separate fields", () => {
  const m = model({ debt: { type: "lend", amount: 4162.37, currency: "THB", date: "2026-07-21" } });
  assert.equal(m.amountText, "4,162.37");
  assert.equal(m.currencyText, "THB");
});

test("debtCardModel: converted line only when the currency differs", () => {
  assert.equal(model({}).convertedText, null);
  const m = model({
    debt: { type: "lend", amount: 450, currency: "USD", date: "2026-07-21",
            convertedAmount: 15750, convertedCurrency: "THB", rate: 35 },
  });
  assert.equal(m.convertedText, "≈ 15,750 THB @ 35");
});

test("debtCardModel: no math line on the first record of a cycle", () => {
  const m = model({ balanceBefore: 0 });
  assert.equal(m.mathText, null);
  assert.equal(m.totalText, "450");
});

test("debtCardModel: math line adds when the balance grows", () => {
  const m = model({ balanceBefore: 3712.37 });
  assert.equal(m.mathText, "3,712.37 + 450");
  assert.equal(m.totalText, "4,162.37");
});

test("debtCardModel: math line subtracts when the balance shrinks", () => {
  const m = model({
    debt: { type: "paid-back", amount: 712.37, currency: "THB", date: "2026-07-21" },
    balanceBefore: 4162.37,
  });
  assert.equal(m.mathText, "4,162.37 − 712.37");
  assert.equal(m.totalText, "3,450");
});

test("debtCardModel: settled only when a non-zero balance lands on zero", () => {
  const settled = model({
    debt: { type: "paid-back", amount: 4162.37, currency: "THB", date: "2026-07-21" },
    balanceBefore: 4162.37,
  });
  assert.equal(settled.isSettled, true);
  assert.equal(settled.totalText, "0");
  assert.equal(model({ balanceBefore: 0 }).isSettled, false);
});

test("debtCardModel: notes collapse to one line, blank notes are null", () => {
  assert.equal(model({}).notesText, null);
  const m = model({
    debt: { type: "lend", amount: 450, currency: "THB", date: "2026-07-21",
            notes: "  ค่าตั๋วหนัง\nSplit bill —  total 900  " },
  });
  assert.equal(m.notesText, "ค่าตั๋วหนัง Split bill — total 900");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/run.js`
Expected: FAIL — `Cannot find module '../public/debt-card'`; the 115 existing tests still pass.

- [ ] **Step 3: Create `public/debt-card.js` with the model only**

```js
/* MuniTrakr debt share-card renderer.
   debtCardModel() is pure (every string + flag the card shows) and Node-testable.
   renderDebtCard() draws that model onto a canvas — browser only. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  function fmtNum(v) {
    return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  // Turns a debt + its context into every string the card draws. Pure: no
  // canvas, no DOM, no store access — so the wording and the running-balance
  // math can be tested in Node.
  function debtCardModel(o) {
    const opts = o || {};
    const debt = opts.debt || {};
    const lang = opts.language === "th" ? "th" : "en";
    const me = opts.userName || "Me";
    const them = opts.personName || "(deleted person)";
    const defaultCurrency = opts.defaultCurrency || "";
    const balanceBefore = Number(opts.balanceBefore) || 0;

    // Full sentence so the recipient knows who's involved without app context.
    const tagSentence = lang === "th"
      ? (debt.type === "lend"      ? them + " ยืมเงินจาก " + me :
         debt.type === "borrow"    ? me   + " ยืมเงินจาก " + them :
         debt.type === "paid-back" ? them + " คืนเงินให้ " + me :
         debt.type === "pay-back"  ? me   + " คืนเงินให้ " + them : "")
      : (debt.type === "lend"      ? them + " borrowed from " + me :
         debt.type === "borrow"    ? me   + " borrowed from " + them :
         debt.type === "paid-back" ? them + " paid back to "  + me :
         debt.type === "pay-back"  ? me   + " paid back to "  + them : "");

    const direction = (debt.type === "lend" || debt.type === "pay-back") ? "out" : "in";

    const showConverted =
      debt.convertedAmount != null && debt.convertedCurrency &&
      debt.convertedCurrency !== debt.currency;
    const convertedText = showConverted
      ? "≈ " + fmtNum(debt.convertedAmount) + " " + debt.convertedCurrency +
        (debt.rate
          ? " @ " + Number(debt.rate).toLocaleString(undefined, { maximumFractionDigits: 4 })
          : "")
      : null;

    // Running balance is always expressed in the default currency.
    const recordAmtInDefault =
      (debt.convertedAmount != null && debt.convertedCurrency === defaultCurrency)
        ? Number(debt.convertedAmount)
        : (debt.currency === defaultCurrency
            ? Number(debt.amount)
            : Number(debt.convertedAmount || debt.amount));

    const delta = (direction === "out" ? 1 : -1) * recordAmtInDefault;
    const newBalance = balanceBefore + delta;
    // Magnitudes only — the operator carries direction, so the equation reads
    // the same whether the cycle is "they owe me" or "I owe them".
    const grows = balanceBefore === 0 ? true : (Math.sign(delta) === Math.sign(balanceBefore));
    const mathText = balanceBefore === 0
      ? null
      : fmtNum(Math.abs(balanceBefore)) + (grows ? " + " : " − ") + fmtNum(Math.abs(delta));

    const rawNotes = debt.notes ? String(debt.notes).replace(/\s+/g, " ").trim() : "";

    return {
      name: them,
      tagSentence,
      direction,
      amountText: fmtNum(debt.amount),
      currencyText: debt.currency || "",
      dateText: debt.date || "",
      convertedText,
      notesText: rawNotes || null,
      notesLabel: lang === "th" ? "โน้ต" : "Notes",
      outstandingLabel: lang === "th" ? "ยอดคงค้าง" : "Outstanding",
      mathText,
      totalText: fmtNum(Math.abs(newBalance)),
      totalCurrency: defaultCurrency,
      isSettled: newBalance === 0 && balanceBefore !== 0,
      settledLabel: lang === "th" ? "เคลียร์แล้ว" : "Settled",
    };
  }

  return { debtCardModel };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/run.js`
Expected: `126/126 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add public/debt-card.js tests/debt-card.test.js
git commit -m "feat: pure debtCardModel — every string the share card draws, Node-tested"
```

---

### Task 2: New canvas layout + wiring, old renderer removed from app.js

**Files:**
- Modify: `public/debt-card.js` (append the renderer inside the factory, before `return`)
- Modify: `public/index.html` (script tag)
- Modify: `public/sw.js` (SHELL entry)
- Modify: `public/app.js` (delete the old renderer + its four private helpers; update the one call site)

**Interfaces:**
- Consumes: `debtCardModel` (Task 1).
- Produces: `renderDebtCard(opts)` → `Promise<Blob>` (PNG). `opts` = `{ debt, person: {name, color}, personIconSvg, balanceBefore, defaultCurrency, userName, language }`. Note this is an **options object** — the old positional signature is gone.

- [ ] **Step 1: Append the renderer to `public/debt-card.js`**

Insert directly **before** the `return { debtCardModel };` line, then change that line to `return { debtCardModel, renderDebtCard };`.

```js
  /* ---------------- Canvas rendering (browser only) ---------------- */

  const WIDTH = 1080;
  const DPR = 2;
  const PAD = 64;
  // Vertical rhythm. Heights are fixed per block, so the card's total height
  // depends only on which optional blocks are present — no pre-measuring pass.
  const TOP = 56, BOTTOM = 56, GAP = 44, NOTE_GAP = 32, NOTE_H = 132, OUT_H = 140;

  const PALETTE = {
    bgTop:    "#f6fbfa",
    bgBot:    "#e7f2ee",
    edge:     "rgba(173,203,216,0.55)",
    card:     "#ffffff",
    line:     "rgba(140,180,205,0.28)",
    text:     "#132a3e",
    muted:    "#5b7488",
    faint:    "#93a6b5",
    out:      "#f2637a",
    in:       "#0fae5e",
    dark:     "#1d2f42",
    settled:  "#0c7a4d",
    noteTile: "#fdf1dd",
    noteInk:  "#c98a2e",
  };

  const FONT = (weight, size) =>
    weight + " " + size + "px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  function roundRect(ctx, x, y, w, h, r) {
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

  // Pure canvas path — no Unicode glyph (iOS would swap in its emoji font).
  function drawCheckmark(ctx, x, y, size, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, size / 7);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x + size * 0.18, y + size * 0.55);
    ctx.lineTo(x + size * 0.42, y + size * 0.78);
    ctx.lineTo(x + size * 0.85, y + size * 0.25);
    ctx.stroke();
    ctx.restore();
  }

  // Small "document" mark for the notes tile — also a path, same reason.
  function drawNoteGlyph(ctx, tileX, tileY, tileSize, color) {
    const w = tileSize * 0.42, h = tileSize * 0.52;
    const x = tileX + (tileSize - w) / 2, y = tileY + (tileSize - h) / 2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    roundRect(ctx, x, y, w, h, 5);
    ctx.stroke();
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const ly = y + h * (0.32 + i * 0.2);
      ctx.moveTo(x + w * 0.24, ly);
      ctx.lineTo(x + w * (i === 2 ? 0.6 : 0.76), ly);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Truncates with an ellipsis so the rendered width fits maxW.
  // ctx.font must already be set.
  function clipText(ctx, str, maxW) {
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

  // Rasterizes an SVG string into an Image at the given pixel size.
  function loadImageFromSvg(svgStr, sizePx) {
    return new Promise((resolve, reject) => {
      let s = svgStr;
      if (!/xmlns=/.test(s)) s = s.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
      s = s.replace("<svg ", '<svg width="' + sizePx + '" height="' + sizePx + '" ');
      const url = URL.createObjectURL(new Blob([s], { type: "image/svg+xml" }));
      const img = new Image();
      img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // Draws the card and resolves with a PNG Blob.
  // opts: { debt, person: {name, color}, personIconSvg, balanceBefore,
  //         defaultCurrency, userName, language }
  async function renderDebtCard(opts) {
    const o = opts || {};
    const person = o.person || {};
    const m = debtCardModel({
      debt: o.debt,
      personName: person.name,
      userName: o.userName,
      defaultCurrency: o.defaultCurrency,
      balanceBefore: o.balanceBefore,
      language: o.language,
    });
    const P = PALETTE;

    const headerH = m.convertedText ? 142 : 112;
    const HEIGHT =
      TOP + headerH + GAP + (m.notesText ? NOTE_H + NOTE_GAP : 0) + OUT_H + BOTTOM;

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * DPR;
    canvas.height = HEIGHT * DPR;
    const ctx = canvas.getContext("2d");
    ctx.scale(DPR, DPR);

    // ---- Background: white bleed behind a rounded gradient card ----
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const grad = ctx.createLinearGradient(0, 0, WIDTH * 0.6, HEIGHT);
    grad.addColorStop(0, P.bgTop);
    grad.addColorStop(1, P.bgBot);
    ctx.fillStyle = grad;
    roundRect(ctx, 10, 10, WIDTH - 20, HEIGHT - 20, 40);
    ctx.fill();
    ctx.strokeStyle = P.edge;
    ctx.lineWidth = 2;
    roundRect(ctx, 10, 10, WIDTH - 20, HEIGHT - 20, 40);
    ctx.stroke();

    let y = TOP;

    // ---- Header, right column first: its width bounds the left column ----
    ctx.textBaseline = "top";
    ctx.font = FONT(800, 64);
    const amtW = ctx.measureText(m.amountText).width;
    ctx.font = FONT(700, 30);
    const curW = m.currencyText ? ctx.measureText(m.currencyText).width + 12 : 0;
    ctx.font = FONT(500, 26);
    const dateW = ctx.measureText(m.dateText).width;
    ctx.font = FONT(500, 24);
    const fxW = m.convertedText ? ctx.measureText(m.convertedText).width : 0;
    const rightW = Math.max(amtW + curW, dateW, fxW);
    const rightEdge = WIDTH - PAD;

    ctx.fillStyle = P.text;
    ctx.font = FONT(800, 64);
    ctx.fillText(m.amountText, rightEdge - amtW - curW, y + 2);
    if (m.currencyText) {
      ctx.font = FONT(700, 30);
      ctx.fillStyle = P.muted;
      ctx.fillText(m.currencyText, rightEdge - curW + 12, y + 34);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = P.faint;
    ctx.font = FONT(500, 26);
    ctx.fillText(m.dateText, rightEdge, y + 84);
    if (m.convertedText) {
      ctx.font = FONT(500, 24);
      ctx.fillText(clipText(ctx, m.convertedText, WIDTH - PAD * 2), rightEdge, y + 118);
    }
    ctx.textAlign = "left";

    // ---- Header, left column: icon tile + name + direction pill ----
    const ICON = 112;
    ctx.fillStyle = person.color || "#8a97a6";
    roundRect(ctx, PAD, y, ICON, ICON, 30);
    ctx.fill();
    if (o.personIconSvg) {
      try {
        const svg = String(o.personIconSvg).replace('stroke="currentColor"', 'stroke="#ffffff"');
        const img = await loadImageFromSvg(svg, ICON - 26);
        ctx.drawImage(img, PAD + 13, y + 13, ICON - 26, ICON - 26);
      } catch (_e) { /* the coloured tile alone still reads fine */ }
    }

    const textX = PAD + ICON + 28;
    const leftMaxW = Math.max(120, rightEdge - textX - rightW - 28);

    ctx.fillStyle = P.text;
    ctx.font = FONT(700, 48);
    ctx.fillText(clipText(ctx, m.name, leftMaxW), textX, y + 2);

    ctx.font = FONT(700, 24);
    const pillPadX = 20, pillH = 46;
    const tag = clipText(ctx, m.tagSentence, leftMaxW - pillPadX * 2);
    const pillW = ctx.measureText(tag).width + pillPadX * 2;
    ctx.fillStyle = m.direction === "out" ? P.out : P.in;
    roundRect(ctx, textX, y + 62, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(tag, textX + pillPadX, y + 62 + pillH / 2 + 1);
    ctx.textBaseline = "top";

    y += headerH + GAP;

    // ---- Notes card ----
    if (m.notesText) {
      ctx.fillStyle = P.card;
      roundRect(ctx, PAD, y, WIDTH - PAD * 2, NOTE_H, 26);
      ctx.fill();
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 1.5;
      roundRect(ctx, PAD, y, WIDTH - PAD * 2, NOTE_H, 26);
      ctx.stroke();

      const tile = 60, tileX = PAD + 28, tileY = y + (NOTE_H - tile) / 2;
      ctx.fillStyle = P.noteTile;
      roundRect(ctx, tileX, tileY, tile, tile, 18);
      ctx.fill();
      drawNoteGlyph(ctx, tileX, tileY, tile, P.noteInk);

      const nx = tileX + tile + 24;
      ctx.fillStyle = P.muted;
      ctx.font = FONT(600, 22);
      ctx.fillText(m.notesLabel, nx, y + 34);
      ctx.fillStyle = P.text;
      ctx.font = FONT(700, 30);
      ctx.fillText(clipText(ctx, m.notesText, rightEdge - 32 - nx), nx, y + 72);

      y += NOTE_H + NOTE_GAP;
    }

    // ---- Outstanding card (green + checkmark once the cycle closes) ----
    ctx.fillStyle = m.isSettled ? P.settled : P.dark;
    roundRect(ctx, PAD, y, WIDTH - PAD * 2, OUT_H, 26);
    ctx.fill();

    ctx.textBaseline = "middle";
    ctx.font = FONT(800, 46);
    const totW = ctx.measureText(m.totalText).width;
    ctx.font = FONT(700, 26);
    const totCurW = m.totalCurrency ? ctx.measureText(m.totalCurrency).width + 10 : 0;
    const totalX = rightEdge - 34 - totW - totCurW;
    ctx.fillStyle = "#ffffff";
    ctx.font = FONT(800, 46);
    ctx.fillText(m.totalText, totalX, y + OUT_H / 2);
    if (m.totalCurrency) {
      ctx.font = FONT(700, 26);
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.fillText(m.totalCurrency, totalX + totW + 10, y + OUT_H / 2 + 8);
    }
    if (m.isSettled) drawCheckmark(ctx, totalX - 54, y + OUT_H / 2 - 18, 36, "#ffffff");

    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.font = FONT(600, 22);
    ctx.fillText(m.outstandingLabel, PAD + 34, m.mathText ? y + 34 : y + 56);
    if (m.mathText) {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = FONT(600, 30);
      const mathMaxW = totalX - (m.isSettled ? 60 : 0) - 24 - (PAD + 34);
      ctx.fillText(clipText(ctx, m.mathText, mathMaxW), PAD + 34, y + 74);
    }

    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }
```

- [ ] **Step 2: Load the module in `public/index.html`**

Replace:

```html
<script src="./debts.js"></script>
```

with:

```html
<script src="./debts.js"></script>
<script src="./debt-card.js"></script>
```

- [ ] **Step 3: Precache it in `public/sw.js`**

Replace:

```js
  "./debts.js",
```

with:

```js
  "./debts.js",
  "./debt-card.js",
```

- [ ] **Step 4: Delete the old renderer and its helpers from `public/app.js`**

Delete these five top-level definitions **in full**, along with their leading comment blocks:

1. `const _aeroCardPalette = { ... };`
2. `function _loadImageFromSvg(svgStr, sizePx) { ... }` (and the 3-line comment above it starting `// Rasterizes an SVG string`)
3. `async function renderDebtCard(debt, person, balanceBeforeAmt, defaultCurrency, userName, language) { ... }` (and the 10-line comment block above it starting `// Renders an Aero-themed PNG card`)
4. `function _roundRect(ctx, x, y, w, h, r) { ... }` (and its `// Rounded-rect path helper` comment)
5. `function _drawCheckmark(ctx, x, y, size, color) { ... }` (and its 3-line comment)
6. `function _clipText(ctx, str, maxW) { ... }` (and its 2-line comment)

All six now live in `public/debt-card.js`. Verify afterwards that `grep -n "_aeroCardPalette\|_loadImageFromSvg\|_roundRect\|_drawCheckmark\|_clipText" public/app.js` returns **no matches**.

- [ ] **Step 5: Update the single call site in `public/app.js`**

Inside `shareDebtRecords`, replace:

```js
        blob = await renderDebtCard(debt, person, before, defaultCurrency, userName, debtShareLanguage);
```

with:

```js
        blob = await renderDebtCard({
          debt,
          person,
          personIconSvg: personIconSvg(person.icon || "person"),
          balanceBefore: before,
          defaultCurrency,
          userName,
          language: debtShareLanguage,
        });
```

- [ ] **Step 6: Verify**

Run: `node --check public/app.js && node --check public/debt-card.js && node --check public/sw.js` → exit 0.
Run: `node tests/run.js` → `126/126 passed, 0 failed`.
Run: `grep -c "renderDebtCard" public/app.js` → expect `2` (the call site and the `console.error("renderDebtCard failed:", err)` message).

- [ ] **Step 7: Commit**

```bash
git add public/debt-card.js public/app.js public/index.html public/sw.js
git commit -m "feat: redesign debt share card — two-column header, notes card, balance card"
```

---

### Task 3: Version bump v78 + handover refresh

**Do not start this task until the user has approved the rendered design preview.**

**Files:**
- Modify: `public/app.js` (`APP_VERSION`), `public/sw.js` (`CACHE`), `handover.md`

- [ ] **Step 1: Bump versions in lockstep**

`public/app.js`: `APP_VERSION` `"v77"` → `"v78"`.
`public/sw.js`: `CACHE` `"munitrakr-v77"` → `"munitrakr-v78"`.

- [ ] **Step 2: Refresh `handover.md`**

- §1 header: `Current version: **v77**` → `**v78**`; test counts `115` → `126` everywhere they describe the suite (the architecture tree line, the §1 test-run line, and the §8 release-flow line).
- §1 architecture tree: add under `public/`, directly after the `debts.js` line:
  `│  ├─ debt-card.js               UMD: share-card model (pure) + canvas renderer`
  and under `tests/`, after `debts.test.js`:
  `│  └─ debt-card.test.js          share-card model wording + balance math`
- §5, "All Debt Records" bullet: after the existing sentence about per-row share buttons, append:
  `Card layout: identity (icon tile, name, direction pill) on the left of the header with the amount, date and any FX line right-aligned opposite it; notes in their own white card; the running balance in a dark card that turns green with a checkmark when the record settles the cycle.`
- §10 glossary: add two rows —
  `| `debtCardModel` | pure (from debt-card.js) — every string + flag the share card draws (wording, FX line, balance math, settled) |`
  `| `renderDebtCard(opts)` | canvas renderer (from debt-card.js); takes an options object and the person's icon SVG injected by the caller |`

- [ ] **Step 3: Final verification**

Run: `node --check public/app.js && node --check public/sw.js` → exit 0.
Run: `node tests/run.js` → `126/126 passed, 0 failed`.
Run: `git status` → only the three edited files modified.

- [ ] **Step 4: Commit (do NOT push)**

```bash
git add public/app.js public/sw.js handover.md
git commit -m "chore: bump to v78 + refresh handover (debt card redesign)"
```
