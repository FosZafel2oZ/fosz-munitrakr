# FX v2 — Universal Currency Fallback + Card Markup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every ISO currency auto-converts (Frankfurter for the 31 ECB codes, fawazahmed0 currency-api for the rest), and a global "Card FX markup %" setting is applied on top of every fetched rate so converted amounts match credit-card statements.

**Architecture:** All changes funnel through `makeRateService` in `public/finance-helpers.js` (pure, Node-tested). `getRate` grows a source-selection chain (Frankfurter vs currency-api with a mirror host); `attachConversion` gains a `markupPct` parameter applied only to fetched rates. app.js injects the markup via its single `attachConversion` wrapper (app.js:332) — none of the 8 call sites change. The pre-emptive manual-rate fields become permanently hidden and their dead validation branches are removed.

**Tech Stack:** Vanilla JS UMD modules, injected-fetch unit tests (`node tests/run.js`), localStorage settings.

**Spec:** `docs/superpowers/specs/2026-06-12-fx-v2-fallback-and-markup-design.md`

**Verified API facts** (probed 2026-06-12, in the spec): currency-api URLs
`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{tag}/v1/currencies/{from}.json`
(tag = `latest` or `YYYY-MM-DD`) with mirror
`https://{tag}.currency-api.pages.dev/v1/currencies/{from}.json`; lowercase
codes; payload `{ "date": "...", "{from}": { "{to}": rate } }`; CORS `*`.

---

### Task 1: Rate-service rewrite (finance-helpers.js) + tests

**Files:**
- Modify: `public/finance-helpers.js` (the `makeRateService` factory, lines ~49-144)
- Test: `tests/finance-helpers.test.js` (rework + extend the makeRateService sections)

- [ ] **Step 1: Rework the test file's rate-service sections**

In `tests/finance-helpers.test.js`, leave the `reconcileRenames` section (lines 1-84) untouched. Replace everything from the line `/* ============================================================ */` above `/* makeRateService — getRate + caching */` (line ~87) to the END of the file with:

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node tests/run.js`
Expected: multiple ✗ failures in finance-helpers.test.js (new URL/markup/fallback assertions); debts + recurring suites still green.

- [ ] **Step 3: Rewrite `makeRateService` in `public/finance-helpers.js`**

Replace the entire `makeRateService` function (from `function makeRateService(deps) {` down to its closing `}` before the final `return { reconcileRenames, makeRateService };`) with:

```js
  function makeRateService(deps) {
    const {
      fetch: fetchFn,
      storage,
      now = () => new Date(),
      isEcb,          // (currency) => boolean — pairs with BOTH codes in the
                      // ECB set use Frankfurter; everything else currency-api
      rateKey = "fin_rates",
    } = deps || {};

    let rateCache = {};
    if (storage) {
      try { rateCache = JSON.parse(storage.getItem(rateKey) || "{}"); } catch { rateCache = {}; }
    }

    function todayStr() {
      return now().toISOString().slice(0, 10);
    }

    async function fetchFrankfurter(from, to, d) {
      try {
        const res = await fetchFn(
          `https://api.frankfurter.dev/v1/${d}?from=${from}&to=${to}`
        );
        if (!res || !res.ok) return null;
        const j = await res.json();
        const rate = j && j.rates && j.rates[to];
        return rate && isFinite(rate) ? rate : null;
      } catch { return null; }
    }

    // fawazahmed0 currency-api — ~200 ISO codes (VND, LAK, KHR, TWD, ...).
    // Lowercase codes; payload { date, {from}: { {to}: rate } }. jsDelivr
    // primary with a Cloudflare mirror, per the project's own guidance.
    async function fetchCurrencyApi(from, to, d, today) {
      const tag = d === today ? "latest" : d;
      const f = from.toLowerCase();
      const t = to.toLowerCase();
      const urls = [
        `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/${f}.json`,
        `https://${tag}.currency-api.pages.dev/v1/currencies/${f}.json`,
      ];
      for (const url of urls) {
        try {
          const res = await fetchFn(url);
          if (!res || !res.ok) continue;
          const j = await res.json();
          const rate = j && j[f] && j[f][t];
          if (rate && isFinite(rate)) return rate;
        } catch {}
      }
      return null;
    }

    async function getRate(from, to, date) {
      if (from === to) return 1;
      const today = todayStr();
      const d = !date || date > today ? today : date;
      const key = `${d}:${from}:${to}`;
      if (rateCache[key] != null) return rateCache[key];
      const rate = (isEcb && isEcb(from) && isEcb(to))
        ? await fetchFrankfurter(from, to, d)
        : await fetchCurrencyApi(from, to, d, today);
      if (rate == null) return null; // graceful: offline / unavailable
      rateCache[key] = rate;
      if (storage) {
        try { storage.setItem(rateKey, JSON.stringify(rateCache)); } catch {}
      }
      return rate;
    }

    function pairAutoConvertible(from, to) {
      return !!from && !!to && from !== to;
    }

    async function attachConversion(r, manualRate, defaultCurrency, markupPct) {
      const def = defaultCurrency || "THB";
      delete r.convertedAmount; delete r.convertedCurrency;
      delete r.rate; delete r.rateDate; delete r.rateUnavailable;
      delete r.manualRate; delete r.fxMarkupPct;
      if (!r.currency || r.currency === def) return r;

      const today = todayStr();
      const rateDate = !r.date || r.date > today ? today : r.date;

      // A user-typed rate (e.g. from a card statement) wins outright and
      // never gets the markup — it already reflects the real charge.
      const mr = Number(manualRate);
      if (Number.isFinite(mr) && mr > 0) {
        r.convertedCurrency = def;
        r.convertedAmount = Math.round(r.amount * mr * 100) / 100;
        r.rate = mr;
        r.rateDate = rateDate;
        r.manualRate = true;
        return r;
      }

      const base = await getRate(r.currency, def, r.date);
      if (base == null) { r.rateUnavailable = true; return r; }
      const pct = Number(markupPct) || 0;
      const effective = pct > 0 ? base * (1 + pct / 100) : base;
      r.convertedCurrency = def;
      r.convertedAmount = Math.round(r.amount * effective * 100) / 100;
      r.rate = effective;
      r.rateDate = rateDate;
      if (pct > 0) r.fxMarkupPct = pct;
      return r;
    }

    return {
      getRate,
      attachConversion,
      pairAutoConvertible,
      _getCache: () => rateCache,
      _setCache: (c) => { rateCache = c || {}; },
    };
  }
