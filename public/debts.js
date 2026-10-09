/* MuniTrakr debt helpers — pure functions. Browser global + Node require. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(require("./finance-helpers"));
  } else {
    // finance-helpers.js loads first in index.html and exports the globals.
    Object.assign(root, factory(root));
  }
})(typeof window !== "undefined" ? window : globalThis, function (fh) {

  // Every balance below counts only items in `defaultCurrency` — the ONE rule
  // is finance-helpers' amountInDefault. An item it returns null for ("not
  // counted": converted to an old default, or rateUnavailable) is skipped
  // entirely: it moves no balance and takes no part in the cycle/settlement math.
  //
  // Transition guard (v86, mixed service-worker cache): an older cached
  // finance-helpers.js has no amountInDefault global, and an older cached
  // app.js calls these functions without a defaultCurrency. In either case
  // every item counts the pre-v86 way (convertedAmount ?? amount) instead of
  // throwing or dropping everything. That is the OLD behaviour, not a second
  // copy of the v86 rule; it stops mattering once both files are v86+.
  const sharedAmountInDefault = fh && typeof fh.amountInDefault === "function"
    ? fh.amountInDefault : null;
  function amountInDefault(item, defaultCurrency) {
    if (!sharedAmountInDefault || !defaultCurrency) {
      if (!item || typeof item !== "object") return null;
      return Number(item.convertedAmount != null ? item.convertedAmount : item.amount);
    }
    return sharedAmountInDefault(item, defaultCurrency);
  }

  // Money is compared and accumulated in integer cents, so float sums of
  // 2-decimal amounts close a cycle exactly (14.6 + 0.15 vs 14.75). Integer
  // amounts (e.g. THB) behave exactly as before.
  function _cents(x) {
    return Math.round((Number(x) || 0) * 100);
  }
  // +1 for types that grow "they owe me" (lend, pay-back), -1 for types that
  // grow "I owe them" (borrow, paid-back), 0 for anything else. THE sign rule
  // for every balance/cycle walk in this file, planDebtReconversion included.
  function _signOf(type) {
    if (type === "lend" || type === "pay-back") return 1;
    if (type === "borrow" || type === "paid-back") return -1;
    return 0;
  }

  // Returns a Map<personId, { lent, back, outstanding, direction, progress }>.
  // - lent  = sum of "lend" amounts in the CURRENT cycle for the person.
  // - back  = sum of "borrow" + "paid-back" amounts in the CURRENT cycle.
  // - outstanding = lent - back (signed; +ve = they owe me, -ve = I owe them).
  // - direction   = "they-owe" | "i-owe" | "clear".
  // - progress    = 0..1 (only meaningful when direction !== "clear").
  //
  // A "cycle" starts at zero and ends the moment a record brings the running
  // net back to exactly zero. After that point, accumulators reset — so progress
  // on a fresh post-settlement debt starts at 0%, not at the inflated historical
  // ratio. Records of type "borrow" and "paid-back" are mathematically identical
  // here; only the badge text in the UI differs.
  function personBalances(debts, peopleById, defaultCurrency) {
    if (!Array.isArray(debts)) return new Map();
    const groups = new Map();
    for (const d of debts) {
      if (!d || !d.personId) continue;
      // peopleById is optional; if provided, ignore debts whose person was deleted.
      if (peopleById && !peopleById[d.personId]) continue;
      if (!groups.has(d.personId)) groups.set(d.personId, []);
      groups.get(d.personId).push(d);
    }
    const out = new Map();
    for (const [pid, list] of groups) {
      list.sort(_chronoCmp);
      let lentC = 0, backC = 0; // integer cents
      for (const d of list) {
        const inDef = amountInDefault(d, defaultCurrency);
        if (inDef === null) continue; // not counted
        const sign = _signOf(d.type);
        if (sign > 0) lentC += _cents(inDef);
        else if (sign < 0) backC += _cents(inDef);
        // Cycle reset: when net hits zero with non-zero activity, reset.
        if (lentC === backC && lentC > 0) {
          lentC = 0;
          backC = 0;
        }
      }
      const lent = lentC / 100, back = backC / 100;
      const outstanding = (lentC - backC) / 100;
      let direction = "clear", progress = 1;
      if (outstanding > 0) {
        direction = "they-owe";
        progress = lent > 0 ? Math.min(1, Math.max(0, back / lent)) : 0;
      } else if (outstanding < 0) {
        direction = "i-owe";
        progress = back > 0 ? Math.min(1, Math.max(0, lent / back)) : 0;
      }
      out.set(pid, { lent, back, outstanding, direction, progress });
    }
    return out;
  }

  // Walks a list of debts in chronological order; returns Map<debt.id, { settled }>.
  // `settled === true` for records that brought the running net to exactly zero
  // (i.e. fully closed out the previous cycle). Use to render a "Settled" badge.
  // Not-counted records get { settled: false } and don't touch the running net.
  function annotateSettlements(debts, defaultCurrency) {
    const out = new Map();
    if (!Array.isArray(debts)) return out;
    const groups = new Map();
    for (const d of debts) {
      if (!d || !d.id || !d.personId) continue;
      if (!groups.has(d.personId)) groups.set(d.personId, []);
      groups.get(d.personId).push(d);
    }
    for (const [, list] of groups) {
      list.sort(_chronoCmp);
      let lentC = 0, backC = 0; // integer cents
      for (const d of list) {
        const inDef = amountInDefault(d, defaultCurrency);
        if (inDef === null) { out.set(d.id, { settled: false }); continue; } // not counted
        const prevNet = lentC - backC;
        const sign = _signOf(d.type);
        if (sign > 0) lentC += _cents(inDef);
        else if (sign < 0) backC += _cents(inDef);
        const nextNet = lentC - backC;
        const settled = prevNet !== 0 && nextNet === 0 && lentC > 0;
        out.set(d.id, { settled });
        if (settled) { lentC = 0; backC = 0; }
      }
    }
    return out;
  }

  // Given the Map from personBalances, return { totalLend, totalBorrow }.
  // totalLend  = sum of outstanding for people whose direction === "they-owe".
  // totalBorrow = -sum of outstanding for people whose direction === "i-owe" (unsigned).
  function totalsAcrossPeople(balances) {
    let totalLend = 0, totalBorrow = 0;
    if (!balances) return { totalLend: 0, totalBorrow: 0 };
    for (const [, row] of balances) {
      if (row.direction === "they-owe") totalLend += row.outstanding;
      else if (row.direction === "i-owe") totalBorrow += -row.outstanding;
    }
    return { totalLend, totalBorrow };
  }

  // Chronological compare: by `date` ascending, then `createdAt` ascending.
  function _chronoCmp(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  }

  // Returns the person's outstanding amount IMMEDIATELY BEFORE the given record,
  // using the same cycle-reset logic as personBalances. Returns 0 if the record
  // isn't found, has no person, or is the first chronological record for the person.
  // The "outstanding" is signed (positive = they owe you).
  function balanceBefore(debts, recordId, peopleById, defaultCurrency) {
    if (!Array.isArray(debts) || !recordId) return 0;
    const target = debts.find((d) => d && d.id === recordId);
    if (!target || !target.personId) return 0;
    if (peopleById && !peopleById[target.personId]) return 0;
    const list = debts
      .filter((d) => d && d.personId === target.personId)
      .sort(_chronoCmp);
    let lentC = 0, backC = 0; // integer cents
    for (const d of list) {
      if (d.id === recordId) break;
      const inDef = amountInDefault(d, defaultCurrency);
      if (inDef === null) continue; // not counted
      const sign = _signOf(d.type);
      if (sign > 0) lentC += _cents(inDef);
      else if (sign < 0) backC += _cents(inDef);
      if (lentC === backC && lentC > 0) { lentC = 0; backC = 0; }
    }
    return (lentC - backC) / 100;
  }

  // Returns the person's outstanding amount IMMEDIATELY AFTER the given record,
  // signed (positive = they owe you). Deliberately calls balanceBefore WITHOUT a
  // people map — a statement for a since-deleted person must still count their
  // full remaining history, not stop dead at 0 the way the people-gated caller does.
  // Returns 0 if the record isn't found or `debts` isn't an array. A
  // not-counted target adds nothing (after === before).
  function balanceAfterRecord(debts, recordId, defaultCurrency) {
    if (!Array.isArray(debts) || !recordId) return 0;
    const target = debts.find((d) => d && d.id === recordId);
    if (!target) return 0;
    const amtC = _cents(amountInDefault(target, defaultCurrency) || 0);
    const signedC = (target.type === "lend" || target.type === "pay-back") ? amtC : -amtC;
    return (_cents(balanceBefore(debts, recordId, undefined, defaultCurrency)) + signedC) / 100;
  }

  // Rounds to a whole number, half away from zero, so a "they owe me" and an
  // "I owe them" balance of the same size round alike. toPrecision(15) first
  // strips binary noise (1474.9999999999998 -> 1475) before the tie decision.
  function _roundHalfAway(x) {
    const r = Math.round(parseFloat(Math.abs(x).toPrecision(15)));
    return x < 0 ? -r : r;
  }

  // Plans converting every not-counted debt into `def` (Bill, 2026-10-01:
  // debts convert at TODAY's rate and settled cycles stay settled; records
  // keep their own dates' rates via finance-helpers' planReconversion).
  // Pure: never mutates `debts` (pass the whole list — counted debts are
  // read, never updated); async only for the rates.
  // opts = { getRate, markupPct, today, concurrency = 6, onProgress } — the
  // same shape as planReconversion. getRate is de-duplicated per
  // date:from:to (dedupeGetRate), at most `concurrency` requests run at
  // once, and onProgress(done, total) fires as each rate arrives (done
  // counts the debts that rate covers).
  //
  // Per not-counted debt: old currency P = convertedCurrency when it has a
  // conversion (convertedAmount set), else its own currency; old value
  // V = amountInDefault(debt, P). The new amount is derived from V with ONE
  // rate per pair, rate(P -> def, today) — never from the original foreign
  // amount. Markup: none for a debt converted before (V already carries it)
  // or one that was in the old default; the current setting only for a
  // rateUnavailable debt, as its save would have applied
  // (reconversionMarkupPct). m = that rate with its markup.
  //
  // Exact cycle closure (residue pin): per person, walking the debts in the
  // balance code's order (_chronoCmp) with its sign rule (_signOf), the new
  // running balance is the old one × m in whole cents:
  //   newBalC_i = roundHalfAway(oldBalC_i × m)
  //   convertedAmount_i = |newBalC_i − newBalC_(i−1)| / 100
  // Rounding is monotone, so each difference has the debt's own direction or
  // is 0 (a debt that rounds to 0 keeps convertedAmount 0 — still counted,
  // never dropped). Wherever the old balance was exactly 0 (a settled cycle)
  // the new one is exactly 0, and every balance is round2(old × m).
  // The pin applies only to a person whose debts are ALL not counted and
  // share one P and one markup (a single m). Otherwise — a debt already
  // counted in def (its amount isn't old × m, so no closure can be
  // promised) or mixed old currencies/markups — each of that person's debts
  // falls back to per-debt rounding, round2(V × m). Debts with no personId
  // or an unknown type (sign 0, moves no balance) are per-debt too.
  //
  // Fields per debt: convertedCurrency = def, convertedAmount, rate = m × V /
  // amount to 10 significant digits (the effective original-currency -> def
  // rate used, before cent rounding), rateDate = today; manualRate: true kept
  // when set; fxMarkupPct only when a markup was applied (never for a debt
  // converted before). Result: { ok: true, updates: [{ item, fields }] }
  // (item = the original reference, input order) or, when any rate is
  // null/non-finite/throws, { ok: false, failed, total, failedItems } with
  // nothing to apply (all or nothing).
  async function planDebtReconversion(debts, def, opts) {
    const { markupPct, today, concurrency = 6, onProgress } = opts || {};
    const getRate = fh.dedupeGetRate(opts && opts.getRate);
    const all = Array.isArray(debts) ? debts.filter((d) => d && typeof d === "object") : [];
    const considered = all.filter((d) => amountInDefault(d, def) === null);
    const total = considered.length;

    const info = new Map(); // debt -> { P, V, pct }
    for (const d of considered) {
      const chained = d.convertedAmount != null && !!d.convertedCurrency;
      const P = chained ? d.convertedCurrency : d.currency;
      const V = Number(amountInDefault(d, P)) || 0;
      const pct = chained ? 0 : fh.reconversionMarkupPct(d, markupPct);
      info.set(d, { P, V, pct });
    }

    // One rate per old currency (all at today's date).
    const olds = [...new Set(considered.map((d) => info.get(d).P))];
    const rateOf = new Map();
    let done = 0;
    await fh.mapLimit(olds, concurrency, async (P) => {
      let r = null;
      try { r = await getRate(P, def, today); } catch { r = null; }
      rateOf.set(P, r != null && Number.isFinite(r) ? r : null);
      done += considered.filter((d) => info.get(d).P === P).length;
      if (typeof onProgress === "function") onProgress(done, total);
    });

    const failedItems = considered.filter((d) => rateOf.get(info.get(d).P) == null);
    if (failedItems.length > 0) {
      return { ok: false, failed: failedItems.length, total, failedItems };
    }
    const mult = (d) => fh.applyMarkup(rateOf.get(info.get(d).P), info.get(d).pct);

    // Residue pin, per eligible person.
    const pinned = new Map(); // debt -> convertedAmount
    const byPerson = new Map();
    for (const d of all) {
      if (!d.personId) continue;
      if (!byPerson.has(d.personId)) byPerson.set(d.personId, []);
      byPerson.get(d.personId).push(d);
    }
    for (const [, list] of byPerson) {
      if (!list.every((d) => info.has(d))) continue; // has a counted debt
      const first = info.get(list[0]);
      if (!list.every((d) => info.get(d).P === first.P && info.get(d).pct === first.pct)) continue;
      const m = mult(list[0]);
      list.sort(_chronoCmp);
      let oldC = 0, newC = 0;
      for (const d of list) {
        const sign = _signOf(d.type);
        if (sign === 0) continue; // moves no balance -> per-debt below
        oldC += sign * _cents(info.get(d).V);
        const nextC = _roundHalfAway(oldC * m);
        pinned.set(d, Math.abs(nextC - newC) / 100);
        newC = nextC;
      }
    }

    const updates = considered.map((d) => {
      const { V, pct } = info.get(d);
      const m = mult(d);
      const convertedAmount = pinned.has(d) ? pinned.get(d) : _roundHalfAway(V * m * 100) / 100;
      const amt = Number(d.amount);
      const rate = parseFloat((amt > 0 ? (m * V) / amt : m).toPrecision(10));
      const fields = { convertedCurrency: def, convertedAmount, rate, rateDate: today };
      if (d.manualRate) fields.manualRate = true;
      if (pct > 0) fields.fxMarkupPct = pct;
      return { item: d, fields };
    });
    return { ok: true, updates };
  }

  // Returns either a single-record plan or a two-record split plan for an entered debt.
  // `entered` is the user's intended record (no id/createdAt — caller stamps those).
  // `balanceBeforeSigned` is the person's outstanding immediately before this record,
  // signed (positive = they owe me, negative = I owe them).
  // `defaultCurrency` is store.settings.defaultCurrency.
  // A not-counted `entered` (rateUnavailable offline save, or an old item
  // converted to a previous default) contributes 0 in the default currency, so
  // it can never overshoot: it passes through unsplit and never throws.
  function planSplit(entered, balanceBeforeSigned, defaultCurrency) {
    if (!entered || typeof entered !== "object") return { split: false, a: entered };
    const settlingType = entered.type === "paid-back" || entered.type === "pay-back";
    if (!settlingType) return { split: false, a: entered };

    // Compared and split in integer cents (exact halves, no float residue).
    const outstandingC = Math.abs(_cents(balanceBeforeSigned));
    if (outstandingC === 0) return { split: false, a: entered };

    const enteredC = _cents(amountInDefault(entered, defaultCurrency) || 0);
    const overshootC = enteredC - outstandingC;
    if (overshootC <= 0) return { split: false, a: entered };
    const outstandingAbs = outstandingC / 100;
    const overshoot = overshootC / 100;

    // Opposite-cycle type for record B: paid-back -> borrow, pay-back -> lend.
    const oppositeType = entered.type === "paid-back" ? "borrow" : "lend";

    // Always record both halves in default currency. Drop original-currency info on split.
    const a = {
      type: entered.type,
      personId: entered.personId,
      date: entered.date,
      amount: outstandingAbs,
      currency: defaultCurrency,
      notes: entered.notes || "",
    };
    const b = {
      type: oppositeType,
      personId: entered.personId,
      date: entered.date,
      amount: overshoot,
      currency: defaultCurrency,
      notes: entered.notes || "",
    };
    return { split: true, a, b };
  }

  // Returns true if applying `editedRecord` to `debts` (replacing the existing record with the
  // same id, or appending if none) would produce a settling-type record whose amount overshoots
  // the cycle's open balance — i.e. the equivalent of an Add-time overshoot that the split modal
  // would handle. Edits that would trigger this are blocked in the UI.
  // A not-counted `editedRecord` (only possible when editing an old item)
  // contributes 0: it never overshoots by amount, but the direction-mismatch
  // rule below still applies unchanged. Never throws.
  function wouldOvershoot(debts, editedRecord, defaultCurrency) {
    if (!editedRecord || (editedRecord.type !== "paid-back" && editedRecord.type !== "pay-back")) {
      return false;
    }
    if (!Array.isArray(debts)) return false;
    const swapped = debts.map((d) => (d && d.id === editedRecord.id) ? editedRecord : d);
    if (!swapped.some((d) => d && d.id === editedRecord.id)) swapped.push(editedRecord);

    const before = balanceBefore(swapped, editedRecord.id, undefined, defaultCurrency);

    const amt = amountInDefault(editedRecord, defaultCurrency) || 0;

    // Direction-cycle mismatch: paid-back assumes they-owe (before > 0); pay-back assumes i-owe (before < 0).
    // Anything else is an "anti-direction" edit -> treat as overshoot.
    if (editedRecord.type === "paid-back" && before <= 0) return true;
    if (editedRecord.type === "pay-back" && before >= 0) return true;

    return _cents(amt) > Math.abs(_cents(before));
  }

  // Splits `total` into `count` shares, each rounded to 2 decimals, that sum
  // cent-exactly to `total`. Index 0 absorbs the rounding remainder — callers
  // put the payer there so other participants' shares stay clean numbers.
  // Returns [] when total is not a positive finite number or count < 1.
  function evenShares(total, count) {
    const t = Number(total);
    const n = Math.floor(Number(count));
    if (!Number.isFinite(t) || !(t > 0) || !Number.isFinite(n) || !(n >= 1)) return [];
    const cents = Math.round(t * 100);
    const base = Math.floor(cents / n);
    const first = cents - base * (n - 1);
    const out = [first / 100];
    for (let i = 1; i < n; i++) out.push(base / 100);
    return out;
  }

  // Split the REMAINING amount (total − already-filled shares) evenly across
  // blankCount blank fields, cent-exact, largest share at index 0. Returns []
  // when nothing positive is left to distribute or any input is invalid
  // (negative or non-finite filled entries are invalid — the caller's save
  // validation rejects them anyway).
  function fillBlanks(total, filled, blankCount) {
    const t = Number(total);
    const n = Math.floor(Number(blankCount));
    if (!Number.isFinite(t) || !(t > 0) || !Number.isFinite(n) || !(n >= 1)) return [];
    if (!Array.isArray(filled)) return [];
    let filledCents = 0;
    for (const f of filled) {
      const v = Number(f);
      if (!Number.isFinite(v) || v < 0) return [];
      filledCents += Math.round(v * 100);
    }
    const remainingCents = Math.round(t * 100) - filledCents;
    if (remainingCents <= 0) return [];
    return evenShares(remainingCents / 100, n);
  }

  // Strips the auto-generated split-bill breakdown ("Split bill — total …")
  // from a notes string, leaving only the user's own notes. The breakdown is
  // generated at save time and tied to that save's debts (amounts, names) —
  // it must not be inherited by a Duplicate, which starts a fresh, unsaved
  // copy that may or may not be split again.
  function stripSplitBreakdown(notes) {
    return String(notes || "").replace(/(?:^| · )Split bill — total .*$/, "");
  }

  // Which debts a split bill produces — the ONE rule (app.js only executes it).
  // `payerId` null / "me" / missing / blank / not a string = I paid: one
  // { personId, amount } lend per entry of `parts`, amounts as given. Any other
  // (non-blank string) `payerId` = that participant
  // paid: I owe them my share (`mine`) and nothing else — the others settle with
  // the payer, not with me — returned as { owe: { personId, amount } }, never
  // together with lends. The caller nets `owe` against the payer's balance via
  // planPaidBy. Invalid input (non-object, `parts` not an array on the lends
  // path, `mine` not a finite number on the owe path) -> { lends: [] }. Never
  // mutates its input; amounts are whatever the caller rounded them to.
  function planSplitDebts(input) {
    if (!input || typeof input !== "object") return { lends: [] };
    const payerId = input.payerId;
    if (typeof payerId === "string" && payerId.trim() !== "" && payerId !== "me") {
      const mine = input.mine;
      if (typeof mine !== "number" || !Number.isFinite(mine)) return { lends: [] };
      return { owe: { personId: payerId, amount: mine } };
    }
    if (!Array.isArray(input.parts)) return { lends: [] };
    return {
      lends: input.parts
        .filter((p) => p && typeof p === "object")
        .map((p) => ({ personId: p.personId, amount: p.amount })),
    };
  }

  // Plans the debt record(s) for a "paid by someone else" expense: the payer
  // fronted `entered.amount`, netted against whatever they already owed me.
  // `entered` is the user's intended record (no id/createdAt — caller stamps
  // those; `type` is set here, this function does not mutate `entered`, it
  // returns new records).
  // `balanceBeforeSigned` is the person's outstanding immediately before this
  // record, signed (positive = they owe me, negative = I owe them).
  // `defaultCurrency` is store.settings.defaultCurrency.
  // The positivity check below validates what the user typed (its own
  // currency), so an offline not-counted entry still plans a plain borrow.
  // Its default-currency value is read by planSplit via amountInDefault: a
  // not-counted entry contributes 0 there, so it never splits (never throws).
  function planPaidBy(entered, balanceBeforeSigned, defaultCurrency) {
    if (!entered || typeof entered !== "object") return { records: [] };
    const amt = Number(entered.amount);
    if (!Number.isFinite(amt) || !(amt > 0)) return { records: [] };

    if (balanceBeforeSigned > 0) {
      // They owe me: settle the cycle first (paid-back), splitting off a
      // fresh borrow if the amount overshoots what they owed.
      const copy = Object.assign({}, entered, { type: "paid-back" });
      const plan = planSplit(copy, balanceBeforeSigned, defaultCurrency);
      return { records: plan.split ? [plan.a, plan.b] : [plan.a] };
    }

    // Balance clear, or I already owe them: this is simply a new borrow.
    const copy = Object.assign({}, entered, { type: "borrow" });
    return { records: [copy] };
  }

  // Selections on the debt screens are always one contiguous block (in display
  // order, `ids` top-to-bottom = newest-to-oldest) so a shared statement image
  // can never have gaps — its "previous" balance is then the true balance
  // before the first selected record. Returns the NEW selection as an array
  // in display order; never mutates `ids` or `selected`.
  function blockSelect(ids, selected, tappedId) {
    if (!Array.isArray(ids)) ids = [];
    const selectedIds = selected instanceof Set ? Array.from(selected) : (Array.isArray(selected) ? selected : []);
    const selectedPositions = [];
    for (const id of selectedIds) {
      const pos = ids.indexOf(id);
      if (pos !== -1) selectedPositions.push(pos);
    }

    const restrictedSelection = () => {
      const posSet = new Set(selectedPositions);
      return ids.filter((_, i) => posSet.has(i));
    };

    const tappedPos = ids.indexOf(tappedId);
    if (tappedPos === -1) return restrictedSelection();

    if (selectedPositions.length === 0) return [tappedId];

    const top = Math.min(...selectedPositions);
    const bottom = Math.max(...selectedPositions);

    if (tappedPos < top || tappedPos > bottom) {
      // Not in the block: extend to include it, filling any gap.
      return ids.slice(Math.min(top, tappedPos), Math.max(bottom, tappedPos) + 1);
    }

    if (tappedPos === top) {
      // Top of the block: drop only it.
      return ids.slice(top + 1, bottom + 1);
    }

    // Middle or bottom: it and everything below (older) are dropped.
    return ids.slice(top, tappedPos);
  }

  return { personBalances, totalsAcrossPeople, annotateSettlements, balanceBefore, balanceAfterRecord, planDebtReconversion, planSplit, wouldOvershoot, evenShares, fillBlanks, stripSplitBreakdown, planSplitDebts, planPaidBy, blockSelect };
});
