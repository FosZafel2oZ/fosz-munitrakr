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