```

Also update the factory's doc comment above it (`deps:` list): `isConvertible — (currency) => boolean` becomes `isEcb — (currency) => boolean (both-ECB pairs use Frankfurter; others use currency-api)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/run.js`
Expected: all pass. Note the exact new total (was 98; finance-helpers grew from 23 to 31 tests → expect `106/106 passed, 0 failed`).

- [ ] **Step 5: Commit**

```bash
git add public/finance-helpers.js tests/finance-helpers.test.js
git commit -m "feat: FX source chain (Frankfurter + currency-api fallback) + markup in rate service (TDD)"
```

---

### Task 2: app.js wiring — service deps, markup injection, manual-field retirement

**Files:**
- Modify: `public/app.js` (seven small edits, anchors below)

NOTE: app.js still references `isConvertible` until this task completes, so the app is briefly inconsistent between Tasks 1–2 — that's fine, tests don't load app.js. Verify with `node --check` + full suite at the end of this task.

- [ ] **Step 1: Rename the currency set and accessor (app.js ~216-233)**

Find:

```js
const CONVERTIBLE = new Set([
  "AUD","BGN","BRL","CAD","CHF","CNY","CZK","DKK","EUR","GBP","HKD","HUF",
  "IDR","ILS","INR","ISK","JPY","KRW","MXN","MYR","NOK","NZD","PHP","PLN",
  "RON","SEK","SGD","THB","TRY","USD","ZAR",
]);
function isRealCurrency(code) {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}
const isConvertible = (c) => CONVERTIBLE.has(c);
function pairAutoConvertible(from, to) {
  return from !== to && isConvertible(from) && isConvertible(to);
}
```

Replace with:

```js
// ECB reference-rate currencies — pairs where BOTH codes are in this set use
// Frankfurter; every other ISO currency converts via the currency-api fallback.
const ECB_CURRENCIES = new Set([
  "AUD","BGN","BRL","CAD","CHF","CNY","CZK","DKK","EUR","GBP","HKD","HUF",
  "IDR","ILS","INR","ISK","JPY","KRW","MXN","MYR","NOK","NZD","PHP","PLN",
  "RON","SEK","SGD","THB","TRY","USD","ZAR",
]);
function isRealCurrency(code) {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}
const isEcb = (c) => ECB_CURRENCIES.has(c);
```

(The local `pairAutoConvertible` is deleted — its only two callers are retired in Step 4.)

- [ ] **Step 2: Service construction + markup-aware wrapper (app.js ~319-334)**

Find:

```js
const _rateService = makeRateService({
  fetch: (...a) => fetch(...a),
  storage: localStorage,
  now: () => new Date(),
  isConvertible,
  rateKey: RATE_KEY,
});
const getRate = _rateService.getRate;
async function attachConversion(r, manualRate) {
  return _rateService.attachConversion(r, manualRate, store && store.settings && store.settings.defaultCurrency);
}
```

Replace with:

```js
const _rateService = makeRateService({
  fetch: (...a) => fetch(...a),
  storage: localStorage,
  now: () => new Date(),
  isEcb,
  rateKey: RATE_KEY,
});
const getRate = _rateService.getRate;
// Single funnel for every conversion in the app — the global card-FX markup
// is injected here so no call site needs to know about it.
async function attachConversion(r, manualRate) {
  const s = store && store.settings;
  return _rateService.attachConversion(
    r, manualRate, s && s.defaultCurrency, (s && s.fxMarkupPct) || 0
  );
}
```

Also update the comment block right above (`/* ---- FX conversion (frankfurter.dev, ...`) to:

```js
/* ---- FX conversion (frankfurter.dev + currency-api fallback, in-browser) ----
   Logic lives in public/finance-helpers.js (testable). Here we instantiate
   the service with browser-provided deps and expose getRate/attachConversion
   as the same globals existing call sites already use. */
