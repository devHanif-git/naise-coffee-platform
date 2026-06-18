"use client";

import { useEffect, useMemo, useState } from "react";
import type { StreakDay } from "@/types/reward";
import {
  buildWeek,
  computeStreakDays,
  hasCheckedInToday,
} from "@/lib/streak";
import { createClient } from "@/lib/supabase/client";

// Streak read from Supabase. Check-ins are recorded server-side at order
// placement (apply_order_rewards); this hook only derives the display values via
// the pure rules in lib/streak.ts. Guests / signed-out see an empty streak.
type UseStreak = {
  hydrated: boolean;
  streakDays: number;
  week: StreakDay[];
  checkedInToday: boolean;
};

export function useStreak(): UseStreak {
  const [checkIns, setCheckIns] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (active) setHydrated(true);
        return;
      }
      const { data } = await supabase
        .from("streak_checkins")
        .select("check_in_date")
        .eq("user_id", user.id);
      if (active && data) {
        setCheckIns(new Set(data.map((r) => r.check_in_date)));
      }
      if (active) setHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  return useMemo<UseStreak>(() => {
    const today = new Date();
    return {
      hydrated,
      streakDays: computeStreakDays(checkIns, today),
      week: buildWeek(checkIns, today),
      checkedInToday: hasCheckedInToday(checkIns, today),
    };
  }, [checkIns, hydrated]);
}
