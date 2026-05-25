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

function ruleDaily(start, opts = {}) {
  return {
    id: "r1", type: "expense", category: "X", subcategory: "",
    amount: 1, currency: "THB", notes: "",
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
    amount: 120, currency: "THB", notes: "n",
  });
  const rec = R.buildRecordFromRule(r, "2026-05-21");
  assert.equal(rec.type, "expense");
  assert.equal(rec.category, "Food");
  assert.equal(rec.subcategory, "Coffee");
  assert.equal(rec.amount, 120);
  assert.equal(rec.currency, "THB");
  assert.equal(rec.notes, "n");
  assert.equal(rec.date, "2026-05-21");
  assert.equal(rec.ruleId, "r1");
  assert.ok(typeof rec.id === "string" && rec.id.length > 0);
  // createdAt/updatedAt are numeric ms (matches the rest of the app's record shape)
  assert.ok(typeof rec.createdAt === "number" && rec.createdAt > 0);
  assert.ok(typeof rec.updatedAt === "number" && rec.updatedAt > 0);
  // No FX fields baked in — those come from attachConversion later.
  assert.equal(rec.convertedAmount, undefined);
  assert.equal(rec.rate, undefined);
});