```

- [ ] **Step 3: `loadStore` migration for `fxMarkupPct`**

In `loadStore()` (app.js ~233-245), after the line
`if (!store.settings.debtShareLanguage) store.settings.debtShareLanguage = "en";`
add:

```js
  if (typeof store.settings.fxMarkupPct !== "number")
    store.settings.fxMarkupPct = 0;
```

- [ ] **Step 4: Retire both manual-rate fields**

(a) Replace `updateManualRateField` (app.js ~2011-2028) with:

```js
// Every ISO currency now auto-converts (Frankfurter or the currency-api
// fallback), so the manual-rate field never needs to pre-open. The field and
// the manualRate plumbing stay for legacy records and as an escape hatch.
function updateManualRateField() {
  $("#manualRateField").classList.add("hidden");
}
```

(b) Replace `updateDbtManualRateField` (app.js ~4201-4216) with:

```js
function updateDbtManualRateField() {
  const field = document.getElementById("dbtManualRateField");
  if (field) field.classList.add("hidden");
}
```

(Leave both `change`-listener registrations in place — they are now cheap no-ops and keep the wiring obvious.)

(c) In the `#recordForm` submit handler, DELETE this block (app.js ~2457-2461, right after `const payload = {...}` is built):

```js
  if (!$("#manualRateField").classList.contains("hidden")) {
    const mr = parseFloat($("#fManualRate").value);
    if (!(mr > 0))
      return ($("#modalError").textContent =
        "Enter the conversion rate (1 " +
        payload.currency +
        " = ? " +
        (settings.defaultCurrency || "THB") +
        ")");
    payload.manualRate = mr;
  }
```

(d) In the same handler's split-the-bill debt block, find:

```js
      const mrVisible = !$("#manualRateField").classList.contains("hidden");
      const mr = mrVisible ? parseFloat($("#fManualRate").value) : null;
      const userNotes = $("#fNotes").value.trim();
```

Replace with:

```js
      const userNotes = $("#fNotes").value.trim();
```

and change the conversion line in that block from
`try { await attachConversion(d, mr); } catch (_e) { d.rateUnavailable = true; }`
to
`try { await attachConversion(d); } catch (_e) { d.rateUnavailable = true; }`

(e) In `saveDebtFromModal` (app.js ~4221+), DELETE the manual-rate block:

```js
  const mrField = document.getElementById("dbtManualRateField");
  let manualRate = null;
  if (mrField && !mrField.classList.contains("hidden")) {
    manualRate = parseFloat(document.getElementById("dbtManualRate").value);
    if (!(manualRate > 0)) {
      const def = (store && store.settings && store.settings.defaultCurrency) || "THB";
      err.textContent = "Enter the conversion rate (1 " + currency + " = ? " + def + ").";
      return;
    }
  }
```

