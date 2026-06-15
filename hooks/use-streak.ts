"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { StreakDay } from "@/types/reward";
import {
  buildWeek,
  computeStreakDays,
  dateKey,
  hasCheckedInToday,
} from "@/lib/streak";

const CHECKINS_KEY = "naise-streak-checkins";
const OFFSET_KEY = "naise-streak-dev-offset";

// Client streak store backed by localStorage, mirroring store/cart.tsx's
// hydrate-then-persist pattern. Holds the set of check-in date keys plus a
// dev-only day offset that shifts "today" so skipped days (and the resulting
// broken streak) can be tested without waiting for real calendar days. The
// pure rules live in lib/streak.ts; this layer only persists and exposes
// actions. Swap localStorage for a Supabase `daily_streaks` query later — the
// derived shape (streakDays/week/checkedInToday) stays the same.
// Outcome of a check-in attempt. `isNewCheckIn` is false when today was already
// checked in (a no-op); `streakDays` is the streak length after the attempt.
// Callers use this to award streak milestones — a milestone fires when a new
// check-in pushes the streak to exactly the milestone's day count.
export type CheckInResult = {
  isNewCheckIn: boolean;
  streakDays: number;
};

type UseStreak = {
  hydrated: boolean;
  streakDays: number;
  week: StreakDay[];
  checkedInToday: boolean;
  checkIn: () => CheckInResult;
  // Dev-only: advance the simulated clock by one day (does NOT check in), so
  // you can leave a gap and watch the streak break, or roll forward to a fresh
  // day to check in again. Reset clears all check-ins and the offset.
  devAdvanceDay: () => void;
  devReset: () => void;
};

// "Today" as the store sees it: the real date shifted by the dev offset.
function simulatedToday(offsetDays: number): Date {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  return now;
}

export function useStreak(): UseStreak {
  const [checkIns, setCheckIns] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  // Load once on mount, in an effect, so the first client render matches the
  // server's empty state and we avoid a hydration mismatch (same approach as
  // the cart store).
  useEffect(() => {
    try {
      const rawCheckIns = localStorage.getItem(CHECKINS_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage
      if (rawCheckIns) setCheckIns(new Set(JSON.parse(rawCheckIns) as string[]));
      const rawOffset = localStorage.getItem(OFFSET_KEY);
      if (rawOffset) setOffset(Number(rawOffset) || 0);
    } catch {
      // Ignore malformed/unavailable storage; start with no streak.
    }
    setHydrated(true);
  }, []);

  // Persist after the initial load so we never clobber stored data with the
  // empty starting state.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(CHECKINS_KEY, JSON.stringify([...checkIns]));
      localStorage.setItem(OFFSET_KEY, String(offset));
    } catch {
      // Storage may be full/unavailable; streak still works in-memory.
    }
  }, [checkIns, offset, hydrated]);

  const checkIn = useCallback((): CheckInResult => {
    const today = simulatedToday(offset);
    const key = dateKey(today);
    // Already checked in today: a no-op, report the unchanged streak.
    if (checkIns.has(key)) {
      return { isNewCheckIn: false, streakDays: computeStreakDays(checkIns, today) };
    }
    const next = new Set(checkIns);
    next.add(key);
    setCheckIns(next);
    return { isNewCheckIn: true, streakDays: computeStreakDays(next, today) };
  }, [offset, checkIns]);

  const devAdvanceDay = useCallback(() => {
    setOffset((o) => o + 1);
  }, []);

  const devReset = useCallback(() => {
    setCheckIns(new Set());
    setOffset(0);
  }, []);

  return useMemo<UseStreak>(() => {
    const today = simulatedToday(offset);
    return {
      hydrated,
      streakDays: computeStreakDays(checkIns, today),
      week: buildWeek(checkIns, today),
      checkedInToday: hasCheckedInToday(checkIns, today),
      checkIn,
      devAdvanceDay,
      devReset,
    };
  }, [checkIns, offset, hydrated, checkIn, devAdvanceDay, devReset]);
}
