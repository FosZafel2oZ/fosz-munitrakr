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

  // Money: whole amounts stay clean ("450"), fractional ones always show both
  // cents ("4,162.37", "11,111,111.10" — never a lone "….1").
  function fmtNum(v) {
    const n = Number(v);
    const whole = Number.isInteger(n);
    return n.toLocaleString(undefined, {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    });
  }

  // Direction rule: which record types point money "out" (+1, they owe more /
  // I owe less) vs "in" (-1). Shared by the single card and the statement.
  function signOf(type) {
    return (type === "lend" || type === "pay-back") ? 1 : -1;
  }

  // Running balances are always expressed in the default currency. Shared by
  // the single card and the statement.
  function amountInDefault(debt, defaultCurrency) {
    return (debt.convertedAmount != null && debt.convertedCurrency === defaultCurrency)
      ? Number(debt.convertedAmount)
      : (debt.currency === defaultCurrency
          ? Number(debt.amount)
          : Number(debt.convertedAmount || debt.amount));
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

    const direction = signOf(debt.type) > 0 ? "out" : "in";

    const showConverted =
      debt.convertedAmount != null && debt.convertedCurrency &&
      debt.convertedCurrency !== debt.currency;
    const convertedText = showConverted
      ? "≈ " + fmtNum(debt.convertedAmount) + " " + debt.convertedCurrency +
        (debt.rate
          ? " @ " + Number(debt.rate).toLocaleString(undefined, { maximumFractionDigits: 4 })
          : "")
      : null;

    const recordAmtInDefault = amountInDefault(debt, defaultCurrency);

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

  // Content model for the multi-record statement image: several selected
  // debts with one person, rolled into oldest-first rows plus a
  // running-balance footer that mirrors debtCardModel's. Pure: no DOM,
  // canvas or store access, and never `new Date(str)`.
  function statementModel(o) {
    const opts = o || {};
    const lang = opts.language === "th" ? "th" : "en";
    const me = opts.userName || "Me";
    const them = opts.personName || "(deleted person)";
    const defaultCurrency = opts.defaultCurrency || "";
    const balanceAfter = Number(opts.balanceAfter) || 0;

    const EN_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const TH_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
    const months = lang === "th" ? TH_MONTHS : EN_MONTHS;
    const RANGE_SEP = " – ";

    // Split "YYYY-MM-DD" by hand — never `new Date(str)` (locale/timezone drift).
    function ymd(str) {
      const p = String(str || "").split("-");
      return { y: p[0] || "", m: Number(p[1]) || 1, d: Number(p[2]) || 1 };
    }
    function shortDate(str) {
      const p = ymd(str);
      return p.d + " " + months[p.m - 1];
    }
    function fullEdge(p) {
      return p.d + " " + months[p.m - 1] + " " + p.y;
    }

    // Chronological order: date asc, then createdAt asc (the app's rule).
    const debts = (opts.debts || []).slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

    function kindText(type) {
      if (lang === "th") {
        return type === "lend" ? them + " ยืม" :
               type === "paid-back" ? them + " คืน" :
               type === "borrow" ? me + " ยืม" :
               type === "pay-back" ? me + " คืน" : "";
      }
      return type === "lend" ? them + " borrowed" :
             type === "paid-back" ? them + " paid back" :
             type === "borrow" ? me + " borrowed" :
             type === "pay-back" ? me + " paid back" : "";
    }

    let netCents = 0;
    let sameSign = true;
    let firstSign = null;

    const rows = debts.map((d) => {
      const amt = amountInDefault(d, defaultCurrency);
      const cents = Math.round(amt * 100);
      const sign = signOf(d.type);
      netCents += sign * cents;
      if (firstSign === null) firstSign = sign;
      else if (sign !== firstSign) sameSign = false;

      const rawNotes = d.notes ? String(d.notes).replace(/\s+/g, " ").trim() : "";
      return {
        dateText: shortDate(d.date),
        kindText: kindText(d.type),
        direction: sign > 0 ? "out" : "in",
        notesText: rawNotes || null,
        amountText: fmtNum(amt),
      };
    });

    let rangeText = "";
    if (debts.length) {
      const firstDate = debts[0].date;
      const lastDate = debts[debts.length - 1].date;
      const first = ymd(firstDate);
      const last = ymd(lastDate);
      if (firstDate === lastDate) {
        rangeText = fullEdge(last);
      } else if (first.y === last.y && first.m === last.m) {
        rangeText = first.d + RANGE_SEP + fullEdge(last);
      } else if (first.y === last.y) {
        rangeText = first.d + " " + months[first.m - 1] + RANGE_SEP + fullEdge(last);
      } else {
        rangeText = fullEdge(first) + RANGE_SEP + fullEdge(last);
      }
    }

    // Subtotal only reads as a true sum when every row points the same way.
    const hasSubtotal = debts.length > 0 && sameSign;
    const subtotalText = hasSubtotal ? fmtNum(Math.abs(netCents) / 100) : null;
    const subtotalLabel = hasSubtotal
      ? (lang === "th" ? "รวม " + debts.length + " รายการ"
                        : "Total of " + debts.length + " records")
      : null;

    // "Previous" is defined backwards from the caller-supplied balanceAfter so
    // the footer's math always adds up: previous + selected net = after.
    const afterCents = Math.round(balanceAfter * 100);
    const prevCents = afterCents - netCents;

    // No math line on a fresh cycle, and none if the balance crossed zero
    // inside the selection (magnitudes alone can't show a true sum then).
    const crossesZero = afterCents !== 0 && Math.sign(afterCents) !== Math.sign(prevCents);
    const mathText = (prevCents === 0 || crossesZero)
      ? null
      : fmtNum(Math.abs(prevCents) / 100) +
        ((netCents === 0 || Math.sign(netCents) === Math.sign(prevCents)) ? " + " : " − ") +
        fmtNum(Math.abs(netCents) / 100);

    return {
      name: them,
      pill: lang === "th" ? "สรุปรายการ" : "Statement",
      countText: lang === "th"
        ? debts.length + " รายการ"
        : debts.length + (debts.length === 1 ? " record" : " records"),
      rangeText,
      rows,
      subtotalLabel,
      subtotalText,
      outstandingLabel: lang === "th" ? "ยอดคงค้าง" : "Outstanding",
      mathText,
      totalText: fmtNum(Math.abs(afterCents) / 100),
      totalCurrency: defaultCurrency,
      isSettled: afterCents === 0,
      settledLabel: lang === "th" ? "เคลียร์แล้ว" : "Settled",
    };
  }

  /* ---------------- Canvas rendering (browser only) ---------------- */

  const WIDTH = 1080;
  const DPR = 2;
  const PAD = 64;
  // Vertical rhythm. Every block has a fixed height except the notes card,
  // which grows per wrapped line — so the height needs one measuring pass
  // (see the throwaway context in renderDebtCard) before the canvas is sized.
  const TOP = 56, BOTTOM = 56, GAP = 44, NOTE_GAP = 32, NOTE_H = 132, OUT_H = 140;
  // Notes wrap; the card grows by one NOTE_LINE per extra line, up to NOTE_MAX_LINES.
  const NOTE_LINE = 38, NOTE_MAX_LINES = 4;
  // Width available to the note text: card inner width minus the icon tile column.
  const NOTE_TEXT_W = WIDTH - PAD - 32 - (PAD + 28 + 60 + 24);

  const PALETTE = {
    bgTop:    "#f6fbfa",
    bgBot:    "#e7f2ee",
    edge:     "rgba(173,203,216,0.55)",
    card:     "#ffffff",
    line:     "rgba(140,180,205,0.28)",
    text:     "#132a3e",
    muted:    "#5b7488",
    faint:    "#93a6b5",
    out:      "#f2637a",
    in:       "#0fae5e",
    dark:     "#1d2f42",
    settled:  "#0c7a4d",
    noteTile: "#fdf1dd",
    noteInk:  "#c98a2e",
  };

  const FONT = (weight, size) =>
    weight + " " + size + "px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  // Pure canvas path — no Unicode glyph (iOS would swap in its emoji font).
  function drawCheckmark(ctx, x, y, size, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(3, size / 7);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x + size * 0.18, y + size * 0.55);
    ctx.lineTo(x + size * 0.42, y + size * 0.78);
    ctx.lineTo(x + size * 0.85, y + size * 0.25);
    ctx.stroke();
    ctx.restore();
  }

  // Small "document" mark for the notes tile — also a path, same reason.
  function drawNoteGlyph(ctx, tileX, tileY, tileSize, color) {
    const w = tileSize * 0.42, h = tileSize * 0.52;
    const x = tileX + (tileSize - w) / 2, y = tileY + (tileSize - h) / 2;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    roundRect(ctx, x, y, w, h, 5);
    ctx.stroke();
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const ly = y + h * (0.32 + i * 0.2);
      ctx.moveTo(x + w * 0.24, ly);
      ctx.lineTo(x + w * (i === 2 ? 0.6 : 0.76), ly);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Truncates with an ellipsis so the rendered width fits maxW.
  // ctx.font must already be set.
  function clipText(ctx, str, maxW) {
    if (ctx.measureText(str).width <= maxW) return str;
    const ell = "…";
    let lo = 0, hi = str.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(str.slice(0, mid) + ell).width <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return str.slice(0, lo) + ell;
  }

  // Greedy wrap into at most maxLines. Prefers breaking at a space, but falls
  // back to a mid-"word" break, which is what makes Thai (no inter-word
  // spaces) wrap at all. The final line ellipsises if text remains.
  // ctx.font must already be set.
  function wrapText(ctx, str, maxW, maxLines) {
    const lines = [];
    let rest = String(str);
    while (rest.length && lines.length < maxLines) {
      if (ctx.measureText(rest).width <= maxW) { lines.push(rest); rest = ""; break; }
      let lo = 1, hi = rest.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(rest.slice(0, mid)).width <= maxW) lo = mid;
        else hi = mid - 1;
      }
      let cut = lo;
      const sp = rest.lastIndexOf(" ", cut);
      if (sp > 0) cut = sp;
      lines.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).replace(/^\s+/, "");
    }
    if (rest.length && lines.length) {
      lines[lines.length - 1] = clipText(ctx, lines[lines.length - 1] + " " + rest, maxW);
    }
    return lines;
  }

  // Rasterizes an SVG string into an Image at the given pixel size.
  function loadImageFromSvg(svgStr, sizePx) {
    return new Promise((resolve, reject) => {
      let s = svgStr;
      if (!/xmlns=/.test(s)) s = s.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ');
      s = s.replace("<svg ", '<svg width="' + sizePx + '" height="' + sizePx + '" ');
      const url = URL.createObjectURL(new Blob([s], { type: "image/svg+xml" }));
      const img = new Image();
      img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // Draws the card and resolves with a PNG Blob.
  // opts: { debt, person: {name, color}, personIconSvg, balanceBefore,
  //         defaultCurrency, userName, language }
  async function renderDebtCard(opts) {
    const o = opts || {};
    const person = o.person || {};
    const m = debtCardModel({
      debt: o.debt,
      personName: person.name,
      userName: o.userName,
      defaultCurrency: o.defaultCurrency,
      balanceBefore: o.balanceBefore,
      language: o.language,
    });
    const P = PALETTE;

    const headerH = m.convertedText ? 142 : 112;
    // Measure the wrap on a throwaway context — the real canvas can't be sized
    // until we know how many note lines there are.
    let noteLines = [];
    if (m.notesText) {
      const measure = document.createElement("canvas").getContext("2d");
      measure.font = FONT(700, 30);
      noteLines = wrapText(measure, m.notesText, NOTE_TEXT_W, NOTE_MAX_LINES);
    }
    const noteH = noteLines.length ? NOTE_H + (noteLines.length - 1) * NOTE_LINE : 0;
    const HEIGHT =
      TOP + headerH + GAP + (noteH ? noteH + NOTE_GAP : 0) + OUT_H + BOTTOM;

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH * DPR;
    canvas.height = HEIGHT * DPR;
    const ctx = canvas.getContext("2d");
    ctx.scale(DPR, DPR);

    // ---- Background: white bleed behind a rounded gradient card ----
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const grad = ctx.createLinearGradient(0, 0, WIDTH * 0.6, HEIGHT);
    grad.addColorStop(0, P.bgTop);
    grad.addColorStop(1, P.bgBot);
    ctx.fillStyle = grad;
    roundRect(ctx, 10, 10, WIDTH - 20, HEIGHT - 20, 40);
    ctx.fill();
    ctx.strokeStyle = P.edge;
    ctx.lineWidth = 2;
    roundRect(ctx, 10, 10, WIDTH - 20, HEIGHT - 20, 40);
    ctx.stroke();

    let y = TOP;

    // ---- Header, right column first: its width bounds the left column ----
    ctx.textBaseline = "top";
    ctx.font = FONT(800, 64);
    // The amount is the one string that would otherwise never clip; without a
    // cap an absurd figure (the app permits 1e15) runs over the name and pill.
    // Leave room for the icon tile plus a readable stub of the name.
    const amountMaxW = WIDTH - PAD * 2 - 112 - 28 - 120;
    const amountClipped = clipText(ctx, m.amountText, amountMaxW);
    const amtW = ctx.measureText(amountClipped).width;
    ctx.font = FONT(700, 30);
    const curW = m.currencyText ? ctx.measureText(m.currencyText).width + 12 : 0;
    ctx.font = FONT(500, 26);
    const dateW = ctx.measureText(m.dateText).width;
    ctx.font = FONT(500, 24);
    const fxW = m.convertedText ? ctx.measureText(m.convertedText).width : 0;
    const rightW = Math.max(amtW + curW, dateW, fxW);
    const rightEdge = WIDTH - PAD;

    ctx.fillStyle = P.text;
    ctx.font = FONT(800, 64);
    ctx.fillText(amountClipped, rightEdge - amtW - curW, y + 2);
    if (m.currencyText) {
      ctx.font = FONT(700, 30);
      ctx.fillStyle = P.muted;
      ctx.fillText(m.currencyText, rightEdge - curW + 12, y + 27);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = P.faint;
    ctx.font = FONT(500, 26);
    ctx.fillText(m.dateText, rightEdge, y + 84);
    if (m.convertedText) {
      ctx.font = FONT(500, 24);
      ctx.fillText(clipText(ctx, m.convertedText, WIDTH - PAD * 2), rightEdge, y + 118);
    }
    ctx.textAlign = "left";

    // ---- Header, left column: icon tile + name + direction pill ----
    const ICON = 112;
    ctx.fillStyle = person.color || "#8a97a6";
    roundRect(ctx, PAD, y, ICON, ICON, 30);
    ctx.fill();
    if (o.personIconSvg) {
      try {
        const svg = String(o.personIconSvg).replace('stroke="currentColor"', 'stroke="#ffffff"');
        const img = await loadImageFromSvg(svg, ICON - 26);
        ctx.drawImage(img, PAD + 13, y + 13, ICON - 26, ICON - 26);
      } catch (_e) { /* the coloured tile alone still reads fine */ }
    }

    const textX = PAD + ICON + 28;
    const leftMaxW = Math.max(120, rightEdge - textX - rightW - 28);

    ctx.fillStyle = P.text;
    ctx.font = FONT(700, 48);
    ctx.fillText(clipText(ctx, m.name, leftMaxW), textX, y + 2);

    ctx.font = FONT(700, 24);
    const pillPadX = 20, pillH = 46;
    const tag = clipText(ctx, m.tagSentence, leftMaxW - pillPadX * 2);
    const pillW = ctx.measureText(tag).width + pillPadX * 2;
    ctx.fillStyle = m.direction === "out" ? P.out : P.in;
    roundRect(ctx, textX, y + 62, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(tag, textX + pillPadX, y + 62 + pillH / 2 + 1);
    ctx.textBaseline = "top";

    y += headerH + GAP;

    // ---- Notes card ----
    if (noteLines.length) {
      ctx.fillStyle = P.card;
      roundRect(ctx, PAD, y, WIDTH - PAD * 2, noteH, 26);
      ctx.fill();
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 1.5;
      roundRect(ctx, PAD, y, WIDTH - PAD * 2, noteH, 26);
      ctx.stroke();

      // Tile stays anchored to the label row so it doesn't drift down as the
      // note grows taller.
      const tile = 60, tileX = PAD + 28, tileY = y + (NOTE_H - tile) / 2;
      ctx.fillStyle = P.noteTile;
      roundRect(ctx, tileX, tileY, tile, tile, 18);
      ctx.fill();
      drawNoteGlyph(ctx, tileX, tileY, tile, P.noteInk);

      const nx = tileX + tile + 24;
      ctx.fillStyle = P.muted;
      ctx.font = FONT(600, 22);
      ctx.fillText(m.notesLabel, nx, y + 34);
      ctx.fillStyle = P.text;
      ctx.font = FONT(700, 30);
      noteLines.forEach((ln, i) => ctx.fillText(ln, nx, y + 72 + i * NOTE_LINE));

      y += noteH + NOTE_GAP;
    }

    // ---- Outstanding card (green + checkmark once the cycle closes) ----
    ctx.fillStyle = m.isSettled ? P.settled : P.dark;
    roundRect(ctx, PAD, y, WIDTH - PAD * 2, OUT_H, 26);
    ctx.fill();

    ctx.textBaseline = "middle";
    ctx.font = FONT(800, 46);
    const totW = ctx.measureText(m.totalText).width;
    ctx.font = FONT(700, 26);
    const totCurW = m.totalCurrency ? ctx.measureText(m.totalCurrency).width + 10 : 0;
    const totalX = rightEdge - 34 - totW - totCurW;
    ctx.fillStyle = "#ffffff";
    ctx.font = FONT(800, 46);
    ctx.fillText(m.totalText, totalX, y + OUT_H / 2);
    if (m.totalCurrency) {
      ctx.font = FONT(700, 26);
      ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.fillText(m.totalCurrency, totalX + totW + 10, y + OUT_H / 2 + 2);
    }
    if (m.isSettled) drawCheckmark(ctx, totalX - 54, y + OUT_H / 2 - 18, 36, "#ffffff");

    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.font = FONT(600, 22);
    ctx.fillText(m.outstandingLabel, PAD + 34, m.mathText ? y + 34 : y + 56);
    if (m.mathText) {
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = FONT(600, 30);
      const mathMaxW = totalX - (m.isSettled ? 60 : 0) - 24 - (PAD + 34);
      ctx.fillText(clipText(ctx, m.mathText, mathMaxW), PAD + 34, y + 74);
    }

    return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  return { debtCardModel, statementModel, renderDebtCard };
});
