const { test, assert } = require("./_lib");
const D = require("../public/debts");

function debt(o) {
  return Object.assign({
    id: "d_" + Math.random().toString(36).slice(2, 7),
    type: "lend",
    personId: "p1",
    date: "2026-05-21",
    amount: 100,
    currency: "THB",
    notes: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }, o);
}

test("personBalances: empty input -> empty map", () => {
  const b = D.personBalances([], {}, "THB");
  assert.equal(b.size, 0);
});

test("personBalances: single lend -> they-owe with 0 progress", () => {
  const b = D.personBalances([debt({ type: "lend", amount: 100, personId: "p1" })], undefined, "THB");
  const row = b.get("p1");
  assert.equal(row.lent, 100);
  assert.equal(row.back, 0);
  assert.equal(row.outstanding, 100);
  assert.equal(row.direction, "they-owe");
  assert.equal(row.progress, 0);
});

test("personBalances: single borrow -> i-owe with 0 progress", () => {
  const b = D.personBalances([debt({ type: "borrow", amount: 50, personId: "p2" })], undefined, "THB");
  const row = b.get("p2");
  assert.equal(row.outstanding, -50);
  assert.equal(row.direction, "i-owe");
  assert.equal(row.progress, 0);
});

test("personBalances: partial repayment -> progress correct", () => {
  const b = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),
    debt({ type: "borrow", amount: 30,  personId: "p1" }),
  ], undefined, "THB");
  const row = b.get("p1");
  assert.equal(row.outstanding, 70);
  assert.equal(row.direction, "they-owe");
  assert.equal(row.progress, 0.3);
});

test("personBalances: full repayment -> clear, progress 1", () => {
  const b = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),
    debt({ type: "borrow", amount: 100, personId: "p1" }),
  ], undefined, "THB");
  const row = b.get("p1");
  assert.equal(row.outstanding, 0);
  assert.equal(row.direction, "clear");
  assert.equal(row.progress, 1);
});

test("personBalances: uses convertedAmount when converted to the default", () => {
  const b = D.personBalances([
    debt({ type: "lend", amount: 1000, currency: "THB", convertedAmount: 27, convertedCurrency: "USD", personId: "p1" }),
  ], undefined, "USD");
  assert.equal(b.get("p1").outstanding, 27);
});

test("personBalances: ignores debts whose person was deleted (when peopleById given)", () => {
  const b = D.personBalances(
    [debt({ personId: "ghost" })],
    { p1: {} }, "THB"
  );
  assert.equal(b.size, 0);
});

test("personBalances: keeps debts when peopleById not provided", () => {
  const b = D.personBalances([debt({ personId: "anyone" })], undefined, "THB");
  assert.equal(b.size, 1);
});

test("personBalances: multiple people independent", () => {
  const b = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),
    debt({ type: "lend",   amount: 200, personId: "p2" }),
    debt({ type: "borrow", amount: 80,  personId: "p2" }),
  ], undefined, "THB");
  assert.equal(b.get("p1").outstanding, 100);
  assert.equal(b.get("p2").outstanding, 120);
});

test("totalsAcrossPeople: sums by direction, ignores clear", () => {
  const balances = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),   // they-owe 100
    debt({ type: "lend",   amount: 200, personId: "p2" }),   // they-owe 200
    debt({ type: "borrow", amount: 200, personId: "p2" }),   // clear
    debt({ type: "borrow", amount: 50,  personId: "p3" }),   // i-owe 50
  ], undefined, "THB");
  const { totalLend, totalBorrow } = D.totalsAcrossPeople(balances);
  assert.equal(totalLend, 100);
  assert.equal(totalBorrow, 50);
});

test("totalsAcrossPeople: empty -> zeros", () => {
  const t = D.totalsAcrossPeople(new Map());
  assert.equal(t.totalLend, 0);
  assert.equal(t.totalBorrow, 0);
});

test("personBalances: direction flip — net flips, progress recalculated for new direction", () => {
  const b = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }), // lent 100
    debt({ type: "borrow", amount: 200, personId: "p1" }), // I now owe 100 net
  ], undefined, "THB");
  const row = b.get("p1");
  assert.equal(row.outstanding, -100);
  assert.equal(row.direction, "i-owe");
  // progress = lent/back = 100/200 = 0.5
  assert.equal(row.progress, 0.5);
});

// --- Cycle reset + "paid-back" type ---

test("personBalances: cycle resets after full repayment — next lend starts at 0% progress", () => {
  const b = D.personBalances([
    debt({ id: "d1", type: "lend",   amount: 100, personId: "p1", date: "2026-01-01", createdAt: 1 }),
    debt({ id: "d2", type: "borrow", amount: 100, personId: "p1", date: "2026-01-15", createdAt: 2 }), // closes cycle 1
    debt({ id: "d3", type: "lend",   amount: 200, personId: "p1", date: "2026-02-01", createdAt: 3 }), // starts cycle 2
    debt({ id: "d4", type: "borrow", amount: 50,  personId: "p1", date: "2026-02-15", createdAt: 4 }),
  ], undefined, "THB");
  const row = b.get("p1");
  assert.equal(row.lent, 200);    // ONLY cycle 2 — historical 100 is gone
  assert.equal(row.back, 50);     // ONLY cycle 2
  assert.equal(row.outstanding, 150);
  assert.equal(row.direction, "they-owe");
  assert.equal(row.progress, 0.25); // 50/200
});

test("personBalances: paid-back type behaves identically to borrow", () => {
  const b1 = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),
    debt({ type: "borrow", amount: 30,  personId: "p1" }),
  ], undefined, "THB");
  const b2 = D.personBalances([
    debt({ type: "lend",      amount: 100, personId: "p1" }),
    debt({ type: "paid-back", amount: 30,  personId: "p1" }),
  ], undefined, "THB");
  assert.equal(b1.get("p1").outstanding, b2.get("p1").outstanding);
  assert.equal(b1.get("p1").direction, b2.get("p1").direction);
  assert.equal(b1.get("p1").progress, b2.get("p1").progress);
});

