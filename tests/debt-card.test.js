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

test("debtCardModel: Thai repayment sentences name both sides", () => {
  const back = model({
    debt: { type: "paid-back", amount: 100, currency: "THB", date: "2026-07-21" },
    language: "th",
  });
  assert.equal(back.tagSentence, "Boat คืนเงินให้ Bill");
  const pay = model({
    debt: { type: "pay-back", amount: 100, currency: "THB", date: "2026-07-21" },
    language: "th",
  });
  assert.equal(pay.tagSentence, "Bill คืนเงินให้ Boat");
  const borrow = model({
    debt: { type: "borrow", amount: 100, currency: "THB", date: "2026-07-21" },
    language: "th",
  });
  assert.equal(borrow.tagSentence, "Bill ยืมเงินจาก Boat");
});

test("debtCardModel: running balance uses the converted amount, not the raw one", () => {
  const m = model({
    debt: { type: "lend", amount: 450, currency: "USD", date: "2026-07-21",
            convertedAmount: 15750, convertedCurrency: "THB", rate: 35 },
    balanceBefore: 1000,
  });
  assert.equal(m.amountText, "450");
  assert.equal(m.currencyText, "USD");
  assert.equal(m.mathText, "1,000 + 15,750");
  assert.equal(m.totalText, "16,750");
  assert.equal(m.totalCurrency, "THB");
});

test("debtCardModel: money shows no decimals when whole, exactly two when not", () => {
  assert.equal(model({ debt: { type: "lend", amount: 450, currency: "THB", date: "2026-07-21" } }).amountText, "450");
  assert.equal(model({ debt: { type: "lend", amount: 1234567.89, currency: "THB", date: "2026-07-21" } }).amountText, "1,234,567.89");
  // A trailing-zero cent must survive — "11,111,111.1" would be wrong.
  const m = model({
    debt: { type: "lend", amount: 1234567.89, currency: "THB", date: "2026-07-21" },
    balanceBefore: 9876543.21,
  });
  assert.equal(m.totalText, "11,111,111.10");
  assert.equal(m.mathText, "9,876,543.21 + 1,234,567.89");
});

function stmt(o) {
  return C.statementModel(Object.assign({
    debts: [],
    personName: "Boat",
    userName: "Bill",
    defaultCurrency: "THB",
    balanceAfter: 0,
    language: "en",
  }, o));
}

test("statementModel: rows come out oldest-first (date, then createdAt for same-day ties)", () => {
  const m = stmt({
    debts: [
      { type: "lend", amount: 100, currency: "THB", date: "2026-09-10", createdAt: 3 },
      { type: "lend", amount: 50, currency: "THB", date: "2026-09-05", createdAt: 2 },
      { type: "lend", amount: 20, currency: "THB", date: "2026-09-05", createdAt: 1 },
    ],
  });
  assert.deepEqual(m.rows.map((r) => r.amountText), ["20", "50", "100"]);
});

test("statementModel: EN kindText for all four types", () => {
  const types = ["lend", "paid-back", "borrow", "pay-back"];
  const m = stmt({
    debts: types.map((type, i) => ({ type, amount: 10, currency: "THB", date: "2026-09-0" + (i + 1) })),
  });
  assert.deepEqual(m.rows.map((r) => r.kindText), [
    "Boat borrowed", "Boat paid back", "Bill borrowed", "Bill paid back",
  ]);
});

test("statementModel: TH kindText for all four types", () => {
  const types = ["lend", "paid-back", "borrow", "pay-back"];
  const m = stmt({
    language: "th",
    debts: types.map((type, i) => ({ type, amount: 10, currency: "THB", date: "2026-09-0" + (i + 1) })),
  });
  assert.deepEqual(m.rows.map((r) => r.kindText), [
    "Boat ยืม", "Boat คืน", "Bill ยืม", "Bill คืน",
  ]);
});

test("statementModel: EN row date and the four rangeText shapes", () => {
  assert.equal(
    stmt({ debts: [{ type: "lend", amount: 10, currency: "THB", date: "2026-09-07" }] }).rows[0].dateText,
    "7 Sep"
  );

  // same day
  assert.equal(
    stmt({ debts: [{ type: "lend", amount: 10, currency: "THB", date: "2026-09-22" }] }).rangeText,
    "22 Sep 2026"
  );

  // same month + year
  assert.equal(
    stmt({ debts: [
      { type: "lend", amount: 10, currency: "THB", date: "2026-09-07" },
      { type: "lend", amount: 10, currency: "THB", date: "2026-09-22" },
    ] }).rangeText,
    "7 – 22 Sep 2026"
  );

  // same year, different month
  assert.equal(
    stmt({ debts: [
      { type: "lend", amount: 10, currency: "THB", date: "2026-08-28" },
      { type: "lend", amount: 10, currency: "THB", date: "2026-09-22" },
    ] }).rangeText,
    "28 Aug – 22 Sep 2026"
  );

  // different years
  assert.equal(
    stmt({ debts: [
      { type: "lend", amount: 10, currency: "THB", date: "2025-12-28" },
      { type: "lend", amount: 10, currency: "THB", date: "2026-01-03" },
    ] }).rangeText,
    "28 Dec 2025 – 3 Jan 2026"
  );
});

