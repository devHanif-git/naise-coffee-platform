"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import type { StampCard as StampCardData, StampSettings } from "@/types/reward";
import { images } from "@/constants/images";
import { cn } from "@/lib/utils";

// The loyalty stamp card. Black hero treatment to match the Beans hero at the
// top of /rewards. Subscribes to the member's own stamp_cards row so a stamp
// granted at the counter animates in live. Milestone slots carry a gold ring.
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
      const t = setTimeout(() => setJustStamped(null), 600);
      prevCount.current = card.currentCount;
      return () => clearTimeout(t);
    }
    prevCount.current = card.currentCount;
  }, [card.currentCount]);

  const slots = Array.from({ length: settings.cardSize }, (_, i) => i + 1);

  // Next milestone + how many stamps away, for the strapline.
  const nextMilestone =
    card.currentCount < settings.milestoneSmall
      ? settings.milestoneSmall
      : card.currentCount < settings.cardSize
        ? settings.cardSize
        : settings.cardSize;
  const toNext = Math.max(0, nextMilestone - card.currentCount);
  const rmOff = (settings.rmOffAmount / 100).toFixed(0);
  const nextRewardLabel =
    nextMilestone === settings.milestoneSmall ? `RM${rmOff} off` : "a free drink";

  return (
    <section
      aria-labelledby="stamp-card-heading"
      className="relative overflow-hidden rounded-[1.75rem] bg-black px-6 py-7 text-white naise-rise"
    >
      <Image
        src={images.coffeeWithLogo}
        alt=""
        width={320}
        height={320}
        aria-hidden
        className="pointer-events-none absolute -bottom-8 -right-10 z-0 h-auto w-36 object-contain sm:w-40"
      />

      <div className="relative z-10">
        <div className="flex items-baseline justify-between">
          <p
            id="stamp-card-heading"
            className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-white/60"
          >
            Stamp Card
          </p>
          <p className="font-heading text-sm font-bold tabular-nums">
            {card.currentCount}
            <span className="text-white/50">/{settings.cardSize}</span>
            {card.cycle > 0 && (
              <span className="ml-2 font-medium text-white/50">Card #{card.cycle + 1}</span>
            )}
          </p>
        </div>

        {/* Stamp grid — filled slots carry the logo badge, empty are dashed
            rings, milestone slots get a gold ring + tiny label. Slots are a
            fixed size and the grid sizes to its content (w-fit) so stamps stay
            legible on narrow phones instead of shrinking to fit a percentage;
            the grid sits above the coffee art (z-10 over z-0). */}
        <div className="mt-5 grid w-fit grid-cols-4 gap-x-3 gap-y-4">
          {slots.map((n) => {
            const filled = n <= card.currentCount;
            const isFree = n === settings.cardSize;
            const isMilestone = n === settings.milestoneSmall || isFree;
            return (
              <div key={n} className="flex flex-col items-center gap-1">
                <div
                  className={cn(
                    "relative flex size-12 items-center justify-center rounded-full",
                    filled
                      ? "" // stamp art has white lettering; sits on the black card so it reads
                      : "border-2 border-dashed border-white/25",
                    isMilestone && !filled && "border-amber-400/70",
                    isMilestone && "ring-2 ring-amber-400/80 ring-offset-2 ring-offset-black",
                    justStamped === n && "naise-stamp-press",
                  )}
                >
                  {filled ? (
                    <Image
                      src={images.stamp}
                      alt=""
                      width={48}
                      height={48}
                      aria-hidden
                      className="size-[118%] max-w-none object-contain"
                    />
                  ) : (
                    <span className="text-[0.6875rem] font-bold text-white/40 tabular-nums">
                      {n}
                    </span>
                  )}

                  {/* Milestone celebration — a gold ring pulse + specks flying
                      out, fired once when this milestone slot is the one just
                      stamped. Sits outside the clipped image wrapper so the
                      specks can travel past the slot edge. */}
                  {isMilestone && justStamped === n && (
                    <span aria-hidden className="pointer-events-none absolute inset-0">
                      <span className="naise-burst-ring absolute inset-0 rounded-full ring-2 ring-amber-400/90" />
                      {Array.from({ length: 8 }, (_, i) => (
                        <span
                          key={i}
                          className="naise-burst-speck absolute left-1/2 top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400"
                          style={{ ["--a" as string]: `${i * 45}deg` }}
                        />
                      ))}
                    </span>
                  )}
                </div>
                {isMilestone && (
                  <span className="text-[0.5rem] font-bold uppercase tracking-wide text-amber-400">
                    {isFree ? "Free" : `RM${rmOff}`}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-5 max-w-[62%] text-[0.8125rem] leading-snug text-white/70">
          {toNext > 0 ? (
            <>
              <span className="font-semibold text-white">{toNext}</span> more{" "}
              {toNext === 1 ? "stamp" : "stamps"} to{" "}
              <span className="font-heading font-bold uppercase tracking-wide text-white">
                {nextRewardLabel}
              </span>
            </>
          ) : (
            <>Card full — reward unlocked!</>
          )}
        </p>
      </div>
    </section>
  );
}
