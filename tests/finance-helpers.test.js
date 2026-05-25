const { test, assert } = require("./_lib");
const H = require("../public/finance-helpers");

/* ============================================================ */
/* reconcileRenames                                              */
/* ============================================================ */

function settings(cats) {
  return { expense: cats.expense || [], investment: cats.investment || [] };
}

test("reconcileRenames: renames category on all matching records (by id)", () => {
  const oldS = settings({ expense: [{ id: "c1", name: "Food", subs: [] }] });
  const newS = settings({ expense: [{ id: "c1", name: "Food & Dining", subs: [] }] });
  const records = [
    { id: "r1", type: "expense", category: "Food", subcategory: "" },
    { id: "r2", type: "expense", category: "Food", subcategory: "Coffee" },
    { id: "r3", type: "investment", category: "Food", subcategory: "" }, // different type — untouched
  ];
  H.reconcileRenames(oldS, newS, records);
  assert.equal(records[0].category, "Food & Dining");
  assert.equal(records[1].category, "Food & Dining");
  assert.equal(records[2].category, "Food"); // investment row untouched
});

test("reconcileRenames: renames subcategory under the (already-renamed) category", () => {
  const oldS = settings({
    expense: [{ id: "c1", name: "Food", subs: [{ id: "s1", name: "Coffee" }] }],
  });
  const newS = settings({
    expense: [{ id: "c1", name: "Food & Dining", subs: [{ id: "s1", name: "Cafe" }] }],
  });
  const records = [
    { id: "r1", type: "expense", category: "Food", subcategory: "Coffee" },
    { id: "r2", type: "expense", category: "Food", subcategory: "Lunch" },
  ];
  H.reconcileRenames(oldS, newS, records);
  assert.equal(records[0].category, "Food & Dining");
  assert.equal(records[0].subcategory, "Cafe");
  assert.equal(records[1].category, "Food & Dining");
  assert.equal(records[1].subcategory, "Lunch"); // unmatched sub stays
});

test("reconcileRenames: no-op when names unchanged", () => {
  const oldS = settings({ expense: [{ id: "c1", name: "Food", subs: [] }] });
  const newS = settings({ expense: [{ id: "c1", name: "Food", subs: [] }] });
  const records = [{ id: "r1", type: "expense", category: "Food", subcategory: "" }];
  H.reconcileRenames(oldS, newS, records);
  assert.equal(records[0].category, "Food");
});

test("reconcileRenames: ignores new category that has no matching id in old", () => {
  const oldS = settings({ expense: [] });
  const newS = settings({ expense: [{ id: "c1", name: "Food", subs: [] }] });
  const records = [{ id: "r1", type: "expense", category: "WasFood", subcategory: "" }];
  H.reconcileRenames(oldS, newS, records);
  assert.equal(records[0].category, "WasFood"); // unchanged
});

test("reconcileRenames: returns silently when records is not an array", () => {
  const oldS = settings({ expense: [{ id: "c1", name: "A", subs: [] }] });
  const newS = settings({ expense: [{ id: "c1", name: "B", subs: [] }] });
  // Should not throw on null/undefined records.
  H.reconcileRenames(oldS, newS, null);
  H.reconcileRenames(oldS, newS, undefined);
});

test("reconcileRenames: handles both expense and investment in one pass", () => {
  const oldS = {
    expense: [{ id: "c1", name: "Food", subs: [] }],
    investment: [{ id: "i1", name: "Stocks", subs: [] }],
  };
  const newS = {
    expense: [{ id: "c1", name: "Dining", subs: [] }],
    investment: [{ id: "i1", name: "Equities", subs: [] }],
  };
  const records = [
    { type: "expense", category: "Food", subcategory: "" },
    { type: "investment", category: "Stocks", subcategory: "" },
  ];
  H.reconcileRenames(oldS, newS, records);
  assert.equal(records[0].category, "Dining");
  assert.equal(records[1].category, "Equities");
});


/* ============================================================ */
/* makeRateService — getRate + caching                          */
/* ============================================================ */

