/* MuniTrakr debt share-card renderer.
   debtCardModel() is pure (every string + flag the card shows) and Node-testable.
   renderDebtCard() draws that model onto a canvas — browser only. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== "undefined" ? window : globalThis, function () {

  function fmtNum(v) {
    return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  // Turns a debt + its context into every string the card draws. Pure: no
  // canvas, no DOM, no store access — so the wording and the running-balance
  // math can be tested in Node.
  function debtCardModel(o) {
    const opts = o || {};
    const debt = opts.debt || {};
    const lang = opts.language === "th" ? "th" : "en";
    const me = opts.userName || "Me";
    const them = opts.personName || "(deleted person)";
    const defaultCurrency = opts.defaultCurrency || "";
    const balanceBefore = Number(opts.balanceBefore) || 0;

    // Full sentence so the recipient knows who's involved without app context.
    const tagSentence = lang === "th"
      ? (debt.type === "lend"      ? them + " ยืมเงินจาก " + me :
         debt.type === "borrow"    ? me   + " ยืมเงินจาก " + them :
         debt.type === "paid-back" ? them + " คืนเงินให้ " + me :
         debt.type === "pay-back"  ? me   + " คืนเงินให้ " + them : "")
      : (debt.type === "lend"      ? them + " borrowed from " + me :
         debt.type === "borrow"    ? me   + " borrowed from " + them :
         debt.type === "paid-back" ? them + " paid back to "  + me :
         debt.type === "pay-back"  ? me   + " paid back to "  + them : "");

    const direction = (debt.type === "lend" || debt.type === "pay-back") ? "out" : "in";

    const showConverted =
      debt.convertedAmount != null && debt.convertedCurrency &&
      debt.convertedCurrency !== debt.currency;
    const convertedText = showConverted
      ? "≈ " + fmtNum(debt.convertedAmount) + " " + debt.convertedCurrency +
        (debt.rate
          ? " @ " + Number(debt.rate).toLocaleString(undefined, { maximumFractionDigits: 4 })
          : "")
      : null;

    // Running balance is always expressed in the default currency.
    const recordAmtInDefault =
      (debt.convertedAmount != null && debt.convertedCurrency === defaultCurrency)
        ? Number(debt.convertedAmount)
        : (debt.currency === defaultCurrency
            ? Number(debt.amount)
            : Number(debt.convertedAmount || debt.amount));

    const delta = (direction === "out" ? 1 : -1) * recordAmtInDefault;
    const newBalance = balanceBefore + delta;
    // Magnitudes only — the operator carries direction, so the equation reads
    // the same whether the cycle is "they owe me" or "I owe them".
    const grows = balanceBefore === 0 ? true : (Math.sign(delta) === Math.sign(balanceBefore));
    const mathText = balanceBefore === 0
      ? null
      : fmtNum(Math.abs(balanceBefore)) + (grows ? " + " : " − ") + fmtNum(Math.abs(delta));

    const rawNotes = debt.notes ? String(debt.notes).replace(/\s+/g, " ").trim() : "";

    return {
      name: them,
      tagSentence,
      direction,
      amountText: fmtNum(debt.amount),
      currencyText: debt.currency || "",
      dateText: debt.date || "",
      convertedText,
      notesText: rawNotes || null,
      notesLabel: lang === "th" ? "โน้ต" : "Notes",
      outstandingLabel: lang === "th" ? "ยอดคงค้าง" : "Outstanding",
      mathText,
      totalText: fmtNum(Math.abs(newBalance)),
      totalCurrency: defaultCurrency,
      isSettled: newBalance === 0 && balanceBefore !== 0,
      settledLabel: lang === "th" ? "เคลียร์แล้ว" : "Settled",
    };
  }

  return { debtCardModel };
});
