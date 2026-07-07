# Dashboard & Reports Date Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin view `/admin` and `/admin/reports` analytics for any historical day or custom date window (yesterday, N days ago, day X → day Y), while the dashboard's live store-state (on-the-bar count, order pipeline) stays current.

**Architecture:** Replace the string `ReportRange` with an explicit inclusive KL day-key range `{from, to}`. Presets become client-side shortcuts that resolve to a range. A shared `RangePicker` (preset pills + native `<input type="date">` custom fields, zero new deps) drives both surfaces via server actions. Reports fully follow the range; the dashboard splits range-driven stats from always-live pipeline.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, TypeScript (strict), Tailwind, recharts, Supabase server client.

## Global Constraints

- **No new libraries.** Custom date fields use native `<input type="date">`. (verbatim from spec: "No new libraries")
- **No test framework exists** in this repo (verified: no vitest/jest, no test files, scripts are `dev`/`build`/`start`/`lint`). Verification per task = `npx tsc --noEmit` (typecheck) + `npm run lint` + browser verification for UI. Do **not** add a test runner.
- All day-keys are **Asia/Kuala_Lumpur** calendar days, format `YYYY-MM-DD` (matches existing `klDate`/`klToday` in `lib/analytics/reports.ts`).
- Money is stored as integers (sen); never floats.
- Server Actions re-check `isAdmin()` — they are independently callable endpoints.
- Strict TypeScript, no `any`. Follow existing file/patterns (mirror `ReportsView` + `loadReport`).

## File Structure

