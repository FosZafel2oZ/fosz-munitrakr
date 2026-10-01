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

  /* ---------- amountInDefault ----------
     The ONE definition of the counting rule (see design doc §1). Returns a
     Number when `item` counts toward totals in currency `def`, else null
     ("not counted" — never stored on the item, always derived here):
       - item.currency === def          -> Number(item.amount)
       - item.convertedCurrency === def && convertedAmount set -> Number(convertedAmount)
       - otherwise (incl. stale conversion to a different currency,
         rateUnavailable, or no conversion yet) -> null
     null/non-object item -> null.
  */
  function amountInDefault(item, def) {
    if (!item || typeof item !== "object") return null;
    if (item.currency === def) return Number(item.amount);
    if (item.convertedCurrency === def && item.convertedAmount != null) {
      return Number(item.convertedAmount);
    }
    return null;
  }

  /* ---------- countNotCounted ----------
     Number of items whose amountInDefault is null. Non-array -> 0.
  */
  function countNotCounted(items, def) {
    if (!Array.isArray(items)) return 0;
    return items.filter((it) => amountInDefault(it, def) === null).length;
  }

  /* ---------- applyMarkup ----------
     Shared by attachConversion and planReconversion: applies a percentage
     markup on top of a base FX rate, or returns the base unchanged when
     pct <= 0. toPrecision strips binary-float noise
     (0.027 * 1.025 -> 0.027674999... otherwise).
  */
  function applyMarkup(base, pct) {
    return pct > 0 ? parseFloat((base * (1 + pct / 100)).toPrecision(10)) : base;
  }

  /* ---------- clearConversionFields ----------
     Deletes every FX field from `item` in place so a fresh conversion (or a
     planReconversion update) can be applied cleanly.
  */
  function clearConversionFields(item) {
    delete item.convertedAmount;
    delete item.convertedCurrency;
    delete item.rate;
    delete item.rateDate;
    delete item.rateUnavailable;
    delete item.manualRate;
    delete item.fxMarkupPct;
  }

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  /* ---------- planReconversion ----------
     Pure planner for design doc §6 ("Convert old records to USD?"). Never
     mutates `items`. Considers only items where amountInDefault(item, def)
     is null; every other item is left out of the result entirely.
     opts = { getRate, markupPct, today, concurrency = 6, onProgress }
       - getRate(from, to, date) -> Promise<number|null>, may reject.
       - today: "YYYY-MM-DD", used to clamp a missing/future item.date for
         the resulting rateDate (not for the getRate call itself, which
         always gets the item's own raw date per design doc §6).
       - concurrency: max simultaneous getRate calls (simple worker pool).
       - onProgress(done, total): called after each considered item settles.
     Per considered item:
       - Legacy manual item (manualRate truthy, has convertedAmount in some
         other currency): chains convertedAmount * rate(convertedCurrency ->
         def, item.date), keeping manualRate: true and no markup.
       - Otherwise: rate(item.currency -> def, item.date) with markup =
         the item's own stored fxMarkupPct if it was converted before, else
         opts.markupPct (a never-converted item uses the current setting).
     A null/non-finite rate or a thrown getRate fails that item. All items
     must succeed for the run to succeed: { ok: true, updates: [{ item,
     fields }] } (item = the original reference, considered order); any
     failure -> { ok: false, failed, total } and nothing to apply.
  */
  async function planReconversion(items, def, opts) {
    const { getRate, markupPct, today, concurrency = 6, onProgress } = opts || {};
    const considered = Array.isArray(items)
      ? items.filter((it) => amountInDefault(it, def) === null)
      : [];
    const total = considered.length;
    const results = new Array(total);
    let done = 0;
    let nextIndex = 0;

    async function settleOne(item) {
      const rateDate = !item.date || item.date > today ? today : item.date;
      try {
        if (item.manualRate && item.convertedAmount != null && item.convertedCurrency) {
          const r = await getRate(item.convertedCurrency, def, item.date);
          if (r == null || !Number.isFinite(r)) return { ok: false };
          const convertedAmount = round2(item.convertedAmount * r);
          const rate = parseFloat((convertedAmount / item.amount).toPrecision(10));
          return {
            ok: true,
            item,
            fields: { convertedCurrency: def, convertedAmount, rate, rateDate, manualRate: true },
          };
        }
        const pct = item.convertedAmount != null
          ? (Number(item.fxMarkupPct) || 0)
          : (Number(markupPct) || 0);
        const base = await getRate(item.currency, def, item.date);
        if (base == null || !Number.isFinite(base)) return { ok: false };
        const eff = applyMarkup(base, pct);
        const convertedAmount = round2(item.amount * eff);
        const fields = { convertedCurrency: def, convertedAmount, rate: eff, rateDate };
        if (pct > 0) fields.fxMarkupPct = pct;
        return { ok: true, item, fields };
      } catch {
        return { ok: false };
      }
    }

    async function worker() {
      while (nextIndex < total) {
        const i = nextIndex++;
        results[i] = await settleOne(considered[i]);
        done++;
        if (typeof onProgress === "function") onProgress(done, total);
      }
    }

    const workerCount = Math.max(1, Math.min(concurrency || 6, total || 1));
    await Promise.all(Array.from({ length: workerCount }, worker));

    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) return { ok: false, failed, total };
    return { ok: true, updates: results.map((r) => ({ item: r.item, fields: r.fields })) };
  }

  /* ---------- summarizeTotals ----------
     Sums for the Summary page. Counted amounts only (amountInDefault(r, def)
     !== null); records with a date that is not YYYY-MM-DD (month 01-12), a type
     other than "expense"/"investment", or a non-finite amount are skipped.
     Returns { firstYear, lastYear, years }:
       firstYear = earliest year with a counted record, else currentYear
       lastYear  = max(currentYear, latest year with a counted record)
       years     = plain object keyed by year; EVERY year in
                   [firstYear, lastYear] is present (zeros when empty):
         years[y] = { spent, invested, months: [12 x { spent, invested }] }
                    (months[0] = January). "spent" = expenses, "invested" =
                    investments. All sums are rounded to cents.
  */
  function summarizeTotals(records, def, currentYear) {
    const cents = (x) => Math.round(x * 100) / 100;
    const counted = [];
    (Array.isArray(records) ? records : []).forEach((r) => {
      if (!r || (r.type !== "expense" && r.type !== "investment")) return;
      const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(r.date);
      if (!m) return;
      const month = Number(m[2]);
      if (month < 1 || month > 12) return;
      const amt = amountInDefault(r, def);
      if (amt === null || !Number.isFinite(amt)) return;
      counted.push({ year: Number(m[1]), month: month - 1, type: r.type, amt });
    });
    const countedYears = counted.map((c) => c.year);
    const firstYear = countedYears.length ? Math.min(...countedYears) : currentYear;
    const lastYear = Math.max(currentYear, ...countedYears);
    const years = {};
    for (let y = firstYear; y <= lastYear; y++) {
      years[y] = {
        spent: 0, invested: 0,
        months: Array.from({ length: 12 }, () => ({ spent: 0, invested: 0 })),
      };
    }
    counted.forEach((c) => {
      const key = c.type === "expense" ? "spent" : "invested";
      years[c.year][key] += c.amt;
      years[c.year].months[c.month][key] += c.amt;
    });
    Object.keys(years).forEach((y) => {
      const yr = years[y];
      yr.spent = cents(yr.spent);
      yr.invested = cents(yr.invested);
      yr.months.forEach((mo) => {
        mo.spent = cents(mo.spent);
        mo.invested = cents(mo.invested);
      });
    });
    return { firstYear, lastYear, years };
  }

  /* ---------- summaryAverage ----------
     Per-month average for the Months view: total / currentMonth (1-12) for the
     current year, total / 12 for any other year. Rounded to cents.
  */
  function summaryAverage(total, year, currentYear, currentMonth) {
    const divisor = year === currentYear ? currentMonth : 12;
    return Math.round((total / divisor) * 100) / 100;
  }

  /* ---------- yearsAverage ----------
     Mean of the given yearly totals, rounded to cents; empty/non-array -> 0.
  */
  function yearsAverage(totals) {
    if (!Array.isArray(totals) || !totals.length) return 0;
    const sum = totals.reduce((a, b) => a + b, 0);
    return Math.round((sum / totals.length) * 100) / 100;
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
        const rate = Number(j && j.rates && j.rates[to]);
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
          const rate = Number(j && j[f] && j[f][t]);
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
      clearConversionFields(r);
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
      const effective = applyMarkup(base, pct);
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

  /* ---------- currencyChoices ----------
     An item keeps its own currency even after it was removed from the
     user's list — an editor must still be able to show and save it. Returns
     a NEW array: list, plus current appended when it's a non-empty string
     not already in list. Never mutates list.
  */
  function currencyChoices(list, current) {
    const l = Array.isArray(list) ? list.slice() : [];
    if (current && !l.includes(current)) l.push(current);
    return l;
  }

  /* ---------- iconHref ----------
     Generic icon-choice resolver shared by the home-screen icon and both
     header icons. "yoimiya" always wins; "custom" only resolves to the
     stored picture when it's a valid data:image/ string; anything else
     (including an unrecognized choice) falls back to walletSrc.
  */
  function iconHref(choice, custom, walletSrc) {
    if (choice === "yoimiya") return "./icon.png";
    if (choice === "custom" && typeof custom === "string" && custom.startsWith("data:image/")) {
      return custom;
    }
    return walletSrc;
  }

  /* ---------- homeIconHref ----------
     Picks the apple-touch-icon href for settings.homeIcon. Falls back to
     the wallet PNG (the default) for anything unrecognized, including a
     "custom" pick whose stored picture is missing or not a data:image/ URL.
  */
  function homeIconHref(s) {
    return iconHref(s && s.homeIcon, s && s.homeIconCustom, "./icon-wallet.png");
  }

  /* ---------- effectiveIconChoice ----------
     Which tile is really in effect for a (choice, custom) pair — the same
     resolution iconHref does, but naming the tile instead of the href. Used
     so a "custom" pick with no valid picture highlights "wallet" instead.
  */
  function effectiveIconChoice(choice, custom) {
    if (choice === "yoimiya") return "yoimiya";
    if (choice === "custom" && typeof custom === "string" && custom.startsWith("data:image/")) {
      return "custom";
    }
    return "wallet";
  }

  /* ---------- headerIconHref ----------
     Picks the header-icon href for the given mode ("debt" or anything else,
     treated as finance), reading that mode's choice + stored picture off
     settings `s` and defaulting to that mode's own wallet PNG (rose for
     debt).
  */
  function headerIconHref(s, mode) {
    if (mode === "debt") {
      return iconHref(s && s.headerIconDebtChoice, s && s.headerIconDebt, "./icon-wallet-red.png");
    }
    return iconHref(s && s.headerIconFinanceChoice, s && s.headerIconFinance, "./icon-wallet.png");
  }

  /* ---------- iconChoiceFromPicture ----------
     The header-choice inference rule, standalone: "custom" when `pic` is a
     data:image/ string, else "wallet". Shared by migrateIconChoices (below)
     and by buildSettingsPayload's fallback for a missing header choice, so
     the rule lives in exactly one place.
  */
  function iconChoiceFromPicture(pic) {
    return typeof pic === "string" && pic.startsWith("data:image/") ? "custom" : "wallet";
  }

  /* ---------- migrateIconChoices ----------
     Mutates and returns settings object `s` (no-op for null/non-object):
     for each header slot, an invalid/missing choice becomes "custom" when
     that slot's stored picture is a data:image/ string, else "wallet" — so
     a never-changed header (no choice field yet, no picture) lands on
     Wallet instead of the old implicit Yoimiya default. Also normalizes the
     home-icon fields the same way loadStore used to do inline.
  */
  function migrateIconChoices(s) {
    if (!s || typeof s !== "object") return s;
    const CHOICES = ["wallet", "yoimiya", "custom"];
    if (!CHOICES.includes(s.headerIconFinanceChoice)) {
      s.headerIconFinanceChoice = iconChoiceFromPicture(s.headerIconFinance);
    }
    if (!CHOICES.includes(s.headerIconDebtChoice)) {
      s.headerIconDebtChoice = iconChoiceFromPicture(s.headerIconDebt);
    }
    if (!CHOICES.includes(s.homeIcon)) s.homeIcon = "wallet";
    if (s.homeIconCustom === undefined) s.homeIconCustom = null;
    return s;
  }

  return {
    reconcileRenames, makeRateService, currencyChoices,
    iconHref, homeIconHref, effectiveIconChoice, headerIconHref,
    iconChoiceFromPicture, migrateIconChoices,
    amountInDefault, countNotCounted, applyMarkup, clearConversionFields,
    planReconversion, summarizeTotals, summaryAverage, yearsAverage,
  };
});