test("personBalances: multiple settle cycles all reset cleanly", () => {
  const b = D.personBalances([
    debt({ id: "d1", type: "lend",      amount: 50, personId: "p1", date: "2026-01-01", createdAt: 1 }),
    debt({ id: "d2", type: "paid-back", amount: 50, personId: "p1", date: "2026-01-10", createdAt: 2 }),
    debt({ id: "d3", type: "lend",      amount: 30, personId: "p1", date: "2026-02-01", createdAt: 3 }),
    debt({ id: "d4", type: "paid-back", amount: 30, personId: "p1", date: "2026-02-10", createdAt: 4 }),
  ], undefined, "THB");
  const row = b.get("p1");
  assert.equal(row.outstanding, 0);
  assert.equal(row.direction, "clear");
});

// --- annotateSettlements ---

test("annotateSettlements: flags the record that closes a cycle", () => {
  const debts = [
    debt({ id: "d1", type: "lend",   amount: 100, personId: "p1", date: "2026-01-01", createdAt: 1 }),
    debt({ id: "d2", type: "borrow", amount: 30,  personId: "p1", date: "2026-01-15", createdAt: 2 }),
    debt({ id: "d3", type: "borrow", amount: 70,  personId: "p1", date: "2026-01-20", createdAt: 3 }), // closes
    debt({ id: "d4", type: "lend",   amount: 50,  personId: "p1", date: "2026-02-01", createdAt: 4 }),
  ];
  const ann = D.annotateSettlements(debts, "THB");
  assert.equal(ann.get("d1").settled, false);
  assert.equal(ann.get("d2").settled, false);
  assert.equal(ann.get("d3").settled, true);
  assert.equal(ann.get("d4").settled, false);
});

test("annotateSettlements: paid-back type can close a cycle", () => {
  const debts = [
    debt({ id: "d1", type: "lend",      amount: 50, personId: "p1", date: "2026-01-01", createdAt: 1 }),
    debt({ id: "d2", type: "paid-back", amount: 50, personId: "p1", date: "2026-01-10", createdAt: 2 }),
  ];
  const ann = D.annotateSettlements(debts, "THB");
  assert.equal(ann.get("d2").settled, true);
});

test("annotateSettlements: a single-record net-zero does NOT count as settled (no prior cycle)", () => {
  // If the very first record is amount 0, it didn't close anything.
  const debts = [
    debt({ id: "d1", type: "lend", amount: 0, personId: "p1", date: "2026-01-01", createdAt: 1 }),
  ];
  const ann = D.annotateSettlements(debts, "THB");
  assert.equal(ann.get("d1").settled, false);
});

test("annotateSettlements: each cycle's closer gets its own flag", () => {
  const debts = [
    debt({ id: "d1", type: "lend",      amount: 50, personId: "p1", date: "2026-01-01", createdAt: 1 }),
    debt({ id: "d2", type: "paid-back", amount: 50, personId: "p1", date: "2026-01-10", createdAt: 2 }), // closes
    debt({ id: "d3", type: "lend",      amount: 30, personId: "p1", date: "2026-02-01", createdAt: 3 }),
    debt({ id: "d4", type: "paid-back", amount: 30, personId: "p1", date: "2026-02-10", createdAt: 4 }), // closes
  ];
  const ann = D.annotateSettlements(debts, "THB");
  assert.equal(ann.get("d1").settled, false);
  assert.equal(ann.get("d2").settled, true);
  assert.equal(ann.get("d3").settled, false);
  assert.equal(ann.get("d4").settled, true);
});

// --- balanceBefore ---

test("balanceBefore: returns 0 for first record of a person", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
  ];
  const peopleById = { p1: { id: "p1" } };
  assert.equal(D.balanceBefore(debts, "a", peopleById, "THB"), 0);
});

test("balanceBefore: returns running outstanding before the named record", () => {
  const debts = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 200, currency: "THB" },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50, currency: "THB" },
    { id: "c", type: "lend",      personId: "p1", date: "2026-01-10", createdAt: 3, amount: 100, currency: "THB" },
  ];
  const peopleById = { p1: { id: "p1" } };
  // Before "c": 200 lent - 50 paid back = 150 outstanding.
  assert.equal(D.balanceBefore(debts, "c", peopleById, "THB"), 150);
});

test("balanceBefore: respects cycle reset", () => {
  const debts = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 100, currency: "THB" },
    { id: "c", type: "lend",      personId: "p1", date: "2026-01-10", createdAt: 3, amount:  80, currency: "THB" },
  ];
  const peopleById = { p1: { id: "p1" } };
  // Before "c": cycle reset by "b", so 0.
  assert.equal(D.balanceBefore(debts, "c", peopleById, "THB"), 0);
});

test("balanceBefore: uses convertedAmount when present", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1,
      amount: 10, currency: "USD", convertedAmount: 360, convertedCurrency: "THB" },
    { id: "b", type: "lend", personId: "p1", date: "2026-01-02", createdAt: 2,
      amount: 5,  currency: "USD", convertedAmount: 180, convertedCurrency: "THB" },
  ];
  const peopleById = { p1: { id: "p1" } };
  assert.equal(D.balanceBefore(debts, "b", peopleById, "THB"), 360);
});

test("balanceBefore: ignores records for other people", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
    { id: "x", type: "lend", personId: "p2", date: "2026-01-02", createdAt: 2, amount: 999, currency: "THB" },
    { id: "b", type: "lend", personId: "p1", date: "2026-01-03", createdAt: 3, amount:  50, currency: "THB" },
  ];
  const peopleById = { p1: { id: "p1" }, p2: { id: "p2" } };
  assert.equal(D.balanceBefore(debts, "b", peopleById, "THB"), 100);
});

test("balanceBefore: returns 0 when record id not found", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
  ];
  assert.equal(D.balanceBefore(debts, "missing", { p1: { id: "p1" } }, "THB"), 0);
});

test("balanceBefore: returns 0 when person is not in peopleById (deleted)", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
    { id: "b", type: "lend", personId: "p1", date: "2026-01-02", createdAt: 2, amount:  50, currency: "THB" },
  ];
  // p1 omitted from peopleById -> treated as deleted, returns 0.
  assert.equal(D.balanceBefore(debts, "b", {}, "THB"), 0);
});

