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
      // toPrecision strips binary-float noise (0.027 * 1.025 -> 0.027674999...).
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
  };
});
