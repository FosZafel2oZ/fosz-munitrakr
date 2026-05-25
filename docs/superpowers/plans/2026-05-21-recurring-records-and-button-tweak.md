# Recurring Records + Dashboard Button Tweak — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recurring/scheduled records (rent, salary, SIPs) with per-rule auto-confirm and backfill, plus a small dashboard tweak that moves the currency code out of the big number into the muted label.

**Architecture:** Pure-function recurrence math lives in a new `public/recurring.js` (UMD pattern → testable from Node). A `processRecurring()` orchestrator in `app.js` runs at boot and after Restore, generating records (silent path) or queueing confirmations (banner path). UI additions: a Settings section, a rule editor modal, an Add Record shortcut, a record-card badge, and a dashboard banner.

**Tech Stack:** Vanilla JS, Chart.js (already vendored), `localStorage`, service worker. No build step. Tests via `node` + `assert` (added as part of Task 1).

**Project notes:**
- **No git repo.** Ignore any "commit" instinct — just save the files and proceed.
- **Two specs covered:** `2026-05-21-recurring-records-design.md` (Tasks 1–15) and `2026-05-21-dashboard-total-buttons-design.md` (Task 16). Both ship under one `v32` cache bump (Task 17).
- **Don't break v31 behavior.** The migration in Task 8 is additive only.

---

## File map

**Created:**
- `public/recurring.js` — date helpers + `computeOccurrences` + `applyEndChecks` + `buildRecordFromRule`. UMD-style (browser global + Node require). Pure functions only — no DOM, no `attachConversion`.
- `tests/run.js` — minimal runner: globs `tests/*.test.js`, runs them under `node`, reports pass/fail count.
- `tests/_lib.js` — tiny `test(name, fn)` helper + `assertEq` wrapper around `node:assert`.
- `tests/recurring.test.js` — unit tests for everything in `recurring.js`.

**Modified:**
- `public/index.html` — add `<script src="./recurring.js"></script>` before `app.js`; add Recurring section in Settings; add banner mount on dashboard; extend Add Record modal.
- `public/app.js` — migration in `loadStore()`; `processRecurring()` + UI render functions; wire boot/Restore; **Task 16** small render-string change.
- `public/sw.js` — add `recurring.js` to `SHELL`; bump `CACHE` to `munitrakr-v32`.
- `public/styles.css` — banner, rule-row, badge styles using existing tokens.

---

### Task 1: Test harness + `recurring.js` scaffold + date helpers

**Files:**
- Create: `tests/run.js`
- Create: `tests/_lib.js`
- Create: `tests/recurring.test.js`
- Create: `public/recurring.js`

- [ ] **Step 1: Create the test runner**

`tests/run.js`:

```js
/* Minimal test runner: requires every tests/*.test.js, reports totals. */
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js"));
let total = 0, failed = 0;
for (const f of files) {
  process.stdout.write("\n=== " + f + " ===\n");
  const before = { t: total, f: failed };
  global.__counts = { add(p) { total++; if (!p) failed++; } };
  try {
    require(path.join(dir, f));
  } catch (e) {
    failed++;
    console.error("THREW:", e && e.stack || e);
  }
  process.stdout.write(`  (+${total - before.t} run, +${failed - before.f} failed)\n`);
}
console.log(`\n${total - failed}/${total} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Create the test helper**

`tests/_lib.js`:

```js
const assert = require("node:assert/strict");
function test(name, fn) {
  let passed = false;
  try {
    fn();
    passed = true;
    process.stdout.write("  ✓ " + name + "\n");
  } catch (e) {
    process.stdout.write("  ✗ " + name + "\n    " + (e.message || e) + "\n");
  }
  if (global.__counts) global.__counts.add(passed);
}
module.exports = { test, assert };
```

- [ ] **Step 3: Create `recurring.js` scaffold (UMD wrapper + stub exports)**

`public/recurring.js`:

```js
/* MuniTrakr recurring rules — pure functions. Browser global + Node require. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  // ---- Date helpers (string-based YYYY-MM-DD, no `new Date(string)`) ----
  function parseYMD(s) {
    const [y, m, d] = s.split("-").map(Number);
    return { y, m, d };
  }
  function formatYMD({ y, m, d }) {
    const mm = String(m).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }
  function lastDayOfMonth(y, m) {
    return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }
  function addDays(ymd, n) {
    // Use local-date arithmetic via Date but only with integer Y/M/D inputs.
    const d = new Date(ymd.y, ymd.m - 1, ymd.d);
    d.setDate(d.getDate() + n);
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  function addMonths(ymd, n) {
    const totalMonths = (ymd.y * 12 + (ymd.m - 1)) + n;
    const y = Math.floor(totalMonths / 12);
    const m = (totalMonths % 12) + 1;
    const d = Math.min(ymd.d, lastDayOfMonth(y, m));
    return { y, m, d };
  }
  function addYears(ymd, n) {
    const y = ymd.y + n;
    const d = Math.min(ymd.d, lastDayOfMonth(y, ymd.m));
    return { y, m: ymd.m, d };
  }
  function cmpYMD(a, b) {
    if (a.y !== b.y) return a.y - b.y;
    if (a.m !== b.m) return a.m - b.m;
    return a.d - b.d;
  }

  // Stub — real impl in later tasks.
  function computeOccurrences(/*rule, todayYmdStr*/) { return []; }
  function applyEndChecks(/*rule*/) {}
  function buildRecordFromRule(/*rule, dateStr*/) { return null; }

  return {
    parseYMD, formatYMD, isLeap, lastDayOfMonth,
    addDays, addMonths, addYears, cmpYMD,
    computeOccurrences, applyEndChecks, buildRecordFromRule,
  };
});
```

- [ ] **Step 4: Write failing tests for date helpers**

`tests/recurring.test.js`:

```js
const { test, assert } = require("./_lib");
const R = require("../public/recurring");

test("parseYMD + formatYMD roundtrip", () => {
  assert.equal(R.formatYMD(R.parseYMD("2026-05-21")), "2026-05-21");
  assert.equal(R.formatYMD(R.parseYMD("2024-02-29")), "2024-02-29");
});

test("isLeap", () => {
  assert.equal(R.isLeap(2024), true);
  assert.equal(R.isLeap(2025), false);
  assert.equal(R.isLeap(2100), false); // century non-leap
  assert.equal(R.isLeap(2000), true);  // 400-year leap
});

test("lastDayOfMonth", () => {
  assert.equal(R.lastDayOfMonth(2024, 2), 29);
  assert.equal(R.lastDayOfMonth(2025, 2), 28);
  assert.equal(R.lastDayOfMonth(2026, 4), 30);
  assert.equal(R.lastDayOfMonth(2026, 12), 31);
});

test("addDays wraps months and years", () => {
  assert.deepEqual(R.addDays({ y: 2026, m: 1, d: 31 }, 1), { y: 2026, m: 2, d: 1 });
  assert.deepEqual(R.addDays({ y: 2026, m: 12, d: 31 }, 1), { y: 2027, m: 1, d: 1 });
  assert.deepEqual(R.addDays({ y: 2024, m: 2, d: 28 }, 1), { y: 2024, m: 2, d: 29 });
});

test("addMonths clamps day to last day of target month", () => {
  assert.deepEqual(R.addMonths({ y: 2026, m: 1, d: 31 }, 1), { y: 2026, m: 2, d: 28 });
  assert.deepEqual(R.addMonths({ y: 2024, m: 1, d: 31 }, 1), { y: 2024, m: 2, d: 29 });
  assert.deepEqual(R.addMonths({ y: 2026, m: 3, d: 31 }, 1), { y: 2026, m: 4, d: 30 });
});

test("addYears Feb 29 -> Feb 28 in non-leap", () => {
  assert.deepEqual(R.addYears({ y: 2024, m: 2, d: 29 }, 1), { y: 2025, m: 2, d: 28 });
  assert.deepEqual(R.addYears({ y: 2024, m: 2, d: 29 }, 4), { y: 2028, m: 2, d: 29 });
});

test("cmpYMD sign", () => {
  assert.ok(R.cmpYMD({ y: 2026, m: 1, d: 1 }, { y: 2026, m: 1, d: 2 }) < 0);
  assert.ok(R.cmpYMD({ y: 2026, m: 2, d: 1 }, { y: 2026, m: 1, d: 31 }) > 0);
  assert.equal(R.cmpYMD({ y: 2026, m: 5, d: 21 }, { y: 2026, m: 5, d: 21 }), 0);
});
```

- [ ] **Step 5: Run tests, see them pass**

Run: `node tests/run.js`
Expected: all tests pass for the helpers. The 3 stubs (`computeOccurrences`, `applyEndChecks`, `buildRecordFromRule`) aren't tested yet — that's later tasks.

- [ ] **Step 6: Save files. (No git commit — repo not initialized.)**

---

### Task 2: `computeOccurrences` — Daily + Weekly cadences

**Files:**
- Modify: `public/recurring.js` (replace the stub `computeOccurrences`)
- Modify: `tests/recurring.test.js` (add tests)

- [ ] **Step 1: Add failing tests for daily and weekly**

Append to `tests/recurring.test.js`:

