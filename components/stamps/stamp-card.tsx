"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { StampCard as StampCardData, StampSettings } from "@/types/reward";
import { cn } from "@/lib/utils";

// The 8-slot loyalty card. Subscribes to the member's own stamp_cards row so a
// stamp granted at the counter animates in live. Milestone slots carry a badge.
export function StampCard({
  initial,
  settings,
  userId,
}: {
  initial: StampCardData | null;
  settings: StampSettings;
  userId: string | null;
}) {
  const [card, setCard] = useState<StampCardData>(
    initial ?? { currentCount: 0, cycle: 0, totalStamps: 0 },
  );
  const prevCount = useRef(card.currentCount);
  const [justStamped, setJustStamped] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    const db = createClient();
    const channel = db
      .channel(`stamp-card-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stamp_cards", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { current_count: number; cycle: number; total_stamps: number };
          setCard({ currentCount: row.current_count, cycle: row.cycle, totalStamps: row.total_stamps });
        },
      )
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  }, [userId]);

  // Animate the newest slot when the count rises (ignore resets to 0).
  useEffect(() => {
    if (card.currentCount > prevCount.current) {
      setJustStamped(card.currentCount);
      const t = setTimeout(() => setJustStamped(null), 400);
      prevCount.current = card.currentCount;
      return () => clearTimeout(t);
    }
    prevCount.current = card.currentCount;
  }, [card.currentCount]);

  const slots = Array.from({ length: settings.cardSize }, (_, i) => i + 1);

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider">Stamp Card</h2>
        <span className="text-xs text-muted-foreground">
          {card.currentCount}/{settings.cardSize}
          {card.cycle > 0 && <> · Card #{card.cycle + 1}</>}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3">
        {slots.map((n) => {
          const filled = n <= card.currentCount;
          const isMilestone = n === settings.milestoneSmall || n === settings.cardSize;
          return (
            <div
              key={n}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-full border-2 text-sm font-bold",
                filled ? "border-foreground bg-foreground text-white" : "border-dashed border-border text-muted-foreground",
                justStamped === n && "naise-stamp-press",
              )}
            >
              {filled ? "☕" : n}
              {isMilestone && !filled && (
                <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1 text-[0.5rem] font-bold text-black">
                  {n === settings.cardSize ? "FREE" : "RM"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[0.6875rem] text-muted-foreground">
        Earn a stamp with every order. {settings.milestoneSmall} stamps = RM
        {(settings.rmOffAmount / 100).toFixed(0)} off · {settings.cardSize} stamps = a free drink.
      </p>
    </section>
  );
}
