/* MuniTrakr debt helpers — pure functions. Browser global + Node require. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

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
  function personBalances(debts, peopleById) {
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
      let lent = 0, back = 0;
      for (const d of list) {
        const amt = Number(d.convertedAmount != null ? d.convertedAmount : d.amount) || 0;
        if (d.type === "lend" || d.type === "pay-back") lent += amt;
        else if (d.type === "borrow" || d.type === "paid-back") back += amt;
        // Cycle reset: when net hits zero with non-zero activity, reset.
        if (lent === back && lent > 0) {
          lent = 0;
          back = 0;
        }
      }
      const outstanding = lent - back;
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
  function annotateSettlements(debts) {
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
      let lent = 0, back = 0;
      for (const d of list) {
        const amt = Number(d.convertedAmount != null ? d.convertedAmount : d.amount) || 0;
        const prevNet = lent - back;
        if (d.type === "lend" || d.type === "pay-back") lent += amt;
        else if (d.type === "borrow" || d.type === "paid-back") back += amt;
        const nextNet = lent - back;
        const settled = prevNet !== 0 && nextNet === 0 && lent > 0;
        out.set(d.id, { settled });
        if (settled) { lent = 0; back = 0; }
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
  function balanceBefore(debts, recordId, peopleById) {
    if (!Array.isArray(debts) || !recordId) return 0;
    const target = debts.find((d) => d && d.id === recordId);
    if (!target || !target.personId) return 0;
    if (peopleById && !peopleById[target.personId]) return 0;
    const list = debts
      .filter((d) => d && d.personId === target.personId)
      .sort(_chronoCmp);
    let lent = 0, back = 0;
    for (const d of list) {
      if (d.id === recordId) break;
      const amt = Number(d.convertedAmount != null ? d.convertedAmount : d.amount) || 0;
      if (d.type === "lend" || d.type === "pay-back") lent += amt;
      else if (d.type === "borrow" || d.type === "paid-back") back += amt;
      if (lent === back && lent > 0) { lent = 0; back = 0; }
    }
    return lent - back;
  }

  // Returns either a single-record plan or a two-record split plan for an entered debt.
  // `entered` is the user's intended record (no id/createdAt — caller stamps those).
  // `balanceBeforeSigned` is the person's outstanding immediately before this record,
  // signed (positive = they owe me, negative = I owe them).
  // `defaultCurrency` is store.settings.defaultCurrency.
  function planSplit(entered, balanceBeforeSigned, defaultCurrency) {
    if (!entered || typeof entered !== "object") return { split: false, a: entered };
    const settlingType = entered.type === "paid-back" || entered.type === "pay-back";
    if (!settlingType) return { split: false, a: entered };

    const outstandingAbs = Math.abs(balanceBeforeSigned);
    if (outstandingAbs === 0) return { split: false, a: entered };

    const enteredAmtDefault = Number(
      entered.convertedAmount != null ? entered.convertedAmount : entered.amount
    ) || 0;
    const overshoot = enteredAmtDefault - outstandingAbs;
    if (overshoot <= 0) return { split: false, a: entered };

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
  function wouldOvershoot(debts, editedRecord, defaultCurrency) {
    if (!editedRecord || (editedRecord.type !== "paid-back" && editedRecord.type !== "pay-back")) {
      return false;
    }
    if (!Array.isArray(debts)) return false;
    const swapped = debts.map((d) => (d && d.id === editedRecord.id) ? editedRecord : d);
    if (!swapped.some((d) => d && d.id === editedRecord.id)) swapped.push(editedRecord);

    const before = balanceBefore(swapped, editedRecord.id);

    const amt = Number(
      editedRecord.convertedAmount != null ? editedRecord.convertedAmount : editedRecord.amount
    ) || 0;

    // Direction-cycle mismatch: paid-back assumes they-owe (before > 0); pay-back assumes i-owe (before < 0).
    // Anything else is an "anti-direction" edit -> treat as overshoot.
    if (editedRecord.type === "paid-back" && before <= 0) return true;
    if (editedRecord.type === "pay-back" && before >= 0) return true;

    return amt > Math.abs(before);
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

  return { personBalances, totalsAcrossPeople, annotateSettlements, balanceBefore, planSplit, wouldOvershoot, evenShares };
});
