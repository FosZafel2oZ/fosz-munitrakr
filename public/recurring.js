/* MuniTrakr recurring rules — pure functions. Browser global + Node require. */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    Object.assign(root, factory());
  }
})(typeof window !== "undefined" ? window : globalThis, function () {
  // ---- Date helpers (string-based YYYY-MM-DD, no `new Date(string)`) ----
  function parseYMD(s) {
    const [y, m, d] = s.split("-").map(Number);
    return { y, m, d };
  }
  function formatYMD({ y, m, d }) {
    const mm = String(m).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }
  function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }
  function lastDayOfMonth(y, m) {
    return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }
  function addDays(ymd, n) {
    // Use local-date arithmetic via Date but only with integer Y/M/D inputs.
    const d = new Date(ymd.y, ymd.m - 1, ymd.d);
    d.setDate(d.getDate() + n);
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  function addMonths(ymd, n) {
    const totalMonths = (ymd.y * 12 + (ymd.m - 1)) + n;
    const y = Math.floor(totalMonths / 12);
    const m = (totalMonths % 12) + 1;
    const d = Math.min(ymd.d, lastDayOfMonth(y, m));
    return { y, m, d };
  }
  function addYears(ymd, n) {
    const y = ymd.y + n;
    const d = Math.min(ymd.d, lastDayOfMonth(y, ymd.m));
    return { y, m: ymd.m, d };
  }
  function cmpYMD(a, b) {
    if (a.y !== b.y) return a.y - b.y;
    if (a.m !== b.m) return a.m - b.m;
    return a.d - b.d;
  }

  function computeOccurrences(rule, todayStr) {
    if (rule.paused || !rule.cadence) return [];
    const today = parseYMD(todayStr);
    const endCap = rule.endDate ? parseYMD(rule.endDate) : null;
    const remaining = rule.maxOccurrences != null
      ? Math.max(0, rule.maxOccurrences - (rule.occurrenceCount || 0))
      : Infinity;
    if (remaining === 0) return [];

    // Start cursor = day after lastGeneratedDate, else startDate.
    let cursor = rule.lastGeneratedDate
      ? addDays(parseYMD(rule.lastGeneratedDate), 1)
      : parseYMD(rule.startDate);

    // Cadence-specific "snap-up to next valid date >= cursor".
    cursor = snapToCadence(cursor, rule.cadence);

    const out = [];
    while (cmpYMD(cursor, today) <= 0 && (!endCap || cmpYMD(cursor, endCap) <= 0)) {
      out.push(formatYMD(cursor));
      if (out.length >= remaining) break;
      cursor = stepCadence(cursor, rule.cadence);
    }
    return out;
  }

  function snapToCadence(ymd, cadence) {
    if (cadence.kind === "daily") return ymd;
    if (cadence.kind === "weekly") {
      // Find first date >= ymd with .getDay() === cadence.weekday
      const dt = new Date(ymd.y, ymd.m - 1, ymd.d);
      const diff = (cadence.weekday - dt.getDay() + 7) % 7;
      return addDays(ymd, diff);
    }
    if (cadence.kind === "monthly") {
      // Try this month first; if cadence day < ymd.d, jump to next month.
      const target = monthlyDateInMonth(ymd.y, ymd.m, cadence.dayOfMonth);
      if (cmpYMD(target, ymd) >= 0) return target;
      const nxt = addMonths({ y: ymd.y, m: ymd.m, d: 1 }, 1);
      return monthlyDateInMonth(nxt.y, nxt.m, cadence.dayOfMonth);
    }
    if (cadence.kind === "yearly") {
      const target = yearlyDateInYear(ymd.y, cadence.month, cadence.day);
      if (cmpYMD(target, ymd) >= 0) return target;
      return yearlyDateInYear(ymd.y + 1, cadence.month, cadence.day);
    }
    return ymd;
  }

  function stepCadence(ymd, cadence) {
    if (cadence.kind === "daily") return addDays(ymd, 1);
    if (cadence.kind === "weekly") return addDays(ymd, 7);
    if (cadence.kind === "monthly") {
      const nxt = addMonths({ y: ymd.y, m: ymd.m, d: 1 }, 1);
      return monthlyDateInMonth(nxt.y, nxt.m, cadence.dayOfMonth);
    }
    if (cadence.kind === "yearly") {
      return yearlyDateInYear(ymd.y + 1, cadence.month, cadence.day);
    }
    return ymd;
  }

  function monthlyDateInMonth(y, m, dayOfMonth) {
    return { y, m, d: Math.min(dayOfMonth, lastDayOfMonth(y, m)) };
  }

  function yearlyDateInYear(y, month, day) {
    return { y, m: month, d: Math.min(day, lastDayOfMonth(y, month)) };
  }

  function applyEndChecks(rule) {
    if (rule.endDate && rule.lastGeneratedDate &&
        cmpYMD(parseYMD(rule.lastGeneratedDate), parseYMD(rule.endDate)) >= 0) {
      rule.paused = true;
    }
    if (rule.maxOccurrences != null && (rule.occurrenceCount || 0) >= rule.maxOccurrences) {
      rule.paused = true;
    }
  }

  function buildRecordFromRule(rule, dateStr) {
    // createdAt/updatedAt must be numeric (Date.now ms) to match the rest of
    // the app — the records list sort uses `b.createdAt - a.createdAt` as a
    // same-day tiebreaker, which silently NaN's out if one side is a string.
    const now = Date.now();
    const id = "rec_" + now.toString(36) + "_" + Math.random().toString(36).slice(2, 8);
    return {
      id,
      type: rule.type,
      category: rule.category,
      subcategory: rule.subcategory || "",
      date: dateStr,
      amount: Number(rule.amount) || 0,
      currency: rule.currency,
      notes: rule.notes || "",
      ruleId: rule.id,
      createdAt: now,
      updatedAt: now,
    };
  }

  function unpauseRule(rule, todayStr) {
    rule.paused = false;
    if (rule.lastGeneratedDate) {
      rule.lastGeneratedDate = todayStr;
    } else {
      rule.startDate = todayStr;
    }
    rule.updatedAt = new Date().toISOString();
  }

  return {
    parseYMD, formatYMD, isLeap, lastDayOfMonth,
    addDays, addMonths, addYears, cmpYMD,
    computeOccurrences, applyEndChecks, buildRecordFromRule,
    unpauseRule,
  };
});
