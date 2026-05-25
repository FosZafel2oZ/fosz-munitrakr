# Recurring / Scheduled Records — Design

**Project:** MuniTrakr
**Date:** 2026-05-21
**Status:** Approved (pending user review of this written spec)
**Target version:** `v32` (lockstep `app.js APP_VERSION` and `sw.js CACHE`)

---

## 1. Summary

Add a system for **recurring/scheduled records** so that fixed events (rent, salary, SIPs) and variable ones (utility bills) can be defined once as rules and automatically produced as records on their due dates. Rules support standard cadences (daily / weekly / monthly / yearly), optional end conditions, per-rule auto-confirm toggle, and pause/resume.

The QR-code transfer feature originally paired with this work was dropped during brainstorming — the existing Web Share / file Backup already covers device-to-device transfer cleanly, and multi-frame QR adds too much code for an overlapping capability.

---

## 2. Goals & non-goals

**Goals**
- Define a recurring rule once; receive correct records on subsequent due dates without re-entry.
- Honor user trust: variable-amount rules surface a confirmation banner instead of silently mutating data.
- Survive long offline gaps: when the app opens after weeks away, all missed occurrences are backfilled to their true dates (one per cycle).
- Preserve history: rule edits never rewrite past records; rule deletes leave generated records intact.
- Stay within the existing offline-PWA architecture: no backend, no new persistence layer, no build step.

**Non-goals**
- Cron-grade flexibility (multiple weekdays, custom intervals like "every 17 days").
- Notifications/reminders outside the app (push notifications, calendar export).
- Variable-amount prediction (auto-pull from a bank, OCR receipts, etc.).
- Per-occurrence editing UI beyond what Edit-from-banner already provides.

---

## 3. Data model

A new `recurring` array lives in `store.settings`. `loadStore()` adds `settings.recurring = []` during its existing migration pass when missing.

```ts
type Rule = {
  id: string;                          // stable, e.g. "rule_<uuid>"

  // ----- Template (mirrors Record but with no date/converted*/rate*) -----
  type: "expense" | "investment";
  category: string;                    // category NAME (matches record convention)
  subcategory: string;
  amount: number;
  currency: string;
  notes: string;
  tags: string[];

  // ----- Cadence -----
  cadence: {
    kind: "daily" | "weekly" | "monthly" | "yearly";
    weekday?: 0 | 1 | 2 | 3 | 4 | 5 | 6;   // weekly only (0 = Sun)
    dayOfMonth?: 1..31;                     // monthly only (29-31 -> last-day fallback)
    month?: 1..12;                          // yearly only
    day?: 1..31;                            // yearly only (Feb 29 -> Feb 28 in non-leap)
  };

  // ----- Lifecycle -----
  startDate: "YYYY-MM-DD";             // first eligible date
  endDate?: "YYYY-MM-DD";              // optional hard stop (inclusive)
  maxOccurrences?: number;             // optional cap (counts Confirmed AND Skipped)
  occurrenceCount: number;             // running tally
  autoConfirm: boolean;                // true = silent auto-create; false = banner
  paused: boolean;
  lastGeneratedDate?: "YYYY-MM-DD";    // bookmark for backfill

  createdAt: string;                   // ISO timestamp
  updatedAt: string;                   // ISO timestamp
};
```

**Generated records** gain one new optional field: **`ruleId?: string`** linking back to the parent rule. Absent on legacy records — no migration of existing records required.

---

## 4. Cadence math

A single **pure** function `computeOccurrences(rule, today)` returns the array of `YYYY-MM-DD` dates that should exist between `lastGeneratedDate + 1 day` (or `startDate` if unset) and `min(today, endDate ?? ∞)`, capped by `maxOccurrences - occurrenceCount`.

### Cadence rules