test("personBalances: pay-back behaves identically to lend in cycle math", () => {
  // I owe Mama 100 (one borrow record). I pay back 100 via pay-back -> cycle resets to 0.
  const debts = [
    { id: "a", type: "borrow",   personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
    { id: "b", type: "pay-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 100, currency: "THB" },
  ];
  const peopleById = { p1: { id: "p1" } };
  const b = D.personBalances(debts, peopleById, "THB");
  const row = b.get("p1");
  assert.equal(row.lent, 0);
  assert.equal(row.back, 0);
  assert.equal(row.outstanding, 0);
  assert.equal(row.direction, "clear");
});

test("annotateSettlements: pay-back can close a cycle", () => {
  const debts = [
    { id: "a", type: "borrow",   personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
    { id: "b", type: "pay-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 100, currency: "THB" },
  ];
  const map = D.annotateSettlements(debts, "THB");
  assert.equal(map.get("b").settled, true);
  assert.equal(!!(map.get("a") && map.get("a").settled), false);
});

test("balanceBefore: pay-back contributes to lent before the target", () => {
  const debts = [
    { id: "a", type: "borrow",   personId: "p1", date: "2026-01-01", createdAt: 1, amount: 200, currency: "THB" },
    { id: "b", type: "pay-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50, currency: "THB" },
    { id: "c", type: "borrow",   personId: "p1", date: "2026-01-10", createdAt: 3, amount: 100, currency: "THB" },
  ];
  const peopleById = { p1: { id: "p1" } };
  // Before "c": back=200, lent=50, outstanding = lent - back = -150.
  assert.equal(D.balanceBefore(debts, "c", peopleById, "THB"), -150);
});

// --- balanceAfterRecord ---

test("balanceAfterRecord: two lends for a person absent from any people map", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-09-20", createdAt: 1, amount: 100, currency: "THB" },
    { id: "b", type: "lend", personId: "p1", date: "2026-09-22", createdAt: 2, amount:  50, currency: "THB" },
  ];
  // No peopleById passed anywhere — p1 doesn't exist in any people map.
  assert.equal(D.balanceAfterRecord(debts, "b", "THB"), 150);
  assert.equal(D.balanceAfterRecord(debts, "a", "THB"), 100);
});

test("balanceAfterRecord: paid-back and borrow signs", () => {
  const lendThenPaidBack = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 500, currency: "THB" },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 200, currency: "THB" },
  ];
  // After "b": 500 lent - 200 paid back = 300.
  assert.equal(D.balanceAfterRecord(lendThenPaidBack, "b", "THB"), 300);

  const borrow = [
    { id: "c", type: "borrow", personId: "p2", date: "2026-01-10", createdAt: 3, amount: 80, currency: "THB" },
  ];
  // After "c": nothing before it, then -80 borrowed.
  assert.equal(D.balanceAfterRecord(borrow, "c", "THB"), -80);
});

test("balanceAfterRecord: uses convertedAmount when present", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1,
      amount: 450, currency: "USD", convertedAmount: 15750, convertedCurrency: "THB" },
  ];
  assert.equal(D.balanceAfterRecord(debts, "a", "THB"), 15750);
});

test("balanceAfterRecord: returns 0 for unknown id", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
  ];
  assert.equal(D.balanceAfterRecord(debts, "missing", "THB"), 0);
});

// --- planSplit ---

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

test("planSplit: outstanding 0 with paid-back type does not split (pass-through)", () => {
  const entered = { type: "paid-back", personId: "p1", date: "2026-05-24", amount: 100, currency: "THB", notes: "" };
  const out = D.planSplit(entered, 0, "THB");
  assert.equal(out.split, false);
  assert.equal(out.a, entered);
});

test("wouldOvershoot: amount bump that pushes paid-back past outstanding -> true", () => {
  const debts = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50, currency: "THB" },
  ];
  // edit b: amount 50 -> 200. Outstanding before b is +100. Bumping to 200 overshoots by 100.
  const edited = { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 200, currency: "THB" };
  assert.equal(D.wouldOvershoot(debts, edited, "THB"), true);
});

test("wouldOvershoot: amount decrease still within outstanding -> false", () => {
  const debts = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50, currency: "THB" },
  ];
  const edited = { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 30, currency: "THB" };
  assert.equal(D.wouldOvershoot(debts, edited, "THB"), false);
});

test("wouldOvershoot: editing a non-settling record (lend) -> always false", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
  ];
  const edited = { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 9999, currency: "THB" };
  assert.equal(D.wouldOvershoot(debts, edited, "THB"), false);
});

test("wouldOvershoot: pay-back when no i-owe cycle exists -> true (mismatched direction)", () => {
  // Person has +100 outstanding (they owe me). A pay-back here makes no sense — treat as overshoot.
  const debts = [
    { id: "a", type: "lend",     personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
    { id: "x", type: "pay-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50, currency: "THB" },
  ];
  const edited = { id: "x", type: "pay-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 50, currency: "THB" };
  assert.equal(D.wouldOvershoot(debts, edited, "THB"), true);
});

test("wouldOvershoot: uses convertedAmount when present", () => {
  const debts = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100, currency: "THB" },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50, currency: "THB" },
  ];
  // Edit b: USD 10 ~ THB 350 — that overshoots THB 100 outstanding.
  const edited = {
    id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2,
    amount: 10, currency: "USD", convertedAmount: 350, convertedCurrency: "THB",
  };
  assert.equal(D.wouldOvershoot(debts, edited, "THB"), true);
});

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
  assert.deepEqual(D.evenShares(100, Infinity), []);
});

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

/* ---------------- planPaidBy (paid-by-someone-else) ---------------- */

function paidByEntered(amount, extra) {
  return Object.assign(
    { personId: "p1", date: "2026-07-24", amount, currency: "THB", notes: "x" },
    extra
  );
}

test("planPaidBy: clear balance -> single borrow", () => {
  const out = D.planPaidBy(paidByEntered(450), 0, "THB");
  assert.equal(out.records.length, 1);
  const r = out.records[0];
  assert.equal(r.type, "borrow");
  assert.equal(r.amount, 450);
  assert.equal(r.currency, "THB");
  assert.equal(r.personId, "p1");
  assert.equal(r.date, "2026-07-24");
  assert.equal(r.notes, "x");
});

test("planPaidBy: they owe more than the amount -> single paid-back, original currency kept", () => {
  const entered = paidByEntered(450, { currency: "USD" });
  const out = D.planPaidBy(entered, 1000, "THB");
  assert.equal(out.records.length, 1);
  const r = out.records[0];
  assert.equal(r.type, "paid-back");
  assert.equal(r.amount, 450);
  assert.equal(r.currency, "USD");
});

