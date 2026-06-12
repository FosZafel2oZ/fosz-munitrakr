/* MuniTrakr finance helpers — reconcileRenames + FX rate service.
   Pure logic with injected dependencies so it's testable in Node.
   Browser global + Node require (UMD). */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  /* ---------- Category/sub-category rename propagation ----------
     Pure: takes old settings, new settings, and the records array, and
     mutates record.category / record.subcategory in place for any renames
     detected by stable id match.
  */
  function reconcileRenames(oldS, newS, records) {
    if (!Array.isArray(records)) return;
    ["expense", "investment"].forEach((type) => {
      const oldById = {};
      (oldS[type] || []).forEach((c) => (oldById[c.id] = c));
      (newS[type] || []).forEach((nc) => {
        const oc = oldById[nc.id];
        if (!oc) return;
        if (oc.name && nc.name && oc.name !== nc.name) {
          records.forEach((r) => {
            if (r.type === type && r.category === oc.name) r.category = nc.name;
          });
        }
        const oldSub = {};
        (oc.subs || []).forEach((s) => (oldSub[s.id] = s));
        (nc.subs || []).forEach((ns) => {
          const os = oldSub[ns.id];
          if (os && os.name && ns.name && os.name !== ns.name) {
            records.forEach((r) => {
              if (
                r.type === type &&
                r.category === nc.name &&
                r.subcategory === os.name
              )
                r.subcategory = ns.name;
            });
          }
        });
      });
    });
  }

  /* ---------- Rate service factory ----------
     deps:
       fetch        — fetch implementation
       storage      — localStorage-like { getItem, setItem } (optional)
       now          — () => Date  (defaults to () => new Date())
       isEcb        — (currency) => boolean (both-ECB pairs use Frankfurter; others use currency-api)
       rateKey      — storage key (default "fin_rates")
  */
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
      const effective = pct > 0 ? parseFloat((base * (1 + pct / 100)).toPrecision(10)) : base;
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

  return { reconcileRenames, makeRateService };
});