- **Daily** — every day from `startDate` onward.
- **Weekly** — first occurrence is the first `cadence.weekday` on or after `startDate`; thereafter every 7 days.
- **Monthly** — `cadence.dayOfMonth` in each month. If the target month lacks that day (e.g. Feb 30/31, Apr 31), use the **last day of that month**. This preserves "end-of-month-ish" intent.
- **Yearly** — `cadence.month` + `cadence.day` each year. If `cadence.day = 29` and `cadence.month = 2` and the target year is non-leap, use **Feb 28**.

### Date arithmetic

All cadence math operates on `{ y, m, d }` integers parsed from `YYYY-MM-DD` strings, with small helpers `addDays`, `addMonths`, `addYears`, `lastDayOfMonth`, `isLeap`. **No `new Date(string)` parsing** — avoids the UTC-vs-local trap that already bit the iOS date input field. Final output is re-serialized to `YYYY-MM-DD`.

### Pause semantics

When a rule is paused, `computeOccurrences` returns `[]`. Pausing **does not** advance `lastGeneratedDate`. Unpausing applies one of:

- If `lastGeneratedDate` exists → set `lastGeneratedDate = today`. Next occurrence is the next naturally-due date *after* today. No backfill of the pause window.
- If `lastGeneratedDate` is unset (rule never fired) → set `startDate = today`. Rule effectively starts fresh from the unpause moment.

This matches user intent: pause means "skip these days," not "queue them for later."

### Cap interactions

- `endDate` reached mid-backfill → generate up to and including `endDate`, then auto-pause the rule.
- `maxOccurrences` reached mid-backfill → generate up to the cap, then auto-pause the rule.
- A **Skip** action on a pending confirmation counts against `maxOccurrences` (advances `occurrenceCount`), matching the user's mental model that they made a choice about that occurrence.

---

## 5. Generation pipeline

A new `processRecurring()` function runs once at app boot, **after** `loadStore()` finishes migration and **before** the first `loadRecords()`/render. It also runs after Restore (so importing a backup re-evaluates rules against today).

```
processRecurring():
  if recurringProcessedThisBoot: return   // in-memory idempotency guard
  recurringProcessedThisBoot = true
  for rule in store.settings.recurring:
    if rule.paused or !rule.cadence: continue
    dueDates = computeOccurrences(rule, today)
    for date in dueDates:
      if rule.autoConfirm:
        record = buildRecordFromRule(rule, date)
        await attachConversion(record)        // historical FX for that date
        store.records.push(record)
        rule.lastGeneratedDate = date
        rule.occurrenceCount += 1
        applyEndChecks(rule)                  // auto-pause if cap/endDate reached
      else:
        pendingConfirmations.push({ ruleId: rule.id, dueDate: date })
        // lastGeneratedDate does NOT advance here
  saveStore()
  if pendingConfirmations.length: renderBanner()
```

`pendingConfirmations[]` is **derived state**, recomputed on each boot. It is not persisted. When the user acts:

- **Confirm** → insert the record (with `attachConversion`), advance `rule.lastGeneratedDate = dueDate`, `occurrenceCount += 1`, run `applyEndChecks`.
- **Edit** → open the Add Record modal pre-filled from the template at `dueDate`; on save, treat as Confirm but with user edits to the record body.
- **Skip** → advance `rule.lastGeneratedDate = dueDate`, `occurrenceCount += 1`, no record inserted, run `applyEndChecks`.

Each action saves the store and re-renders the banner.

### `applyEndChecks(rule)`

After any operation that increments `occurrenceCount` or advances `lastGeneratedDate`, this helper checks: if `endDate` is set and `lastGeneratedDate >= endDate`, OR if `maxOccurrences` is set and `occurrenceCount >= maxOccurrences`, then set `rule.paused = true`. Pure mutation, no I/O.

### Idempotency

Two-layer defense:
1. **In-memory** `recurringProcessedThisBoot` flag — prevents double-runs within a single page session (iOS PWA wake-from-background can fire boot logic).
2. **Persistent** `lastGeneratedDate` bookmark — the real safety net. Even if (1) is bypassed, `computeOccurrences` will return `[]` because the bookmark already advanced past today's due dates.