test("planPaidBy: they owe exactly the amount -> single paid-back (no split)", () => {
  const out = D.planPaidBy(paidByEntered(450), 450, "THB");
  assert.equal(out.records.length, 1);
  const r = out.records[0];
  assert.equal(r.type, "paid-back");
  assert.equal(r.amount, 450);
});

test("planPaidBy: they owe less -> two records, exact split halves in default currency", () => {
  const out = D.planPaidBy(paidByEntered(450), 100, "THB");
  assert.equal(out.records.length, 2);
  const [a, b] = out.records;
  assert.equal(a.type, "paid-back");
  assert.equal(a.amount, 100);
  assert.equal(a.currency, "THB");
  assert.equal(a.personId, "p1");
  assert.equal(a.date, "2026-07-24");
  assert.equal(a.notes, "x");
  assert.equal(b.type, "borrow");
  assert.equal(b.amount, 350);
  assert.equal(b.currency, "THB");
  assert.equal(b.personId, "p1");
  assert.equal(b.date, "2026-07-24");
  assert.equal(b.notes, "x");
});

test("planPaidBy: I already owe them -> single borrow", () => {
  const out = D.planPaidBy(paidByEntered(450), -200, "THB");
  assert.equal(out.records.length, 1);
  const r = out.records[0];
  assert.equal(r.type, "borrow");
  assert.equal(r.amount, 450);
});

test("planPaidBy: converted amount drives the math", () => {
  const entered = paidByEntered(450, {
    currency: "USD",
    convertedAmount: 15750,
    convertedCurrency: "THB",
  });
  const out = D.planPaidBy(entered, 1000, "THB");
  assert.equal(out.records.length, 2);
  const [a, b] = out.records;
  assert.equal(a.type, "paid-back");
  assert.equal(a.amount, 1000);
  assert.equal(a.currency, "THB");
  assert.equal(b.type, "borrow");
  assert.equal(b.amount, 14750);
  assert.equal(b.currency, "THB");
});

test("planPaidBy: invalid input -> empty; no caller mutation", () => {
  assert.deepEqual(D.planPaidBy(null, 100, "THB"), { records: [] });
  assert.deepEqual(D.planPaidBy(paidByEntered(0), 100, "THB"), { records: [] });
  assert.deepEqual(D.planPaidBy(paidByEntered(NaN), 100, "THB"), { records: [] });

  const e = paidByEntered(450);
  D.planPaidBy(e, 0, "THB");
  assert.equal(e.type, undefined);

  const e2 = paidByEntered(450);
  D.planPaidBy(e2, 1000, "THB");
  assert.equal(e2.type, undefined);
});

/* ---------------- stripSplitBreakdown (Duplicate) ---------------- */

test("stripSplitBreakdown: removes the breakdown after the user's notes", () => {
  assert.equal(
    D.stripSplitBreakdown("Bonchon · Split bill — total 900: Bill 450 · Boat 450"),
    "Bonchon");
});

test("stripSplitBreakdown: breakdown-only notes become empty", () => {
  assert.equal(
    D.stripSplitBreakdown("Split bill — total 2,500: Bill 1,250 · Boat 1,250"),
    "");
});

test("stripSplitBreakdown: notes without a breakdown are unchanged", () => {
  assert.equal(D.stripSplitBreakdown("Coffee with Nok · oat milk"), "Coffee with Nok · oat milk");
  assert.equal(D.stripSplitBreakdown(""), "");
});

test("stripSplitBreakdown: user notes containing their own middle dots survive", () => {
  assert.equal(
    D.stripSplitBreakdown("Dinner · Thonglor · Split bill — total 1,000: Bill 500 · Nok 500"),
    "Dinner · Thonglor");
});

test("stripSplitBreakdown: the \"paid by\" suffix goes with the breakdown", () => {
  assert.equal(
    D.stripSplitBreakdown("Dinner · Split bill — total THB 1,000: Bill 500 · Brother 500 · paid by Brother"),
    "Dinner");
  assert.equal(
    D.stripSplitBreakdown("Split bill — total THB 1,000: Bill 500 · Brother 500 · paid by Brother"),
    "");
});

/* ---------------- planSplitDebts (Split the bill: who paid) ---------------- */

function splitParts() {
  return [
    { personId: "b", name: "Brother", amount: 333.33 },
    { personId: "p", name: "Ploy", amount: 333.33 },
  ];
}

test("planSplitDebts: payer null -> one lend per part, amounts as given", () => {
  const out = D.planSplitDebts({ payerId: null, mine: 333.34, parts: splitParts() });
  assert.deepEqual(out, { lends: [
    { personId: "b", amount: 333.33 },
    { personId: "p", amount: 333.33 },
  ] });
});

test("planSplitDebts: payer \"me\" (or missing) -> same lends as payer null", () => {
  const want = { lends: [
    { personId: "b", amount: 333.33 },
    { personId: "p", amount: 333.33 },
  ] };
  assert.deepEqual(D.planSplitDebts({ payerId: "me", mine: 333.34, parts: splitParts() }), want);
  assert.deepEqual(D.planSplitDebts({ mine: 333.34, parts: splitParts() }), want);
});

test("planSplitDebts: blank or non-string payer (\"\", \"  \", 0, false) -> lends like null", () => {
  const want = { lends: [
    { personId: "b", amount: 333.33 },
    { personId: "p", amount: 333.33 },
  ] };
  assert.deepEqual(D.planSplitDebts({ payerId: "", mine: 333.34, parts: splitParts() }), want);
  assert.deepEqual(D.planSplitDebts({ payerId: "  ", mine: 333.34, parts: splitParts() }), want);
  assert.deepEqual(D.planSplitDebts({ payerId: 0, mine: 333.34, parts: splitParts() }), want);
  assert.deepEqual(D.planSplitDebts({ payerId: false, mine: 333.34, parts: splitParts() }), want);
});

test("planSplitDebts: payer is a participant -> owe that person my share, no lends", () => {
  const out = D.planSplitDebts({ payerId: "b", mine: 333.34, parts: splitParts() });
  assert.deepEqual(out, { owe: { personId: "b", amount: 333.34 } });
  assert.equal(out.lends, undefined);
});

test("planSplitDebts: payer not among the parts -> still owe (the UI prevents it)", () => {
  const out = D.planSplitDebts({ payerId: "x", mine: 500, parts: splitParts() });
  assert.deepEqual(out, { owe: { personId: "x", amount: 500 } });
});

