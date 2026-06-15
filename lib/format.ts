// Money is stored in sen (1 MYR = 100 sen). Format to a RM display string.
export function formatPrice(sen: number): string {
  return `RM ${(sen / 100).toFixed(2)}`;
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