---

## 6. UI

### 6.1 New Settings section: "Recurring"

Inserted between **Categories** and **Preferences** in the existing collapsible Settings list. Collapsed by default, matching the other sections.

Row layout per rule:

```
[icon] Rent · Monthly · day 1 · 15,000 THB        [⏸] [⋯]
       Auto-confirm ON · Next: Jun 1
```

- `[⏸]` toggles `paused` (icon flips to ▶ when paused; row dims).
- `[⋯]` opens the rule editor modal.
- Tapping the row body also opens the editor.
- Drag-reorderable via the existing `makeDraggable()` helper.
- **+ Add rule** button at the bottom of the section.

### 6.2 Rule editor modal

Reuses the visual language of the Add Record modal. Fields top-to-bottom:

1. **Type** toggle (Expense / Investment) — drives accent color.
2. **Category** + **Subcategory** cascading selects.
3. **Amount** + **Currency**.
4. **Notes**, **Tags**.
5. **Cadence** — segmented control (Daily / Weekly / Monthly / Yearly). Each reveals its own sub-controls:
   - Weekly → weekday picker (Sun–Sat chips).
   - Monthly → day-of-month number input (1–31) with helper text "29–31 falls back to last day of month."
   - Yearly → month select + day-of-month input with helper text "Feb 29 falls back to Feb 28 in non-leap years."
6. **Start date** — date input, defaults to today.
7. **End condition** — segmented (None / End date / After N occurrences). Reveals the relevant field. Default None.
8. **Auto-confirm** toggle. Default ON. Helper text: "ON: records appear automatically on their due date. OFF: a banner asks you to confirm each one."
9. **Save** / **Delete** buttons. Delete prompts confirmation; generated records are left intact.

### 6.3 Add Record modal — "Make this recurring" shortcut

Below the existing Notes field, a collapsed row:

```
[ ] Make this recurring                                     ⌄
```

When checked, it expands inline with **Cadence**, **End condition**, and **Auto-confirm** — the same three controls from the rule editor (no need to also re-enter category/amount; those come from the record body).