test("planSplitDebts: never mutates its input", () => {
  const parts = splitParts();
  const input = { payerId: null, mine: 333.34, parts };
  const snapshot = JSON.stringify(input);
  const out = D.planSplitDebts(input);
  assert.equal(JSON.stringify(input), snapshot);
  assert.notEqual(out.lends[0], parts[0]); // fresh objects, not the caller's
  out.lends[0].amount = 1;
  assert.equal(parts[0].amount, 333.33);
  const input2 = { payerId: "b", mine: 500, parts: splitParts() };
  const snapshot2 = JSON.stringify(input2);
  D.planSplitDebts(input2);
  assert.equal(JSON.stringify(input2), snapshot2);
});

test("planSplitDebts: non-object or missing fields -> { lends: [] }", () => {
  assert.deepEqual(D.planSplitDebts(null), { lends: [] });
  assert.deepEqual(D.planSplitDebts(undefined), { lends: [] });
  assert.deepEqual(D.planSplitDebts("x"), { lends: [] });
  assert.deepEqual(D.planSplitDebts({}), { lends: [] });
  assert.deepEqual(D.planSplitDebts({ payerId: null, mine: 10 }), { lends: [] });
  assert.deepEqual(D.planSplitDebts({ payerId: null, mine: 10, parts: "nope" }), { lends: [] });
  assert.deepEqual(D.planSplitDebts({ payerId: "b", parts: splitParts() }), { lends: [] });
  assert.deepEqual(D.planSplitDebts({ payerId: "b", mine: "500", parts: splitParts() }), { lends: [] });
});

/* ---------------- blockSelect (no-gaps selection rule) ---------------- */

const BLOCK_IDS = ["a", "b", "c", "d", "e"]; // a = newest, top

test("blockSelect: empty selection, tap c -> [c]", () => {
  assert.deepEqual(D.blockSelect(BLOCK_IDS, [], "c"), ["c"]);
});

test("blockSelect: extend downward — selected [b], tap e -> [b,c,d,e]", () => {
  assert.deepEqual(D.blockSelect(BLOCK_IDS, ["b"], "e"), ["b", "c", "d", "e"]);
});

test("blockSelect: extend upward — selected [c,d], tap a -> [a,b,c,d]", () => {
  assert.deepEqual(D.blockSelect(BLOCK_IDS, ["c", "d"], "a"), ["a", "b", "c", "d"]);
});

test("blockSelect: top edge drops only itself — selected [b,c,d], tap b -> [c,d]", () => {
  assert.deepEqual(D.blockSelect(BLOCK_IDS, ["b", "c", "d"], "b"), ["c", "d"]);
});

test("blockSelect: middle cuts it and everything older — selected [a,b,c,d], tap b -> [a]", () => {
  assert.deepEqual(D.blockSelect(BLOCK_IDS, ["a", "b", "c", "d"], "b"), ["a"]);
});

test("blockSelect: bottom edge drops only itself — selected [a,b,c], tap c -> [a,b]", () => {
  assert.deepEqual(D.blockSelect(BLOCK_IDS, ["a", "b", "c"], "c"), ["a", "b"]);
});

test("blockSelect: one-row block, tap it -> []", () => {
  assert.deepEqual(D.blockSelect(BLOCK_IDS, ["c"], "c"), []);
});

test("blockSelect: unknown tap and gap normalisation", () => {
  // Unknown tap: current selection restricted to ids, in display order, unchanged.
  assert.deepEqual(D.blockSelect(BLOCK_IDS, ["d", "b"], "z"), ["b", "d"]);
  // Gapped input's block is b..d; extending to e fills the gap.
  assert.deepEqual(D.blockSelect(BLOCK_IDS, ["b", "d"], "e"), ["b", "c", "d", "e"]);
  // selected may be a Set; it must not be mutated.
  const s = new Set(["c"]);
  assert.deepEqual(D.blockSelect(BLOCK_IDS, s, "a"), ["a", "b", "c"]);
  assert.deepEqual(Array.from(s), ["c"]);
});

/* ---------------- default-currency counting rule (v86) ----------------
   Default is USD. A "stale" item was converted to an OLD default (EUR); a
   "rate n/a" item never got a conversion. Both are NOT counted: skipped
   entirely — no balance movement, no cycle/settlement effect. */

function stale(o) {
  return Object.assign({ amount: 5000, currency: "THB", convertedAmount: 130, convertedCurrency: "EUR" }, o);
}
function rateNA(o) {
  return Object.assign({ amount: 900, currency: "JPY", rateUnavailable: true }, o);
}

test("personBalances: stale-convertedCurrency and rateUnavailable items are skipped", () => {
  const b = D.personBalances([
    debt({ id: "a", type: "lend", amount: 100, currency: "USD", createdAt: 1 }),
    debt(stale({ id: "b", type: "lend", createdAt: 2 })),
    debt(rateNA({ id: "c", type: "borrow", createdAt: 3 })),
    debt({ id: "d", type: "borrow", amount: 20, currency: "THB", convertedAmount: 20, convertedCurrency: "USD", createdAt: 4 }),
  ], undefined, "USD");
  const row = b.get("p1");
  assert.equal(row.lent, 100);
  assert.equal(row.back, 20);
  assert.equal(row.outstanding, 80);
  assert.equal(row.direction, "they-owe");
  assert.equal(row.progress, 0.2);
});

test("personBalances: a skipped item cannot close or open a cycle", () => {
  const b = D.personBalances([
    debt({ id: "a", type: "lend", amount: 100, currency: "USD", createdAt: 1 }),
    debt(stale({ id: "b", type: "paid-back", amount: 100, convertedAmount: 100, createdAt: 2 })),
    debt(rateNA({ id: "c", type: "borrow", amount: 100, createdAt: 3 })),
    debt({ id: "d", type: "paid-back", amount: 100, currency: "USD", createdAt: 4 }), // closes
    debt({ id: "e", type: "lend", amount: 50, currency: "USD", createdAt: 5 }),
  ], { p1: {} }, "USD");
  const row = b.get("p1");
  assert.equal(row.lent, 50);
  assert.equal(row.back, 0);
  assert.equal(row.outstanding, 50);
  assert.equal(row.progress, 0);
});

