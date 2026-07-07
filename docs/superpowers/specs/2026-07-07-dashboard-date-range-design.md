# Dashboard & Reports Date Range — Design

**Date:** 2026-07-07
**Branch:** `feat/dashboard-date-range`
**Status:** Approved

## Problem

The admin analytics surfaces can only look at a fixed set of windows counted
*backward from today*:

- `/admin/reports` offers `Today / 7 days / 30 days / Month`.
- `/admin` dashboard has no picker at all — it shows a fixed "today + this
  month" overview.

There is no way to view **yesterday**, **N days ago**, or an **arbitrary
`day X → day Y` window**. The root cause is that `ReportRange` is a string enum
and the server derives the start day from `Date.now()`, so the end is always
today.

## Goal

Let an admin view analytics for any historical day or custom date window on both
`/admin/reports` and `/admin`, while preserving the dashboard's live
store-state view where a historical value would be meaningless.

## Core Model

Replace the string `ReportRange` with an explicit, inclusive day-key range:

```ts
type AnalyticsRange = { from: string; to: string }; // inclusive KL day-keys, YYYY-MM-DD
```

- All day-keys are **Asia/Kuala_Lumpur** calendar days (matches the existing
  `klDate`/`klToday` convention in `reports.ts` and `dashboard.ts`).
- Server filters completed orders where `klDate(created_at)` is within
  `[from, to]` inclusive.
- **Presets are client-side shortcuts** that resolve to `{from, to}`:
  - Today → `from = to = today`
  - Yesterday → `from = to = today − 1`
  - Last 7 days → `from = today − 6`, `to = today`
  - Last 30 days → `from = today − 29`, `to = today`
  - This month → `from = 1st of month`, `to = today`
  - Custom → user-picked `from`/`to`
- **Prior-period deltas** keep working: the baseline is the equal-length window
  immediately before `from` (window length = `to − from + 1` days).

This is simpler than the current backward-from-today logic and yields yesterday,
N-days-ago, and arbitrary windows for free.

## Picker Component

A single shared `RangePicker` (client component) reused by both surfaces:

- A row of preset pills: Today / Yesterday / 7 days / 30 days / Month.
- A **Custom** pill that reveals two date fields (From / To) plus an Apply
  button.
- Custom date fields use native `<input type="date">` — **no new
  dependencies**. This gives a native mobile picker (the primary surface), works
  offline, and is accessible. (shadcn's Calendar would pull in
  `react-day-picker` + `date-fns`, which AGENTS.md says requires approval; native
  inputs avoid that.)
- Validation: `to` is capped at today; if `from > to`, swap them.
- Emits an `AnalyticsRange` and a human label (preset name, or a formatted date
  span like "1 – 5 Jul" for custom).

## `/admin/reports` Changes

- Replace the 4-button `RANGES` row in `reports-view.tsx` with `RangePicker`.
- `getReportData` accepts `{from, to}` instead of a `ReportRange` string.
- Everything downstream (revenue, deltas, top items, payment mix, source split,
  custom drinks) already recomputes from `getReportData` — it just receives the
  new range shape.
- Period label adapts: presets show "Yesterday" / "Last 7 days"; custom shows
  the actual date span.
- Default remains the last-7-days window.

## `/admin` Dashboard Changes

Refactor `app/(admin)/admin/page.tsx` into a `DashboardView` client component +
a `loadDashboard` server action, mirroring the existing
`ReportsView` + `loadReport` pattern.

**Follows the selected range:**
- Hero headline: revenue, orders, avg order.
- Stat tiles: revenue, orders, active customers, avg order.
- Top sellers.
- Revenue trend chart.

**Always live (ignores the range):**
- The amber **"On the bar"** in-progress count.
- The **order pipeline** meters (pending / preparing / ready / completed /
  cancelled snapshot).

These reflect *current* store state; a historical pipeline snapshot would be
meaningless.

- Hero label reflects the window: "Today · 7 Jul", "Yesterday · 6 Jul",
  "1 – 5 Jul", etc.
- **Default = Today**, preserving the current feel.

### Accepted tradeoff

Today the dashboard shows *today's take* **and** *month-to-date* at once. Making
the stats range-driven means the admin sees one window at a time (pick "Month"
for month-to-date, "Today" for today). We gain yesterday/custom windows; we lose
the simultaneous both-at-once glance. This is accepted — the single-range model
is cleaner than special-casing the month tiles.

## Files

- `lib/analytics/types.ts` — replace `ReportRange` with `AnalyticsRange`; update
  `ReportData`.
- `lib/analytics/range.ts` *(new)* — preset definitions + `{from, to}` resolver
  in KL day-keys, plus label formatting.
- `lib/analytics/reports.ts` — `getReportData({from, to})`.
- `lib/analytics/dashboard.ts` — `getDashboardMetrics({from, to})` for
  range-driven stats; keep a separate always-live query for pipeline +
  on-the-bar.
- `components/admin/range-picker.tsx` *(new)* — shared presets + custom picker.
- `components/admin/reports-view.tsx` — use `RangePicker`.
- `components/admin/dashboard-view.tsx` *(new)* — client view, live vs range
  split.
- `app/(admin)/admin/page.tsx` — split into server shell + `DashboardView` +
  `loadDashboard` server action (re-checks `isAdmin`).
- `app/(admin)/admin/reports/page.tsx` — `loadReport` accepts `{from, to}`.

## Out of Scope

- The `/manage` board's own `today/yesterday/last7/all` filter
  (`lib/orders/range.ts`) — unchanged.
- No schema changes; RLS unaffected (reads only, already admin-gated).
- No new libraries.

## Testing

- Verify presets resolve to correct KL day-keys around the KL/UTC boundary
  (e.g. late-evening MYT).
- Custom window: pick a past `day X → day Y`, confirm totals and prior-period
  delta baseline are correct.
- Yesterday and single past-day selections show non-empty data when orders
  exist on those days.
- Dashboard: range drives stats while pipeline + on-the-bar stay current
  regardless of selected range.
- `npm run build` / typecheck clean.
