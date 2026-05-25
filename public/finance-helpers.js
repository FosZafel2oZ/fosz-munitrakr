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
       isConvertible — (currency) => boolean
       rateKey      — storage key (default "fin_rates")
  */
  function makeRateService(deps) {
    const {
      fetch: fetchFn,
      storage,
      now = () => new Date(),
      isConvertible,
      rateKey = "fin_rates",
    } = deps || {};

    let rateCache = {};
    if (storage) {
      try { rateCache = JSON.parse(storage.getItem(rateKey) || "{}"); } catch { rateCache = {}; }
    }

    function todayStr() {
      return now().toISOString().slice(0, 10);
    }

    async function getRate(from, to, date) {
      if (from === to) return 1;
      const today = todayStr();
      const d = !date || date > today ? today : date;
      const key = `${d}:${from}:${to}`;
      if (rateCache[key] != null) return rateCache[key];
      try {
        const res = await fetchFn(
          `https://api.frankfurter.dev/v1/${d}?from=${from}&to=${to}`
        );
        if (!res || !res.ok) throw 0;
        const j = await res.json();
        const rate = j && j.rates && j.rates[to];
        if (!rate || !isFinite(rate)) throw 0;
        rateCache[key] = rate;
        if (storage) {
          try { storage.setItem(rateKey, JSON.stringify(rateCache)); } catch {}
        }
        return rate;
      } catch {
        return null; // graceful: skip conversion when offline / unavailable
      }
    }

    function pairAutoConvertible(from, to) {
      return from !== to && !!isConvertible && isConvertible(from) && isConvertible(to);
    }

    async function attachConversion(r, manualRate, defaultCurrency) {
      const def = defaultCurrency || "THB";
      delete r.convertedAmount; delete r.convertedCurrency;
      delete r.rate; delete r.rateDate; delete r.rateUnavailable;
      delete r.manualRate;
      if (!r.currency || r.currency === def) return r;

      const today = todayStr();
      const rateDate = !r.date || r.date > today ? today : r.date;

      if (pairAutoConvertible(r.currency, def)) {
        const rate = await getRate(r.currency, def, r.date);
        if (rate == null) { r.rateUnavailable = true; return r; }
        r.convertedCurrency = def;
        r.convertedAmount = Math.round(r.amount * rate * 100) / 100;
        r.rate = rate;
        r.rateDate = rateDate;
        return r;
      }
      // not auto-convertible: use the rate the user typed in, if any
      const mr = Number(manualRate);
      if (Number.isFinite(mr) && mr > 0) {
        r.convertedCurrency = def;
        r.convertedAmount = Math.round(r.amount * mr * 100) / 100;
        r.rate = mr;
        r.rateDate = rateDate;
        r.manualRate = true;
        return r;
      }
      r.rateUnavailable = true;
      return r;
    }

    return {
      getRate,
      attachConversion,
      pairAutoConvertible,
      // Inspect helpers (handy for tests)
      _getCache: () => rateCache,
      _setCache: (c) => { rateCache = c || {}; },
    };
  }

  return { reconcileRenames, makeRateService };
});