test("annotateSettlements: skipped items never settle and never close a cycle", () => {
  const debts = [
    debt({ id: "a", type: "lend", amount: 100, currency: "USD", createdAt: 1 }),
    debt(stale({ id: "b", type: "paid-back", amount: 100, convertedAmount: 100, createdAt: 2 })),
    debt(rateNA({ id: "c", type: "paid-back", amount: 100, createdAt: 3 })),
    debt({ id: "d", type: "paid-back", amount: 100, currency: "USD", createdAt: 4 }),
  ];
  const ann = D.annotateSettlements(debts, "USD");
  assert.equal(ann.get("a").settled, false);
  assert.equal(ann.get("b").settled, false);
  assert.equal(ann.get("c").settled, false);
  assert.equal(ann.get("d").settled, true);
});

test("balanceBefore: skipped items before the target don't move the balance", () => {
  const debts = [
    debt({ id: "a", type: "lend", amount: 100, currency: "USD", createdAt: 1 }),
    debt(stale({ id: "b", type: "lend", createdAt: 2 })),
    debt(rateNA({ id: "c", type: "borrow", createdAt: 3 })),
    debt({ id: "d", type: "lend", amount: 10, currency: "USD", createdAt: 4 }),
  ];
  assert.equal(D.balanceBefore(debts, "d", { p1: {} }, "USD"), 100);
  assert.equal(D.balanceBefore(debts, "d", undefined, "USD"), 100);
});

test("balanceAfterRecord: a skipped target adds nothing; skipped items before a counted target are ignored", () => {
  const debts = [
    debt({ id: "a", type: "lend", amount: 100, currency: "USD", createdAt: 1 }),
    debt(stale({ id: "b", type: "lend", createdAt: 2 })),
    debt(rateNA({ id: "c", type: "borrow", createdAt: 3 })),
    debt({ id: "d", type: "paid-back", amount: 30, currency: "USD", createdAt: 4 }),
  ];
  assert.equal(D.balanceAfterRecord(debts, "b", "USD"), 100);
  assert.equal(D.balanceAfterRecord(debts, "c", "USD"), 100);
  assert.equal(D.balanceAfterRecord(debts, "d", "USD"), 70);
});

test("wouldOvershoot: skipped items don't inflate the open balance", () => {
  const debts = [
    debt({ id: "a", type: "lend", amount: 100, currency: "USD", createdAt: 1 }),
    debt(stale({ id: "b", type: "lend", createdAt: 2 })),
    debt(rateNA({ id: "c", type: "lend", createdAt: 3 })),
    debt({ id: "d", type: "paid-back", amount: 50, currency: "USD", createdAt: 4 }),
  ];
  const edited = Object.assign({}, debts[3], { amount: 150 });
  assert.equal(D.wouldOvershoot(debts, edited, "USD"), true);
});

test("wouldOvershoot: a not-counted edited record contributes 0 (never overshoots by amount)", () => {
  const debts = [
    debt({ id: "a", type: "lend", amount: 100, currency: "USD", createdAt: 1 }),
    debt({ id: "d", type: "paid-back", amount: 50, currency: "USD", createdAt: 4 }),
  ];
  const edited = rateNA({ id: "d", type: "paid-back", personId: "p1", date: "2026-05-21", createdAt: 4, amount: 99999 });
  assert.equal(D.wouldOvershoot(debts, edited, "USD"), false);
  const editedStale = stale({ id: "d", type: "paid-back", personId: "p1", date: "2026-05-21", createdAt: 4, amount: 99999, convertedAmount: 99999 });
  assert.equal(D.wouldOvershoot(debts, editedStale, "USD"), false);
  // Direction mismatch still blocks regardless of amount (unchanged rule).
  const editedPayBack = rateNA({ id: "d", type: "pay-back", personId: "p1", date: "2026-05-21", createdAt: 4 });
  assert.equal(D.wouldOvershoot(debts, editedPayBack, "USD"), true);
});

test("planSplit: a not-counted entered item contributes 0 -> never splits, passes through", () => {
  const e1 = stale({ type: "paid-back", personId: "p1", date: "2026-05-24", amount: 999, convertedAmount: 999, notes: "" });
  const out1 = D.planSplit(e1, +100, "USD");
  assert.equal(out1.split, false);
  assert.equal(out1.a, e1);
  const e2 = rateNA({ type: "pay-back", personId: "p1", date: "2026-05-24", amount: 999, notes: "" });
  const out2 = D.planSplit(e2, -100, "USD");
  assert.equal(out2.split, false);
  assert.equal(out2.a, e2);
});

test("planPaidBy: a not-counted entered item never splits; offline no-netting borrow still planned", () => {
  const e = rateNA({ personId: "p1", date: "2026-07-24", amount: 900, notes: "x" });
  const netted = D.planPaidBy(e, 100, "USD");
  assert.equal(netted.records.length, 1);
  assert.equal(netted.records[0].type, "paid-back");
  assert.equal(netted.records[0].amount, 900);
  assert.equal(netted.records[0].currency, "JPY");
  const plain = D.planPaidBy(e, 0, "USD");
  assert.equal(plain.records.length, 1);
  assert.equal(plain.records[0].type, "borrow");
  assert.equal(plain.records[0].amount, 900);
  assert.equal(plain.records[0].rateUnavailable, true);
});

/* ---- integer-cent cycle comparisons (v86 fix wave) ---- */

test("cents: 14.6 + 0.15 lent, 14.75 paid back -> clear, settled, no overshoot", () => {
  const ds = [
    debt({ id: "a", type: "lend", amount: 14.6, currency: "USD", date: "2026-01-01" }),
    debt({ id: "b", type: "lend", amount: 0.15, currency: "USD", date: "2026-01-02" }),
    debt({ id: "c", type: "paid-back", amount: 14.75, currency: "USD", date: "2026-01-03" }),
  ];
  const row = D.personBalances(ds, undefined, "USD").get("p1");
  assert.equal(row.direction, "clear");
  assert.equal(row.outstanding, 0);
  assert.equal(D.annotateSettlements(ds, "USD").get("c").settled, true);
  assert.equal(D.balanceBefore(ds, "c", undefined, "USD"), 14.75);
  assert.equal(D.balanceAfterRecord(ds, "c", "USD"), 0);
  assert.equal(D.wouldOvershoot(ds, ds[2], "USD"), false);
  const plan = D.planSplit({ type: "paid-back", personId: "p1", date: "2026-01-03", amount: 20, currency: "USD" }, 0.1 + 0.2, "USD");
  assert.equal(plan.split, true);
  assert.equal(plan.a.amount, 0.3);
  assert.equal(plan.b.amount, 19.7);
});