function mockStorage(initial) {
  let store = initial ? { ...initial } : {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    _inspect: () => store,
  };
}
function mockFetchOk(rate, to) {
  return async () => ({ ok: true, json: async () => ({ rates: { [to]: rate } }) });
}
function mockFetchFail() {
  return async () => ({ ok: false, json: async () => ({}) });
}
function mockFetchNetworkError() {
  return async () => { throw new Error("network down"); };
}
function fixedNow(yyyy_mm_dd) {
  const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
  return () => new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
const CONVERTIBLE = new Set(["THB","USD","EUR","GBP","JPY"]);
const isConvertible = (c) => CONVERTIBLE.has(c);

test("getRate: same currency returns 1 without calling fetch", async () => {
  let calls = 0;
  const svc = H.makeRateService({
    fetch: async () => { calls++; return { ok: true, json: async () => ({}) }; },
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  assert.equal(await svc.getRate("THB", "THB", "2026-05-21"), 1);
  assert.equal(calls, 0);
});

test("getRate: fetches and returns rate on success", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(0.027, "USD"),
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  const r = await svc.getRate("THB", "USD", "2026-05-21");
  assert.equal(r, 0.027);
});

test("getRate: second call for same date+pair hits cache, not network", async () => {
  let calls = 0;
  const svc = H.makeRateService({
    fetch: async (url) => {
      calls++;
      return { ok: true, json: async () => ({ rates: { USD: 0.027 } }) };
    },
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  await svc.getRate("THB", "USD", "2026-05-21");
  await svc.getRate("THB", "USD", "2026-05-21");
  await svc.getRate("THB", "USD", "2026-05-21");
  assert.equal(calls, 1);
});

test("getRate: cache persists into storage", async () => {
  const storage = mockStorage();
  const svc = H.makeRateService({
    fetch: mockFetchOk(0.5, "EUR"),
    storage, isConvertible, now: fixedNow("2026-05-21"),
  });
  await svc.getRate("GBP", "EUR", "2026-05-21");
  const persisted = JSON.parse(storage._inspect().fin_rates);
  assert.equal(persisted["2026-05-21:GBP:EUR"], 0.5);
});

test("getRate: rehydrates cache from storage on construction", async () => {
  const storage = mockStorage({
    fin_rates: JSON.stringify({ "2026-05-21:THB:USD": 0.027 }),
  });
  let calls = 0;
  const svc = H.makeRateService({
    fetch: async () => { calls++; return { ok: true, json: async () => ({}) }; },
    storage, isConvertible, now: fixedNow("2026-05-21"),
  });
  const r = await svc.getRate("THB", "USD", "2026-05-21");
  assert.equal(r, 0.027);
  assert.equal(calls, 0); // pure cache hit
});

test("getRate: future date clamps to today", async () => {
  let seenUrl = "";
  const svc = H.makeRateService({
    fetch: async (url) => { seenUrl = url; return { ok: true, json: async () => ({ rates: { USD: 0.027 } }) }; },
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  await svc.getRate("THB", "USD", "2099-01-01"); // future
  assert.ok(seenUrl.includes("/2026-05-21"), "future date should be clamped to today; got " + seenUrl);
});

test("getRate: returns null on HTTP non-200", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchFail(),
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  assert.equal(await svc.getRate("THB", "USD", "2026-05-21"), null);
});

test("getRate: returns null on network error", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchNetworkError(),
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  assert.equal(await svc.getRate("THB", "USD", "2026-05-21"), null);
});

test("getRate: failed fetch does NOT poison cache", async () => {
  let attempt = 0;
  const svc = H.makeRateService({
    fetch: async () => {
      attempt++;
      if (attempt === 1) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ rates: { USD: 0.027 } }) };
    },
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  const first = await svc.getRate("THB", "USD", "2026-05-21");
  assert.equal(first, null);
  // Retry — should hit network again (cache wasn't poisoned with null)
  const second = await svc.getRate("THB", "USD", "2026-05-21");
  assert.equal(second, 0.027);
});


/* ============================================================ */
/* attachConversion                                              */
/* ============================================================ */

test("attachConversion: same-currency record gets no FX fields", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(0.027, "USD"),
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 100, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(r, null, "THB");
  assert.equal(r.convertedAmount, undefined);
  assert.equal(r.rate, undefined);
  assert.equal(r.rateUnavailable, undefined);
});

test("attachConversion: convertible pair fills converted fields", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(0.027, "USD"),
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 1000, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(r, null, "USD");
  assert.equal(r.convertedCurrency, "USD");
  assert.equal(r.convertedAmount, 27); // 1000 * 0.027 = 27
  assert.equal(r.rate, 0.027);
  assert.equal(r.rateDate, "2026-05-21");
  assert.equal(r.rateUnavailable, undefined);
  assert.equal(r.manualRate, undefined);
});

test("attachConversion: rounds converted amount to 2 decimals", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(0.0271234, "USD"),
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 1234.56, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(r, null, "USD");
  // 1234.56 * 0.0271234 = 33.4854647... -> 33.49 (banker-style round-half-up via Math.round)
  assert.equal(r.convertedAmount, 33.49);
});

test("attachConversion: convertible pair but FX unreachable -> rateUnavailable", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchNetworkError(),
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 1000, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(r, null, "USD");
  assert.equal(r.rateUnavailable, true);
  assert.equal(r.convertedAmount, undefined);
});

test("attachConversion: non-convertible pair without manualRate -> rateUnavailable", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(1, "USD"),
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  // "ABC" is not in CONVERTIBLE set
  const r = { amount: 100, currency: "ABC", date: "2026-05-21" };
  await svc.attachConversion(r, null, "USD");
  assert.equal(r.rateUnavailable, true);
});

test("attachConversion: non-convertible pair WITH manualRate uses it and flags manualRate=true", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(999, "USD"), // would-be-wrong if mistakenly fetched
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 100, currency: "ABC", date: "2026-05-21" };
  await svc.attachConversion(r, 0.5, "USD");
  assert.equal(r.convertedAmount, 50);
  assert.equal(r.rate, 0.5);
  assert.equal(r.convertedCurrency, "USD");
  assert.equal(r.manualRate, true);
  assert.equal(r.rateUnavailable, undefined);
});

test("attachConversion: clears any prior FX fields before re-attaching", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(0.027, "USD"),
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  const r = {
    amount: 1000, currency: "THB", date: "2026-05-21",
    // stale fields from a prior conversion:
    convertedAmount: 999, convertedCurrency: "EUR", rate: 9.99,
    rateDate: "2020-01-01", rateUnavailable: true, manualRate: true,
  };
  await svc.attachConversion(r, null, "USD");
  assert.equal(r.convertedAmount, 27);
  assert.equal(r.convertedCurrency, "USD");
  assert.equal(r.rate, 0.027);
  assert.equal(r.rateUnavailable, undefined);
  assert.equal(r.manualRate, undefined);
});

test("attachConversion: missing date falls back to 'today' from injected clock", async () => {
  let seenUrl = "";
  const svc = H.makeRateService({
    fetch: async (url) => { seenUrl = url; return { ok: true, json: async () => ({ rates: { USD: 0.027 } }) }; },
    storage: mockStorage(), isConvertible, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 100, currency: "THB" /* no date */ };
  await svc.attachConversion(r, null, "USD");
  assert.ok(seenUrl.includes("/2026-05-21"), "should request today when record has no date; got " + seenUrl);
  assert.equal(r.rateDate, "2026-05-21");
});
