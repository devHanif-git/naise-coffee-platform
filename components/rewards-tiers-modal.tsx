"use client";

import { useEffect } from "react";
import { X, Check, Lock } from "lucide-react";
import type { RewardTier } from "@/types/reward";
import { cn } from "@/lib/utils";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

// Lists the loyalty tiers and the Beans needed to unlock each. Opened from
// "View Tiers". Hand-rolled like RewardsInfoModal — closes on backdrop click or
// Esc, locks body scroll, and lifts above the tab bar on mobile. `beans` marks
// which tiers are unlocked and which is current.
export function RewardsTiersModal({
  tiers,
  beans,
  onClose,
}: {
  tiers: RewardTier[];
  beans: number;
  onClose: () => void;
}) {
  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The current tier is the highest one the customer has unlocked.
  const currentId = [...tiers]
    .reverse()
    .find((t) => beans >= t.threshold)?.id;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rewards-tiers-title"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 pb-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] naise-fade sm:items-center sm:pb-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[80dvh] w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white naise-pop"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
              Naise Rewards
            </p>
            <h2
              id="rewards-tiers-title"
              className="mt-1 font-heading text-2xl font-bold tracking-tight"
            >
              Loyalty Tiers
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-5" strokeWidth={2.5} aria-hidden />
          </button>
        </div>

        <ul className="flex flex-col gap-3 overflow-y-auto overscroll-contain px-6 py-6">
          {tiers.map((tier) => {
            const unlocked = beans >= tier.threshold;
            const current = tier.id === currentId;
            return (
              <li
                key={tier.id}
                className={cn(
                  "flex items-start gap-4 rounded-2xl border p-4 transition-colors",
                  current
                    ? "border-transparent bg-black text-white"
                    : "border-border bg-white",
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-full",
                    current
                      ? "bg-white text-black"
                      : unlocked
                        ? "bg-black text-white"
                        : "bg-neutral-100 text-muted-foreground",
                  )}
                >
                  {unlocked ? (
                    <Check className="size-5" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <Lock className="size-4" strokeWidth={2.5} aria-hidden />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-heading text-base font-bold tracking-tight">
                      {tier.name}
                    </h3>
                    {current && (
                      <span className="rounded-full bg-white/20 px-2 py-0.5 text-[0.5625rem] font-bold uppercase tracking-wider">
                        Current
                      </span>
                    )}
                  </div>
                  <p
                    className={cn(
                      "mt-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide tabular-nums",
                      current ? "text-white/70" : "text-muted-foreground",
                    )}
                  >
                    {tier.threshold === 0
                      ? "Starting tier"
                      : `${tier.threshold.toLocaleString()} Beans`}
                  </p>
                  <p
                    className={cn(
                      "mt-1.5 text-sm leading-snug",
                      current ? "text-white/80" : "text-muted-foreground",
                    )}
                  >
                    {tier.perk}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-12 w-full rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white transition-transform hover:scale-[1.01] active:scale-[0.99] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