test("cents: personBalances returns cent-exact lent/back/outstanding", () => {
  const ds = [
    debt({ type: "lend", amount: 0.1, currency: "USD", date: "2026-01-01" }),
    debt({ type: "lend", amount: 0.2, currency: "USD", date: "2026-01-02" }),
  ];
  const row = D.personBalances(ds, undefined, "USD").get("p1");
  assert.equal(row.lent, 0.3);
  assert.equal(row.outstanding, 0.3);
});

/* ---- transition guard (older cached app.js passes no defaultCurrency) ---- */

test("transition guard: no defaultCurrency -> pre-v86 counting (convertedAmount ?? amount)", () => {
  const ds = [
    debt({ type: "lend", amount: 100, currency: "THB", date: "2026-01-01" }),
    debt({ type: "lend", amount: 10, currency: "USD", convertedCurrency: "THB", convertedAmount: 340, date: "2026-01-02" }),
  ];
  assert.equal(D.personBalances(ds).get("p1").outstanding, 440);
  assert.equal(D.balanceAfterRecord(ds, ds[1].id), 440);
});

/* ---- planDebtReconversion: today's rate + exact cycle closure ---- */

const TODAY = "2026-10-01";
function rateFn(map, calls) {
  return async (from, to, date) => {
    if (calls) calls.push(date + ":" + from + ":" + to);
    const r = map[date + ":" + from + ":" + to];
    return r === undefined ? null : r;
  };
}
// Applies a successful plan to deep copies (the app does the same to the fresh store).
function applyPlan(debts, plan) {
  const copies = debts.map((d) => JSON.parse(JSON.stringify(d)));
  const byId = new Map(copies.map((d) => [d.id, d]));
  for (const { item, fields } of plan.updates) {
    const t = byId.get(item.id);
    for (const k of ["convertedAmount", "convertedCurrency", "rate", "rateDate", "rateUnavailable", "manualRate", "fxMarkupPct"]) delete t[k];
    Object.assign(t, fields);
  }
  return copies;
}

