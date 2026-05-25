# DebtTrakr · Per-record share-as-image

**Date:** 2026-05-23
**Mode:** DebtTrakr
**Status:** Approved (design)

## Goal

Let the user share a single debt record as an image from the per-person history view. The image renders a compact, Aero-themed card with the record's details and a running-math line showing how the person's outstanding balance moved. Sharing uses the iOS/Web Share sheet so the user can send to any messenger (LINE, WhatsApp, Messages, etc.) — no backend, no third-party API.

## Motivation

Users want a way to send a quick statement to the person they're tracking. LINE-specific push (LINE Notify) was retired in March 2025, and the LINE Messaging API requires a backend, which conflicts with the project's no-backend constraint. The Web Share API already works in this app (proven by the Backup flow), and an image attachment is universally previewable in every messenger.

## Trigger & UI placement

- A small **share icon** appears on the right side of every debt row in the **person-history view**.
- Tapping the icon opens the system share sheet directly. Tap is isolated from the row's edit handler via `stopPropagation` so the edit modal does not open.
- Icon is an inline SVG (consistent with the project's iOS-emoji-safe icon convention from handover §9).
- No share affordance on the All-Debt-Records list or person cards in this iteration.

## Image content

Single Aero-themed card. Fields, top to bottom:

1. Person icon tile (colored using person's stored color, icon from `PEOPLE_ICONS`) + person name.
2. Direction badge — `Lent`, `Borrow`, or `Paid back`. Color follows app convention (`Lent` uses the `--out` hue, `Borrow`/`Paid back` use the `--in` hue). Because the card is rendered on canvas, the implementer reads the Aero theme's literal hex values from `styles.css` and hardcodes them in the renderer (not via `getComputedStyle` against a live DOM element, since the user's current theme may differ from Aero).
3. Original amount + currency (e.g. `USD 20`).
4. Converted line (only if the record has a conversion): `≈ THB 720 @ 36.00`.
5. Date in `YYYY-MM-DD` format.
6. Notes line (only if present, single line, ellipsised if very long).
7. **Outstanding running-math** line:
   - Lent: `Outstanding:  THB 200 + 100 = THB 300`
   - Paid back / Borrow: `Outstanding:  THB 300 − 100 = THB 200`
   - If the record's currency differs from the default currency, the math uses the **converted** amount so the arithmetic balances.
   - If the resulting balance is exactly `0`, append `✓ Settled`.

The "previous balance" used in the math is the person's outstanding **immediately before this record** — derived by re-running `personBalances` on the debts list with this record excluded (or equivalently, on the slice of records that predate it).

## Visual style

- **Aero theme always**, regardless of the user's currently-selected app theme. Frutiger-glass light look, blue/green accent palette.
- Person's stored color is the only per-record accent (used on the icon tile and direction badge).
- Padding is generous so the content reads comfortably on a phone preview.

## Dimensions

- Width: **1080 px fixed**.
- Height: `max(1080, contentHeight + padding)`. Square by default; expands only when notes or unusually long numbers would otherwise be clipped.
- DPR: render at 2× for crisp output on retina screens; the exported PNG is still nominal 1080×N.

## Rendering & sharing

- Render to an offscreen `<canvas>` using the Canvas 2D API. No new dependencies.
- Convert via `canvas.toBlob(..., 'image/png')`.
- Share path:
  1. Build a `File` from the blob: `new File([blob], filename, { type: 'image/png' })`.
  2. If `navigator.canShare?.({ files: [file] })`, call `navigator.share({ files: [file] })`.
  3. Otherwise, fall back to a direct download via a temporary `<a download>` link.
- Filename: `debt-<sanitized-person-name>-<YYYY-MM-DD>.png`.

This mirrors the existing Backup flow (handover §9) — same Web Share + download pattern, no `text`/`title` fields (those caused iOS targets to save extra files).

## Code touch points

- **New helper:** `renderDebtCard(debt, person, balanceBefore, opts) → Promise<Blob>` in `app.js` (or a new small `share-card.js` UMD if it ends up large enough to justify a separate file and unit tests).
- **New helper:** `shareDebtRecord(debt)` — orchestrates: compute `balanceBefore`, call `renderDebtCard`, invoke share-or-download.
- **Row renderer in person-history**: add the share icon button with isolated tap handler that calls `shareDebtRecord(debt)`.
- **CSS:** no app-CSS impact (the card is rendered purely on canvas using literal colors/fonts that mirror the Aero palette).
- Estimated size: ~150–250 lines added in `app.js`, no new files required unless the renderer is extracted for testability.

## Edge cases

- **Record being shared closes a cycle (new outstanding = 0):** math line ends with `✓ Settled`.
- **Record currency differs from default currency:** math uses converted amount; original-currency line still appears above.
- **Record has no conversion** (e.g. record's currency equals default currency, or `rateUnavailable` with no manual rate): no `≈` line; math uses the record's `amount` directly.
- **Notes longer than one line at the card width:** truncate with ellipsis on the canvas (single-line clip — no need for multi-line wrapping in this iteration).
- **Web Share unavailable / `canShare(files)` returns false:** silent fallback to PNG download (no error toast needed — the user gets a file either way).
- **Very long person names:** truncate with ellipsis at the card width.

## Out of scope (this iteration)

- Sharing from the All-Debt-Records list.
- Sharing from a person card on the dashboard.
- Per-person summary "statement" image.
- Sharing multiple records at once.
- Theme-matched card variants (Default, Yoimiya).
- LINE-specific deep link (`https://line.me/R/share?text=...`) — the iOS share sheet covers LINE plus every other messenger with one tap.

## Testing

- **Unit:** if `renderDebtCard`/`balanceBefore` are extracted to a UMD module, add Node tests in `tests/` that verify the balance-before computation for various record orderings (cycle resets, mid-history records, first record). Canvas rendering itself is not unit-tested.
- **Manual:** on iOS PWA, tap share on records of each direction, verify the running math, the converted-currency case, the cycle-close `✓ Settled` case, and the long-notes truncation. Confirm the share sheet opens and the image arrives intact in LINE/Messages.

## Release

- Bump `APP_VERSION` in `app.js` and `CACHE` in `sw.js` together (handover §8).
- `node --check public/app.js && node --check public/sw.js && node tests/run.js` must pass before deploy.
