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
// Frankfurter-shaped response: { rates: { USD: 0.027 } }
function mockFetchOk(rate, to) {
  return async () => ({ ok: true, json: async () => ({ rates: { [to]: rate } }) });
}
function mockFetchFail() {
  return async () => ({ ok: false, json: async () => ({}) });
}
function mockFetchNetworkError() {
  return async () => { throw new Error("network down"); };
}
// currency-api-shaped response: { date, vnd: { thb: 0.00125 } }
function mockFetchCurrencyApi(from, to, rate) {
  return async () => ({
    ok: true,
    json: async () => ({ date: "2026-05-21", [from]: { [to]: rate } }),
  });
}
function fixedNow(yyyy_mm_dd) {
  const [y, m, d] = yyyy_mm_dd.split("-").map(Number);
  return () => new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
const ECB = new Set(["THB","USD","EUR","GBP","JPY"]);
const isEcb = (c) => ECB.has(c);

test("getRate: same currency returns 1 without calling fetch", async () => {
  let calls = 0;
  const svc = H.makeRateService({
    fetch: async () => { calls++; return { ok: true, json: async () => ({}) }; },
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  assert.equal(await svc.getRate("THB", "THB", "2026-05-21"), 1);
  assert.equal(calls, 0);
});

test("getRate: ECB pair fetches the Frankfurter URL", async () => {
  let seenUrl = "";
  const svc = H.makeRateService({
    fetch: async (url) => { seenUrl = url; return { ok: true, json: async () => ({ rates: { USD: 0.027 } }) }; },
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = await svc.getRate("THB", "USD", "2026-05-21");
  assert.equal(r, 0.027);
  assert.ok(seenUrl.startsWith("https://api.frankfurter.dev/"), "expected Frankfurter, got " + seenUrl);
});

test("getRate: non-ECB pair fetches currency-api with lowercase codes + @latest for today", async () => {
  let seenUrl = "";
  const svc = H.makeRateService({
    fetch: async (url) => { seenUrl = url; return { ok: true, json: async () => ({ date: "2026-05-21", vnd: { thb: 0.00125 } }) }; },
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = await svc.getRate("VND", "THB", "2026-05-21");
  assert.equal(r, 0.00125);
  assert.ok(
    seenUrl === "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/vnd.json",
    "unexpected URL: " + seenUrl
  );
});

test("getRate: non-ECB pair with a PAST date uses the dated tag", async () => {
  let seenUrl = "";
  const svc = H.makeRateService({
    fetch: async (url) => { seenUrl = url; return { ok: true, json: async () => ({ date: "2026-05-01", vnd: { thb: 0.00120 } }) }; },
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = await svc.getRate("VND", "THB", "2026-05-01");
  assert.equal(r, 0.0012);
  assert.ok(seenUrl.includes("currency-api@2026-05-01/"), "expected dated tag, got " + seenUrl);
});

test("getRate: currency-api falls back to the pages.dev mirror when jsDelivr fails", async () => {
  const seen = [];
  const svc = H.makeRateService({
    fetch: async (url) => {
      seen.push(url);
      if (url.includes("jsdelivr")) throw new Error("cdn down");
      return { ok: true, json: async () => ({ date: "2026-05-21", lak: { thb: 0.0015 } }) };
    },
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = await svc.getRate("LAK", "THB", "2026-05-21");
  assert.equal(r, 0.0015);
  assert.equal(seen.length, 2);
  assert.ok(seen[1] === "https://latest.currency-api.pages.dev/v1/currencies/lak.json",
    "expected mirror, got " + seen[1]);
});

test("getRate: both currency-api hosts failing -> null", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchNetworkError(),
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  assert.equal(await svc.getRate("VND", "THB", "2026-05-21"), null);
});

test("getRate: currency-api payload missing the target code -> null", async () => {
  const svc = H.makeRateService({
    fetch: async () => ({ ok: true, json: async () => ({ date: "2026-05-21", vnd: { usd: 0.00004 } }) }),
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  assert.equal(await svc.getRate("VND", "THB", "2026-05-21"), null);
});

test("getRate: mixed pair (one ECB, one not) uses currency-api, not Frankfurter", async () => {
  let seenUrl = "";
  const svc = H.makeRateService({
    fetch: async (url) => { seenUrl = url; return { ok: true, json: async () => ({ date: "2026-05-21", twd: { thb: 1.04 } }) }; },
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = await svc.getRate("TWD", "THB", "2026-05-21"); // THB is ECB, TWD is not
  assert.equal(r, 1.04);
  assert.ok(seenUrl.includes("currency-api"), "expected currency-api, got " + seenUrl);
});

test("getRate: second call for same date+pair hits cache, not network", async () => {
  let calls = 0;
  const svc = H.makeRateService({
    fetch: async () => { calls++; return { ok: true, json: async () => ({ rates: { USD: 0.027 } }) }; },
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
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
    storage, isEcb, now: fixedNow("2026-05-21"),
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
    storage, isEcb, now: fixedNow("2026-05-21"),
  });
  const r = await svc.getRate("THB", "USD", "2026-05-21");
  assert.equal(r, 0.027);
  assert.equal(calls, 0); // pure cache hit
});

test("getRate: future date clamps to today", async () => {
  let seenUrl = "";
  const svc = H.makeRateService({
    fetch: async (url) => { seenUrl = url; return { ok: true, json: async () => ({ rates: { USD: 0.027 } }) }; },
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  await svc.getRate("THB", "USD", "2099-01-01"); // future
  assert.ok(seenUrl.includes("/2026-05-21"), "future date should be clamped to today; got " + seenUrl);
});

test("getRate: returns null on HTTP non-200 (ECB pair)", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchFail(),
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  assert.equal(await svc.getRate("THB", "USD", "2026-05-21"), null);
});

test("getRate: returns null on network error (ECB pair)", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchNetworkError(),
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
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
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const first = await svc.getRate("THB", "USD", "2026-05-21");
  assert.equal(first, null);
  const second = await svc.getRate("THB", "USD", "2026-05-21");
  assert.equal(second, 0.027);
});


/* ============================================================ */
/* attachConversion                                              */
/* ============================================================ */

test("attachConversion: same-currency record gets no FX fields", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(0.027, "USD"),
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 100, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(r, null, "THB");
  assert.equal(r.convertedAmount, undefined);
  assert.equal(r.rate, undefined);
  assert.equal(r.rateUnavailable, undefined);
});

test("attachConversion: ECB pair fills converted fields", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(0.027, "USD"),
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 1000, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(r, null, "USD");
  assert.equal(r.convertedCurrency, "USD");
  assert.equal(r.convertedAmount, 27);
  assert.equal(r.rate, 0.027);
  assert.equal(r.rateDate, "2026-05-21");
  assert.equal(r.rateUnavailable, undefined);
  assert.equal(r.manualRate, undefined);
  assert.equal(r.fxMarkupPct, undefined);
});

test("attachConversion: non-ECB currency converts via currency-api", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchCurrencyApi("vnd", "thb", 0.00125),
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 800000, currency: "VND", date: "2026-05-21" };
  await svc.attachConversion(r, null, "THB");
  assert.equal(r.convertedCurrency, "THB");
  assert.equal(r.convertedAmount, 1000); // 800000 * 0.00125
  assert.equal(r.rate, 0.00125);
});

test("attachConversion: rounds converted amount to 2 decimals", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(0.0271234, "USD"),
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 1234.56, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(r, null, "USD");
  assert.equal(r.convertedAmount, 33.49);
});

test("attachConversion: FX unreachable -> rateUnavailable", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchNetworkError(),
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 1000, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(r, null, "USD");
  assert.equal(r.rateUnavailable, true);
  assert.equal(r.convertedAmount, undefined);
});

test("attachConversion: manual rate wins, skips fetch, never gets markup", async () => {
  let calls = 0;
  const svc = H.makeRateService({
    fetch: async () => { calls++; return { ok: true, json: async () => ({ rates: { USD: 999 } }) }; },
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 100, currency: "ABC", date: "2026-05-21" };
  await svc.attachConversion(r, 0.5, "USD", 2.5); // markup present but must be ignored
  assert.equal(calls, 0);
  assert.equal(r.convertedAmount, 50);
  assert.equal(r.rate, 0.5);
  assert.equal(r.convertedCurrency, "USD");
  assert.equal(r.manualRate, true);
  assert.equal(r.fxMarkupPct, undefined);
  assert.equal(r.rateUnavailable, undefined);
});

test("attachConversion: markup applied on top of fetched rate", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(0.027, "USD"),
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 1000, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(r, null, "USD", 2.5);
  // effective = 0.027 * 1.025 = 0.027675 -> 1000 * 0.027675 = 27.675 -> 27.68
  assert.equal(r.rate, 0.027675);
  assert.equal(r.convertedAmount, 27.68);
  assert.equal(r.fxMarkupPct, 2.5);
});

test("attachConversion: markup 0 / undefined adds no fxMarkupPct field", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(0.027, "USD"),
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const a = { amount: 100, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(a, null, "USD", 0);
  assert.equal(a.fxMarkupPct, undefined);
  assert.equal(a.rate, 0.027);
  const b = { amount: 100, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(b, null, "USD");
  assert.equal(b.fxMarkupPct, undefined);
});

test("attachConversion: cache stores the BASE rate, markup applied per-attach", async () => {
  let calls = 0;
  const svc = H.makeRateService({
    fetch: async () => { calls++; return { ok: true, json: async () => ({ rates: { USD: 0.027 } }) }; },
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const a = { amount: 1000, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(a, null, "USD", 2.5);
  const b = { amount: 1000, currency: "THB", date: "2026-05-21" };
  await svc.attachConversion(b, null, "USD", 0);
  assert.equal(calls, 1);            // one fetch, cached base reused
  assert.equal(a.rate, 0.027675);    // with markup
  assert.equal(b.rate, 0.027);       // without
});

test("attachConversion: clears any prior FX fields (incl. fxMarkupPct) before re-attaching", async () => {
  const svc = H.makeRateService({
    fetch: mockFetchOk(0.027, "USD"),
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = {
    amount: 1000, currency: "THB", date: "2026-05-21",
    convertedAmount: 999, convertedCurrency: "EUR", rate: 9.99,
    rateDate: "2020-01-01", rateUnavailable: true, manualRate: true,
    fxMarkupPct: 9,
  };
  await svc.attachConversion(r, null, "USD");
  assert.equal(r.convertedAmount, 27);
  assert.equal(r.convertedCurrency, "USD");
  assert.equal(r.rate, 0.027);
  assert.equal(r.rateUnavailable, undefined);
  assert.equal(r.manualRate, undefined);
  assert.equal(r.fxMarkupPct, undefined);
});

test("attachConversion: missing date falls back to 'today' from injected clock", async () => {
  let seenUrl = "";
  const svc = H.makeRateService({
    fetch: async (url) => { seenUrl = url; return { ok: true, json: async () => ({ rates: { USD: 0.027 } }) }; },
    storage: mockStorage(), isEcb, now: fixedNow("2026-05-21"),
  });
  const r = { amount: 100, currency: "THB" /* no date */ };
  await svc.attachConversion(r, null, "USD");
  assert.ok(seenUrl.includes("/2026-05-21"), "should request today; got " + seenUrl);
  assert.equal(r.rateDate, "2026-05-21");
});


/* ============================================================ */
/* amountInDefault                                               */
/* ============================================================ */

test("amountInDefault: item's own currency matches default -> Number(amount)", () => {
  assert.equal(H.amountInDefault({ amount: "100", currency: "USD" }, "USD"), 100);
});
test("amountInDefault: converted to default -> Number(convertedAmount)", () => {
  const item = { amount: 1000, currency: "THB", convertedCurrency: "USD", convertedAmount: "27" };
  assert.equal(H.amountInDefault(item, "USD"), 27);
});
test("amountInDefault: converted to a DIFFERENT (stale) currency -> null", () => {
  const item = { amount: 1000, currency: "THB", convertedCurrency: "EUR", convertedAmount: 25 };
  assert.equal(H.amountInDefault(item, "USD"), null);
});
test("amountInDefault: rateUnavailable (no convertedAmount at all) -> null", () => {
  const item = { amount: 1000, currency: "THB", rateUnavailable: true };
  assert.equal(H.amountInDefault(item, "USD"), null);
});
test("amountInDefault: convertedAmount is null even though convertedCurrency matches -> null", () => {
  const item = { amount: 1000, currency: "THB", convertedCurrency: "USD", convertedAmount: null };
  assert.equal(H.amountInDefault(item, "USD"), null);
});
test("amountInDefault: null/non-object item -> null", () => {
  assert.equal(H.amountInDefault(null, "USD"), null);
  assert.equal(H.amountInDefault(undefined, "USD"), null);
  assert.equal(H.amountInDefault("x", "USD"), null);
});


/* ============================================================ */
/* countNotCounted                                               */
/* ============================================================ */

test("countNotCounted: counts only the not-counted items", () => {
  const items = [
    { amount: 100, currency: "USD" },                                              // counted
    { amount: 1000, currency: "THB", convertedCurrency: "USD", convertedAmount: 27 }, // counted
    { amount: 1000, currency: "THB", convertedCurrency: "EUR", convertedAmount: 25 }, // not counted (stale)
    { amount: 500, currency: "THB", rateUnavailable: true },                        // not counted
  ];
  assert.equal(H.countNotCounted(items, "USD"), 2);
});
test("countNotCounted: empty array -> 0", () => {
  assert.equal(H.countNotCounted([], "USD"), 0);
});
test("countNotCounted: non-array -> 0", () => {
  assert.equal(H.countNotCounted(null, "USD"), 0);
  assert.equal(H.countNotCounted(undefined, "USD"), 0);
});


/* ============================================================ */
/* applyMarkup                                                   */
/* ============================================================ */

test("applyMarkup: pct <= 0 returns base unchanged", () => {
  assert.equal(H.applyMarkup(0.027, 0), 0.027);
  assert.equal(H.applyMarkup(0.027, -5), 0.027);
});
test("applyMarkup: pct > 0 applies markup and strips binary-float noise", () => {
  assert.equal(H.applyMarkup(0.027, 2.5), 0.027675);
});


/* ============================================================ */
/* clearConversionFields                                         */
/* ============================================================ */

test("clearConversionFields: deletes all FX fields", () => {
  const item = {
    amount: 100, currency: "THB",
    convertedAmount: 3, convertedCurrency: "USD", rate: 0.03,
    rateDate: "2026-01-01", rateUnavailable: true, manualRate: true, fxMarkupPct: 5,
  };
  H.clearConversionFields(item);
  assert.equal(item.convertedAmount, undefined);
  assert.equal(item.convertedCurrency, undefined);
  assert.equal(item.rate, undefined);
  assert.equal(item.rateDate, undefined);
  assert.equal(item.rateUnavailable, undefined);
  assert.equal(item.manualRate, undefined);
  assert.equal(item.fxMarkupPct, undefined);
  // untouched fields survive
  assert.equal(item.amount, 100);
  assert.equal(item.currency, "THB");
});
test("clearConversionFields: no-op (no throw) when fields are already absent", () => {
  const item = { amount: 1, currency: "USD" };
  H.clearConversionFields(item);
  assert.equal(item.amount, 1);
});


/* ============================================================ */
/* planReconversion                                              */
/* ============================================================ */

function fakeGetRate(map, calls) {
  return async (from, to, date) => {
    if (calls) calls.push({ from, to, date });
    const key = `${date}:${from}:${to}`;
    if (map[key] === undefined) throw new Error("no rate configured for " + key);
    return map[key];
  };
}

test("planReconversion: ignores items already counted (in-default) and only touches not-counted", async () => {
  const items = [
    { id: 1, amount: 100, currency: "USD" }, // counted -> ignored
    { id: 2, amount: 1000, currency: "THB", date: "2026-05-01" }, // not counted
  ];
  const getRate = fakeGetRate({ "2026-05-01:THB:USD": 0.03 });
  const res = await H.planReconversion(items, "USD", { getRate, today: "2026-05-21" });
  assert.equal(res.ok, true);
  assert.equal(res.updates.length, 1);
  assert.equal(res.updates[0].item, items[1]); // original reference
  assert.equal(res.updates[0].fields.convertedAmount, 30);
  assert.equal(res.updates[0].fields.convertedCurrency, "USD");
  assert.equal(res.updates[0].fields.rate, 0.03);
  assert.equal(res.updates[0].fields.rateDate, "2026-05-01");
  assert.equal(res.updates[0].fields.fxMarkupPct, undefined);
});

test("planReconversion: a rateUnavailable (failed foreign) item uses opts.markupPct", async () => {
  const items = [{ id: 1, amount: 1000, currency: "THB", date: "2026-05-01", rateUnavailable: true }];
  const getRate = fakeGetRate({ "2026-05-01:THB:USD": 0.03 });
  const res = await H.planReconversion(items, "USD", { getRate, markupPct: 2.5, today: "2026-05-21" });
  assert.equal(res.ok, true);
  // effective = 0.03 * 1.025 = 0.03075 -> 1000 * 0.03075 = 30.75
  assert.equal(res.updates[0].fields.rate, 0.03075);
  assert.equal(res.updates[0].fields.convertedAmount, 30.75);
  assert.equal(res.updates[0].fields.fxMarkupPct, 2.5);
  assert.equal(res.updates[0].fields.rateUnavailable, undefined);
});

test("planReconversion: an item that was in the old default (never converted) gets NO markup", async () => {
  const items = [{ id: 1, amount: 1000, currency: "THB", date: "2026-05-01" }];
  const getRate = fakeGetRate({ "2026-05-01:THB:USD": 0.03 });
  const res = await H.planReconversion(items, "USD", { getRate, markupPct: 2.5, today: "2026-05-21" });
  assert.equal(res.ok, true);
  assert.equal(res.updates[0].fields.rate, 0.03);
  assert.equal(res.updates[0].fields.convertedAmount, 30);
  assert.equal(res.updates[0].fields.fxMarkupPct, undefined);
});

test("reconversionMarkupPct: own pct if converted before, setting only for rateUnavailable, else 0", () => {
  assert.equal(H.reconversionMarkupPct({ convertedAmount: 5, fxMarkupPct: 4 }, 9), 4);
  assert.equal(H.reconversionMarkupPct({ convertedAmount: 5 }, 9), 0);
  assert.equal(H.reconversionMarkupPct({ rateUnavailable: true }, 9), 9);
  assert.equal(H.reconversionMarkupPct({ rateUnavailable: true }, undefined), 0);
  assert.equal(H.reconversionMarkupPct({ amount: 1, currency: "THB" }, 9), 0);
  assert.equal(H.reconversionMarkupPct(null, 9), 0);
});

test("planReconversion: previously-converted (stale) item keeps its OWN stored fxMarkupPct, ignoring opts.markupPct", async () => {
  const items = [{
    id: 1, amount: 1000, currency: "THB", date: "2026-05-01",
    convertedCurrency: "EUR", convertedAmount: 25, fxMarkupPct: 4,
  }];
  const getRate = fakeGetRate({ "2026-05-01:THB:USD": 0.03 });
  const res = await H.planReconversion(items, "USD", { getRate, markupPct: 99, today: "2026-05-21" });
  assert.equal(res.ok, true);
  // effective = 0.03 * 1.04 = 0.0312 -> 1000 * 0.0312 = 31.2
  assert.equal(res.updates[0].fields.rate, 0.0312);
  assert.equal(res.updates[0].fields.convertedAmount, 31.2);
  assert.equal(res.updates[0].fields.fxMarkupPct, 4);
});

test("planReconversion: previously-converted item with no markup on record -> pct 0, no fxMarkupPct field", async () => {
  const items = [{
    id: 1, amount: 1000, currency: "THB", date: "2026-05-01",
    convertedCurrency: "EUR", convertedAmount: 25,
  }];
  const getRate = fakeGetRate({ "2026-05-01:THB:USD": 0.03 });
  const res = await H.planReconversion(items, "USD", { getRate, markupPct: 99, today: "2026-05-21" });
  assert.equal(res.ok, true);
  assert.equal(res.updates[0].fields.rate, 0.03);
  assert.equal(res.updates[0].fields.fxMarkupPct, undefined);
});

test("planReconversion: legacy manual-rate chain converts convertedAmount via convertedCurrency->def rate", async () => {
  const items = [{
    id: 1, amount: 100, currency: "ABC", date: "2026-05-01",
    manualRate: true, convertedCurrency: "EUR", convertedAmount: 50,
  }];
  const calls = [];
  const getRate = fakeGetRate({ "2026-05-01:EUR:USD": 1.1 }, calls);
  const res = await H.planReconversion(items, "USD", { getRate, today: "2026-05-21" });
  assert.equal(res.ok, true);
  const f = res.updates[0].fields;
  assert.equal(f.convertedCurrency, "USD");
  assert.equal(f.convertedAmount, 55); // 50 * 1.1
  assert.equal(f.rate, 0.55); // 55 / 100, to 10 sig figs
  assert.equal(f.manualRate, true);
  assert.equal(f.fxMarkupPct, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].from, "EUR");
  assert.equal(calls[0].to, "USD");
});

test("planReconversion: rateDate clamps a future/missing item.date to today", async () => {
  const items = [
    { id: 1, amount: 100, currency: "THB", date: "2099-01-01" }, // future
    { id: 2, amount: 100, currency: "THB" }, // missing
  ];
  const getRate = fakeGetRate({
    "2099-01-01:THB:USD": 0.03, // service call itself uses raw item.date per spec
    "undefined:THB:USD": 0.03,
  });
  const res = await H.planReconversion(items, "USD", { getRate, today: "2026-05-21" });
  assert.equal(res.ok, true);
  assert.equal(res.updates[0].fields.rateDate, "2026-05-21");
  assert.equal(res.updates[1].fields.rateDate, "2026-05-21");
});

test("planReconversion: a null rate from getRate is a failure for that item", async () => {
  const items = [
    { id: 1, amount: 100, currency: "THB", date: "2026-05-01" },
    { id: 2, amount: 100, currency: "VND", date: "2026-05-01" },
  ];
  const getRate = async (from, to, date) => (from === "THB" ? 0.03 : null);
  const res = await H.planReconversion(items, "USD", { getRate, today: "2026-05-21" });
  assert.equal(res.ok, false);
  assert.equal(res.failed, 1);
  assert.equal(res.total, 2);
  assert.deepEqual(res.failedItems, [items[1]]);
  assert.equal(res.failedItems[0], items[1]); // original reference
});

test("planReconversion: a thrown getRate is a failure for that item", async () => {
  const items = [{ id: 1, amount: 100, currency: "THB", date: "2026-05-01" }];
  const getRate = async () => { throw new Error("network down"); };
  const res = await H.planReconversion(items, "USD", { getRate, today: "2026-05-21" });
  assert.equal(res.ok, false);
  assert.equal(res.failed, 1);
  assert.equal(res.total, 1);
});

test("planReconversion: any failure leaves the input items completely untouched", async () => {
  const items = [
    { id: 1, amount: 100, currency: "THB", date: "2026-05-01" },
    { id: 2, amount: 100, currency: "VND", date: "2026-05-01" },
  ];
  const snapshot = JSON.parse(JSON.stringify(items));
  const getRate = async (from) => (from === "THB" ? 0.03 : null);
  const res = await H.planReconversion(items, "USD", { getRate, today: "2026-05-21" });
  assert.equal(res.ok, false);
  assert.deepEqual(items, snapshot);
});

test("planReconversion: a non-finite rate is also treated as a failure", async () => {
  const items = [{ id: 1, amount: 100, currency: "THB", date: "2026-05-01" }];
  const getRate = async () => Infinity;
  const res = await H.planReconversion(items, "USD", { getRate, today: "2026-05-21" });
  assert.equal(res.ok, false);
  assert.equal(res.failed, 1);
});

test("planReconversion: honours the concurrency cap (default and explicit)", async () => {
  let inFlight = 0, maxInFlight = 0;
  // Distinct dates, so de-duplication does not collapse the calls.
  const items = Array.from({ length: 10 }, (_, i) => ({
    id: i, amount: 100, currency: "THB", date: "2026-05-" + String(i + 1).padStart(2, "0"),
  }));
  const getRate = async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return 0.03;
  };
  const res = await H.planReconversion(items, "USD", { getRate, today: "2026-05-21", concurrency: 3 });
  assert.equal(res.ok, true);
  assert.ok(maxInFlight <= 3, "expected max 3 in flight, got " + maxInFlight);
  assert.equal(res.updates.length, 10);
});

test("planReconversion: default concurrency is 6 when not specified", async () => {
  let inFlight = 0, maxInFlight = 0;
  const items = Array.from({ length: 20 }, (_, i) => ({
    id: i, amount: 100, currency: "THB", date: "2026-05-" + String(i + 1).padStart(2, "0"),
  }));
  const getRate = async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return 0.03;
  };
  const res = await H.planReconversion(items, "USD", { getRate, today: "2026-05-21" });
  assert.equal(res.ok, true);
  assert.ok(maxInFlight <= 6, "expected max 6 in flight, got " + maxInFlight);
});

test("planReconversion: calls onProgress(done, total) after each item", async () => {
  const items = [
    { id: 1, amount: 100, currency: "THB", date: "2026-05-01" },
    { id: 2, amount: 100, currency: "VND", date: "2026-05-01" },
    { id: 3, amount: 100, currency: "LAK", date: "2026-05-01" },
  ];
  const getRate = async () => 0.03;
  const progress = [];
  const res = await H.planReconversion(items, "USD", {
    getRate, today: "2026-05-21",
    onProgress: (done, total) => progress.push([done, total]),
  });
  assert.equal(res.ok, true);
  assert.equal(progress.length, 3);
  progress.forEach(([, total]) => assert.equal(total, 3));
  assert.deepEqual(progress.map((p) => p[0]).sort((a, b) => a - b), [1, 2, 3]);
});

test("planReconversion: empty considered set -> ok:true, no updates, no calls", async () => {
  const items = [{ id: 1, amount: 100, currency: "USD" }];
  let called = false;
  const getRate = async () => { called = true; return 1; };
  const res = await H.planReconversion(items, "USD", { getRate, today: "2026-05-21" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.updates, []);
  assert.equal(called, false);
});

test("planReconversion: non-array items -> ok:true with no updates", async () => {
  const getRate = async () => 1;
  const res = await H.planReconversion(null, "USD", { getRate, today: "2026-05-21" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.updates, []);
});

test("planReconversion: requests each distinct date:from:to once (shared in-flight promise)", async () => {
  const items = [
    { id: 1, amount: 100, currency: "THB", date: "2026-05-01" },
    { id: 2, amount: 200, currency: "THB", date: "2026-05-01" },
    { id: 3, amount: 300, currency: "THB", date: "2026-05-01" },
    { id: 4, amount: 400, currency: "THB", date: "2026-05-02" },
  ];
  const calls = [];
  const getRate = async (from, to, date) => {
    calls.push(date + ":" + from + ":" + to);
    await new Promise((r) => setTimeout(r, 5));
    return 0.03;
  };
  const res = await H.planReconversion(items, "USD", { getRate, today: "2026-05-21" });
  assert.equal(res.ok, true);
  assert.deepEqual(calls.sort(), ["2026-05-01:THB:USD", "2026-05-02:THB:USD"]);
  assert.deepEqual(res.updates.map((u) => u.fields.convertedAmount), [3, 6, 9, 12]);
});

test("dedupeGetRate: one call per key, shared failures, idempotent wrapping", async () => {
  let n = 0;
  const base = async (from) => { n++; if (from === "BAD") throw new Error("x"); return 2; };
  const g = H.dedupeGetRate(base);
  assert.equal(H.dedupeGetRate(g), g);
  const [a, b] = await Promise.all([g("THB", "USD", "d"), g("THB", "USD", "d")]);
  assert.equal(a, 2);
  assert.equal(b, 2);
  assert.equal(n, 1);
  await assert.rejects(g("BAD", "USD", "d"));
  await assert.rejects(g("BAD", "USD", "d"));
  assert.equal(n, 2);
});

test("mapLimit: input-order results, concurrency honoured, empty list ok", async () => {
  let inFlight = 0, maxInFlight = 0;
  const out = await H.mapLimit([5, 1, 3, 2], 2, async (x, i) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, x));
    inFlight--;
    return x * 10 + i;
  });
  assert.deepEqual(out, [50, 11, 32, 23]);
  assert.ok(maxInFlight <= 2);
  assert.deepEqual(await H.mapLimit([], 6, async () => 1), []);
});


/* ============================================================ */
/* currencyChoices                                               */
/* ============================================================ */

test("currencyChoices: a removed currency is appended so the item can keep it", () => {
  assert.deepEqual(H.currencyChoices(["THB", "USD"], "JPY"), ["THB", "USD", "JPY"]);
});
test("currencyChoices: a listed currency changes nothing and the input is not mutated", () => {
  const list = ["THB", "USD"];
  const out = H.currencyChoices(list, "USD");
  assert.deepEqual(out, ["THB", "USD"]);
  assert.ok(out !== list);
  assert.deepEqual(list, ["THB", "USD"]);
});
test("currencyChoices: blank or missing current is ignored", () => {
  assert.deepEqual(H.currencyChoices(["THB"], ""), ["THB"]);
  assert.deepEqual(H.currencyChoices(["THB"], undefined), ["THB"]);
});
test("currencyChoices: a non-array list is treated as empty", () => {
  assert.deepEqual(H.currencyChoices(null, "JPY"), ["JPY"]);
  assert.deepEqual(H.currencyChoices(undefined, ""), []);
});


/* ============================================================ */
/* homeIconHref                                                  */
/* ============================================================ */

test("homeIconHref: explicit wallet -> wallet PNG", () => {
  assert.equal(H.homeIconHref({ homeIcon: "wallet" }), "./icon-wallet.png");
});
test("homeIconHref: yoimiya -> icon.png", () => {
  assert.equal(H.homeIconHref({ homeIcon: "yoimiya" }), "./icon.png");
});
test("homeIconHref: custom with a valid data:image/ picture -> that picture", () => {
  const pic = "data:image/png;base64,AAAA";
  assert.equal(H.homeIconHref({ homeIcon: "custom", homeIconCustom: pic }), pic);
});
test("homeIconHref: custom with null picture -> wallet", () => {
  assert.equal(H.homeIconHref({ homeIcon: "custom", homeIconCustom: null }), "./icon-wallet.png");
});
test("homeIconHref: custom with a non-data:image/ string -> wallet", () => {
  assert.equal(
    H.homeIconHref({ homeIcon: "custom", homeIconCustom: "https://evil.example/x.png" }),
    "./icon-wallet.png"
  );
});
test("homeIconHref: unknown homeIcon value -> wallet", () => {
  assert.equal(H.homeIconHref({ homeIcon: "bogus" }), "./icon-wallet.png");
});
test("homeIconHref: null/undefined settings -> wallet", () => {
  assert.equal(H.homeIconHref(null), "./icon-wallet.png");
  assert.equal(H.homeIconHref(undefined), "./icon-wallet.png");
});


/* ============================================================ */
/* iconHref                                                      */
/* ============================================================ */

test("iconHref: yoimiya -> icon.png regardless of custom/walletSrc", () => {
  assert.equal(H.iconHref("yoimiya", null, "./icon-wallet-red.png"), "./icon.png");
});
test("iconHref: custom with a valid data:image/ picture -> that picture", () => {
  const pic = "data:image/png;base64,AAAA";
  assert.equal(H.iconHref("custom", pic, "./icon-wallet.png"), pic);
});
test("iconHref: custom with null picture -> walletSrc", () => {
  assert.equal(H.iconHref("custom", null, "./icon-wallet-red.png"), "./icon-wallet-red.png");
});
test("iconHref: custom with a non-data:image/ string -> walletSrc", () => {
  assert.equal(H.iconHref("custom", "https://evil.example/x.png", "./icon-wallet.png"), "./icon-wallet.png");
});
test("iconHref: wallet -> walletSrc", () => {
  assert.equal(H.iconHref("wallet", null, "./icon-wallet-red.png"), "./icon-wallet-red.png");
});
test("iconHref: unrecognized choice -> walletSrc", () => {
  assert.equal(H.iconHref("bogus", "data:image/png;base64,AAAA", "./icon-wallet.png"), "./icon-wallet.png");
});


/* ============================================================ */
/* effectiveIconChoice                                           */
/* ============================================================ */

test("effectiveIconChoice: yoimiya stays yoimiya", () => {
  assert.equal(H.effectiveIconChoice("yoimiya", null), "yoimiya");
});
test("effectiveIconChoice: custom with a valid picture stays custom", () => {
  assert.equal(H.effectiveIconChoice("custom", "data:image/png;base64,AAAA"), "custom");
});
test("effectiveIconChoice: custom without a valid picture falls back to wallet", () => {
  assert.equal(H.effectiveIconChoice("custom", null), "wallet");
  assert.equal(H.effectiveIconChoice("custom", "https://evil.example/x.png"), "wallet");
});
test("effectiveIconChoice: wallet stays wallet", () => {
  assert.equal(H.effectiveIconChoice("wallet", null), "wallet");
});
test("effectiveIconChoice: unrecognized choice falls back to wallet", () => {
  assert.equal(H.effectiveIconChoice("bogus", "data:image/png;base64,AAAA"), "wallet");
});


/* ============================================================ */
/* headerIconHref                                                */
/* ============================================================ */

test("headerIconHref: finance mode, wallet choice -> finance wallet PNG", () => {
  const s = { headerIconFinanceChoice: "wallet", headerIconFinance: null };
  assert.equal(H.headerIconHref(s, "finance"), "./icon-wallet.png");
});
test("headerIconHref: debt mode, wallet choice -> rose wallet PNG", () => {
  const s = { headerIconDebtChoice: "wallet", headerIconDebt: null };
  assert.equal(H.headerIconHref(s, "debt"), "./icon-wallet-red.png");
});
test("headerIconHref: finance mode, yoimiya choice -> icon.png", () => {
  const s = { headerIconFinanceChoice: "yoimiya", headerIconFinance: null };
  assert.equal(H.headerIconHref(s, "finance"), "./icon.png");
});
test("headerIconHref: debt mode, yoimiya choice -> icon.png", () => {
  const s = { headerIconDebtChoice: "yoimiya", headerIconDebt: null };
  assert.equal(H.headerIconHref(s, "debt"), "./icon.png");
});
test("headerIconHref: finance mode, custom choice with a stored picture -> that picture", () => {
  const pic = "data:image/png;base64,AAAA";
  const s = { headerIconFinanceChoice: "custom", headerIconFinance: pic };
  assert.equal(H.headerIconHref(s, "finance"), pic);
});
test("headerIconHref: debt mode, custom choice with a stored picture -> that picture", () => {
  const pic = "data:image/png;base64,BBBB";
  const s = { headerIconDebtChoice: "custom", headerIconDebt: pic };
  assert.equal(H.headerIconHref(s, "debt"), pic);
});
test("headerIconHref: custom choice without a stored picture falls back to the mode's wallet", () => {
  assert.equal(
    H.headerIconHref({ headerIconFinanceChoice: "custom", headerIconFinance: null }, "finance"),
    "./icon-wallet.png"
  );
  assert.equal(
    H.headerIconHref({ headerIconDebtChoice: "custom", headerIconDebt: null }, "debt"),
    "./icon-wallet-red.png"
  );
});
test("headerIconHref: any mode other than 'debt' is treated as finance", () => {
  const s = { headerIconFinanceChoice: "wallet", headerIconFinance: null };
  assert.equal(H.headerIconHref(s, "finance"), "./icon-wallet.png");
  assert.equal(H.headerIconHref(s, undefined), "./icon-wallet.png");
});
test("headerIconHref: null settings -> wallet PNG for the given mode", () => {
  assert.equal(H.headerIconHref(null, "finance"), "./icon-wallet.png");
  assert.equal(H.headerIconHref(null, "debt"), "./icon-wallet-red.png");
});


/* ============================================================ */
/* iconChoiceFromPicture                                         */
/* ============================================================ */

test("iconChoiceFromPicture: data:image/ string -> custom", () => {
  assert.equal(H.iconChoiceFromPicture("data:image/png;base64,AAAA"), "custom");
});
test("iconChoiceFromPicture: null/non-data-URL/undefined -> wallet", () => {
  assert.equal(H.iconChoiceFromPicture(null), "wallet");
  assert.equal(H.iconChoiceFromPicture(undefined), "wallet");
  assert.equal(H.iconChoiceFromPicture("https://evil.example/x.png"), "wallet");
});

/* ============================================================ */
/* migrateIconChoices                                            */
/* ============================================================ */

test("migrateIconChoices: missing choice + data-URL picture -> custom (both header slots)", () => {
  const pic = "data:image/png;base64,AAAA";
  const s = { headerIconFinance: pic, headerIconDebt: pic };
  H.migrateIconChoices(s);
  assert.equal(s.headerIconFinanceChoice, "custom");
  assert.equal(s.headerIconDebtChoice, "custom");
});
test("migrateIconChoices: missing choice + null picture -> wallet (both header slots)", () => {
  const s = { headerIconFinance: null, headerIconDebt: null };
  H.migrateIconChoices(s);
  assert.equal(s.headerIconFinanceChoice, "wallet");
  assert.equal(s.headerIconDebtChoice, "wallet");
});
test("migrateIconChoices: invalid choice is recomputed from the stored picture", () => {
  const pic = "data:image/png;base64,AAAA";
  const s = {
    headerIconFinanceChoice: "bogus", headerIconFinance: pic,
    headerIconDebtChoice: 42, headerIconDebt: null,
  };
  H.migrateIconChoices(s);
  assert.equal(s.headerIconFinanceChoice, "custom");
  assert.equal(s.headerIconDebtChoice, "wallet");
});
test("migrateIconChoices: valid choices (incl. yoimiya with a stored picture) are left alone", () => {
  const pic = "data:image/png;base64,AAAA";
  const s = {
    headerIconFinanceChoice: "yoimiya", headerIconFinance: pic,
    headerIconDebtChoice: "custom", headerIconDebt: pic,
  };
  H.migrateIconChoices(s);
  assert.equal(s.headerIconFinanceChoice, "yoimiya");
  assert.equal(s.headerIconDebtChoice, "custom");
});
test("migrateIconChoices: normalizes home fields the same way loadStore used to", () => {
  const s = { homeIcon: "bogus", homeIconCustom: undefined };
  H.migrateIconChoices(s);
  assert.equal(s.homeIcon, "wallet");
  assert.equal(s.homeIconCustom, null);
});
test("migrateIconChoices: valid home fields are left alone", () => {
  const pic = "data:image/png;base64,AAAA";
  const s = { homeIcon: "custom", homeIconCustom: pic };
  H.migrateIconChoices(s);
  assert.equal(s.homeIcon, "custom");
  assert.equal(s.homeIconCustom, pic);
});
test("migrateIconChoices: mutates and returns the same object", () => {
  const s = { headerIconFinance: null, headerIconDebt: null };
  const out = H.migrateIconChoices(s);
  assert.equal(out, s);
});
test("migrateIconChoices: no-op for null/non-object input", () => {
  assert.equal(H.migrateIconChoices(null), null);
  assert.equal(H.migrateIconChoices(undefined), undefined);
  assert.equal(H.migrateIconChoices("x"), "x");
});

/* ============================================================ */
/* summarizeTotals / summaryAverage / yearsAverage               */
/* ============================================================ */

function rec(type, date, amount, extra) {
  return Object.assign({ type, date, amount, currency: "USD" }, extra || {});
}

test("summarizeTotals: splits spent/invested per month and year", () => {
  const t = H.summarizeTotals([
    rec("expense", "2026-01-05", 10),
    rec("expense", "2026-01-20", 5.5),
    rec("investment", "2026-01-31", 100),
    rec("expense", "2026-03-01", 7),
    rec("investment", "2026-12-31", 20),
  ], "USD", 2026);
  assert.equal(t.firstYear, 2026);
  assert.equal(t.lastYear, 2026);
  const y = t.years[2026];
  assert.equal(y.spent, 22.5);
  assert.equal(y.invested, 120);
  assert.equal(y.months.length, 12);
  assert.deepEqual(y.months[0], { spent: 15.5, invested: 100 });
  assert.deepEqual(y.months[1], { spent: 0, invested: 0 });
  assert.deepEqual(y.months[2], { spent: 7, invested: 0 });
  assert.deepEqual(y.months[11], { spent: 0, invested: 20 });
});

test("summarizeTotals: uses convertedAmount when converted to the default currency", () => {
  const t = H.summarizeTotals([
    rec("expense", "2026-02-10", 50, { currency: "EUR", convertedAmount: 55, convertedCurrency: "USD" }),
  ], "USD", 2026);
  assert.equal(t.years[2026].spent, 55);
  assert.equal(t.years[2026].months[1].spent, 55);
});

test("summarizeTotals: not-counted records are skipped (and do not move the year range)", () => {
  const t = H.summarizeTotals([
    rec("expense", "2020-04-01", 40, { currency: "EUR" }), // no conversion -> not counted
    rec("expense", "2021-04-01", 40, { currency: "EUR", convertedAmount: 44, convertedCurrency: "GBP" }), // stale
    rec("expense", "2026-04-01", 9),
  ], "USD", 2026);
  assert.equal(t.firstYear, 2026);
  assert.equal(t.years[2020], undefined);
  assert.equal(t.years[2026].spent, 9);
});

test("summarizeTotals: bad dates, unknown types and non-numeric amounts are skipped", () => {
  const t = H.summarizeTotals([
    rec("expense", "", 1),
    rec("expense", undefined, 2),
    rec("expense", "2026-13-01", 3),
    rec("expense", "2026-00-10", 4),
    rec("expense", "26-01-01", 5),
    rec("expense", "2026-1-1", 6),
    rec("expense", "2026-01-01T10:00", 7),
    rec("transfer", "2026-01-01", 8),
    rec("expense", "2026-01-01", "abc"),
    null,
    "junk",
    rec("expense", "2026-01-02", 1),
  ], "USD", 2026);
  assert.equal(t.years[2026].spent, 1);
  assert.equal(t.years[2026].invested, 0);
});

test("summarizeTotals: empty / non-array input gives the current year with zeros", () => {
  for (const input of [[], null, undefined]) {
    const t = H.summarizeTotals(input, "USD", 2026);
    assert.equal(t.firstYear, 2026);
    assert.equal(t.lastYear, 2026);
    assert.deepEqual(Object.keys(t.years), ["2026"]);
    assert.equal(t.years[2026].spent, 0);
    assert.equal(t.years[2026].invested, 0);
    assert.equal(t.years[2026].months.length, 12);
    assert.deepEqual(t.years[2026].months[5], { spent: 0, invested: 0 });
  }
});

test("summarizeTotals: fills every year between first and last with zeros", () => {
  const t = H.summarizeTotals([
    rec("expense", "2023-06-01", 10),
    rec("investment", "2025-06-01", 20),
  ], "USD", 2026);
  assert.equal(t.firstYear, 2023);
  assert.equal(t.lastYear, 2026); // current year is the floor
  assert.deepEqual(Object.keys(t.years), ["2023", "2024", "2025", "2026"]);
  assert.equal(t.years[2024].spent, 0);
  assert.equal(t.years[2024].months.length, 12);
  assert.equal(t.years[2026].invested, 0);
});

test("summarizeTotals: lastYear extends past the current year for future-dated records", () => {
  const t = H.summarizeTotals([
    rec("expense", "2026-02-01", 5),
    rec("expense", "2028-02-01", 10),
  ], "USD", 2026);
  assert.equal(t.firstYear, 2026);
  assert.equal(t.lastYear, 2028);
  assert.deepEqual(Object.keys(t.years), ["2026", "2027", "2028"]);
  assert.equal(t.years[2028].months[1].spent, 10);
});

test("summarizeTotals: rounds sums to cents, avoiding float drift", () => {
  const t = H.summarizeTotals([
    rec("expense", "2026-05-01", 0.1),
    rec("expense", "2026-05-02", 0.2),
    rec("expense", "2026-06-01", 10.005),
    rec("investment", "2026-05-03", 1.234),
  ], "USD", 2026);
  const y = t.years[2026];
  assert.equal(y.months[4].spent, 0.3);
  assert.equal(y.months[4].invested, 1.23);
  assert.equal(y.spent, 10.31);
});

test("summaryAverage: current year divides by the current month number", () => {
  assert.equal(H.summaryAverage(300, 2026, 2026, 3), 100);
  assert.equal(H.summaryAverage(100, 2026, 2026, 1), 100);
});

test("summaryAverage: any other year divides by 12", () => {
  assert.equal(H.summaryAverage(1200, 2025, 2026, 3), 100);
  assert.equal(H.summaryAverage(1200, 2027, 2026, 3), 100);
});

test("summaryAverage: rounds to cents", () => {
  assert.equal(H.summaryAverage(100, 2025, 2026, 3), 8.33);
});

test("yearsAverage: mean over the given totals, 0 for an empty list", () => {
  assert.equal(H.yearsAverage([100, 200, 300]), 200);
  assert.equal(H.yearsAverage([0, 50]), 25);
  assert.equal(H.yearsAverage([]), 0);
  assert.equal(H.yearsAverage(undefined), 0);
  assert.equal(H.yearsAverage([10, 0, 0]), 3.33);
});

test("summarizeTotals: only future-dated records -> firstYear is that year (earliest counted)", () => {
  const t = H.summarizeTotals([rec("expense", "2028-02-01", 10)], "USD", 2026);
  assert.equal(t.firstYear, 2028);
  assert.equal(t.lastYear, 2028);
  assert.deepEqual(Object.keys(t.years), ["2028"]);
});

/* ============================================================ */
/* recentPicks                                                   */
/* ============================================================ */

const PICK_CATS = [
  { name: "Food", subs: [{ name: "Coffee" }, { name: "Lunch" }] },
  { name: "Rent", subs: [] },
  { name: "Fun", subs: [{ name: "Games" }] },
];
function pk(category, subcategory, createdAt, extra) {
  return Object.assign({ type: "expense", category, subcategory, createdAt, date: "2026-01-01" }, extra);
}

test("recentPicks: newest createdAt first, ordered by createdAt not date", () => {
  const recs = [
    pk("Food", "", 100, { date: "2026-09-30" }),
    pk("Rent", "", 300, { date: "2020-01-01" }),
    pk("Fun", "", 200, { date: "2026-12-31" }),
  ];
  const out = H.recentPicks(recs, "expense", PICK_CATS);
  assert.deepEqual(out, [
    { category: "Rent", sub: "" },
    { category: "Fun", sub: "" },
    { category: "Food", sub: "" },
  ]);
});

test("recentPicks: a sub record gives a sub pick, no sub gives a main pick", () => {
  const out = H.recentPicks([pk("Food", "Coffee", 2), pk("Rent", "", 1)], "expense", PICK_CATS);
  assert.deepEqual(out, [{ category: "Food", sub: "Coffee" }, { category: "Rent", sub: "" }]);
});

test("recentPicks: records created by recurring rules are skipped", () => {
  const recs = [pk("Rent", "", 500, { ruleId: "r1" }), pk("Food", "", 100)];
  assert.deepEqual(H.recentPicks(recs, "expense", PICK_CATS), [{ category: "Food", sub: "" }]);
});

test("recentPicks: only records of the requested type count", () => {
  const recs = [pk("Food", "", 200, { type: "investment" }), pk("Rent", "", 100)];
  assert.deepEqual(H.recentPicks(recs, "expense", PICK_CATS), [{ category: "Rent", sub: "" }]);
  assert.deepEqual(H.recentPicks(recs, "investment", PICK_CATS), [{ category: "Food", sub: "" }]);
});

test("recentPicks: duplicates collapse, keeping the newest occurrence's position", () => {
  const recs = [
    pk("Food", "", 100),
    pk("Rent", "", 200),
    pk("Food", "", 300),
    pk("Rent", "", 150),
  ];
  assert.deepEqual(H.recentPicks(recs, "expense", PICK_CATS), [
    { category: "Food", sub: "" },
    { category: "Rent", sub: "" },
  ]);
});

test("recentPicks: main and sub picks of the same category are distinct", () => {
  const recs = [pk("Food", "", 3), pk("Food", "Coffee", 2), pk("Food", "Lunch", 1)];
  assert.deepEqual(H.recentPicks(recs, "expense", PICK_CATS), [
    { category: "Food", sub: "" },
    { category: "Food", sub: "Coffee" },
    { category: "Food", sub: "Lunch" },
  ]);
});

test("recentPicks: a deleted category is skipped", () => {
  const recs = [pk("Gone", "", 300), pk("Gone", "X", 250), pk("Rent", "", 100)];
  assert.deepEqual(H.recentPicks(recs, "expense", PICK_CATS), [{ category: "Rent", sub: "" }]);
});

test("recentPicks: a deleted sub falls back to the main pick", () => {
  const out = H.recentPicks([pk("Food", "Removed", 200), pk("Rent", "", 100)], "expense", PICK_CATS);
  assert.deepEqual(out, [{ category: "Food", sub: "" }, { category: "Rent", sub: "" }]);
});

test("recentPicks: a deleted sub de-dups with an existing main pick", () => {
  const recs = [pk("Food", "", 100), pk("Food", "Removed", 300), pk("Rent", "", 200)];
  assert.deepEqual(H.recentPicks(recs, "expense", PICK_CATS), [
    { category: "Food", sub: "" },
    { category: "Rent", sub: "" },
  ]);
});

test("recentPicks: limit defaults to 10 and can be overridden", () => {
  const cats = Array.from({ length: 12 }, (_, i) => ({ name: "C" + i, subs: [] }));
  const recs = cats.map((c, i) => pk(c.name, "", i + 1));
  const out = H.recentPicks(recs, "expense", cats);
  assert.equal(out.length, 10);
  assert.equal(out[0].category, "C11");
  assert.equal(out[9].category, "C2");
  assert.equal(H.recentPicks(recs, "expense", cats, 3).length, 3);
});

test("recentPicks: records without a numeric createdAt sort last", () => {
  const recs = [
    pk("Food", "", undefined),
    pk("Rent", "", "2026-01-01T00:00:00Z"),
    pk("Fun", "", 5),
  ];
  const out = H.recentPicks(recs, "expense", PICK_CATS);
  assert.equal(out[0].category, "Fun");
  assert.equal(out.length, 3);
});

test("recentPicks: category/sub matching ignores case, result uses the settings spelling", () => {
  const out = H.recentPicks([pk("food", "coffee", 1)], "expense", PICK_CATS);
  assert.deepEqual(out, [{ category: "Food", sub: "Coffee" }]);
});

test("recentPicks: empty / non-array input gives []", () => {
  assert.deepEqual(H.recentPicks([], "expense", PICK_CATS), []);
  assert.deepEqual(H.recentPicks(undefined, "expense", PICK_CATS), []);
  assert.deepEqual(H.recentPicks([pk("Food", "", 1)], "expense", undefined), []);
  assert.deepEqual(H.recentPicks([null, pk("Food", "", 1)], "expense", PICK_CATS), [{ category: "Food", sub: "" }]);
});

test("recentPicks: never mutates its inputs", () => {
  const recs = [pk("Food", "", 1), pk("Rent", "", 2)];
  const before = JSON.stringify(recs);
  const catsBefore = JSON.stringify(PICK_CATS);
  H.recentPicks(recs, "expense", PICK_CATS);
  assert.equal(JSON.stringify(recs), before);
  assert.equal(JSON.stringify(PICK_CATS), catsBefore);
});