test("planDebtReconversion: reviewer example - settled cycle stays settled, outstanding = round2(500 x rate)", async () => {
  const ds = [
    debt({ id: "jan", type: "lend", amount: 1000, date: "2026-01-01" }),
    debt({ id: "feb", type: "paid-back", amount: 1000, date: "2026-02-01" }),
    debt({ id: "mar", type: "lend", amount: 500, date: "2026-03-01" }),
  ];
  const calls = [];
  const plan = await D.planDebtReconversion(ds, "USD", {
    getRate: rateFn({ [TODAY + ":THB:USD"]: 0.0295 }, calls), markupPct: 3, today: TODAY,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(calls, [TODAY + ":THB:USD"]); // ONE rate, today's
  assert.deepEqual(plan.updates.map((u) => u.fields.convertedAmount), [29.5, 29.5, 14.75]);
  plan.updates.forEach((u) => {
    assert.equal(u.fields.convertedCurrency, "USD");
    assert.equal(u.fields.rate, 0.0295);
    assert.equal(u.fields.rateDate, TODAY);
    assert.equal(u.fields.fxMarkupPct, undefined); // old-default debts: no card markup
  });
  const after = applyPlan(ds, plan);
  const row = D.personBalances(after, undefined, "USD").get("p1");
  assert.equal(row.outstanding, Math.round(500 * 0.0295 * 100) / 100);
  assert.equal(row.outstanding, 14.75);
  assert.equal(row.progress, 0); // fresh cycle after the settled one
  assert.equal(D.annotateSettlements(after, "USD").get("feb").settled, true);
  assert.equal(ds[0].convertedAmount, undefined); // input untouched
});

test("planDebtReconversion: a many-item cycle whose per-item rounding leaves a cent closes exactly", async () => {
  const r = 0.0295;
  // Per item: 15 x 0.0295 = 0.4425 -> 0.44 (x3 = 1.32) but 45 x 0.0295 = 1.3275 -> 1.33.
  assert.notEqual(3 * Math.round(15 * r * 100), Math.round(45 * r * 100));
  const ds = [
    debt({ id: "l1", type: "lend", amount: 15, date: "2026-01-01" }),
    debt({ id: "l2", type: "lend", amount: 15, date: "2026-01-02" }),
    debt({ id: "l3", type: "lend", amount: 15, date: "2026-01-03" }),
    debt({ id: "pb", type: "paid-back", amount: 45, date: "2026-01-04" }),
    debt({ id: "b1", type: "borrow", amount: 15, date: "2026-02-01" }),
  ];
  const plan = await D.planDebtReconversion(ds, "USD", {
    getRate: rateFn({ [TODAY + ":THB:USD"]: r }), today: TODAY,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.updates.map((u) => u.fields.convertedAmount), [0.44, 0.45, 0.44, 1.33, 0.44]);
  const after = applyPlan(ds, plan);
  assert.equal(D.annotateSettlements(after, "USD").get("pb").settled, true);
  const row = D.personBalances(after, undefined, "USD").get("p1");
  assert.equal(row.direction, "i-owe");
  assert.equal(row.outstanding, -0.44); // symmetric with a "they owe" 15 THB
});

test("planDebtReconversion: a person with a debt already counted in the new default falls back to per-debt rounding", async () => {
  const r = 0.0295;
  const ds = [
    debt({ id: "l1", type: "lend", amount: 15, date: "2026-01-01" }),
    debt({ id: "l2", type: "lend", amount: 15, date: "2026-01-02" }),
    debt({ id: "l3", type: "lend", amount: 15, date: "2026-01-03" }),
    debt({ id: "usd", type: "lend", amount: 5, currency: "USD", convertedCurrency: "THB", convertedAmount: 170, date: "2026-01-05" }),
  ];
  const plan = await D.planDebtReconversion(ds, "USD", {
    getRate: rateFn({ [TODAY + ":THB:USD"]: r }), today: TODAY,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.updates.length, 3); // the USD debt is counted -> never touched
  assert.deepEqual(plan.updates.map((u) => u.fields.convertedAmount), [0.44, 0.44, 0.44]);
});

test("planDebtReconversion: mixed old currencies fall back; chained debt derives from its old value with no markup", async () => {
  const ds = [
    // EUR 100 converted to the old default THB with a 2% markup.
    debt({ id: "eur", type: "lend", amount: 100, currency: "EUR", convertedCurrency: "THB", convertedAmount: 3876, fxMarkupPct: 2, rate: 38.76, date: "2026-01-01" }),
    // A failed foreign conversion (offline save): its old currency is its own, JPY.
    debt({ id: "jpy", type: "lend", amount: 1000, currency: "JPY", rateUnavailable: true, date: "2026-01-02" }),
    // Another person: a legacy manual-rate chain.
    debt({ id: "man", personId: "p2", type: "borrow", amount: 50, currency: "LAK", convertedCurrency: "THB", convertedAmount: 333, manualRate: true, date: "2026-01-03" }),
  ];
  const calls = [];
  const plan = await D.planDebtReconversion(ds, "USD", {
    getRate: rateFn({ [TODAY + ":THB:USD"]: 0.0295, [TODAY + ":JPY:USD"]: 0.0067 }, calls),
    markupPct: 2.5, today: TODAY,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(calls.sort(), [TODAY + ":JPY:USD", TODAY + ":THB:USD"]);
  const f = Object.fromEntries(plan.updates.map((u) => [u.item.id, u.fields]));
  // Chained: 3876 x 0.0295 = 114.342 -> 114.34; rate = 0.0295 x 3876 / 100.
  assert.equal(f.eur.convertedAmount, 114.34);
  assert.equal(f.eur.rate, 1.14342);
  assert.equal(f.eur.fxMarkupPct, undefined);
  // rateUnavailable: today's JPY rate with the current markup, like its save would have.
  // 0.0067 x 1.025 = 0.0068675 -> 1000 x = 6.8675 -> 6.87
  assert.equal(f.jpy.convertedAmount, 6.87);
  assert.equal(f.jpy.rate, 0.0068675);
  assert.equal(f.jpy.fxMarkupPct, 2.5);
  // Manual chain keeps manualRate, no markup: 333 x 0.0295 = 9.8235 -> 9.82
  assert.equal(f.man.convertedAmount, 9.82);
  assert.equal(f.man.manualRate, true);
  assert.equal(f.man.fxMarkupPct, undefined);
  assert.equal(f.man.rate, 0.19647);
});

test("planDebtReconversion: a debt that rounds to 0 is kept (convertedAmount 0, still counted)", async () => {
  const ds = [debt({ id: "tiny", type: "lend", amount: 0.1, date: "2026-01-01" })];
  const plan = await D.planDebtReconversion(ds, "USD", {
    getRate: rateFn({ [TODAY + ":THB:USD"]: 0.0295 }), today: TODAY,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].fields.convertedAmount, 0);
  const after = applyPlan(ds, plan);
  const H = require("../public/finance-helpers");
  assert.equal(H.amountInDefault(after[0], "USD"), 0); // counted (not null)
  assert.equal(D.personBalances(after, undefined, "USD").get("p1").direction, "clear");
});

test("planDebtReconversion: any missing rate -> ok:false with the failed debts, input untouched", async () => {
  const ds = [
    debt({ id: "a", type: "lend", amount: 100, date: "2026-01-01" }),
    debt({ id: "b", type: "lend", amount: 100, currency: "VND", date: "2026-01-02" }),
    debt({ id: "c", type: "lend", amount: 5, currency: "USD", date: "2026-01-03" }),
  ];
  const snap = JSON.parse(JSON.stringify(ds));
  const plan = await D.planDebtReconversion(ds, "USD", {
    getRate: rateFn({ [TODAY + ":THB:USD"]: 0.0295 }), today: TODAY,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.failed, 1);
  assert.equal(plan.total, 2);
  assert.equal(plan.failedItems[0], ds[1]);
  assert.deepEqual(ds, snap);
  const thrown = await D.planDebtReconversion(ds, "USD", {
    getRate: async () => { throw new Error("offline"); }, today: TODAY,
  });
  assert.equal(thrown.ok, false);
  assert.equal(thrown.failed, 2);
});

test("planDebtReconversion: onProgress reaches total; empty input -> ok with no updates", async () => {
  const ds = [
    debt({ type: "lend", amount: 100, date: "2026-01-01" }),
    debt({ type: "lend", amount: 100, date: "2026-01-02" }),
    debt({ type: "lend", amount: 100, currency: "EUR", date: "2026-01-03" }),
  ];
  const progress = [];
  const plan = await D.planDebtReconversion(ds, "USD", {
    getRate: async () => 0.5, today: TODAY, onProgress: (d, t) => progress.push([d, t]),
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(progress[progress.length - 1], [3, 3]);
  // Back to THB: only the EUR debt is not counted; the THB ones are never touched.
  const back = await D.planDebtReconversion(ds, "THB", { getRate: async () => 38, today: TODAY });
  assert.equal(back.updates.length, 1);
  assert.equal(back.updates[0].item, ds[2]);
  const empty = await D.planDebtReconversion([], "USD", { getRate: async () => { throw 1; }, today: TODAY });
  assert.deepEqual(empty, { ok: true, updates: [] });
});

test("records keep per-date rates while debts use today's; a shared deduped getRate asks each key once", async () => {
  const H = require("../public/finance-helpers");
  const recs = [
    { id: "r1", amount: 1000, currency: "THB", date: "2026-01-01" },
    { id: "r2", amount: 1000, currency: "THB", date: "2026-02-01" },
    { id: "r3", amount: 500, currency: "THB", date: TODAY },
  ];
  const ds = [debt({ id: "d1", amount: 1000, date: "2026-01-01" })];
  const calls = [];
  const getRate = H.dedupeGetRate(rateFn({
    ["2026-01-01:THB:USD"]: 0.03, ["2026-02-01:THB:USD"]: 0.031, [TODAY + ":THB:USD"]: 0.0295,
  }, calls));
  const [rp, dp] = await Promise.all([
    H.planReconversion(recs, "USD", { getRate, today: TODAY }),
    D.planDebtReconversion(ds, "USD", { getRate, today: TODAY }),
  ]);
  assert.deepEqual(rp.updates.map((u) => u.fields.convertedAmount), [30, 31, 14.75]);
  assert.deepEqual(rp.updates.map((u) => u.fields.rateDate), ["2026-01-01", "2026-02-01", TODAY]);
  assert.equal(dp.updates[0].fields.convertedAmount, 29.5); // today's rate, not January's 0.03
  assert.equal(calls.length, 3); // today's THB:USD shared by r3 and the debt
});
