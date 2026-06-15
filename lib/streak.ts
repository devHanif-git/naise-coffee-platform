import type { StreakDay } from "@/types/reward";

// Pure, date-based streak logic. No storage, no React — feed it the set of
// check-in date keys plus "today" and it derives everything the UI shows. This
// keeps the rules identical when the source of truth moves from localStorage to
// a Supabase `daily_streaks` query: only the persistence layer changes.

// Local-time date key, e.g. "2026-06-14". We key by calendar day in the user's
// timezone (not UTC) so "today" matches what the customer sees on their clock.
export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Midnight of `date` shifted by `days`. Returns a fresh Date; never mutates.
function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function hasCheckedInToday(checkIns: Set<string>, today: Date): boolean {
  return checkIns.has(dateKey(today));
}

// Consecutive days up to and including the most recent check-in, but only while
// the streak is still "alive" — the last check-in must be today or yesterday.
// A gap of one full day or more breaks it back to 0. Counting starts from today
// when today is done, otherwise from yesterday (so an unfinished today doesn't
// zero out a streak the customer can still keep alive before midnight).
export function computeStreakDays(checkIns: Set<string>, today: Date): number {
  const start = checkIns.has(dateKey(today)) ? today : addDays(today, -1);
  if (!checkIns.has(dateKey(start))) return 0;

  let count = 0;
  let cursor = start;
  while (checkIns.has(dateKey(cursor))) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The Mon–Sun week containing `today`, each day flagged done if it has a
// check-in. Mirrors the weekly stamp card in the rewards screen.
export function buildWeek(checkIns: Set<string>, today: Date): StreakDay[] {
  // JS getDay(): Sun=0..Sat=6. Shift so Monday is the start of the week.
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = addDays(today, -mondayOffset);
  return WEEKDAY_LABELS.map((label, i) => {
    const day = addDays(monday, i);
    return { label, done: checkIns.has(dateKey(day)) };
  });
}