- `lib/analytics/types.ts` — **modify**: replace `ReportRange` with `AnalyticsRange`; restructure `DashboardMetrics` (range-driven + live split); `ReportData.range` becomes `AnalyticsRange`.
- `lib/analytics/range.ts` — **new**: analytics range resolver (presets, KL day math, previous-window, labels, sanitize). Distinct from `lib/orders/range.ts` (the manage board's filter — do not touch).
- `lib/analytics/reports.ts` — **modify**: `getReportData(range: AnalyticsRange)`.
- `lib/analytics/dashboard.ts` — **modify**: `getDashboardMetrics(range: AnalyticsRange)` — range stats + always-live pipeline from one fetch.
- `components/admin/range-picker.tsx` — **new**: shared presets + custom picker.
- `components/admin/dashboard-charts.tsx` — **modify**: range-neutral empty copy.
- `components/admin/reports-view.tsx` — **modify**: use `RangePicker`.
- `components/admin/dashboard-view.tsx` — **new**: client view, live-vs-range split.
- `app/(admin)/admin/reports/page.tsx` — **modify**: `loadReport(range: AnalyticsRange)`.
- `app/(admin)/admin/page.tsx` — **modify**: server shell + `loadDashboard` action + `<DashboardView>`.

---

### Task 1: Analytics range resolver + types

**Files:**
- Modify: `lib/analytics/types.ts`
- Create: `lib/analytics/range.ts`
- Temp: `scripts/_verify-range.ts` (deleted in Task 5)

**Interfaces:**
- Produces:
  - `type AnalyticsRange = { from: string; to: string }` (in `types.ts`)
  - `type RangePresetKey = "today" | "yesterday" | "7d" | "30d" | "month"`
  - `rangePresets: { value: RangePresetKey; label: string }[]`
  - `isRangePresetKey(v: string): v is RangePresetKey`
  - `klToday(now?: number): string`
  - `shiftDay(dayKey: string, delta: number): string`
  - `rangeDays(range: AnalyticsRange): number`
  - `presetToRange(key: RangePresetKey, now?: number): AnalyticsRange`
  - `sanitizeRange(range: AnalyticsRange, now?: number): AnalyticsRange`
  - `matchPreset(range: AnalyticsRange, now?: number): RangePresetKey | null`
  - `previousWindow(range: AnalyticsRange): AnalyticsRange`
  - `eachDay(range: AnalyticsRange): string[]`
  - `formatRangeLabel(range: AnalyticsRange, now?: number): string`

- [ ] **Step 1: Update `lib/analytics/types.ts`**

Replace the whole file with:

```ts
export type AnalyticsRange = { from: string; to: string }; // inclusive KL day-keys (YYYY-MM-DD)

export type DashboardMetrics = {
  // Range-driven aggregates (follow the selected window).
  range: { orders: number; revenue: number; activeCustomers: number; completed: number };
  trend: { date: string; revenue: number }[]; // per KL day within range, zero-filled
  topSellers: { name: string; quantity: number }[]; // within range, completed, top 5
  // Always-live store state (ignores the selected range).
  live: {
    inProgress: number; // today's pending+preparing+ready ("on the bar")
    statusBreakdown: { status: string; count: number }[]; // current snapshot, all orders
  };
};

export type ReportData = {
  range: AnalyticsRange;
  totals: {
    orders: number;
    revenue: number;
    redemptionBeans: number;
    rewardLines: number;
    itemsSold: number; // total quantity across completed orders
  };
  // Online vs in-store vs custom split of completed orders in the range.
  totalsBySource: {
    online: { orders: number; revenue: number };
    store: { orders: number; revenue: number };
    custom: { orders: number; revenue: number };
  };
  previous: { orders: number; revenue: number }; // equal-length window immediately before
  trend: { date: string; revenue: number; orders: number }[]; // per KL day, completed
  topItems: { name: string; quantity: number; revenue: number }[]; // top 10, completed
  topCustomItems: { name: string; quantity: number; revenue: number }[]; // top 10 custom drinks
  paymentBreakdown: { method: string; orders: number; revenue: number }[]; // completed
};
```

- [ ] **Step 2: Create `lib/analytics/range.ts`**

```ts
import type { AnalyticsRange } from "@/lib/analytics/types";

const KL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
const DAY_MS = 86_400_000;

export type RangePresetKey = "today" | "yesterday" | "7d" | "30d" | "month";

export const rangePresets: { value: RangePresetKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "month", label: "Month" },
];

export function isRangePresetKey(v: string): v is RangePresetKey {
  return v === "today" || v === "yesterday" || v === "7d" || v === "30d" || v === "month";
}

// KL calendar day (YYYY-MM-DD) for an instant.
export function klDayKey(instant: number): string {
  return KL.format(new Date(instant));
}
export function klToday(now: number = Date.now()): string {
  return klDayKey(now);
}

// Shift a YYYY-MM-DD key by whole calendar days. Day keys are only compared as
// calendar days, so plain UTC arithmetic is safe.
export function shiftDay(dayKey: string, delta: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + delta * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

// Inclusive number of calendar days in a range.
export function rangeDays(range: AnalyticsRange): number {
  return (
    Math.round(
      (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / DAY_MS,
    ) + 1
  );
}

export function presetToRange(key: RangePresetKey, now: number = Date.now()): AnalyticsRange {
  const today = klToday(now);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "yesterday": {
      const y = shiftDay(today, -1);
      return { from: y, to: y };
    }
    case "7d":
      return { from: klDayKey(now - 6 * DAY_MS), to: today };
    case "30d":
      return { from: klDayKey(now - 29 * DAY_MS), to: today };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

// Clamp `to` to today and swap if reversed, so a hand-built range from the
// client can't reach into the future or invert. Boundary validation.
export function sanitizeRange(range: AnalyticsRange, now: number = Date.now()): AnalyticsRange {
  const today = klToday(now);
  let { from, to } = range;
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;
  if (from > to) from = to;
  return { from, to };
}

// The preset a range corresponds to, or null when it's a custom span.
export function matchPreset(range: AnalyticsRange, now: number = Date.now()): RangePresetKey | null {
  for (const p of rangePresets) {
    const r = presetToRange(p.value, now);
    if (r.from === range.from && r.to === range.to) return p.value;
  }
  return null;
}

// Equal-length window immediately before `from`, for period-over-period deltas.
export function previousWindow(range: AnalyticsRange): AnalyticsRange {
  const n = rangeDays(range);
  return { from: shiftDay(range.from, -n), to: shiftDay(range.from, -1) };
}

// Every day key from `from` to `to` inclusive (for zero-filled trends).
export function eachDay(range: AnalyticsRange): string[] {
  const out: string[] = [];
  for (let d = range.from; d <= range.to; d = shiftDay(d, 1)) out.push(d);
  return out;
}

const DMY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "Asia/Kuala_Lumpur",
});
// Parse at UTC noon so the +8 formatter can't drift to the adjacent day.
function dmy(dayKey: string): string {
  return DMY.format(new Date(`${dayKey}T12:00:00Z`));
}

// Human label: preset name when it matches one, else a date span.
export function formatRangeLabel(range: AnalyticsRange, now: number = Date.now()): string {
  const preset = matchPreset(range, now);
  if (preset === "today") return "Today";
  if (preset === "yesterday") return "Yesterday";
  if (preset === "7d") return "Last 7 days";
  if (preset === "30d") return "Last 30 days";
  if (preset === "month") return "This month";
  if (range.from === range.to) return dmy(range.from);
  return `${dmy(range.from)} – ${dmy(range.to)}`;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Create temp verification script `scripts/_verify-range.ts`**

```ts
import assert from "node:assert/strict";
import {
  presetToRange,
  previousWindow,
  rangeDays,
  matchPreset,
  sanitizeRange,
  eachDay,
  formatRangeLabel,
} from "../lib/analytics/range.ts";

// Fixed instant: 2026-07-07 10:00 UTC = 2026-07-07 18:00 KL.
const now = Date.parse("2026-07-07T10:00:00Z");

assert.deepEqual(presetToRange("today", now), { from: "2026-07-07", to: "2026-07-07" });
assert.deepEqual(presetToRange("yesterday", now), { from: "2026-07-06", to: "2026-07-06" });
assert.deepEqual(presetToRange("7d", now), { from: "2026-07-01", to: "2026-07-07" });
assert.deepEqual(presetToRange("30d", now), { from: "2026-06-08", to: "2026-07-07" });
assert.deepEqual(presetToRange("month", now), { from: "2026-07-01", to: "2026-07-07" });

// KL boundary: 2026-07-07 17:00 UTC = 2026-07-08 01:00 KL -> "today" is the 8th.
const lateNow = Date.parse("2026-07-07T17:00:00Z");
assert.equal(presetToRange("today", lateNow).to, "2026-07-08");

assert.equal(rangeDays({ from: "2026-07-01", to: "2026-07-07" }), 7);
assert.equal(rangeDays({ from: "2026-07-07", to: "2026-07-07" }), 1);

assert.deepEqual(previousWindow({ from: "2026-07-01", to: "2026-07-07" }), {
  from: "2026-06-24",
  to: "2026-06-30",
});
assert.deepEqual(previousWindow({ from: "2026-07-07", to: "2026-07-07" }), {
  from: "2026-07-06",
  to: "2026-07-06",
});

assert.equal(matchPreset({ from: "2026-07-06", to: "2026-07-06" }, now), "yesterday");
assert.equal(matchPreset({ from: "2026-07-02", to: "2026-07-05" }, now), null);

// sanitize: swap reversed, clamp future.
assert.deepEqual(sanitizeRange({ from: "2026-07-05", to: "2026-07-02" }, now), {
  from: "2026-07-02",
  to: "2026-07-05",
});
assert.deepEqual(sanitizeRange({ from: "2026-07-06", to: "2026-12-31" }, now), {
  from: "2026-07-06",
  to: "2026-07-07",
});

assert.deepEqual(eachDay({ from: "2026-07-05", to: "2026-07-07" }), [
  "2026-07-05",
  "2026-07-06",
  "2026-07-07",
]);

assert.equal(formatRangeLabel({ from: "2026-07-07", to: "2026-07-07" }, now), "Today");
assert.equal(formatRangeLabel({ from: "2026-07-01", to: "2026-07-07" }, now), "Last 7 days");
assert.equal(formatRangeLabel({ from: "2026-07-02", to: "2026-07-05" }, now), "2 Jul – 5 Jul");

console.log("range resolver OK");
```

- [ ] **Step 5: Run the verification**

Run: `node --experimental-strip-types scripts/_verify-range.ts`
Expected: prints `range resolver OK` with no assertion errors.
(Node ≥ 23.6 runs `.ts` without the flag; if your Node lacks type-stripping and the command errors before assertions, skip this step and rely on browser verification in Tasks 3–4 — note it in the commit.)

- [ ] **Step 6: Commit**

```bash
git add lib/analytics/types.ts lib/analytics/range.ts scripts/_verify-range.ts
git commit -m "feat(analytics): add date-range resolver and range types"
```

---

### Task 2: Shared RangePicker component

**Files:**
- Create: `components/admin/range-picker.tsx`

**Interfaces:**
- Consumes: `AnalyticsRange` (types), `rangePresets`, `presetToRange`, `matchPreset`, `sanitizeRange`, `klToday` (range.ts).
- Produces: `RangePicker({ value, onChange, disabled }: { value: AnalyticsRange; onChange: (range: AnalyticsRange) => void; disabled?: boolean })`.

- [ ] **Step 1: Create `components/admin/range-picker.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Calendar } from "lucide-react";
import type { AnalyticsRange } from "@/lib/analytics/types";
import {
  rangePresets,
  presetToRange,
  matchPreset,
  sanitizeRange,
  klToday,
  type RangePresetKey,
} from "@/lib/analytics/range";
import { cn } from "@/lib/utils";