On Save, the app performs both actions atomically:
1. Save the record (as today's expense/investment).
2. Create a rule with `startDate = the record's date` and `lastGeneratedDate = the record's date`. The next occurrence will be the next cycle, not today.

### 6.4 Record card — provenance badge

Records with `ruleId` show a small `↻` badge next to the date in the records list. Tapping the badge shows a tooltip/sheet: "Generated from rule: *Rent*" with a "Go to rule" link that scrolls to the rule's row in the Recurring settings section. If the rule was deleted, the sheet shows "Rule no longer exists."

### 6.5 Dashboard confirmation banner

Pinned strip above the donut on the **dashboard view only**. Hidden when the queue is empty.

One line per pending occurrence:

```
Rent — 15,000 THB — due May 1     [Confirm] [Edit] [Skip]
```

If more than 3 pending, show "+N more" → expands a scrollable sheet with **Confirm all** / **Skip all** bulk actions. Bulk actions iterate the pipeline above.

---

## 7. Migration, versioning, files touched

### Migration
- `loadStore()` adds `settings.recurring = []` if missing. No record-shape change required (`ruleId` is optional).
- **Backup/Restore** already serializes the whole `store.settings`, so `recurring` rides along for free. Restoring a backup on an older app version simply ignores the new field.

### Versioning
- `APP_VERSION` in `app.js`: `v31 → v32`.
- `CACHE` in `sw.js`: `munitrakr-v31 → munitrakr-v32`.
- Both bumped in lockstep per HANDOVER §7.

### Files touched
- **`public/app.js`** — new functions (`computeOccurrences`, `processRecurring`, `applyEndChecks`, `buildRecordFromRule`, `renderRecurringSection`, `openRuleEditor`, `renderConfirmationBanner`); boot wiring; Add Record modal extension; record-card badge rendering. Date helpers (`addDays`, `addMonths`, `addYears`, `lastDayOfMonth`, `isLeap`, `parseYMD`, `formatYMD`).
- **`public/styles.css`** — banner, rule-row, badge, modal section styles. Reuses existing theme tokens (`--accent`, `--card`, etc.); no new color variables.
- **`public/sw.js`** — `CACHE` bump.
- **`public/index.html`** — banner mount point on dashboard; "Recurring" section scaffold in Settings.
- **`tests/run.js`** *(new)* — minimal `node`-based test runner using `assert`, no framework.
- **`tests/computeOccurrences.test.js`** *(new)* — see Section 8.

---

## 8. Testing

`computeOccurrences` is the riskiest pure function in this design; it gets a tight unit suite. The test harness is a single `node tests/run.js` script using `assert` — no framework, matching the project's zero-build-step ethos. To make the function importable from Node, the helpers and `computeOccurrences` are extracted into a small inline export pattern guarded by `typeof module !== 'undefined'`.

### Unit cases

1. Daily backfill across N days (N = 0, 1, 7, 90).
2. Weekly with `startDate` mid-week → first occurrence is the next matching weekday.
3. Weekly across DST boundary (string-based math means no DST sensitivity, but assert it).
4. Monthly day 31 → Feb fallback to Feb 28 (and Feb 29 in leap year).
5. Monthly day 31 → April fallback to Apr 30.
6. Yearly Feb 29 → Feb 28 in non-leap.
7. Yearly Feb 29 → Feb 29 in leap year (sanity).
8. `endDate` mid-backfill → output capped, rule auto-paused.
9. `maxOccurrences` mid-backfill → output capped, rule auto-paused.
10. Paused rule → returns `[]`.
11. Unpause with existing `lastGeneratedDate` → bookmark becomes today; no pause-window backfill.
12. Unpause with unset `lastGeneratedDate` → `startDate` becomes today.
13. Skip action advances bookmark and `occurrenceCount`; subsequent boot does not re-queue.
14. Confirm action advances bookmark and `occurrenceCount`; subsequent boot does not re-queue.

### Manual smoke tests

- Create one rule per cadence on localhost; force backfill by editing `startDate` into the past; verify banner queue and silent path.
- Repeat on iOS PWA after re-deploy to confirm no `Date` parsing regressions.
- Restore a v31 backup on v32 → verify `settings.recurring = []` is added.
- Restore a v32 backup with rules on v32 → verify rules and generated records reappear correctly.

---

## 9. Risks & gotchas

- **iOS PWA wake-from-background**: boot may fire when the app is foregrounded after weeks asleep. `processRecurring()` is idempotent via the in-memory flag + `lastGeneratedDate` bookmark.
- **FX for backfilled records**: `attachConversion()` already accepts a historical date and hits the correct Frankfurter endpoint. If the API is unreachable for a historical date, the existing `rateUnavailable: true` flag is set per generated record — same failure mode as manual entry. No new error path.
- **Orphaned `ruleId`**: deleting a rule leaves generated records' `ruleId` pointing at nothing. The "Go to rule" link shows "Rule no longer exists." Cheap; no cleanup pass.
- **Bulk Confirm-all with many pending**: iterating `attachConversion` is async and per-record. For a year of daily backfill (~365 records) this could be slow on a cold network. Mitigation: bulk Confirm runs FX in parallel with `Promise.all`, and rate-cache (`fin_rates`) absorbs duplicates within a request.
- **No git repo**: HANDOVER §8 flags that the project has no git repo. This spec is written to disk but cannot be committed via `git`. Recommend initializing a repo as a separate task (out of scope for this spec).

---

## 10. Open questions

None at spec time. All design questions were resolved during brainstorming. Any new questions surfaced during implementation should be flagged on the implementation plan, not retro-fit here.