and change its two conversion calls from
`try { await attachConversion(updated, manualRate); } catch ...` /
`try { await attachConversion(entered, manualRate); } catch ...`
to
`try { await attachConversion(updated); } catch ...` /
`try { await attachConversion(entered); } catch ...`

- [ ] **Step 5: Currencies-manager copy (app.js ~2105-2158)**

In `renderCurManager`, replace:

```js
    const conv = isConvertible(code);
```
and the tag span:
```js
      `<span class="cur-tag ${conv ? "ok" : "warn"}">${
        conv ? "auto-convert" : "manual rate"
      }</span>` +
```

with (no `conv` variable):

```js
      `<span class="cur-tag ok">auto-convert</span>` +
```

In the `#addCurBtn` handler, replace:

```js
  $("#curMsg").style.color = isConvertible(code) ? "var(--in)" : "var(--out)";
  $("#curMsg").textContent = isConvertible(code)
    ? code + " added (auto-convertible)."
    : code +
      " added. Not auto-convertible — you'll enter the rate yourself when adding a record in " +
      code +
      ".";
```

with:

```js
  $("#curMsg").style.color = "var(--in)";
  $("#curMsg").textContent = code + " added (auto-converts).";
```

- [ ] **Step 6: Verify no stale references and run checks**

Run: `grep -n "isConvertible\|CONVERTIBLE\b\|pairAutoConvertible" public/app.js`
Expected: only the `ECB_CURRENCIES` definition and `isEcb` remain (no `isConvertible`, no app-level `pairAutoConvertible`).

Run: `node --check public/app.js && node tests/run.js`
Expected: clean, `106/106 passed, 0 failed`

- [ ] **Step 7: Commit**

```bash
git add public/app.js
git commit -m "feat: wire FX v2 — isEcb source selection, global markup injection, retire manual-rate fields"
```

---

### Task 3: Card FX markup setting UI

**Files:**
- Modify: `public/index.html` (Preferences block, ~line 263-276)
- Modify: `public/app.js` (`buildSettingsPayload`, `openSettings`, new save handler)

- [ ] **Step 1: Add the Preferences field (index.html)**

Find (end of the Preferences block):

```html
      <div class="muted" style="margin-top:8px">
        Controls the text rendered on debt record images you share.
      </div>
      <div id="debtShareLanguageMsg" class="form-error"></div>

    </div>
```

Replace with:

```html
      <div class="muted" style="margin-top:8px">
        Controls the text rendered on debt record images you share.
      </div>
      <div id="debtShareLanguageMsg" class="form-error"></div>

      <label style="margin-top:16px">Card FX markup %
        <div class="inline-edit">
          <input id="setFxMarkup" type="number" inputmode="decimal"
            step="0.1" min="0" max="10" placeholder="0" />
          <button class="btn-mini" id="saveFxMarkup">Save</button>
        </div>
      </label>
      <div class="muted" style="margin-top:8px">
        Added on top of market rates so converted amounts match your
        credit-card statement (Thai cards charge up to 2.5%). 0 = off.
      </div>
      <div id="fxMarkupMsg" class="form-error"></div>

    </div>
```

- [ ] **Step 2: Include it in `buildSettingsPayload` (app.js ~2032-2051)**

After the `p.debtShareLanguage = ...;` assignment, add:

```js
  const mk = $("#setFxMarkup") ? parseFloat($("#setFxMarkup").value) : NaN;
  p.fxMarkupPct = Number.isFinite(mk) && mk >= 0
    ? Math.min(mk, 10)
    : (settings.fxMarkupPct || 0);
```

- [ ] **Step 3: Populate on `openSettings` (app.js ~2316+)**

After the `if ($("#setDebtShareLanguage")) { ... }` block inside `openSettings`, add:

```js
  if ($("#setFxMarkup")) {
    $("#setFxMarkup").value = settings.fxMarkupPct || 0;
    if ($("#fxMarkupMsg")) $("#fxMarkupMsg").textContent = "";
  }
```

- [ ] **Step 4: Save handler (app.js, right after the `#saveDebtShareLanguage` handler ~2613)**

```js
$("#saveFxMarkup")?.addEventListener("click", async () => {
  const msg = $("#fxMarkupMsg");
  if (msg) msg.textContent = "";
  try {
    settings = await api("/settings", "PUT", buildSettingsPayload());
    syncDraftsFromSettings();
    if ($("#setFxMarkup")) $("#setFxMarkup").value = settings.fxMarkupPct || 0;
    if (msg) {
      msg.style.color = "var(--in)";
      msg.textContent = (settings.fxMarkupPct || 0) > 0
        ? "Markup set to " + settings.fxMarkupPct + "% — applied to all new conversions."
        : "Markup off.";
    }
  } catch (err) {
    if (msg) { msg.style.color = ""; msg.textContent = err.message; }
  }
});
```