export function RangePicker({
  value,
  onChange,
  disabled,
}: {
  value: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
  disabled?: boolean;
}) {
  const active = matchPreset(value);
  const [customOpen, setCustomOpen] = useState(active === null);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const today = klToday();

  function pickPreset(key: RangePresetKey) {
    setCustomOpen(false);
    onChange(presetToRange(key));
  }

  function applyCustom() {
    const next = sanitizeRange({ from, to });
    setFrom(next.from);
    setTo(next.to);
    onChange(next);
  }

  const pillBase =
    "rounded-full px-3.5 py-1.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {rangePresets.map((p) => {
          const on = !customOpen && active === p.value;
          return (
            <button
              key={p.value}
              type="button"
              disabled={disabled}
              onClick={() => pickPreset(p.value)}
              aria-pressed={on}
              className={cn(
                pillBase,
                on
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {p.label}
            </button>
          );
        })}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setCustomOpen((v) => !v)}
          aria-pressed={customOpen}
          className={cn(
            pillBase,
            "inline-flex items-center gap-1.5",
            customOpen
              ? "bg-foreground text-background"
              : "border border-border text-muted-foreground hover:bg-muted",
          )}
        >
          <Calendar className="size-4" aria-hidden />
          Custom
        </button>
      </div>

      {customOpen && (
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            From
            <input
              type="date"
              value={from}
              max={to || today}
              disabled={disabled}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            To
            <input
              type="date"
              value={to}
              min={from}
              max={today}
              disabled={disabled}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </label>
          <button
            type="button"
            disabled={disabled || !from || !to}
            onClick={applyCustom}
            className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-semibold text-background outline-none transition-colors hover:bg-foreground/90 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (Full UX verified in Task 3 once wired.)

- [ ] **Step 3: Commit**

```bash
git add components/admin/range-picker.tsx
git commit -m "feat(admin): add shared date RangePicker (presets + custom)"
```

---

### Task 3: Wire /admin/reports to the range

**Files:**
- Modify: `lib/analytics/reports.ts`
- Modify: `components/admin/dashboard-charts.tsx:16-18` (empty-state copy)
- Modify: `components/admin/reports-view.tsx`
- Modify: `app/(admin)/admin/reports/page.tsx`

**Interfaces:**
- Consumes: `AnalyticsRange` (types), `previousWindow` / `presetToRange` / `sanitizeRange` / `formatRangeLabel` (range.ts), `RangePicker` (Task 2).
- Produces: `getReportData(range: AnalyticsRange): Promise<ReportData>`; `loadReport(range: AnalyticsRange): Promise<ReportData>`.

- [ ] **Step 1: Rewrite the header of `lib/analytics/reports.ts`**

Replace lines 1–75 (imports through the prior-period loop setup) with the block below. Keep everything from `const totalsRevenue = ...` (current line 76) onward **unchanged**.

```ts
import { createClient } from "@/lib/supabase/server";
import { normalizePaymentMethod, UNPAID_PAYMENT_METHOD } from "@/data/payment-methods";
import type { AnalyticsRange, ReportData } from "@/lib/analytics/types";
import { previousWindow } from "@/lib/analytics/range";

const KL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
function klDate(iso: string): string {
  return KL.format(new Date(iso));
}

export async function getReportData(range: AnalyticsRange): Promise<ReportData> {
  const db = await createClient();
  const { from, to } = range;
  const prev = previousWindow(range);

  const { data: orders, error } = await db
    .from("orders")
    .select("id, status, total, payment_method, source, created_at");
  if (error) throw new Error(`getReportData failed: ${error.message}`);

  const inRange = (iso: string) => {
    const d = klDate(iso);
    return d >= from && d <= to;
  };

  const completed = (orders ?? []).filter(
    (o) => o.status === "completed" && inRange(o.created_at),
  );

  // Online vs in-store vs custom split (completed orders in range).
  const bySource = (src: "online" | "store" | "custom") => {
    const rows = completed.filter((o) => (o.source ?? "online") === src);
    return { orders: rows.length, revenue: rows.reduce((s, o) => s + o.total, 0) };
  };
  const totalsBySource = {
    online: bySource("online"),
    store: bySource("store"),
    custom: bySource("custom"),
  };

  // Prior-period completed totals (revenue + order count) for delta arrows.
  let prevRevenue = 0;
  let prevOrders = 0;
  for (const o of orders ?? []) {
    if (o.status !== "completed") continue;
    const d = klDate(o.created_at);
    if (d >= prev.from && d <= prev.to) {
      prevRevenue += o.total;
      prevOrders += 1;
    }
  }
```

Then update the final `return` object's `range` field (current line 144) so it returns the passed range:

```ts
  return {
    range,
    totals: { orders: completed.length, revenue: totalsRevenue, redemptionBeans, rewardLines, itemsSold },
    totalsBySource,
    previous: { orders: prevOrders, revenue: prevRevenue },
    trend,
    topItems,
    topCustomItems,
    paymentBreakdown,
  };
```

(`range` is now `AnalyticsRange` — assign it directly. All other lines between are unchanged.)

- [ ] **Step 2: Range-neutral empty copy in `components/admin/dashboard-charts.tsx`**

Change the `RevenueArea` empty-state text (line 17):

```tsx
        No completed sales in this range.
```

- [ ] **Step 3: Rewrite `components/admin/reports-view.tsx`**

Replace lines 1–29 (imports + `RANGES`/`PERIOD_LABEL`/`PREV_LABEL` consts) with:

```tsx
"use client";

import { useState, useTransition } from "react";
import { TrendingUp, TrendingDown, Gift } from "lucide-react";
import type { AnalyticsRange, ReportData } from "@/lib/analytics/types";
import { formatRangeLabel } from "@/lib/analytics/range";
import { paymentMethodLabel } from "@/data/payment-methods";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RevenueArea } from "@/components/admin/dashboard-charts";
import { RangePicker } from "@/components/admin/range-picker";
```

Replace the component signature + `pick` (current lines 90–104) with:

```tsx
export function ReportsView({
  initial,
  load,
}: {
  initial: ReportData;
  load: (range: AnalyticsRange) => Promise<ReportData>;
}) {
  const [data, setData] = useState(initial);
  const [pending, startTransition] = useTransition();

  function pick(range: AnalyticsRange) {
    startTransition(async () => setData(await load(range)));
  }
```

Replace the range-pills block + eyebrow (current lines 111–130) with:

```tsx
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker value={data.range} onChange={pick} disabled={pending} />
        <Eyebrow>{formatRangeLabel(data.range)}</Eyebrow>
      </div>
```

Replace the `vs {PREV_LABEL[data.range]}` line (current line 149) with:

```tsx
                  vs prior period ({formatPrice(data.previous.revenue)})
```

Leave the rest of the component unchanged.

- [ ] **Step 4: Update `app/(admin)/admin/reports/page.tsx`**

```tsx
import { getReportData } from "@/lib/analytics/reports";
import type { AnalyticsRange } from "@/lib/analytics/types";
import { presetToRange, sanitizeRange } from "@/lib/analytics/range";
import { ReportsView } from "@/components/admin/reports-view";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { isAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Server Action used by the range picker to re-fetch on the server. Re-checks
// admin since Server Actions are independently callable endpoints, and sanitizes
// the client-supplied range (clamp future, swap reversed).
async function loadReport(range: AnalyticsRange) {
  "use server";
  if (!(await isAdmin())) throw new Error("Not authorized.");
  return getReportData(sanitizeRange(range));
}

export default async function ReportsPage() {
  const initial = await getReportData(presetToRange("7d"));
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Reports" description="Sales and revenue trends." />
      <ReportsView initial={initial} load={loadReport} />
    </div>
  );
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Browser verification**

Run: `npm run dev`, sign in as admin, open `/admin/reports`.
Verify:
- Default shows "Last 7 days"; presets Today / Yesterday / 7 days / 30 days / Month each reload and highlight.
- "Yesterday" shows yesterday's data (non-empty if orders exist then).
- Custom → pick a past `from`→`to` (e.g. 2 days ago → yesterday), Apply → totals, delta vs prior period, top items, payment mix all recompute; eyebrow shows the date span.
- Custom "To" cannot exceed today; reversed from/to auto-corrects.

- [ ] **Step 7: Commit**

```bash
git add lib/analytics/reports.ts components/admin/dashboard-charts.tsx components/admin/reports-view.tsx app/\(admin\)/admin/reports/page.tsx
git commit -m "feat(reports): drive /admin/reports with preset + custom date range"
```

---

### Task 4: Range-driven /admin dashboard with live pipeline

**Files:**
- Modify: `lib/analytics/dashboard.ts`
- Create: `components/admin/dashboard-view.tsx`
- Modify: `app/(admin)/admin/page.tsx`

**Interfaces:**
- Consumes: `AnalyticsRange`, `DashboardMetrics` (types); `eachDay` / `presetToRange` / `sanitizeRange` / `formatRangeLabel` (range.ts); `RangePicker`; `RevenueArea`, `Sparkline` (dashboard-charts); `formatPrice`.
- Produces: `getDashboardMetrics(range: AnalyticsRange): Promise<DashboardMetrics>`; `DashboardView({ initial, initialRange, load })`; `loadDashboard(range: AnalyticsRange): Promise<DashboardMetrics>`.

- [ ] **Step 1: Rewrite `lib/analytics/dashboard.ts`**

```ts
import { createClient } from "@/lib/supabase/server";
import type { AnalyticsRange, DashboardMetrics } from "@/lib/analytics/types";
import { klToday, eachDay } from "@/lib/analytics/range";

const KL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
function klDate(iso: string): string {
  return KL.format(new Date(iso));
}

const IN_PROGRESS = new Set(["pending", "preparing", "ready"]);

export async function getDashboardMetrics(range: AnalyticsRange): Promise<DashboardMetrics> {
  const db = await createClient();
  const { data: orders, error } = await db
    .from("orders")
    .select("id, status, total, created_at, user_id");
  if (error) throw new Error(`getDashboardMetrics failed: ${error.message}`);

  const { from, to } = range;
  const today = klToday();

  let rangeOrders = 0;
  let rangeRevenue = 0;
  let liveInProgress = 0;
  const activeUsers = new Set<string>();
  const statusCounts = new Map<string, number>();
  const rangeCompletedIds: string[] = [];
  const dayRevenue = new Map<string, number>(); // KL day -> completed revenue (sen)

  for (const o of orders ?? []) {
    const d = klDate(o.created_at);
    // Live: current snapshot of all orders by status; today's in-progress.
    statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1);
    if (d === today && IN_PROGRESS.has(o.status)) liveInProgress++;

    // Range-driven aggregates.
    if (d >= from && d <= to) {
      rangeOrders++;
      if (o.user_id) activeUsers.add(o.user_id);
      if (o.status === "completed") {
        rangeRevenue += o.total;
        rangeCompletedIds.push(o.id);
        dayRevenue.set(d, (dayRevenue.get(d) ?? 0) + o.total);
      }
    }
  }

  // Per-day revenue across the range, zero-filled so the trend line is continuous.
  const trend = eachDay(range).map((date) => ({ date, revenue: dayRevenue.get(date) ?? 0 }));

  let topSellers: { name: string; quantity: number }[] = [];
  if (rangeCompletedIds.length > 0) {
    const { data: items, error: itemsErr } = await db
      .from("order_items")
      .select("name, quantity, is_custom, order_id, products(name)")
      .in("order_id", rangeCompletedIds);
    if (itemsErr) throw new Error(`getDashboardMetrics failed: ${itemsErr.message}`);
    const byName = new Map<string, number>();
    for (const it of items ?? []) {
      if (it.is_custom) continue; // best-sellers is for featurable menu items only
      const displayName = it.products?.name ?? it.name;
      byName.set(displayName, (byName.get(displayName) ?? 0) + it.quantity);
    }
    topSellers = [...byName.entries()]
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }

  return {
    range: {
      orders: rangeOrders,
      revenue: rangeRevenue,
      activeCustomers: activeUsers.size,
      completed: rangeCompletedIds.length,
    },
    trend,
    topSellers,
    live: {
      inProgress: liveInProgress,
      statusBreakdown: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
    },
  };
}
```

- [ ] **Step 2: Create `components/admin/dashboard-view.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { AnalyticsRange, DashboardMetrics } from "@/lib/analytics/types";
import { formatRangeLabel } from "@/lib/analytics/range";
import { formatPrice } from "@/lib/format";
import { RevenueArea, Sparkline } from "@/components/admin/dashboard-charts";
import { RangePicker } from "@/components/admin/range-picker";
import { cn } from "@/lib/utils";

// Order pipeline meters. Colours match the barista board (drink-row.tsx):
// pending=amber, preparing=blue, ready=emerald.
const PIPELINE = [
  { key: "pending", label: "Pending", bar: "bg-amber-500" },
  { key: "preparing", label: "Preparing", bar: "bg-blue-500" },
  { key: "ready", label: "Ready", bar: "bg-emerald-500" },
  { key: "completed", label: "Completed", bar: "bg-foreground" },
  { key: "cancelled", label: "Cancelled", bar: "bg-muted-foreground/40" },
] as const;

function aov(revenue: number, completed: number) {
  return completed > 0 ? Math.round(revenue / completed) : 0;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </span>
  );
}

