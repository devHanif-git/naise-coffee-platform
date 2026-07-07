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