```js
function ruleDaily(start, opts = {}) {
  return {
    id: "r1", type: "expense", category: "X", subcategory: "",
    amount: 1, currency: "THB", notes: "", tags: [],
    cadence: { kind: "daily" },
    startDate: start,
    occurrenceCount: 0, autoConfirm: true, paused: false,
    ...opts,
  };
}
function ruleWeekly(start, weekday, opts = {}) {
  return { ...ruleDaily(start, opts), cadence: { kind: "weekly", weekday } };
}

test("daily: no occurrences when today < startDate", () => {
  const r = ruleDaily("2026-05-21");
  assert.deepEqual(R.computeOccurrences(r, "2026-05-20"), []);
});

test("daily: one occurrence on startDate", () => {
  const r = ruleDaily("2026-05-21");
  assert.deepEqual(R.computeOccurrences(r, "2026-05-21"), ["2026-05-21"]);
});

test("daily: backfill 7 days", () => {
  const r = ruleDaily("2026-05-15");
  assert.deepEqual(R.computeOccurrences(r, "2026-05-21"), [
    "2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18",
    "2026-05-19", "2026-05-20", "2026-05-21",
  ]);
});

test("daily: respects lastGeneratedDate bookmark", () => {
  const r = ruleDaily("2026-05-15", { lastGeneratedDate: "2026-05-19" });
  assert.deepEqual(R.computeOccurrences(r, "2026-05-21"), ["2026-05-20", "2026-05-21"]);
});

test("weekly: first occurrence is next matching weekday on/after startDate", () => {
  // 2026-05-21 is a Thursday (weekday 4)
  // Rule starts 2026-05-18 (Mon), weekday=4 (Thu) -> first occurrence 2026-05-21
  const r = ruleWeekly("2026-05-18", 4);
  assert.deepEqual(R.computeOccurrences(r, "2026-05-21"), ["2026-05-21"]);
});

test("weekly: every 7 days after first hit", () => {
  const r = ruleWeekly("2026-05-21", 4); // Thursdays
  assert.deepEqual(R.computeOccurrences(r, "2026-06-11"), [
    "2026-05-21", "2026-05-28", "2026-06-04", "2026-06-11",
  ]);
});
```

- [ ] **Step 2: Run tests, see them fail**

Run: `node tests/run.js`
Expected: the new tests fail (current stub returns `[]`).

- [ ] **Step 3: Implement `computeOccurrences` for daily + weekly**

In `public/recurring.js`, replace the stub with:

```js
function computeOccurrences(rule, todayStr) {
  if (rule.paused || !rule.cadence) return [];
  const today = parseYMD(todayStr);
  const endCap = rule.endDate ? parseYMD(rule.endDate) : null;
  const remaining = rule.maxOccurrences != null
    ? Math.max(0, rule.maxOccurrences - (rule.occurrenceCount || 0))
    : Infinity;
  if (remaining === 0) return [];

  // Start cursor = day after lastGeneratedDate, else startDate.
  let cursor = rule.lastGeneratedDate
    ? addDays(parseYMD(rule.lastGeneratedDate), 1)
    : parseYMD(rule.startDate);

  // Cadence-specific "snap-up to next valid date >= cursor".
  cursor = snapToCadence(cursor, rule.cadence);

  const out = [];
  while (cmpYMD(cursor, today) <= 0 && (!endCap || cmpYMD(cursor, endCap) <= 0)) {
    out.push(formatYMD(cursor));
    if (out.length >= remaining) break;
    cursor = stepCadence(cursor, rule.cadence);
  }
  return out;
}

function snapToCadence(ymd, cadence) {
  if (cadence.kind === "daily") return ymd;
  if (cadence.kind === "weekly") {
    // Find first date >= ymd with .getDay() === cadence.weekday
    const dt = new Date(ymd.y, ymd.m - 1, ymd.d);
    const diff = (cadence.weekday - dt.getDay() + 7) % 7;
    return addDays(ymd, diff);
  }
  if (cadence.kind === "monthly") {
    // Implemented in Task 3.
    return ymd;
  }
  if (cadence.kind === "yearly") {
    // Implemented in Task 4.
    return ymd;
  }
  return ymd;
}

function stepCadence(ymd, cadence) {
  if (cadence.kind === "daily") return addDays(ymd, 1);
  if (cadence.kind === "weekly") return addDays(ymd, 7);
  if (cadence.kind === "monthly") return addMonths(ymd, 1); // refined in Task 3
  if (cadence.kind === "yearly") return addYears(ymd, 1);   // refined in Task 4
  return ymd;
}
```