function StatTile({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4">
      <Eyebrow>{label}</Eyebrow>
      <span className="font-mono text-2xl font-bold tabular-nums tracking-tight">{value}</span>
      {children}
    </div>
  );
}

export function DashboardView({
  initial,
  initialRange,
  load,
}: {
  initial: DashboardMetrics;
  initialRange: AnalyticsRange;
  load: (range: AnalyticsRange) => Promise<DashboardMetrics>;
}) {
  const [m, setM] = useState(initial);
  const [range, setRange] = useState(initialRange);
  const [pending, startTransition] = useTransition();

  function pick(next: AnalyticsRange) {
    setRange(next);
    startTransition(async () => setM(await load(next)));
  }

  const statusMap = new Map(m.live.statusBreakdown.map((s) => [s.status, s.count]));
  const pipelineMax = Math.max(1, ...PIPELINE.map((p) => statusMap.get(p.key) ?? 0));
  const sellerMax = Math.max(1, ...m.topSellers.map((s) => s.quantity));
  const rangeLabel = formatRangeLabel(range);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker value={range} onChange={pick} disabled={pending} />
      </div>

      <div className={cn("flex flex-col gap-7 transition-opacity", pending && "opacity-50")}>
        {/* Range take (ink) + live "on the bar" count (amber). */}
        <section className="naise-rise relative overflow-hidden rounded-3xl bg-black px-6 py-7 text-white sm:px-8 sm:py-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-2">
              <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-white/55">
                {rangeLabel}
              </span>
              <span className="font-mono text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
                {formatPrice(m.range.revenue)}
              </span>
              <span className="text-sm text-white/65">
                {m.range.orders} order{m.range.orders === 1 ? "" : "s"} placed
                <span className="px-1.5 text-white/30">·</span>
                avg {formatPrice(aov(m.range.revenue, m.range.completed))}
              </span>
            </div>

            <div className="flex items-center gap-3 self-start rounded-2xl border border-white/15 bg-white/[0.06] px-5 py-4 sm:self-auto">
              <span className="relative flex size-2.5 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-70 motion-reduce:hidden" />
                <span className="relative inline-flex size-2.5 rounded-full bg-amber-400" />
              </span>
              <div className="flex flex-col leading-none">
                <span className="font-mono text-3xl font-bold tabular-nums text-amber-300">
                  {m.live.inProgress}
                </span>
                <span className="mt-1 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-white/55">
                  On the bar
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Range stats — revenue tile carries a sparkline. */}
        <section className="flex flex-col gap-3">
          <Eyebrow>{rangeLabel}</Eyebrow>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Revenue" value={formatPrice(m.range.revenue)}>
              <Sparkline data={m.trend} />
            </StatTile>
            <StatTile label="Orders" value={String(m.range.orders)} />
            <StatTile label="Active customers" value={String(m.range.activeCustomers)} />
            <StatTile label="Avg order" value={formatPrice(aov(m.range.revenue, m.range.completed))} />
          </div>
        </section>

        {/* Revenue trend (range) + live order pipeline. */}
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 lg:col-span-2">
            <div className="flex items-baseline justify-between">
              <h2 className="font-heading text-base font-semibold">Revenue trend</h2>
              <Eyebrow>{rangeLabel}</Eyebrow>
            </div>
            <RevenueArea data={m.trend} />
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-heading text-base font-semibold">Order pipeline</h2>
              <Eyebrow>Live</Eyebrow>
            </div>
            <ul className="flex flex-col gap-3">
              {PIPELINE.map((p) => {
                const count = statusMap.get(p.key) ?? 0;
                return (
                  <li key={p.key} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{p.label}</span>
                      <span className="font-mono font-medium tabular-nums">{count}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", p.bar)}
                        style={{ width: `${(count / pipelineMax) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* Top sellers — ranking within the range. */}
        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-heading text-base font-semibold">Top sellers</h2>
            <Eyebrow>{rangeLabel}</Eyebrow>
          </div>
          {m.topSellers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No completed orders in this range.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {m.topSellers.map((s, i) => (
                <li key={s.name} className="flex items-center gap-3 text-sm">
                  <span className="w-4 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="w-32 shrink-0 truncate font-medium sm:w-44">{s.name}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-foreground"
                      style={{ width: `${(s.quantity / sellerMax) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right font-mono font-medium tabular-nums">
                    {s.quantity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `app/(admin)/admin/page.tsx`**

```tsx
import Link from "next/link";
import { Plus, ClipboardList } from "lucide-react";
import { getDashboardMetrics } from "@/lib/analytics/dashboard";
import type { AnalyticsRange } from "@/lib/analytics/types";
import { presetToRange, sanitizeRange } from "@/lib/analytics/range";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { DashboardView } from "@/components/admin/dashboard-view";
import { Button } from "@/components/ui/button";
import { isAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Re-fetch on the server when the range changes. Re-checks admin (Server Actions
// are independently callable) and sanitizes the client-supplied range.
async function loadDashboard(range: AnalyticsRange) {
  "use server";
  if (!(await isAdmin())) throw new Error("Not authorized.");
  return getDashboardMetrics(sanitizeRange(range));
}

export default async function AdminDashboardPage() {
  const initialRange = presetToRange("today");
  const initial = await getDashboardMetrics(initialRange);

  return (
    <div className="flex flex-col gap-7">
      <AdminPageHeader title="Dashboard" description="Store performance at a glance.">
        <Button asChild variant="outline" size="sm" className="rounded-full">
          <Link href="/manage">
            <ClipboardList className="size-4" aria-hidden />
            Orders
          </Link>
        </Button>
        <Button asChild size="sm" className="rounded-full">
          <Link href="/admin/menu/new">
            <Plus className="size-4" aria-hidden />
            New item
          </Link>
        </Button>
      </AdminPageHeader>

      <DashboardView initial={initial} initialRange={initialRange} load={loadDashboard} />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Browser verification**

Open `/admin` as admin.
Verify:
- Default = Today; hero shows today's revenue/orders/avg; "On the bar" shows the live in-progress count.
- Switch to Yesterday / a custom past window: hero eyebrow, revenue, orders, avg, stat tiles, sparkline, revenue trend, and top sellers all reflect the selected window.
- The "On the bar" number and the Order pipeline meters (labelled "Live") do **not** change when the range changes — they stay current.
- Trend renders for multi-day ranges; single-day (Today/Yesterday) renders without error.

- [ ] **Step 6: Commit**

```bash
git add lib/analytics/dashboard.ts components/admin/dashboard-view.tsx app/\(admin\)/admin/page.tsx
git commit -m "feat(dashboard): range-driven stats with always-live pipeline"
```

---

### Task 5: Full build, cleanup, final verification

**Files:**
- Delete: `scripts/_verify-range.ts`

- [ ] **Step 1: Remove the temp verification script**

```bash
git rm scripts/_verify-range.ts
```

(If the `scripts/` directory is now empty and was created by this feature, remove it too.)

- [ ] **Step 2: Full production build**

Run: `npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Cross-surface smoke in browser**

Run: `npm run dev`.
- `/admin/reports`: default 7 days → switch every preset → custom past window. Data and deltas correct.
- `/admin`: default Today → Yesterday → custom window. Stats follow range; pipeline + on-the-bar stay live.
- Confirm no console errors on either page.

- [ ] **Step 5: Commit cleanup**

```bash
git add -A
git commit -m "chore(analytics): remove temp range verification script"
```

---

## Self-Review

**Spec coverage:**
- Core `{from,to}` model → Task 1 (`types.ts`, `range.ts`). ✓
- Presets as client shortcuts (today/yesterday/7d/30d/month) → `presetToRange`, `rangePresets` (Task 1); pills (Task 2). ✓
- Custom calendar via native `<input type="date">`, no new deps → Task 2. ✓
- Prior-period baseline = equal-length window before `from` → `previousWindow` (Task 1), used in reports (Task 3). ✓
- `/admin/reports` uses picker; downstream recomputes → Task 3. ✓
- Dashboard: range drives revenue/orders/active customers/avg/top sellers/trend → Task 4. ✓
- Dashboard: on-the-bar + pipeline always live → `DashboardMetrics.live`, labelled "Live" (Task 4). ✓
- Hero label reflects window; default Today (dashboard) / 7d (reports) → Tasks 3–4. ✓
- Boundary validation (clamp future, swap reversed) → `sanitizeRange` in both server actions. ✓
- Out of scope: `lib/orders/range.ts` untouched; no schema/RLS changes; no new libs. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content. ✓

**Type consistency:** `AnalyticsRange` used identically across types.ts, range.ts, reports.ts, dashboard.ts, both views, both pages. `DashboardMetrics` shape (`range`/`trend`/`topSellers`/`live`) matches producer (dashboard.ts) and consumer (dashboard-view.tsx). `getReportData`/`getDashboardMetrics`/`loadReport`/`loadDashboard` signatures consistent. `RangePicker` props match both call sites. ✓
