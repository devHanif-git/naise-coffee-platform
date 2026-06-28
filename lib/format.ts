// Money is stored in sen (1 MYR = 100 sen). Format to a RM display string.
export function formatPrice(sen: number): string {
  return `RM ${(sen / 100).toFixed(2)}`;
}

// Capitalize the first character of free-text input (notes) so entries are
// consistently sentence-cased. Leaves the rest as typed; no-op on empty input.
export function capitalizeFirst(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Capitalize the first character of every word (after each space) for drink
// names, e.g. "sada dasdsa" -> "Sada Dasdsa". Leaves the rest of each word as
// typed so mid-word caps survive; no-op on empty input.
export function capitalizeWords(value: string): string {
  return value.replace(/(^|\s)(\S)/g, (_, sep, char) => sep + char.toUpperCase());
}

// Absolute order time from an ISO timestamp, e.g. "14 Jun 2026, 9:52 pm".
// Locale and timeZone are pinned so the edge server (UTC) and the client
// (local) render identical text — no hydration mismatch. Naise operates in
// Malaysia, so times display in MYT regardless of the viewer's device clock.
export function formatOrderTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date(iso));
}