Add `snapToCadence` and `stepCadence` to the returned object so later tasks can refine them if needed (or just keep them private — they're only called by `computeOccurrences`). Keep them private for now.

- [ ] **Step 4: Run tests, see them pass**

Run: `node tests/run.js`
Expected: all helper tests + new daily/weekly tests pass.

- [ ] **Step 5: Save files.**

---

### Task 3: `computeOccurrences` — Monthly cadence with last-day-of-month fallback

**Files:**
- Modify: `public/recurring.js` (refine `snapToCadence` and `stepCadence` for monthly)
- Modify: `tests/recurring.test.js`

- [ ] **Step 1: Add failing monthly tests**

Append to `tests/recurring.test.js`:

```js
function ruleMonthly(start, dayOfMonth, opts = {}) {
  return { ...ruleDaily(start, opts), cadence: { kind: "monthly", dayOfMonth } };
}

test("monthly: day 1 across three months", () => {
  const r = ruleMonthly("2026-01-01", 1);
  assert.deepEqual(R.computeOccurrences(r, "2026-03-15"), [
    "2026-01-01", "2026-02-01", "2026-03-01",
  ]);
});

test("monthly: day 31 falls back to last day of month (Feb)", () => {
  const r = ruleMonthly("2026-01-31", 31);
  assert.deepEqual(R.computeOccurrences(r, "2026-04-30"), [
    "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30",
  ]);
});

test("monthly: day 31 in leap-year Feb -> Feb 29", () => {
  const r = ruleMonthly("2024-01-31", 31);
  assert.deepEqual(R.computeOccurrences(r, "2024-02-29"), [
    "2024-01-31", "2024-02-29",
  ]);
});

test("monthly: startDate mid-month, dayOfMonth=1 -> snap forward to next month's 1st", () => {
  const r = ruleMonthly("2026-05-10", 1);
  assert.deepEqual(R.computeOccurrences(r, "2026-07-15"), [
    "2026-06-01", "2026-07-01",
  ]);
});
```

- [ ] **Step 2: Run tests, see them fail**

Run: `node tests/run.js`
Expected: monthly tests fail.

- [ ] **Step 3: Refine `snapToCadence` and `stepCadence` for monthly**

In `public/recurring.js`, replace the monthly branches:

```js
function snapToCadence(ymd, cadence) {
  if (cadence.kind === "daily") return ymd;
  if (cadence.kind === "weekly") {
    const dt = new Date(ymd.y, ymd.m - 1, ymd.d);
    const diff = (cadence.weekday - dt.getDay() + 7) % 7;
    return addDays(ymd, diff);
  }
  if (cadence.kind === "monthly") {
    // Try this month first; if cadence day < ymd.d, jump to next month.
    const target = monthlyDateInMonth(ymd.y, ymd.m, cadence.dayOfMonth);
    if (cmpYMD(target, ymd) >= 0) return target;
    const nxt = addMonths({ y: ymd.y, m: ymd.m, d: 1 }, 1);
    return monthlyDateInMonth(nxt.y, nxt.m, cadence.dayOfMonth);
  }
  if (cadence.kind === "yearly") return ymd; // Task 4
  return ymd;
}

function stepCadence(ymd, cadence) {
  if (cadence.kind === "daily") return addDays(ymd, 1);
  if (cadence.kind === "weekly") return addDays(ymd, 7);
  if (cadence.kind === "monthly") {
    const nxt = addMonths({ y: ymd.y, m: ymd.m, d: 1 }, 1);
    return monthlyDateInMonth(nxt.y, nxt.m, cadence.dayOfMonth);
  }
  if (cadence.kind === "yearly") return addYears(ymd, 1); // Task 4
  return ymd;
}

function monthlyDateInMonth(y, m, dayOfMonth) {
  return { y, m, d: Math.min(dayOfMonth, lastDayOfMonth(y, m)) };
}
```

- [ ] **Step 4: Run tests, see them pass**

Run: `node tests/run.js`
Expected: monthly tests pass.

- [ ] **Step 5: Save files.**

---

### Task 4: `computeOccurrences` — Yearly cadence with Feb 29 fallback

**Files:**
- Modify: `public/recurring.js`
- Modify: `tests/recurring.test.js`

- [ ] **Step 1: Add failing yearly tests**

Append to `tests/recurring.test.js`:

```js
function ruleYearly(start, month, day, opts = {}) {
  return { ...ruleDaily(start, opts), cadence: { kind: "yearly", month, day } };
}

test("yearly: anniversary across three years", () => {
  const r = ruleYearly("2024-05-21", 5, 21);
  assert.deepEqual(R.computeOccurrences(r, "2026-05-21"), [
    "2024-05-21", "2025-05-21", "2026-05-21",
  ]);
});

test("yearly: Feb 29 falls back to Feb 28 in non-leap year", () => {
  const r = ruleYearly("2024-02-29", 2, 29);
  assert.deepEqual(R.computeOccurrences(r, "2025-12-31"), [
    "2024-02-29", "2025-02-28",
  ]);
});

test("yearly: Feb 29 stays Feb 29 in next leap year", () => {
  const r = ruleYearly("2024-02-29", 2, 29, { lastGeneratedDate: "2024-02-29" });
  assert.deepEqual(R.computeOccurrences(r, "2028-12-31"), [
    "2025-02-28", "2026-02-28", "2027-02-28", "2028-02-29",
  ]);
});
```

- [ ] **Step 2: Run tests, see them fail**

Run: `node tests/run.js`
Expected: yearly tests fail.

- [ ] **Step 3: Refine yearly branches**

In `public/recurring.js`, replace the yearly branches:

```js
function snapToCadence(ymd, cadence) {
  if (cadence.kind === "daily") return ymd;
  if (cadence.kind === "weekly") {
    const dt = new Date(ymd.y, ymd.m - 1, ymd.d);
    const diff = (cadence.weekday - dt.getDay() + 7) % 7;
    return addDays(ymd, diff);
  }
  if (cadence.kind === "monthly") {
    const target = monthlyDateInMonth(ymd.y, ymd.m, cadence.dayOfMonth);
    if (cmpYMD(target, ymd) >= 0) return target;
    const nxt = addMonths({ y: ymd.y, m: ymd.m, d: 1 }, 1);
    return monthlyDateInMonth(nxt.y, nxt.m, cadence.dayOfMonth);
  }
  if (cadence.kind === "yearly") {
    const target = yearlyDateInYear(ymd.y, cadence.month, cadence.day);
    if (cmpYMD(target, ymd) >= 0) return target;
    return yearlyDateInYear(ymd.y + 1, cadence.month, cadence.day);
  }
  return ymd;
}

function stepCadence(ymd, cadence) {
  if (cadence.kind === "daily") return addDays(ymd, 1);
  if (cadence.kind === "weekly") return addDays(ymd, 7);
  if (cadence.kind === "monthly") {
    const nxt = addMonths({ y: ymd.y, m: ymd.m, d: 1 }, 1);
    return monthlyDateInMonth(nxt.y, nxt.m, cadence.dayOfMonth);
  }
  if (cadence.kind === "yearly") {
    return yearlyDateInYear(ymd.y + 1, cadence.month, cadence.day);
  }
  return ymd;
}

function yearlyDateInYear(y, month, day) {
  return { y, m: month, d: Math.min(day, lastDayOfMonth(y, month)) };
}
```

- [ ] **Step 4: Run tests, see them pass**

Run: `node tests/run.js`
Expected: yearly tests pass.

- [ ] **Step 5: Save files.**

---

### Task 5: End conditions — `endDate` and `maxOccurrences`

**Files:**
- Modify: `tests/recurring.test.js`

The `computeOccurrences` code already honors both caps (see Task 2 implementation). This task is purely about tests + auto-pause via `applyEndChecks` (which is wired in Task 7).

- [ ] **Step 1: Add tests for `endDate` and `maxOccurrences`**

Append to `tests/recurring.test.js`:

```js
test("endDate caps backfill at the endDate (inclusive)", () => {
  const r = ruleDaily("2026-05-15", { endDate: "2026-05-18" });
  assert.deepEqual(R.computeOccurrences(r, "2026-05-21"), [
    "2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18",
  ]);
});

test("maxOccurrences caps total", () => {
  const r = ruleDaily("2026-05-15", { maxOccurrences: 3 });
  assert.deepEqual(R.computeOccurrences(r, "2026-05-21"), [
    "2026-05-15", "2026-05-16", "2026-05-17",
  ]);
});

test("maxOccurrences respects already-counted occurrenceCount", () => {
  const r = ruleDaily("2026-05-15", { maxOccurrences: 5, occurrenceCount: 3, lastGeneratedDate: "2026-05-17" });
  assert.deepEqual(R.computeOccurrences(r, "2026-05-21"), [
    "2026-05-18", "2026-05-19",
  ]);
});
```

- [ ] **Step 2: Run tests, see them pass (already implemented in Task 2)**

Run: `node tests/run.js`
Expected: all pass. If any fail, fix `computeOccurrences` to honor `endDate` and `maxOccurrences - occurrenceCount` properly.

- [ ] **Step 3: Save files.**

---

### Task 6: Pause/unpause semantics

**Files:**
- Modify: `public/recurring.js` (add `unpauseRule`)
- Modify: `tests/recurring.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/recurring.test.js`:

```js
test("paused rule returns no occurrences", () => {
  const r = ruleDaily("2026-05-15", { paused: true });
  assert.deepEqual(R.computeOccurrences(r, "2026-05-21"), []);
});

test("unpauseRule with existing lastGeneratedDate sets bookmark to today", () => {
  const r = ruleDaily("2026-05-01", { paused: true, lastGeneratedDate: "2026-05-05" });
  R.unpauseRule(r, "2026-05-21");
  assert.equal(r.paused, false);
  assert.equal(r.lastGeneratedDate, "2026-05-21");
  // After unpause, no backfill of the pause window:
  assert.deepEqual(R.computeOccurrences(r, "2026-05-21"), []);
});

test("unpauseRule with no lastGeneratedDate sets startDate to today", () => {
  const r = ruleDaily("2026-05-01", { paused: true });
  R.unpauseRule(r, "2026-05-21");
  assert.equal(r.paused, false);
  assert.equal(r.startDate, "2026-05-21");
  assert.deepEqual(R.computeOccurrences(r, "2026-05-21"), ["2026-05-21"]);
});
```

- [ ] **Step 2: Run tests, see them fail (`unpauseRule` undefined)**

Run: `node tests/run.js`
Expected: the new tests fail because `R.unpauseRule` is `undefined`.

- [ ] **Step 3: Implement `unpauseRule` and export it**

In `public/recurring.js`, add inside the factory:

```js
function unpauseRule(rule, todayStr) {
  rule.paused = false;
  if (rule.lastGeneratedDate) {
    rule.lastGeneratedDate = todayStr;
  } else {
    rule.startDate = todayStr;
  }
  rule.updatedAt = new Date().toISOString();
}
```

Add `unpauseRule` to the returned object.

- [ ] **Step 4: Run tests, see them pass**

Run: `node tests/run.js`
Expected: all pass.

- [ ] **Step 5: Save files.**

---

### Task 7: `applyEndChecks` and `buildRecordFromRule`

**Files:**
- Modify: `public/recurring.js`
- Modify: `tests/recurring.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/recurring.test.js`:

```js
test("applyEndChecks pauses rule when endDate reached", () => {
  const r = ruleDaily("2026-01-01", {
    endDate: "2026-05-21",
    lastGeneratedDate: "2026-05-21",
  });
  R.applyEndChecks(r);
  assert.equal(r.paused, true);
});

test("applyEndChecks pauses rule when maxOccurrences reached", () => {
  const r = ruleDaily("2026-01-01", { maxOccurrences: 3, occurrenceCount: 3 });
  R.applyEndChecks(r);
  assert.equal(r.paused, true);
});

test("applyEndChecks leaves rule alone when neither cap reached", () => {
  const r = ruleDaily("2026-01-01", { maxOccurrences: 5, occurrenceCount: 2 });
  R.applyEndChecks(r);
  assert.equal(r.paused, false);
});

test("buildRecordFromRule clones template + sets date and ruleId, no fx fields", () => {
  const r = ruleDaily("2026-05-15", {
    type: "expense", category: "Food", subcategory: "Coffee",
    amount: 120, currency: "THB", notes: "n", tags: ["t"],
  });
  const rec = R.buildRecordFromRule(r, "2026-05-21");
  assert.equal(rec.type, "expense");
  assert.equal(rec.category, "Food");
  assert.equal(rec.subcategory, "Coffee");
  assert.equal(rec.amount, 120);
  assert.equal(rec.currency, "THB");
  assert.equal(rec.notes, "n");
  assert.deepEqual(rec.tags, ["t"]);
  assert.equal(rec.date, "2026-05-21");
  assert.equal(rec.ruleId, "r1");
  assert.ok(typeof rec.id === "string" && rec.id.length > 0);
  assert.ok(typeof rec.createdAt === "string");
  assert.ok(typeof rec.updatedAt === "string");
  // No FX fields baked in — those come from attachConversion later.
  assert.equal(rec.convertedAmount, undefined);
  assert.equal(rec.rate, undefined);
});
```

- [ ] **Step 2: Run tests, see them fail**

Run: `node tests/run.js`
Expected: the 4 new tests fail.

- [ ] **Step 3: Implement `applyEndChecks` and `buildRecordFromRule`**

In `public/recurring.js`, replace the stubs:

```js
function applyEndChecks(rule) {
  if (rule.endDate && rule.lastGeneratedDate &&
      cmpYMD(parseYMD(rule.lastGeneratedDate), parseYMD(rule.endDate)) >= 0) {
    rule.paused = true;
  }
  if (rule.maxOccurrences != null && (rule.occurrenceCount || 0) >= rule.maxOccurrences) {
    rule.paused = true;
  }
}

function buildRecordFromRule(rule, dateStr) {
  const now = new Date().toISOString();
  // Use the same id shape used elsewhere in the project (timestamp + random)
  const id = "rec_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  return {
    id,
    type: rule.type,
    category: rule.category,
    subcategory: rule.subcategory || "",
    date: dateStr,
    amount: Number(rule.amount) || 0,
    currency: rule.currency,
    notes: rule.notes || "",
    tags: Array.isArray(rule.tags) ? rule.tags.slice() : [],
    ruleId: rule.id,
    createdAt: now,
    updatedAt: now,
  };
}
```

- [ ] **Step 4: Run tests, see them pass**

Run: `node tests/run.js`
Expected: all tests pass. This is the last pure-function task — `recurring.js` is now feature-complete.

- [ ] **Step 5: Save files.**

---

### Task 8: Migration in `loadStore()` + wire `recurring.js` into the page + sw.js shell

**Files:**
- Modify: `public/app.js` (inside `loadStore()`)
- Modify: `public/index.html`
- Modify: `public/sw.js` (SHELL only; cache name bump is Task 17)

- [ ] **Step 1: Add the migration line to `loadStore()`**

In `public/app.js`, inside `loadStore()` (function starts at line ~178), find the block that initializes settings defaults. Add this line near the other `settings.X = settings.X || ...` defaults:

```js
store.settings.recurring = store.settings.recurring || [];
```

Place it next to `store.settings.currencies = ...` for visual grouping.

- [ ] **Step 2: Add `<script>` tag in `index.html`**

In `public/index.html`, locate the line that loads `app.js`. Add `recurring.js` immediately before it:

```html
<script src="./recurring.js"></script>
<script src="./app.js"></script>
```

- [ ] **Step 3: Add `recurring.js` to service worker SHELL**

In `public/sw.js`, add `"./recurring.js"` to the `SHELL` array, alphabetically near other JS:

```js
const SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./recurring.js",
  "./styles.css",
  "./vendor/chart.umd.min.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon.png",
  "./chevron.svg",
  "./chevron-dark.svg",
];
```

- [ ] **Step 4: Smoke test: open localhost and verify globals**

Run: `npm start`
Open: `http://localhost:3000`
In DevTools console, type:
```
computeOccurrences && unpauseRule && applyEndChecks && buildRecordFromRule
```
Expected: all four are functions (not `undefined`).
Also: `store.settings.recurring` should be `[]` (open Application → localStorage → `fin_store` and inspect).

- [ ] **Step 5: Save files.**

---

### Task 9: `processRecurring()` orchestrator + boot/Restore wiring

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Add `pendingConfirmations` module-level state**

Near the top of `public/app.js` (after the other top-level state like `store`, `records`), add:

```js
let pendingConfirmations = []; // [{ ruleId, dueDate, rule }] — derived, not persisted
let recurringProcessedThisBoot = false;
```

- [ ] **Step 2: Add `processRecurring()` function**

Add this function in `public/app.js` (near other store-touching helpers like `loadRecords`):

```js
async function processRecurring() {
  if (recurringProcessedThisBoot) return;
  recurringProcessedThisBoot = true;
  loadStore();
  const today = ymdLocal(new Date()); // existing helper that returns local YYYY-MM-DD
  pendingConfirmations = [];
  let storeDirty = false;

  for (const rule of store.settings.recurring) {
    if (rule.paused || !rule.cadence) continue;
    const dueDates = computeOccurrences(rule, today);
    if (!dueDates.length) continue;

    if (rule.autoConfirm) {
      for (const date of dueDates) {
        const rec = buildRecordFromRule(rule, date);
        try {
          await attachConversion(rec);
        } catch (_e) {
          rec.rateUnavailable = true;
        }
        store.records.push(rec);
        rule.lastGeneratedDate = date;
        rule.occurrenceCount = (rule.occurrenceCount || 0) + 1;
        applyEndChecks(rule);
        storeDirty = true;
        if (rule.paused) break; // applyEndChecks may have paused it mid-loop
      }
    } else {
      for (const date of dueDates) {
        pendingConfirmations.push({ ruleId: rule.id, dueDate: date, rule });
      }
    }
  }

  if (storeDirty) {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }
}
```

**If there's no existing `ymdLocal()` helper**, search `app.js` for how the current code formats today's date (look for `toISOString().slice(0,10)` or `getFullYear()` patterns) and use the same approach. If you cannot find one, add at the top of `processRecurring()`:

```js
function localToday() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
const today = localToday();
```

- [ ] **Step 3: Wire `processRecurring()` into boot**

Find the existing boot sequence in `app.js` (where `loadStore()` is called on page init and `loadRecords()` runs first). Replace the boot chain so `processRecurring()` runs after `loadStore()` and before the first render. Example:

```js
// existing boot pattern (find and adapt):
//   loadStore();
//   ... applyTheme, applyHeaderIcon, etc. ...
//   loadRecords();
//   showView(prefs.view);
//
// New: insert processRecurring() between loadStore and loadRecords.
loadStore();
await processRecurring();
await loadRecords();
```

If the existing boot is not in an `async` IIFE, wrap it:

```js
(async function boot() {
  loadStore();
  // ... theme/icon/etc ...
  await processRecurring();
  await loadRecords();
  showView(prefs.view);
  // ... rest of init
})();
```

- [ ] **Step 4: Wire `processRecurring()` into Restore**

Find the Restore handler in `app.js` (search for "restore" or the file-input change handler in Settings → Backup & Restore). After it replaces `store` and persists, add:

```js
recurringProcessedThisBoot = false; // allow re-evaluation against restored rules
await processRecurring();
await loadRecords();
```

- [ ] **Step 5: Manual smoke test — silent path**

Run: `npm start`, open localhost.
In DevTools console, seed a rule:

```js
store.settings.recurring.push({
  id: "rule_test1",
  type: "expense", category: "Food", subcategory: "",
  amount: 100, currency: "THB", notes: "test", tags: [],
  cadence: { kind: "daily" },
  startDate: "2026-05-18",                 // 3 days ago
  occurrenceCount: 0, autoConfirm: true, paused: false,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});
localStorage.setItem("fin_store", JSON.stringify(store));
location.reload();
```

Expected: on reload, 4 new expense records appear (one per day from startDate to today), each with `ruleId: "rule_test1"`. Inspect `store.records` to confirm.

- [ ] **Step 6: Manual smoke test — pending path**

In console:
```js
store.settings.recurring[0].autoConfirm = false;
store.settings.recurring[0].lastGeneratedDate = undefined;
store.settings.recurring[0].occurrenceCount = 0;
localStorage.setItem("fin_store", JSON.stringify(store));
recurringProcessedThisBoot = false;
location.reload();
```

After reload, in console: `pendingConfirmations.length` should be > 0. No new records created. (Banner UI comes in Task 14.)

- [ ] **Step 7: Clean up the test rule**

```js
store.settings.recurring = [];
store.records = store.records.filter(r => !r.ruleId);
localStorage.setItem("fin_store", JSON.stringify(store));
location.reload();
```

- [ ] **Step 8: Save files.**

---

### Task 10: Settings UI — "Recurring" section list

**Files:**
- Modify: `public/index.html` (add section scaffold)
- Modify: `public/app.js` (render function + event handlers)
- Modify: `public/styles.css` (row styles)

- [ ] **Step 1: Add Settings section scaffold to `index.html`**

In `public/index.html`, locate the Settings view. Find the "Categories" collapsible section. Insert this section AFTER Categories and BEFORE Preferences:

```html
<details class="settings-section">
  <summary>Recurring</summary>
  <div class="section-body">
    <div id="recurringList" class="recurring-list"></div>
    <button class="btn-secondary" id="addRecurringBtn">+ Add rule</button>
  </div>
</details>
```

Match the exact tag/class names used by the neighbouring sections (Categories, Currencies). If neighbours use `<section>` + custom collapse JS instead of `<details>`, match that pattern instead.

- [ ] **Step 2: Add CSS for the list rows**

In `public/styles.css`, append:

```css
.recurring-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.recurring-row {
  display: flex; align-items: center; gap: 10px;
  background: var(--card); border-radius: 12px; padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--text) 8%, transparent);
}
.recurring-row.paused { opacity: 0.5; }
.recurring-row .rr-body { flex: 1; min-width: 0; }
.recurring-row .rr-title { font-weight: 600; }
.recurring-row .rr-meta { font-size: 0.85em; color: var(--muted, #888); }
.recurring-row .rr-actions { display: flex; gap: 4px; }
.recurring-row .rr-icon-btn {
  background: transparent; border: 0; padding: 6px 8px; cursor: pointer;
  color: var(--text); font-size: 1.1em; border-radius: 8px;
}
.recurring-row .rr-icon-btn:hover { background: color-mix(in srgb, var(--text) 8%, transparent); }
```

- [ ] **Step 3: Add `renderRecurringSection()` to `app.js`**

```js
function renderRecurringSection() {
  const root = document.getElementById("recurringList");
  if (!root) return;
  root.innerHTML = "";
  const rules = store.settings.recurring || [];
  if (!rules.length) {
    root.innerHTML = '<div class="muted">No recurring rules yet. Tap "+ Add rule" to create one.</div>';
    return;
  }
  for (const rule of rules) {
    const row = document.createElement("div");
    row.className = "recurring-row" + (rule.paused ? " paused" : "");
    row.dataset.ruleId = rule.id;
    row.innerHTML = `
      <div class="rr-body">
        <div class="rr-title">${escapeHtml(rule.category || "(no category)")} · ${escapeHtml(cadenceSummary(rule.cadence))}</div>
        <div class="rr-meta">${fmt(rule.amount, rule.currency)} · ${rule.autoConfirm ? "Auto-confirm ON" : "Confirm each"} · Next: ${escapeHtml(nextOccurrenceLabel(rule))}</div>
      </div>
      <div class="rr-actions">
        <button class="rr-icon-btn rr-pause" title="${rule.paused ? "Resume" : "Pause"}">${rule.paused ? "▶" : "⏸"}</button>
        <button class="rr-icon-btn rr-edit" title="Edit">⋯</button>
      </div>
    `;
    row.querySelector(".rr-pause").addEventListener("click", (e) => {
      e.stopPropagation();
      togglePauseRule(rule.id);
    });
    row.querySelector(".rr-edit").addEventListener("click", (e) => {
      e.stopPropagation();
      openRuleEditor(rule.id);
    });
    row.addEventListener("click", () => openRuleEditor(rule.id));
    root.appendChild(row);
  }
}

function cadenceSummary(c) {
  if (!c) return "—";
  if (c.kind === "daily") return "Daily";
  if (c.kind === "weekly") return "Weekly · " + ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][c.weekday];
  if (c.kind === "monthly") return "Monthly · day " + c.dayOfMonth;
  if (c.kind === "yearly") return "Yearly · " + c.month + "/" + c.day;
  return c.kind;
}

function nextOccurrenceLabel(rule) {
  if (rule.paused) return "Paused";
  // Compute the very next future date from today.
  const today = (function () {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  })();
  // Use a temporary clone advanced to today so we get the next future date.
  const clone = JSON.parse(JSON.stringify(rule));
  clone.lastGeneratedDate = today;
  // Step once.
  const occ = computeOccurrences({ ...clone, lastGeneratedDate: today }, addDaysStr(today, 366));
  return occ[0] || "—";
}

function addDaysStr(ymd, n) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
}

function togglePauseRule(ruleId) {
  loadStore();
  const rule = store.settings.recurring.find((r) => r.id === ruleId);
  if (!rule) return;
  if (rule.paused) {
    const today = (function () {
      const d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    })();
    unpauseRule(rule, today);
  } else {
    rule.paused = true;
    rule.updatedAt = new Date().toISOString();
  }
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  renderRecurringSection();
}
```

**Use existing helpers** if they already exist in `app.js`:
- `escapeHtml(s)` — search first; if not present, add a one-liner: `function escapeHtml(s){ return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }`
- `fmt(n, cur)` — already exists (line ~666).
- `STORE_KEY` — already exists (line ~5).

- [ ] **Step 4: Wire up the Add button and call render when Settings opens**

Add near the bottom of `app.js` (in the section that wires Settings buttons):

```js
document.getElementById("addRecurringBtn")?.addEventListener("click", () => openRuleEditor(null));
```

In the existing function that opens the Settings view (search for where it currently calls render functions for Categories, Currencies, etc.), add:

```js
renderRecurringSection();
```

- [ ] **Step 5: Stub `openRuleEditor`**

Add a stub so clicks don't throw — full implementation in Task 11:

```js
function openRuleEditor(ruleId) {
  console.log("openRuleEditor stub — full impl in Task 11", ruleId);
}
```

- [ ] **Step 6: Manual smoke test**

Seed two rules in console:
```js
store.settings.recurring = [
  { id: "ra", type: "expense", category: "Rent", subcategory: "", amount: 15000, currency: "THB",
    notes: "", tags: [], cadence: { kind: "monthly", dayOfMonth: 1 },
    startDate: "2026-01-01", occurrenceCount: 0, autoConfirm: true, paused: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: "rb", type: "investment", category: "SIP", subcategory: "", amount: 5000, currency: "THB",
    notes: "", tags: [], cadence: { kind: "weekly", weekday: 1 },
    startDate: "2026-05-01", occurrenceCount: 0, autoConfirm: false, paused: true,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];
localStorage.setItem("fin_store", JSON.stringify(store));
location.reload();
```

Open Settings → expand "Recurring" → expected: two rows. Second row dimmed (paused). Tap ▶ on it → expected: dim clears, icon becomes ⏸. Tap ⏸ → reverses.

- [ ] **Step 7: Clean up**

```js
store.settings.recurring = [];
localStorage.setItem("fin_store", JSON.stringify(store));
location.reload();
```

- [ ] **Step 8: Save files.**

---

### Task 11: Settings UI — Rule editor modal

**Files:**
- Modify: `public/index.html` (modal markup)
- Modify: `public/app.js` (replace `openRuleEditor` stub with full implementation)
- Modify: `public/styles.css` (modal-section styles if needed)

- [ ] **Step 1: Add modal markup to `index.html`**

Find the existing Add Record modal (search for `id="recordModal"` or similar). Append a sibling modal:

```html
<div id="ruleModal" class="modal hidden" aria-hidden="true">
  <div class="modal-card">
    <header class="modal-head">
      <strong id="ruleModalTitle">New recurring rule</strong>
      <button class="icon-btn" id="ruleModalClose" aria-label="Close">✕</button>
    </header>
    <div class="modal-body">
      <label>Type
        <div class="seg" id="ruleType">
          <button type="button" data-v="expense" class="seg-on">Expense</button>
          <button type="button" data-v="investment">Investment</button>
        </div>
      </label>
      <label>Category <select id="ruleCategory"></select></label>
      <label>Subcategory <select id="ruleSubcategory"></select></label>
      <label>Amount <input type="number" id="ruleAmount" inputmode="decimal" /></label>
      <label>Currency <select id="ruleCurrency"></select></label>
      <label>Notes <input type="text" id="ruleNotes" /></label>

      <label>Cadence
        <div class="seg" id="ruleCadence">
          <button type="button" data-v="daily" class="seg-on">Daily</button>
          <button type="button" data-v="weekly">Weekly</button>
          <button type="button" data-v="monthly">Monthly</button>
          <button type="button" data-v="yearly">Yearly</button>
        </div>
      </label>

      <label class="rule-cad-sub hidden" id="ruleWeeklyWrap">Weekday
        <select id="ruleWeekday">
          <option value="0">Sun</option><option value="1">Mon</option><option value="2">Tue</option>
          <option value="3">Wed</option><option value="4">Thu</option><option value="5">Fri</option>
          <option value="6">Sat</option>
        </select>
      </label>
      <label class="rule-cad-sub hidden" id="ruleMonthlyWrap">Day of month
        <input type="number" id="ruleDayOfMonth" min="1" max="31" value="1" />
        <span class="hint">29–31 falls back to last day of month.</span>
      </label>
      <div class="rule-cad-sub hidden" id="ruleYearlyWrap">
        <label>Month <select id="ruleYearMonth"></select></label>
        <label>Day <input type="number" id="ruleYearDay" min="1" max="31" value="1" /></label>
        <span class="hint">Feb 29 falls back to Feb 28 in non-leap years.</span>
      </div>

      <label>Start date <input type="date" id="ruleStartDate" /></label>

      <label>End condition
        <div class="seg" id="ruleEnd">
          <button type="button" data-v="none" class="seg-on">None</button>
          <button type="button" data-v="date">End date</button>
          <button type="button" data-v="count">After N</button>
        </div>
      </label>
      <label class="rule-end-sub hidden" id="ruleEndDateWrap">End date <input type="date" id="ruleEndDate" /></label>
      <label class="rule-end-sub hidden" id="ruleEndCountWrap">Occurrences <input type="number" id="ruleEndCount" min="1" value="12" /></label>

      <label class="row-toggle">
        <input type="checkbox" id="ruleAutoConfirm" checked />
        Auto-confirm new records
        <span class="hint">OFF: a banner asks you to confirm each one.</span>
      </label>
    </div>
    <footer class="modal-foot">
      <button class="btn-danger hidden" id="ruleDelete">Delete</button>
      <button class="btn-primary" id="ruleSave">Save</button>
    </footer>
  </div>
</div>
```

Match the exact `class` names of the existing record modal (`modal`, `modal-card`, `modal-head`, etc.). If naming differs, use the project's actual names.

- [ ] **Step 2: Add minimal CSS for cadence sub-rows**

In `public/styles.css`:

```css
.rule-cad-sub, .rule-end-sub { display: block; }
.rule-cad-sub.hidden, .rule-end-sub.hidden { display: none; }
.row-toggle { display: flex; gap: 8px; align-items: center; }
.row-toggle .hint { color: var(--muted, #888); font-size: 0.85em; }
.seg { display: inline-flex; gap: 4px; }
.seg button { padding: 6px 10px; border-radius: 8px; background: transparent; border: 1px solid color-mix(in srgb, var(--text) 12%, transparent); color: var(--text); cursor: pointer; }
.seg button.seg-on { background: var(--accent); color: white; border-color: transparent; }
```

(Skip any class that already has a definition — don't double up.)

- [ ] **Step 3: Replace the `openRuleEditor` stub in `app.js`**

```js
function openRuleEditor(ruleId) {
  loadStore();
  const isNew = !ruleId;
  const rule = isNew ? newRuleDraft() : JSON.parse(JSON.stringify(
    store.settings.recurring.find((r) => r.id === ruleId)
  ));
  if (!rule) return;

  const $m = document.getElementById("ruleModal");
  document.getElementById("ruleModalTitle").textContent = isNew ? "New recurring rule" : "Edit recurring rule";
  document.getElementById("ruleDelete").classList.toggle("hidden", isNew);

  // Type segmented
  setSeg("ruleType", rule.type);
  // Category/Subcategory/Currency selects populated from settings
  populateRuleCategorySelects(rule);
  document.getElementById("ruleAmount").value = rule.amount ?? "";
  document.getElementById("ruleNotes").value = rule.notes ?? "";
  populateRuleCurrency(rule);

  // Cadence
  setSeg("ruleCadence", rule.cadence?.kind || "daily");
  showCadenceSub(rule.cadence?.kind || "daily");
  document.getElementById("ruleWeekday").value = rule.cadence?.weekday ?? 1;
  document.getElementById("ruleDayOfMonth").value = rule.cadence?.dayOfMonth ?? 1;
  populateYearMonthSelect();
  document.getElementById("ruleYearMonth").value = rule.cadence?.month ?? 1;
  document.getElementById("ruleYearDay").value = rule.cadence?.day ?? 1;

  document.getElementById("ruleStartDate").value = rule.startDate || todayStr();

  // End condition
  const endKind = rule.endDate ? "date" : (rule.maxOccurrences != null ? "count" : "none");
  setSeg("ruleEnd", endKind);
  showEndSub(endKind);
  document.getElementById("ruleEndDate").value = rule.endDate || "";
  document.getElementById("ruleEndCount").value = rule.maxOccurrences ?? 12;

  document.getElementById("ruleAutoConfirm").checked = rule.autoConfirm !== false;

  // Wire segmented toggles
  wireSeg("ruleType", (v) => { rule.type = v; populateRuleCategorySelects(rule); });
  wireSeg("ruleCadence", (v) => { rule.cadence = { kind: v }; showCadenceSub(v); });
  wireSeg("ruleEnd", (v) => showEndSub(v));

  // Open modal
  $m.classList.remove("hidden");
  document.body.classList.add("modal-open"); // matches existing syncModalLock pattern

  // Buttons
  document.getElementById("ruleModalClose").onclick = closeRuleModal;
  document.getElementById("ruleSave").onclick = () => saveRuleFromModal(rule, isNew);
  document.getElementById("ruleDelete").onclick = () => deleteRuleFromModal(rule);
}

function closeRuleModal() {
  document.getElementById("ruleModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function newRuleDraft() {
  return {
    id: "rule_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
    type: activeType || "expense",
    category: "", subcategory: "", amount: 0,
    currency: store.settings.defaultCurrency,
    notes: "", tags: [],
    cadence: { kind: "daily" },
    startDate: todayStr(),
    occurrenceCount: 0, autoConfirm: true, paused: false,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function setSeg(segId, value) {
  const root = document.getElementById(segId);
  for (const b of root.querySelectorAll("button")) {
    b.classList.toggle("seg-on", b.dataset.v === String(value));
  }
}
function wireSeg(segId, onChange) {
  const root = document.getElementById(segId);
  for (const b of root.querySelectorAll("button")) {
    b.onclick = () => {
      for (const x of root.querySelectorAll("button")) x.classList.toggle("seg-on", x === b);
      onChange(b.dataset.v);
    };
  }
}
function showCadenceSub(kind) {
  document.getElementById("ruleWeeklyWrap").classList.toggle("hidden", kind !== "weekly");
  document.getElementById("ruleMonthlyWrap").classList.toggle("hidden", kind !== "monthly");
  document.getElementById("ruleYearlyWrap").classList.toggle("hidden", kind !== "yearly");
}
function showEndSub(kind) {
  document.getElementById("ruleEndDateWrap").classList.toggle("hidden", kind !== "date");
  document.getElementById("ruleEndCountWrap").classList.toggle("hidden", kind !== "count");
}

function populateRuleCategorySelects(rule) {
  const cats = (rule.type === "expense" ? store.settings.expense : store.settings.investment) || [];
  const catSel = document.getElementById("ruleCategory");
  catSel.innerHTML = cats.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
  if (rule.category && cats.find((c) => c.name === rule.category)) catSel.value = rule.category;
  else rule.category = catSel.value || "";

  const refreshSubs = () => {
    const cat = cats.find((c) => c.name === catSel.value);
    const subSel = document.getElementById("ruleSubcategory");
    const subs = (cat && cat.subs) || [];
    subSel.innerHTML = `<option value="">—</option>` + subs.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("");
    if (rule.subcategory && subs.find((s) => s.name === rule.subcategory)) subSel.value = rule.subcategory;
    else rule.subcategory = "";
  };
  refreshSubs();
  catSel.onchange = () => { rule.category = catSel.value; refreshSubs(); };
  document.getElementById("ruleSubcategory").onchange = (e) => { rule.subcategory = e.target.value; };
}

function populateRuleCurrency(rule) {
  const sel = document.getElementById("ruleCurrency");
  sel.innerHTML = (store.settings.currencies || []).map((c) => `<option value="${c}">${c}</option>`).join("");
  sel.value = rule.currency || store.settings.defaultCurrency;
  sel.onchange = () => { rule.currency = sel.value; };
}

function populateYearMonthSelect() {
  const sel = document.getElementById("ruleYearMonth");
  if (sel.options.length) return;
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  sel.innerHTML = names.map((n, i) => `<option value="${i + 1}">${n}</option>`).join("");
}

function saveRuleFromModal(draft, isNew) {
  // Pull current control values into draft (segmented controls already mutated draft.type/cadence.kind/etc.)
  draft.amount = Number(document.getElementById("ruleAmount").value) || 0;
  draft.notes = document.getElementById("ruleNotes").value;
  draft.currency = document.getElementById("ruleCurrency").value;
  draft.startDate = document.getElementById("ruleStartDate").value || todayStr();

  const cadenceKind = draft.cadence?.kind || "daily";
  draft.cadence = { kind: cadenceKind };
  if (cadenceKind === "weekly") draft.cadence.weekday = Number(document.getElementById("ruleWeekday").value);
  if (cadenceKind === "monthly") draft.cadence.dayOfMonth = Number(document.getElementById("ruleDayOfMonth").value);
  if (cadenceKind === "yearly") {
    draft.cadence.month = Number(document.getElementById("ruleYearMonth").value);
    draft.cadence.day = Number(document.getElementById("ruleYearDay").value);
  }

  const endKind = document.querySelector("#ruleEnd button.seg-on").dataset.v;
  draft.endDate = endKind === "date" ? document.getElementById("ruleEndDate").value || undefined : undefined;
  draft.maxOccurrences = endKind === "count" ? Number(document.getElementById("ruleEndCount").value) || undefined : undefined;

  draft.autoConfirm = document.getElementById("ruleAutoConfirm").checked;
  draft.updatedAt = new Date().toISOString();

  loadStore();
  if (isNew) {
    store.settings.recurring.push(draft);
  } else {
    const idx = store.settings.recurring.findIndex((r) => r.id === draft.id);
    if (idx >= 0) store.settings.recurring[idx] = draft;
  }
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  renderRecurringSection();
  closeRuleModal();
}

function deleteRuleFromModal(draft) {
  if (!confirm("Delete this rule? Records it already generated will be kept.")) return;
  loadStore();
  store.settings.recurring = store.settings.recurring.filter((r) => r.id !== draft.id);
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  renderRecurringSection();
  closeRuleModal();
}
```

- [ ] **Step 4: Manual smoke test**

Run `npm start`, open localhost. Settings → Recurring → "+ Add rule" → fill in: Type Expense, Category from your real list, Amount 1000, Cadence Monthly, Day 1, Start date today. Save. Expected: rule appears in the list. Tap it → expected: editor reopens pre-filled. Change something, Save. Expected: list updates. Delete from the editor → expected: row disappears.

Also: switch Type to Investment, confirm Category select repopulates.
Also: change Cadence between Daily/Weekly/Monthly/Yearly — confirm sub-rows show/hide.
Also: change End condition — confirm sub-rows show/hide.

- [ ] **Step 5: Save files.**

---

### Task 12: Add Record modal — "Make this recurring" shortcut

**Files:**
- Modify: `public/index.html` (add toggle + nested controls)
- Modify: `public/app.js` (the existing Add Record save handler)

- [ ] **Step 1: Add the toggle + nested controls to the existing Add Record modal**

In `public/index.html`, find the body of the existing record modal. After the Notes field, insert:

```html
<details class="rec-recurring">
  <summary><label class="row-toggle"><input type="checkbox" id="recRecurringToggle" /> Make this recurring</label></summary>
  <div class="rec-recurring-body">
    <label>Cadence
      <div class="seg" id="recCadence">
        <button type="button" data-v="daily" class="seg-on">Daily</button>
        <button type="button" data-v="weekly">Weekly</button>
        <button type="button" data-v="monthly">Monthly</button>
        <button type="button" data-v="yearly">Yearly</button>
      </div>
    </label>
    <label class="rec-cad-sub hidden" id="recWeeklyWrap">Weekday
      <select id="recWeekday">
        <option value="0">Sun</option><option value="1">Mon</option><option value="2">Tue</option>
        <option value="3">Wed</option><option value="4">Thu</option><option value="5">Fri</option>
        <option value="6">Sat</option>
      </select>
    </label>
    <label class="rec-cad-sub hidden" id="recMonthlyWrap">Day of month <input type="number" id="recDayOfMonth" min="1" max="31" value="1" /></label>
    <div class="rec-cad-sub hidden" id="recYearlyWrap">
      <label>Month <select id="recYearMonth"></select></label>
      <label>Day <input type="number" id="recYearDay" min="1" max="31" value="1" /></label>
    </div>
    <label>End condition
      <div class="seg" id="recEnd">
        <button type="button" data-v="none" class="seg-on">None</button>
        <button type="button" data-v="date">End date</button>
        <button type="button" data-v="count">After N</button>
      </div>
    </label>
    <label class="rec-end-sub hidden" id="recEndDateWrap">End date <input type="date" id="recEndDate" /></label>
    <label class="rec-end-sub hidden" id="recEndCountWrap">Occurrences <input type="number" id="recEndCount" min="1" value="12" /></label>
    <label class="row-toggle"><input type="checkbox" id="recAutoConfirm" checked /> Auto-confirm new records</label>
  </div>
</details>
```

CSS (`public/styles.css`):
```css
.rec-recurring { margin-top: 8px; }
.rec-recurring summary { cursor: pointer; }
.rec-recurring-body { display: flex; flex-direction: column; gap: 8px; padding: 8px 0; }
.rec-cad-sub.hidden, .rec-end-sub.hidden { display: none; }
```

- [ ] **Step 2: Wire the sub-controls (mirrors rule modal logic)**

In `app.js`, find `openModal(record)` (line ~1943). At the end of its body, add:

```js
// Reset and wire the "Make this recurring" sub-form on every open.
const recToggle = document.getElementById("recRecurringToggle");
if (recToggle) {
  recToggle.checked = false;
  document.querySelector(".rec-recurring").open = false;
  // Populate yearly month select (idempotent).
  const yms = document.getElementById("recYearMonth");
  if (yms && !yms.options.length) {
    yms.innerHTML = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
      .map((n, i) => `<option value="${i+1}">${n}</option>`).join("");
  }
  setSeg("recCadence", "daily"); showRecCadenceSub("daily");
  setSeg("recEnd", "none"); showRecEndSub("none");
  wireSeg("recCadence", showRecCadenceSub);
  wireSeg("recEnd", showRecEndSub);
}

function showRecCadenceSub(kind) {
  document.getElementById("recWeeklyWrap").classList.toggle("hidden", kind !== "weekly");
  document.getElementById("recMonthlyWrap").classList.toggle("hidden", kind !== "monthly");
  document.getElementById("recYearlyWrap").classList.toggle("hidden", kind !== "yearly");
}
function showRecEndSub(kind) {
  document.getElementById("recEndDateWrap").classList.toggle("hidden", kind !== "date");
  document.getElementById("recEndCountWrap").classList.toggle("hidden", kind !== "count");
}
```

Move the two `show...` helpers out of the `if (recToggle)` block so they're top-level functions (or hoist them above this code).

- [ ] **Step 3: Extend the record save handler**

Find the existing save handler in `openModal` (searches for `api("/records", "POST", ...)` or similar). After the record is successfully saved, check the toggle and create a rule:

```js
// After the existing successful POST that saved the record (call this AFTER `await loadRecords()`):
if (document.getElementById("recRecurringToggle")?.checked) {
  await createRuleFromAddRecord(savedRecord); // see below
}
```

Add the helper:

```js
async function createRuleFromAddRecord(savedRecord) {
  const cadenceKind = document.querySelector("#recCadence button.seg-on").dataset.v;
  const cadence = { kind: cadenceKind };
  if (cadenceKind === "weekly") cadence.weekday = Number(document.getElementById("recWeekday").value);
  if (cadenceKind === "monthly") cadence.dayOfMonth = Number(document.getElementById("recDayOfMonth").value);
  if (cadenceKind === "yearly") {
    cadence.month = Number(document.getElementById("recYearMonth").value);
    cadence.day = Number(document.getElementById("recYearDay").value);
  }
  const endKind = document.querySelector("#recEnd button.seg-on").dataset.v;
  const rule = {
    id: "rule_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
    type: savedRecord.type,
    category: savedRecord.category,
    subcategory: savedRecord.subcategory || "",
    amount: savedRecord.amount,
    currency: savedRecord.currency,
    notes: savedRecord.notes || "",
    tags: (savedRecord.tags || []).slice(),
    cadence,
    startDate: savedRecord.date,
    lastGeneratedDate: savedRecord.date,         // record already created — start ticking after this date
    endDate: endKind === "date" ? document.getElementById("recEndDate").value || undefined : undefined,
    maxOccurrences: endKind === "count" ? Number(document.getElementById("recEndCount").value) || undefined : undefined,
    occurrenceCount: 1,                          // we already produced one
    autoConfirm: document.getElementById("recAutoConfirm").checked,
    paused: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // Also stamp the just-saved record with the new ruleId for provenance.
  loadStore();
  const recIdx = store.records.findIndex((r) => r.id === savedRecord.id);
  if (recIdx >= 0) store.records[recIdx].ruleId = rule.id;
  store.settings.recurring.push(rule);
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  await loadRecords();
}
```

- [ ] **Step 4: Manual smoke test**

Open Add Record (+ FAB). Fill normal fields. Expand "Make this recurring", set Monthly day 1, Auto-confirm ON. Save. Expected: one new record appears in the list with `ruleId` set (check via DevTools `store.records[0]`). Open Settings → Recurring → expected: new rule appears in the list, "Next:" shows a future date (next month's 1st).

- [ ] **Step 5: Save files.**

---

### Task 13: Record card — `ruleId` provenance badge

**Files:**
- Modify: `public/app.js` (record-row render helper)
- Modify: `public/styles.css`

- [ ] **Step 1: Locate the existing record-row render**

Find the code that builds each record card (search for the part that injects amount, date, category into a row, around line ~860 where `el.addEventListener("click", () => openModal(r))` is set).

- [ ] **Step 2: Inject the `↻` badge when `ruleId` is set**

In that render block, just after the date span, add:

```js
if (r.ruleId) {
  const badge = document.createElement("span");
  badge.className = "rec-rule-badge";
  badge.title = "Generated from a recurring rule";
  badge.textContent = "↻";
  badge.addEventListener("click", (e) => {
    e.stopPropagation();
    const rule = (store.settings.recurring || []).find((x) => x.id === r.ruleId);
    if (!rule) {
      alert("Rule no longer exists.");
    } else {
      // Open Settings → Recurring section → open editor for this rule.
      showView("settings");
      setTimeout(() => openRuleEditor(rule.id), 50);
    }
  });
  // Append next to date element — adapt to actual row structure:
  el.querySelector(".rec-date")?.appendChild(badge);
}
```

If `.rec-date` is not the right selector for the date container, use whatever the codebase uses (inspect via DevTools).

- [ ] **Step 3: Add badge style**

In `public/styles.css`:

```css
.rec-rule-badge {
  display: inline-block; margin-left: 6px; padding: 0 5px;
  border-radius: 6px; font-size: 0.85em;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent); cursor: pointer; user-select: none;
}
```

- [ ] **Step 4: Manual smoke test**

If you completed Task 12's smoke test, you should already have a record with `ruleId`. Find it in the records list — expected: `↻` badge next to the date. Tap the badge → expected: jumps to Settings and opens the rule editor for that rule.

Delete the rule. Reload. Tap the badge on the orphaned record → expected: "Rule no longer exists." alert.

- [ ] **Step 5: Save files.**

---

### Task 14: Dashboard banner — Confirm / Edit / Skip + bulk actions

**Files:**
- Modify: `public/index.html` (banner mount point on dashboard)
- Modify: `public/app.js` (render + handlers)
- Modify: `public/styles.css`

- [ ] **Step 1: Add banner mount in `index.html`**

In `public/index.html`, inside `<main id="view-dashboard">`, **above** `<div class="summary-row">` (line ~42), add:

```html
<div id="confirmBanner" class="confirm-banner hidden"></div>
```

- [ ] **Step 2: Add banner CSS**

```css
.confirm-banner {
  background: var(--card); border-radius: 12px; padding: 10px 12px;
  display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
}
.confirm-banner.hidden { display: none; }
.cb-row { display: flex; align-items: center; gap: 8px; }
.cb-row .cb-text { flex: 1; min-width: 0; }
.cb-row .cb-actions { display: flex; gap: 4px; }
.cb-row .cb-actions button {
  padding: 4px 8px; border-radius: 6px; border: 1px solid color-mix(in srgb, var(--text) 12%, transparent);
  background: transparent; color: var(--text); cursor: pointer;
}
.cb-row .cb-actions .cb-confirm { background: var(--accent); color: white; border-color: transparent; }
.cb-more { font-size: 0.85em; color: var(--muted, #888); }
.cb-bulk { display: flex; gap: 8px; margin-top: 4px; }
.cb-bulk button { flex: 1; }
```

- [ ] **Step 3: Render function**

```js
function renderConfirmBanner() {
  const root = document.getElementById("confirmBanner");
  if (!root) return;
  if (!pendingConfirmations.length) {
    root.classList.add("hidden");
    root.innerHTML = "";
    return;
  }
  root.classList.remove("hidden");
  const shown = pendingConfirmations.slice(0, 3);
  const extra = pendingConfirmations.length - shown.length;
  root.innerHTML = shown.map((p, i) => `
    <div class="cb-row" data-i="${i}">
      <div class="cb-text">${escapeHtml(p.rule.category)} — ${fmt(p.rule.amount, p.rule.currency)} — due ${p.dueDate}</div>
      <div class="cb-actions">
        <button class="cb-confirm" data-act="confirm">Confirm</button>
        <button data-act="edit">Edit</button>
        <button data-act="skip">Skip</button>
      </div>
    </div>
  `).join("") + (extra > 0 ? `
    <div class="cb-more">+${extra} more</div>
    <div class="cb-bulk">
      <button id="cbConfirmAll" class="cb-confirm">Confirm all</button>
      <button id="cbSkipAll">Skip all</button>
    </div>
  ` : "");

  for (const row of root.querySelectorAll(".cb-row")) {
    const i = Number(row.dataset.i);
    row.querySelector('[data-act="confirm"]').onclick = () => confirmPending(i);
    row.querySelector('[data-act="edit"]').onclick = () => editPending(i);
    row.querySelector('[data-act="skip"]').onclick = () => skipPending(i);
  }
  document.getElementById("cbConfirmAll")?.addEventListener("click", confirmAllPending);
  document.getElementById("cbSkipAll")?.addEventListener("click", skipAllPending);
}

async function confirmPending(idx) {
  const p = pendingConfirmations[idx];
  if (!p) return;
  loadStore();
  const rule = store.settings.recurring.find((r) => r.id === p.ruleId);
  if (!rule) { pendingConfirmations.splice(idx, 1); renderConfirmBanner(); return; }
  const rec = buildRecordFromRule(rule, p.dueDate);
  try { await attachConversion(rec); } catch (_e) { rec.rateUnavailable = true; }
  store.records.push(rec);
  rule.lastGeneratedDate = p.dueDate;
  rule.occurrenceCount = (rule.occurrenceCount || 0) + 1;
  applyEndChecks(rule);
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  pendingConfirmations.splice(idx, 1);
  await loadRecords();
  renderConfirmBanner();
}

async function skipPending(idx) {
  const p = pendingConfirmations[idx];
  if (!p) return;
  loadStore();
  const rule = store.settings.recurring.find((r) => r.id === p.ruleId);
  if (!rule) { pendingConfirmations.splice(idx, 1); renderConfirmBanner(); return; }
  rule.lastGeneratedDate = p.dueDate;
  rule.occurrenceCount = (rule.occurrenceCount || 0) + 1;
  applyEndChecks(rule);
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  pendingConfirmations.splice(idx, 1);
  renderConfirmBanner();
}

async function editPending(idx) {
  const p = pendingConfirmations[idx];
  if (!p) return;
  const rule = store.settings.recurring.find((r) => r.id === p.ruleId);
  if (!rule) return;
  const draft = buildRecordFromRule(rule, p.dueDate);
  // openModal expects a record-shaped object; reusing it as "edit unsaved".
  // After the user saves, treat as confirm.
  openModalAsConfirmation(draft, async () => {
    // post-save callback: advance bookmark + remove from pending
    loadStore();
    const r2 = store.settings.recurring.find((r) => r.id === p.ruleId);
    if (r2) {
      r2.lastGeneratedDate = p.dueDate;
      r2.occurrenceCount = (r2.occurrenceCount || 0) + 1;
      applyEndChecks(r2);
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    }
    pendingConfirmations.splice(idx, 1);
    renderConfirmBanner();
  });
}

async function confirmAllPending() {
  // Run sequentially but await each, so rule state stays consistent.
  while (pendingConfirmations.length) await confirmPending(0);
}
async function skipAllPending() {
  while (pendingConfirmations.length) await skipPending(0);
}
```

- [ ] **Step 4: Implement `openModalAsConfirmation(draft, onSaved)`**

The cleanest approach is to extend `openModal()` so it accepts an optional pre-filled draft and a `onSavedCallback`. Add a thin wrapper:

```js
function openModalAsConfirmation(draft, onSaved) {
  // Stash the callback so the existing save handler can call it after success.
  window.__pendingOnSaved = onSaved;
  openModal(draft); // openModal already accepts a record to prefill
}
```

In the existing record save handler (inside `openModal`), after the record is saved AND `await loadRecords()` runs, add:

```js
const cb = window.__pendingOnSaved;
window.__pendingOnSaved = null;
if (cb) await cb();
```

- [ ] **Step 5: Call `renderConfirmBanner()` whenever the dashboard view shows**

In the `showView()` function, when switching to dashboard, after the existing render calls, add:

```js
if (v === "dashboard") renderConfirmBanner();
```

Also call it once after `processRecurring()` resolves at boot.

- [ ] **Step 6: Manual smoke test**

Seed:
```js
store.settings.recurring = [{
  id: "rt1", type: "expense", category: "Electric", subcategory: "",
  amount: 800, currency: "THB", notes: "", tags: [],
  cadence: { kind: "daily" },
  startDate: "2026-05-18",
  occurrenceCount: 0, autoConfirm: false, paused: false,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}];
localStorage.setItem("fin_store", JSON.stringify(store));
recurringProcessedThisBoot = false;
location.reload();
```

Expected on dashboard: banner with 3 rows (May 18, 19, 20) + "+1 more" + Confirm-all/Skip-all. Tap Confirm on the first row → expected: row disappears, new record appears in the dashboard's recent list. Tap Skip → row disappears, no record. Tap Edit → modal opens pre-filled; on Save it acts like Confirm.

Tap **Confirm all** → expected: every remaining pending becomes a record.

Clean up rule + records afterward.

- [ ] **Step 7: Save files.**

---

### Task 15: Final smoke test of recurring system

**Files:** None modified; this is a manual integration check.

- [ ] **Step 1: Restore a fresh state**

```js
store.settings.recurring = [];
store.records = store.records.filter(r => !r.ruleId);
localStorage.setItem("fin_store", JSON.stringify(store));
location.reload();
```

- [ ] **Step 2: Create one rule of each cadence via the UI**

- Daily, auto-confirm ON
- Weekly (Monday), auto-confirm OFF, end date in 4 weeks
- Monthly day 31, auto-confirm ON, after 6 occurrences
- Yearly Feb 29, auto-confirm OFF

Verify each is listed in Settings → Recurring.

- [ ] **Step 3: Test backfill**

In console: edit the Daily rule's `startDate` to 5 days ago, set `lastGeneratedDate = undefined`, `occurrenceCount = 0`. Save. Reload.

Expected: 5 new daily records appear, all with `ruleId`. Banner empty (Daily was auto-confirm).

Edit Weekly rule similarly. Reload. Expected: banner shows 1+ pending occurrences.

- [ ] **Step 4: Test pause / unpause**

Pause the Daily rule via the ⏸ button. Edit its `startDate` to 1 day ago, set `lastGeneratedDate = undefined`. Reload. Expected: no new record (paused). Tap ▶ → expected: pause toggles off, no immediate record (because unpause sets `startDate = today` since `lastGeneratedDate` was undefined).

- [ ] **Step 5: Test Restore re-evaluates rules**

Use Settings → Backup & Restore → download the backup. Wipe localStorage. Reload. Restore from the file. Expected: rules come back; any rules whose next occurrence is ≤ today generate records (or queue confirmations) right after Restore.

- [ ] **Step 6: Run the unit tests one more time**

Run: `node tests/run.js`
Expected: all tests still pass — no regressions.

- [ ] **Step 7: Save (no files changed).**

---

### Task 16: Dashboard total buttons — currency layout tweak

**Files:**
- Modify: `public/app.js` (dashboard render path only)

- [ ] **Step 1: Update the 4 lines in the dashboard render path**

In `public/app.js`, find the dashboard render block (lines 777–780):

```js
// BEFORE
$("#sumExpense").textContent = fmt(yearTotal("expense"), cur);
$("#sumInvest").textContent = fmt(yearTotal("investment"), cur);
$("#cardExpense .muted").textContent = yr + " Expenses";
$("#cardInvest .muted").textContent = yr + " Investments";
```

Replace with:

```js
// AFTER
$("#sumExpense").textContent = fmt(yearTotal("expense"));               // no currency in big number
$("#sumInvest").textContent  = fmt(yearTotal("investment"));            // no currency in big number
$("#cardExpense .muted").textContent = yr + " Expenses"   + (cur ? " · " + cur : "");
$("#cardInvest .muted").textContent  = yr + " Investments" + (cur ? " · " + cur : "");
```

**Do NOT change** lines 990–993 (the Records-view buttons). Per spec, those stay as-is.

- [ ] **Step 2: Manual smoke test**

Open dashboard. Expected: small line reads `"2026 Expenses · THB"` (or whatever your current year + currency is). Big number reads just the digits (no `"THB "` prefix). Switch active type — same on the Investments card.

Edge case: wipe localStorage → reload → before any records exist, `cur` is empty. Expected: muted line shows `"2026 Expenses"` with no trailing `· undefined`.

Records view: expected: unchanged (still shows currency-prefixed big number).

- [ ] **Step 3: Save files.**

---

### Task 17: Version bump to v32 + final deploy

**Files:**
- Modify: `public/app.js` (`APP_VERSION`)
- Modify: `public/sw.js` (`CACHE`)

- [ ] **Step 1: Bump `APP_VERSION` in `app.js`**

Line 6:

```js
// BEFORE
const APP_VERSION = "v31";
// AFTER
const APP_VERSION = "v32";
```

- [ ] **Step 2: Bump `CACHE` in `sw.js`**

Line 2:

```js
// BEFORE
const CACHE = "munitrakr-v31";
// AFTER
const CACHE = "munitrakr-v32";
```

- [ ] **Step 3: Syntax check both files**

Run: `node --check public/app.js && node --check public/sw.js`
Expected: no output (both syntactically valid).

- [ ] **Step 4: Run the unit tests one final time**

Run: `node tests/run.js`
Expected: all pass.

- [ ] **Step 5: Local smoke test**

Run: `npm start`, open `http://localhost:3000`.
- Settings → App version → expected: `MuniTrakr v32`.
- Hard-reload to force SW update; confirm DevTools → Application → Cache Storage shows `munitrakr-v32`.

- [ ] **Step 6: Deploy**

Drag the `public/` folder onto the existing Netlify site's Deploys tab. (No zip — the user prefers folder uploads.)

On phone: Settings → App version → **Check for updates**.

- [ ] **Step 7: Save (already saved — this is just the final deploy step).**

---

## Done

After Task 17, both specs are shipped:
- Recurring/scheduled records — rules, cadences, backfill, pause, banner, badge.
- Dashboard total buttons — currency moved to muted label.
