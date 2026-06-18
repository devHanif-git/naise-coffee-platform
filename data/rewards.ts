import type { Reward, RewardTier, StreakMilestone } from "@/types/reward";
import { images } from "@/constants/images";

// Loyalty tiers, ordered by the Beans needed to unlock them.
export const rewardTiers: RewardTier[] = [
  {
    id: "fresh",
    name: "Fresh",
    threshold: 0,
    perk: "Earn 10 Beans for every RM1 spent.",
  },
  {
    id: "bold",
    name: "Bold",
    threshold: 1000,
    perk: "A free birthday drink and member-only offers.",
  },
  {
    id: "naise-club",
    name: "Naise Club",
    threshold: 3000,
    perk: "Free upsizes and early access to new drinks.",
  },
];

// How many Beans a customer earns per RM1 spent. Shown in "How it works".
export const beansPerRinggit = 10;

// Resolved tier standing for a Bean balance. `next` is undefined at the top
// tier (nothing left to unlock); `progressPct` then sits at 100. Derived from
// `rewardTiers` so the rewards screen and the tiers modal always agree on the
// current tier rather than reading separate static values.
export type TierProgress = {
  current: RewardTier;
  next?: RewardTier;
  toNext: number;
  progressPct: number;
  isMaxTier: boolean;
};

export function getTierProgress(
  beans: number,
  tiers: RewardTier[] = rewardTiers,
): TierProgress {
  if (tiers.length === 0) {
    throw new Error("getTierProgress requires at least one tier");
  }
  // Tiers ascending by threshold; current is the highest one unlocked.
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

// The main Rewards screen previews only the most recent few activities; the
// full list lives on /rewards/activity. Centralized here so the cap stays
// consistent and survives the move to a Supabase query.
export const RECENT_ACTIVITY_LIMIT = 3;

// The redeemable free-drink catalog. Static config for now; the future CMS will
// manage these. Redemption cost is pegged to each drink's retail price (Beans ≈
// price in sen) for a uniform ~10% reward rate.
export const rewardsCatalog: Reward[] = [
  { id: "free-americano", name: "Free Americano", cost: 1000, image: images.coffeeWithLogo, productSlug: "americano" },
  { id: "free-latte", name: "Free Latte", cost: 1300, image: images.coffeeWithLogo, productSlug: "naise-signature-latte" },
  { id: "free-matcha", name: "Free Matcha", cost: 1500, image: images.coffeeWithLogo, productSlug: "matcha-latte" },
  { id: "free-spanish-latte", name: "Free Spanish Latte", cost: 1400, image: images.coffeeWithLogo, productSlug: "spanish-latte" },
];

// Streak stamp-card milestones (display). The Bean grants are applied
// server-side by apply_order_rewards — these numbers MUST match that function.
export const streakMilestones: StreakMilestone[] = [
  { days: 3, reward: "50 Beans", beans: 50 },
  { days: 7, reward: "100 Beans", beans: 100 },
  { days: 30, reward: "Free Drink", beans: 1000 },
];

// Referral invite-card values (display only; program not built yet).
export const referralReward = { beans: 200, voucher: "RM5 Voucher" };

// Fallback "free drink" target used by the hero when the catalog is empty.
export const FREE_DRINK_FALLBACK = 1000;
