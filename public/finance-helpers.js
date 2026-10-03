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
     Pure: takes old settings, new settings, the records array and (optional)
     the recurring rules array, and mutates item.category / item.subcategory
     in place for any renames detected by stable id match. Records and rules
     share the same shape here ({ type, category, subcategory }) and follow
     exactly the same rules.
     A category or sub without an id (falsy) is never matched on either side:
     id-less entries would all collide under one key and could rename one
     category's (or sub's) items into another's.
  */
  function reconcileRenames(oldS, newS, records, rules) {
    const lists = [records, rules].filter(Array.isArray);
    if (!lists.length) return;
    const each = (fn) =>
      lists.forEach((list) =>
        list.forEach((r) => {
          if (r && typeof r === "object") fn(r);
        })
      );
    const arr = (x) => (Array.isArray(x) ? x : []);
    ["expense", "investment"].forEach((type) => {
      const oldById = {};
      arr(oldS && oldS[type]).forEach((c) => {
        if (c && c.id) oldById[c.id] = c;
      });
      arr(newS && newS[type]).forEach((nc) => {
        if (!nc || !nc.id) return;
        const oc = Object.prototype.hasOwnProperty.call(oldById, nc.id)
          ? oldById[nc.id]
          : null;
        if (!oc) return;
        if (oc.name && nc.name && oc.name !== nc.name) {
          each((r) => {
            if (r.type === type && r.category === oc.name) r.category = nc.name;
          });
        }
        const oldSub = {};
        arr(oc.subs).forEach((s) => {
          if (s && s.id) oldSub[s.id] = s;
        });
        arr(nc.subs).forEach((ns) => {
          if (!ns || !ns.id) return;
          const os = Object.prototype.hasOwnProperty.call(oldSub, ns.id)
            ? oldSub[ns.id]
            : null;
          if (os && os.name && ns.name && os.name !== ns.name) {
            each((r) => {
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

  /* ---------- reconversionMarkupPct ----------
     The card markup a conversion run applies to a NON-manual item (Bill,
     2026-10-01): the item's own stored fxMarkupPct if it was converted
     before (convertedAmount set); else the current setting `markupPct` ONLY
     for a failed foreign conversion (rateUnavailable — its save would have
     applied it); else 0, so an item that was simply in the old default
     currency never gets a card markup.
  */
  function reconversionMarkupPct(item, markupPct) {
    if (!item) return 0;
    if (item.convertedAmount != null) return Number(item.fxMarkupPct) || 0;
    return item.rateUnavailable ? (Number(markupPct) || 0) : 0;
  }

  /* ---------- dedupeGetRate ----------
     Wraps getRate(from, to, date) so each distinct `date:from:to` is
     requested once per wrapper: later callers share the first call's
     (in-flight or settled) promise, failures included. A sync throw
     becomes a rejection. Wrapping an already-wrapped function returns it
     unchanged, so the app can share one wrapper across both planners.
  */
  function dedupeGetRate(getRate) {
    if (typeof getRate === "function" && getRate._deduped) return getRate;
    const calls = new Map();
    const wrapped = (from, to, date) => {
      const key = `${date}:${from}:${to}`;
      if (!calls.has(key)) {
        calls.set(key, Promise.resolve().then(() => getRate(from, to, date)));
      }
      return calls.get(key);
    };
    wrapped._deduped = true;
    return wrapped;
  }

  /* ---------- mapLimit ----------
     Runs async fn(entry, index) over `list` with at most `concurrency`
     calls in flight (simple worker pool); resolves to the results in input
     order. fn is expected to catch its own failures.
  */
  async function mapLimit(list, concurrency, fn) {
    const total = Array.isArray(list) ? list.length : 0;
    const results = new Array(total);
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < total) {
        const i = nextIndex++;
        results[i] = await fn(list[i], i);
      }
    }
    const workerCount = Math.max(1, Math.min(concurrency || 6, total || 1));
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
  }

  /* ---------- planReconversion ----------
     Pure planner for design doc §6 ("Convert old records to USD?") — used
     for RECORDS (debts use debts.js planDebtReconversion: today's rate with
     exact cycle closure). Never mutates `items`. Considers only items where
     amountInDefault(item, def) is null; every other item is left out of the
     result entirely.
     opts = { getRate, markupPct, today, concurrency = 6, onProgress }
       - getRate(from, to, date) -> Promise<number|null>, may reject. Each
         distinct date:from:to is requested once (dedupeGetRate).
       - today: "YYYY-MM-DD", used to clamp a missing/future item.date for
         the resulting rateDate (not for the getRate call itself, which
         always gets the item's own raw date per design doc §6).
       - concurrency: max items converting at once (simple worker pool).
       - onProgress(done, total): called after each considered item settles.
     Per considered item:
       - Legacy manual item (manualRate truthy, has convertedAmount in some
         other currency): chains convertedAmount * rate(convertedCurrency ->
         def, item.date), keeping manualRate: true and no markup.
       - Otherwise: rate(item.currency -> def, item.date) with markup per
         reconversionMarkupPct (own stored pct if converted before; the
         current setting only for a rateUnavailable item; else 0).
     A null/non-finite rate or a thrown getRate fails that item. All items
     must succeed for the run to succeed: { ok: true, updates: [{ item,
     fields }] } (item = the original reference, considered order); any
     failure -> { ok: false, failed, total, failedItems } (failedItems = the
     original references, considered order) and nothing to apply.
  */
  async function planReconversion(items, def, opts) {
    const { markupPct, today, concurrency = 6, onProgress } = opts || {};
    const getRate = dedupeGetRate((opts || {}).getRate);
    const considered = Array.isArray(items)
      ? items.filter((it) => amountInDefault(it, def) === null)
      : [];
    const total = considered.length;
    let done = 0;

    async function settleOne(item) {
      const rateDate = !item.date || item.date > today ? today : item.date;
      try {
        if (item.manualRate && item.convertedAmount != null && item.convertedCurrency) {
          const r = await getRate(item.convertedCurrency, def, item.date);
          if (r == null || !Number.isFinite(r)) return { ok: false, item };
          const convertedAmount = round2(item.convertedAmount * r);
          const rate = parseFloat((convertedAmount / item.amount).toPrecision(10));
          return {
            ok: true,
            item,
            fields: { convertedCurrency: def, convertedAmount, rate, rateDate, manualRate: true },
          };
        }
        const pct = reconversionMarkupPct(item, markupPct);
        const base = await getRate(item.currency, def, item.date);
        if (base == null || !Number.isFinite(base)) return { ok: false, item };
        const eff = applyMarkup(base, pct);
        const convertedAmount = round2(item.amount * eff);
        const fields = { convertedCurrency: def, convertedAmount, rate: eff, rateDate };
        if (pct > 0) fields.fxMarkupPct = pct;
        return { ok: true, item, fields };
      } catch {
        return { ok: false, item };
      }
    }

    const results = await mapLimit(considered, concurrency, async (item) => {
      const res = await settleOne(item);
      done++;
      if (typeof onProgress === "function") onProgress(done, total);
      return res;
    });

    const failedItems = results.filter((r) => !r.ok).map((r) => r.item);
    if (failedItems.length > 0) {
      return { ok: false, failed: failedItems.length, total, failedItems };
    }
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

  /* ---------- categoryBreakdown ----------
     The breakdown pop-up's data (Summary page and dashboard donut): ALL the
     records given, by category and sub-category — no date or type filter (the
     caller picks the records). Only records whose amountInDefault(r, def) is
     not a finite Number (not counted, non-numeric, null/junk) are skipped.
     Grouped by r.category (missing = ""), then r.subcategory (blank or
     missing = ""). Returns { total, categories: [{ name, amount, pct, subs:
     [{ name, amount }] }] }:
       - amounts (and total) are rounded to cents at the end
       - categories: amount desc, then name; pct = Math.round(amount / total
         * 100), 0 when total is 0
       - subs: amount desc, then name; [] when none of the category's records
         has a sub-category, otherwise the no-sub records appear as
         { name: "" } (only when their amount > 0)
  */
  function categoryBreakdown(records, def) {
    const cents = (x) => Math.round(x * 100) / 100;
    const byName = (a, b) => b.amount - a.amount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const cats = new Map(); // category name -> { amount, subs: Map(sub name -> amount), hasSub }
    let total = 0;
    (Array.isArray(records) ? records : []).forEach((r) => {
      const amt = amountInDefault(r, def);
      if (amt === null || !Number.isFinite(amt)) return;
      const catName = r.category || "";
      const subName = r.subcategory || "";
      if (!cats.has(catName)) cats.set(catName, { amount: 0, subs: new Map(), hasSub: false });
      const c = cats.get(catName);
      c.amount += amt;
      c.subs.set(subName, (c.subs.get(subName) || 0) + amt);
      if (subName) c.hasSub = true;
      total += amt;
    });
    total = cents(total);
    const categories = Array.from(cats, ([name, c]) => {
      const amount = cents(c.amount);
      const subs = !c.hasSub ? [] : Array.from(c.subs, ([sub, a]) => ({ name: sub, amount: cents(a) }))
        .filter((s) => s.name || s.amount > 0)
        .sort(byName);
      return { name, amount, pct: total ? Math.round((amount / total) * 100) : 0, subs };
    });
    categories.sort(byName);
    return { total, categories };
  }

  /* ---------- summaryBreakdown ----------
     The Summary page's pop-up: one period's spending (or investments) by
     category and sub-category. opts = { type: "expense" | "investment", year,
     month } — month 0-11, or null/undefined for the whole year. Same record
     filter as summarizeTotals (YYYY-MM-DD date with month 01-12, matching type,
     amountInDefault(r, def) a finite Number), so `total` equals that period's
     summarizeTotals cell. The grouping, sorting and sub rules are
     categoryBreakdown's (same return shape).
  */
  function summaryBreakdown(records, def, opts) {
    const { type, year, month } = opts || {};
    const wholeYear = month === null || month === undefined;
    const inPeriod = (Array.isArray(records) ? records : []).filter((r) => {
      if (!r || (r.type !== "expense" && r.type !== "investment") || r.type !== type) return false;
      const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(r.date);
      if (!m) return false;
      const mo = Number(m[2]);
      if (mo < 1 || mo > 12) return false;
      return Number(m[1]) === year && (wholeYear || mo - 1 === month);
    });
    return categoryBreakdown(inPeriod, def);
  }

  /* ---------- labelSqueeze ----------
     The horizontal scale for a "Recently added" chip label (scaleX; the text
     height never changes). `widestWordPx` is the label's widest single word,
     `maxPx` the label's width, `minScale` the narrowest allowed (0.84).
       - the word fits (widestWordPx <= maxPx) -> 1, no squeeze
       - otherwise the ratio maxPx / widestWordPx, floored to 2 decimals so the
         word is never a hair too wide, but never below `minScale` (a word
         that still does not fit then breaks across lines as before)
       - any input that is not a positive finite number -> 1
     Pure.
  */
  function labelSqueeze(widestWordPx, maxPx, minScale) {
    const ok = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;
    if (!ok(widestWordPx) || !ok(maxPx) || !ok(minScale)) return 1;
    if (widestWordPx <= maxPx) return 1;
    return Math.max(minScale, Math.floor((maxPx / widestWordPx) * 100) / 100);
  }

  /* ---------- labelWords ----------
     The words of a "Recently added" chip label, for measuring the widest one:
     the text trimmed and split on runs of whitespace, empty pieces dropped
     ("Taxi / Ride" -> ["Taxi", "/", "Ride"]). null / undefined / "" -> [].
     Pure.
  */
  function labelWords(text) {
    return String(text == null ? "" : text).trim().split(/\s+/).filter(Boolean);
  }

  /* ---------- recentPicks ----------
     The Add-Record quick-pick row: the most recently added (category,
     subcategory) picks of one type. `cats` is that type's settings category
     list ([{ name, subs: [{ name }] }]). Returns [{ category, sub }] newest
     first, `sub` = "" for a main-type pick; at most `limit` (default 10).
       - recency is the record's numeric createdAt (not its date), newest
         first; records without a numeric createdAt sort last; ties (equal or
         missing createdAt) go to the later array position (newer record)
       - records of another type are ignored, and so are records made by a
         recurring rule (truthy ruleId) unless the user entered them by hand
         (manual === true — stamped when "Make this recurring" was ticked on
         Add Record, or on a banner Edit & Confirm)
       - each distinct pick appears once, at its newest occurrence; a main
         pick and a sub pick of one category are different picks
       - a category no longer in `cats` is skipped; a sub no longer under its
         category falls back to the main pick (and de-dups as such)
     Names match case-insensitively and come back in the settings' spelling.
     Pure: never mutates its inputs.
  */
  function recentPicks(records, type, cats, limit) {
    const max = limit === undefined ? 10 : limit;
    if (!Array.isArray(records) || !Array.isArray(cats)) return [];
    const lc = (x) => String(x).toLowerCase();
    const ms = (r) => (typeof r.createdAt === "number" && Number.isFinite(r.createdAt) ? r.createdAt : -Infinity);
    const picks = [];
    const seen = new Set();
    records
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r && r.type === type && (!r.ruleId || r.manual === true) && r.category)
      .sort((a, b) => {
        const x = ms(a.r), y = ms(b.r);
        if (x !== y) return y > x ? 1 : -1;
        return b.i - a.i; // tie: the later array position (newer record) first
      })
      .forEach(({ r }) => {
        if (picks.length >= max) return;
        const cat = cats.find((c) => lc(c.name) === lc(r.category));
        if (!cat) return;
        const subs = Array.isArray(cat.subs) ? cat.subs : [];
        const sub = r.subcategory ? subs.find((x) => lc(x.name) === lc(r.subcategory)) : null;
        const key = JSON.stringify([cat.name, sub ? sub.name : ""]);
        if (seen.has(key)) return;
        seen.add(key);
        picks.push({ category: cat.name, sub: sub ? sub.name : "" });
      });
    return picks;
  }

  /* ---------- Category editor helpers ----------
     iconsInUse(cats): the distinct icon ids used by one type's categories
     ([{ icon, subs: [{ icon? }] }]) and by their sub-categories that have an
     icon of their own (a sub with none follows its category, so adds nothing).
     Blank / non-string icons are skipped; first-seen order. Pure.
  */
  function iconsInUse(cats) {
    if (!Array.isArray(cats)) return [];
    const out = [];
    const add = (id) => {
      if (typeof id === "string" && id && !out.includes(id)) out.push(id);
    };
    cats.forEach((c) => {
      if (!c) return;
      add(c.icon);
      (Array.isArray(c.subs) ? c.subs : []).forEach((s) => s && add(s.icon));
    });
    return out;
  }

  /* categoryDraftError(draft, cats): "" when the Edit-category draft
     ({ id, name, subs: [{ name }] }) can be saved, else the first problem, as
     the message to show. `cats` is that type's category list. Checked in
     order:
       1. category name blank (trimmed)
       2. another category (different id) has the same name — trimmed,
          case-insensitive; re-casing the category's own name is fine
       3. any sub-category name blank
       4. two sub-categories share a name — trimmed, case-insensitive
     Messages quote the trimmed name as typed. Pure.
  */
  function categoryDraftError(draft, cats) {
    const name = String((draft && draft.name) || "").trim();
    if (!name) return "Enter a category name.";
    const lc = (x) => String(x).trim().toLowerCase();
    const others = Array.isArray(cats) ? cats : [];
    if (others.some((c) => c && c.id !== draft.id && lc(c.name) === lc(name)))
      return `A category named "${name}" already exists.`;
    const subs = Array.isArray(draft.subs) ? draft.subs : [];
    const names = subs.map((s) => String((s && s.name) || "").trim());
    if (names.some((n) => !n)) return "Enter a name for every sub-category.";
    const seen = new Set();
    for (const n of names) {
      if (seen.has(n.toLowerCase())) return `Two sub-categories are both named "${n}".`;
      seen.add(n.toLowerCase());
    }
    return "";
  }

  // The colour sheet's preset swatches, in display order (6 per row).
  const COLOR_PRESETS = [
    "#7c5cff", "#9d7dff", "#b06bff", "#ff6b81", "#ff8fa3", "#ff5a5a",
    "#ff8a3d", "#ffb066", "#ffd166", "#3ddc97", "#00c2a8", "#00d2b4",
    "#5cd0ff", "#2f93ff", "#3b7dd8", "#2b2f45", "#5a6072", "#8b93a7",
  ];

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
    planReconversion, summarizeTotals, summaryAverage, yearsAverage, categoryBreakdown, summaryBreakdown,
    reconversionMarkupPct, dedupeGetRate, mapLimit, recentPicks, labelSqueeze, labelWords,
    iconsInUse, categoryDraftError, COLOR_PRESETS,
  };
});