- [ ] **Step 5: Verify the settings shim persists the new key**

Read the `path === "/settings" && method === "PUT"` branch of `api()` (app.js ~365). If it assigns the whole body into `store.settings` (the pattern `debtShareLanguage` relies on), nothing more is needed. If it copies a whitelist of keys, add `fxMarkupPct` to it. State which case applied in your report.

- [ ] **Step 6: Verify**

Run: `node --check public/app.js && node tests/run.js`
Expected: clean, `106/106 passed, 0 failed`

- [ ] **Step 7: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: Card FX markup % setting in Preferences"
```

---

### Task 4: v71 bump + handover + final verification

**Files:**
- Modify: `public/app.js:6`, `public/sw.js:2`, `handover.md`

- [ ] **Step 1: Lockstep bump**

`public/app.js` line 6 → `const APP_VERSION = "v71"; // keep in step with sw.js CACHE`
`public/sw.js` line 2 → `const CACHE = "munitrakr-v71";`

- [ ] **Step 2: handover.md**

1. Header: `Current version: **v70**` → `**v71**`.
2. §8 lockstep line: `v70` / `munitrakr-v70` → `v71` / `munitrakr-v71`.
3. Update the test counts everywhere they appear: `98 unit tests` → `106 unit tests` and `98/98 passed` → `106/106 passed` (use the ACTUAL count printed by `node tests/run.js` if it differs).
4. §4 "Currency & FX" — replace the whole subsection body with:

```markdown
### Currency & FX
- Each record has its own currency, auto-converted into `defaultCurrency` on save. Source chain: **Frankfurter** (ECB) when both codes are in the 31-currency `ECB_CURRENCIES` set, otherwise the **fawazahmed0 currency-api** (jsDelivr CDN with a Cloudflare mirror — ~200 ISO codes, daily, lowercase URLs). Rates cached per `date:from:to` in `fin_rates` (base rate, pre-markup).
- **Card FX markup** (`settings.fxMarkupPct`, Preferences → "Card FX markup %", default 0): applied on top of every fetched rate everywhere (records, debts, recurring, splits) so converted amounts match credit-card statements. Stored on converted records as `fxMarkupPct`; `rate` is the effective (marked-up) rate. Never applied to manual rates.
- The pre-emptive manual-rate field is retired (every ISO currency converts). Offline saves mark `rateUnavailable`; re-save/edit when online. Legacy `manualRate` records still render correctly.
- All FX logic lives in `public/finance-helpers.js` (`makeRateService` factory with injectable `fetch` / `storage` / `now` / `isEcb` — testable in Node).
```

5. §3 data model: in the `settings` block comment add `fxMarkupPct: number,` under the shared settings; in `type Record` and `type Debt`, add `fxMarkupPct?,` next to `manualRate?,`.

- [ ] **Step 3: Full verification**

Run: `node --check public/app.js && node --check public/sw.js && node tests/run.js`
Expected: clean, all tests pass (record the exact count).

- [ ] **Step 4: Commit**

```bash
git add public/app.js public/sw.js handover.md
git commit -m "chore: bump to v71 + handover update for FX v2"
```

---

## Manual verification checklist (needs network — preview via file:// is fine for FX since fetch goes direct)

1. Settings → Currencies → add `VND` → message says "added (auto-converts)", tag shows `auto-convert`.
2. Add an expense in VND → no manual-rate box; after save the record shows a converted THB amount.
3. Settings → Preferences → set Card FX markup to `2.5` → Save → message confirms.
4. Add a USD expense → converted amount is ~2.5% higher than the mid-market rate; record's rate line reflects the effective rate.
5. Add a VND debt in DebtTrakr → converts, markup applied.
6. Set markup back to 0 → new conversions are clean mid-market again (old records unchanged).
7. Airplane-mode save in any foreign currency → "rate unavailable" state, no crash; edit+save online converts it.
8. Existing records (incl. old manualRate ones) render unchanged.

## Out of scope

Per spec: per-record card/cash toggle; Visa/MC official rates; re-converting saved records on markup change; offline manual-rate escape hatch.
