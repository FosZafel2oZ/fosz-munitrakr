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
  const b = D.personBalances([], {});
  assert.equal(b.size, 0);
});

test("personBalances: single lend -> they-owe with 0 progress", () => {
  const b = D.personBalances([debt({ type: "lend", amount: 100, personId: "p1" })]);
  const row = b.get("p1");
  assert.equal(row.lent, 100);
  assert.equal(row.back, 0);
  assert.equal(row.outstanding, 100);
  assert.equal(row.direction, "they-owe");
  assert.equal(row.progress, 0);
});

test("personBalances: single borrow -> i-owe with 0 progress", () => {
  const b = D.personBalances([debt({ type: "borrow", amount: 50, personId: "p2" })]);
  const row = b.get("p2");
  assert.equal(row.outstanding, -50);
  assert.equal(row.direction, "i-owe");
  assert.equal(row.progress, 0);
});

test("personBalances: partial repayment -> progress correct", () => {
  const b = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),
    debt({ type: "borrow", amount: 30,  personId: "p1" }),
  ]);
  const row = b.get("p1");
  assert.equal(row.outstanding, 70);
  assert.equal(row.direction, "they-owe");
  assert.equal(row.progress, 0.3);
});

test("personBalances: full repayment -> clear, progress 1", () => {
  const b = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),
    debt({ type: "borrow", amount: 100, personId: "p1" }),
  ]);
  const row = b.get("p1");
  assert.equal(row.outstanding, 0);
  assert.equal(row.direction, "clear");
  assert.equal(row.progress, 1);
});

test("personBalances: uses convertedAmount when present", () => {
  const b = D.personBalances([
    debt({ type: "lend", amount: 1000, currency: "THB", convertedAmount: 27, convertedCurrency: "USD", personId: "p1" }),
  ]);
  assert.equal(b.get("p1").outstanding, 27);
});

test("personBalances: ignores debts whose person was deleted (when peopleById given)", () => {
  const b = D.personBalances(
    [debt({ personId: "ghost" })],
    { p1: {} }
  );
  assert.equal(b.size, 0);
});

test("personBalances: keeps debts when peopleById not provided", () => {
  const b = D.personBalances([debt({ personId: "anyone" })]);
  assert.equal(b.size, 1);
});

test("personBalances: multiple people independent", () => {
  const b = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),
    debt({ type: "lend",   amount: 200, personId: "p2" }),
    debt({ type: "borrow", amount: 80,  personId: "p2" }),
  ]);
  assert.equal(b.get("p1").outstanding, 100);
  assert.equal(b.get("p2").outstanding, 120);
});

test("totalsAcrossPeople: sums by direction, ignores clear", () => {
  const balances = D.personBalances([
    debt({ type: "lend",   amount: 100, personId: "p1" }),   // they-owe 100
    debt({ type: "lend",   amount: 200, personId: "p2" }),   // they-owe 200
    debt({ type: "borrow", amount: 200, personId: "p2" }),   // clear
    debt({ type: "borrow", amount: 50,  personId: "p3" }),   // i-owe 50
  ]);
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
  ]);
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
  ]);
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
  ]);
  const b2 = D.personBalances([
    debt({ type: "lend",      amount: 100, personId: "p1" }),
    debt({ type: "paid-back", amount: 30,  personId: "p1" }),
  ]);
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
  ]);
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
  const ann = D.annotateSettlements(debts);
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
  const ann = D.annotateSettlements(debts);
  assert.equal(ann.get("d2").settled, true);
});

test("annotateSettlements: a single-record net-zero does NOT count as settled (no prior cycle)", () => {
  // If the very first record is amount 0, it didn't close anything.
  const debts = [
    debt({ id: "d1", type: "lend", amount: 0, personId: "p1", date: "2026-01-01", createdAt: 1 }),
  ];
  const ann = D.annotateSettlements(debts);
  assert.equal(ann.get("d1").settled, false);
});

test("annotateSettlements: each cycle's closer gets its own flag", () => {
  const debts = [
    debt({ id: "d1", type: "lend",      amount: 50, personId: "p1", date: "2026-01-01", createdAt: 1 }),
    debt({ id: "d2", type: "paid-back", amount: 50, personId: "p1", date: "2026-01-10", createdAt: 2 }), // closes
    debt({ id: "d3", type: "lend",      amount: 30, personId: "p1", date: "2026-02-01", createdAt: 3 }),
    debt({ id: "d4", type: "paid-back", amount: 30, personId: "p1", date: "2026-02-10", createdAt: 4 }), // closes
  ];
  const ann = D.annotateSettlements(debts);
  assert.equal(ann.get("d1").settled, false);
  assert.equal(ann.get("d2").settled, true);
  assert.equal(ann.get("d3").settled, false);
  assert.equal(ann.get("d4").settled, true);
});

// --- balanceBefore ---

test("balanceBefore: returns 0 for first record of a person", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
  ];
  const peopleById = { p1: { id: "p1" } };
  assert.equal(D.balanceBefore(debts, "a", peopleById), 0);
});

test("balanceBefore: returns running outstanding before the named record", () => {
  const debts = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 200 },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount:  50 },
    { id: "c", type: "lend",      personId: "p1", date: "2026-01-10", createdAt: 3, amount: 100 },
  ];
  const peopleById = { p1: { id: "p1" } };
  // Before "c": 200 lent - 50 paid back = 150 outstanding.
  assert.equal(D.balanceBefore(debts, "c", peopleById), 150);
});

test("balanceBefore: respects cycle reset", () => {
  const debts = [
    { id: "a", type: "lend",      personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
    { id: "b", type: "paid-back", personId: "p1", date: "2026-01-05", createdAt: 2, amount: 100 },
    { id: "c", type: "lend",      personId: "p1", date: "2026-01-10", createdAt: 3, amount:  80 },
  ];
  const peopleById = { p1: { id: "p1" } };
  // Before "c": cycle reset by "b", so 0.
  assert.equal(D.balanceBefore(debts, "c", peopleById), 0);
});

test("balanceBefore: uses convertedAmount when present", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1,
      amount: 10, currency: "USD", convertedAmount: 360, convertedCurrency: "THB" },
    { id: "b", type: "lend", personId: "p1", date: "2026-01-02", createdAt: 2,
      amount: 5,  currency: "USD", convertedAmount: 180, convertedCurrency: "THB" },
  ];
  const peopleById = { p1: { id: "p1" } };
  assert.equal(D.balanceBefore(debts, "b", peopleById), 360);
});

test("balanceBefore: ignores records for other people", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
    { id: "x", type: "lend", personId: "p2", date: "2026-01-02", createdAt: 2, amount: 999 },
    { id: "b", type: "lend", personId: "p1", date: "2026-01-03", createdAt: 3, amount:  50 },
  ];
  const peopleById = { p1: { id: "p1" }, p2: { id: "p2" } };
  assert.equal(D.balanceBefore(debts, "b", peopleById), 100);
});

test("balanceBefore: returns 0 when record id not found", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
  ];
  assert.equal(D.balanceBefore(debts, "missing", { p1: { id: "p1" } }), 0);
});

test("balanceBefore: returns 0 when person is not in peopleById (deleted)", () => {
  const debts = [
    { id: "a", type: "lend", personId: "p1", date: "2026-01-01", createdAt: 1, amount: 100 },
    { id: "b", type: "lend", personId: "p1", date: "2026-01-02", createdAt: 2, amount:  50 },
  ];
  // p1 omitted from peopleById -> treated as deleted, returns 0.
  assert.equal(D.balanceBefore(debts, "b", {}), 0);
});

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
