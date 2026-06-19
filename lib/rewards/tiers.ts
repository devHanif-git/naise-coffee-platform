import type { RewardTier } from "@/types/reward";

// Resolved tier standing for a Bean balance. `next` is undefined at the top tier
// (nothing left to unlock); `progressPct` then sits at 100. Pure + client-safe.
export type TierProgress = {
  current: RewardTier;
  next?: RewardTier;
  toNext: number;
  progressPct: number;
  isMaxTier: boolean;
};

// Tiers ascending by threshold; current is the highest one unlocked. `tiers` is
// required (no static default) now that tiers live in the DB.
export function getTierProgress(beans: number, tiers: RewardTier[]): TierProgress {
  if (tiers.length === 0) {
    throw new Error("getTierProgress requires at least one tier");
  }
  const ordered = [...tiers].sort((a, b) => a.threshold - b.threshold);
  let currentIndex = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (beans >= ordered[i].threshold) currentIndex = i;
  }
  const current = ordered[currentIndex];
  const next = ordered[currentIndex + 1];
  if (!next) {
    return { current, toNext: 0, progressPct: 100, isMaxTier: true };
  }
  const span = next.threshold - current.threshold;
  const earned = beans - current.threshold;
  const progressPct =
    span > 0 ? Math.min(100, Math.max(0, Math.round((earned / span) * 100))) : 0;
  return {
    current,
    next,
    toNext: Math.max(0, next.threshold - beans),
    progressPct,
    isMaxTier: false,
  };
}
