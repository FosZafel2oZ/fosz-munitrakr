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