test("statementModel: TH row date, same-month range, pill and countText", () => {
  const one = stmt({
    language: "th",
    debts: [{ type: "lend", amount: 10, currency: "THB", date: "2026-09-07" }],
  });
  assert.equal(one.rows[0].dateText, "7 ก.ย.");
  assert.equal(one.pill, "สรุปรายการ");

  const range = stmt({
    language: "th",
    debts: [
      { type: "lend", amount: 10, currency: "THB", date: "2026-09-07" },
      { type: "lend", amount: 10, currency: "THB", date: "2026-09-22" },
    ],
  });
  assert.equal(range.rangeText, "7 – 22 ก.ย. 2026");

  const seven = stmt({
    language: "th",
    debts: Array.from({ length: 7 }, (_, i) => ({
      type: "lend", amount: 10, currency: "THB", date: "2026-09-0" + (i + 1),
    })),
  });
  assert.equal(seven.countText, "7 รายการ");
});

test("statementModel: subtotal appears only when every row shares a direction", () => {
  const allLend = stmt({
    debts: [
      { type: "lend", amount: 100, currency: "THB", date: "2026-09-01" },
      { type: "lend", amount: 50, currency: "THB", date: "2026-09-02" },
    ],
  });
  assert.equal(allLend.subtotalText, "150");
  assert.equal(allLend.subtotalLabel, "Total of 2 records");

  const mixed = stmt({
    debts: [
      { type: "lend", amount: 100, currency: "THB", date: "2026-09-01" },
      { type: "paid-back", amount: 50, currency: "THB", date: "2026-09-02" },
    ],
  });
  assert.equal(mixed.subtotalText, null);
  assert.equal(mixed.subtotalLabel, null);
});

test("statementModel: approved mock — seven lends, previous math and total", () => {
  const m = stmt({
    debts: Array.from({ length: 7 }, (_, i) => ({
      type: "lend", amount: 255.1, currency: "THB", date: "2026-09-0" + (i + 1),
    })),
    balanceAfter: 5073.32,
  });
  assert.equal(m.mathText, "3,287.62 + 1,785.70");
  assert.equal(m.totalText, "5,073.32");
  assert.equal(m.subtotalText, "1,785.70");
});

test("statementModel: fresh cycle (previous 0) has no math line", () => {
  const m = stmt({
    debts: [
      { type: "lend", amount: 100, currency: "THB", date: "2026-09-01" },
      { type: "lend", amount: 100, currency: "THB", date: "2026-09-02" },
    ],
    balanceAfter: 200,
  });
  assert.equal(m.mathText, null);
  assert.equal(m.totalText, "200");
});

test("statementModel: math line subtracts when the balance shrinks", () => {
  const m = stmt({
    debts: [{ type: "paid-back", amount: 200, currency: "THB", date: "2026-09-01" }],
    balanceAfter: 300,
  });
  assert.equal(m.mathText, "500 − 200");
});

test("statementModel: crossing zero inside the selection suppresses the math line", () => {
  const m = stmt({
    debts: [{ type: "paid-back", amount: 300, currency: "THB", date: "2026-09-01" }],
    balanceAfter: -200,
  });
  assert.equal(m.mathText, null);
  assert.equal(m.totalText, "200");
});

test("statementModel: settled cycle shows the closing math and isSettled", () => {
  const m = stmt({
    debts: [{ type: "paid-back", amount: 500, currency: "THB", date: "2026-09-01" }],
    balanceAfter: 0,
  });
  assert.equal(m.isSettled, true);
  assert.equal(m.mathText, "500 − 500");
  assert.equal(m.totalText, "0");
});

test("statementModel: a converted record contributes its converted amount to the row and the net", () => {
  const m = stmt({
    debts: [{
      type: "lend", amount: 450, currency: "USD", date: "2026-09-01",
      convertedAmount: 15750, convertedCurrency: "THB",
    }],
    balanceAfter: 15750,
  });
  assert.equal(m.rows[0].amountText, "15,750");
  assert.equal(m.subtotalText, "15,750");
});
