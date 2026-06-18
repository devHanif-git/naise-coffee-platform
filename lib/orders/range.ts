// Date quick-filters for the manage board. Day boundaries are computed against
// Malaysia time (UTC+8, no DST); orders store timestamps in UTC, so we convert
// MYT calendar days into half-open [from, to) UTC instants for the query.

export type DateRangeKey = "today" | "yesterday" | "last7" | "all";

export const dateRanges: { value: DateRangeKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last7", label: "Last 7 days" },
  { value: "all", label: "All time" },
];

export function isDateRangeKey(value: string): value is DateRangeKey {
  return (
    value === "today" ||
    value === "yesterday" ||
    value === "last7" ||
    value === "all"
  );
}

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// The UTC instant of midnight (MYT) on the day that `instant` falls in.
function startOfMytDay(instant: number): number {
  const shifted = new Date(instant + MYT_OFFSET_MS);
  const midnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return midnight - MYT_OFFSET_MS;
}

// Half-open [from, to) UTC ISO bounds for a quick-filter key. A null bound is
// unbounded on that side (so "today"/"last7" stay open into the future).
export function rangeBounds(
  key: DateRangeKey,
  now: number = Date.now(),
): { fromIso: string | null; toIso: string | null } {
  const todayStart = startOfMytDay(now);
  switch (key) {
    case "today":
      return { fromIso: new Date(todayStart).toISOString(), toIso: null };
    case "yesterday":
      return {
        fromIso: new Date(todayStart - DAY_MS).toISOString(),
        toIso: new Date(todayStart).toISOString(),
      };
    case "last7":
      return { fromIso: new Date(todayStart - 6 * DAY_MS).toISOString(), toIso: null };
    case "all":
      return { fromIso: null, toIso: null };
  }
}
