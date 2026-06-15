import type { RewardsSummary, RewardTier } from "@/types/reward";
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
    perk: "1.25× Beans and a free birthday drink.",
  },
  {
    id: "naise-club",
    name: "Naise Club",
    threshold: 3000,
    perk: "1.5× Beans, free upsizes, and early access to new drinks.",
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

// Mock rewards snapshot for the signed-in customer. Replace with a server fetch
// (Supabase) once the rewards tables and RLS are in place.
export const rewardsSummary: RewardsSummary = {
  beans: 1250,
  nextDrinkAt: 1000,
  streakDays: 4,
  week: [
    { label: "Mon", done: true },
    { label: "Tue", done: true },
    { label: "Wed", done: true },
    { label: "Thu", done: true },
    { label: "Fri", done: false },
    { label: "Sat", done: false },
    { label: "Sun", done: false },
  ],
  milestones: [
    { days: 3, reward: "50 Beans", beans: 50 },
    { days: 7, reward: "100 Beans", beans: 100 },
    { days: 30, reward: "Free Drink", beans: 1000 },
  ],
  tier: "Bold",
  tierMax: 3000,
  nextTier: "Naise Club",
  referralBeans: 200,
  referralVoucher: "RM5 Voucher",
  // Redemption cost is pegged to each drink's retail price (Beans ≈ price in
  // sen) for a uniform ~10% reward rate. Customers earn 10 Beans per RM1
  // (`beansPerRinggit`), so cost == price-in-sen means a free drink costs ~10%
  // of the spend it took to earn it. Avoids the old leak where 500-Bean drinks
  // gave back 15–20% and let people arbitrage toward the priciest free drink.
  rewards: [
    { id: "free-americano", name: "Free Americano", cost: 1000, image: images.coffeeWithLogo, productSlug: "americano" },
    { id: "free-latte", name: "Free Latte", cost: 1300, image: images.coffeeWithLogo, productSlug: "naise-signature-latte" },
    { id: "free-matcha", name: "Free Matcha", cost: 1500, image: images.coffeeWithLogo, productSlug: "matcha-latte" },
    { id: "free-spanish-latte", name: "Free Spanish Latte", cost: 1400, image: images.coffeeWithLogo, productSlug: "spanish-latte" },
  ],
  activity: [
    { id: "a1", amount: 120, label: "Spanish Latte", when: "Today" },
    { id: "a2", amount: 90, label: "Americano", when: "Yesterday" },
    { id: "a3", amount: -1000, label: "Redeemed Americano", when: "12 Jun" },
    { id: "a4", amount: 140, label: "Caramel Macchiato", when: "10 Jun" },
    { id: "a5", amount: 50, label: "3-Day Streak Bonus", when: "9 Jun" },
    { id: "a6", amount: 130, label: "Matcha Latte", when: "7 Jun" },
    { id: "a7", amount: 200, label: "Referral Bonus", when: "5 Jun" },
    { id: "a8", amount: -1300, label: "Redeemed Latte", when: "2 Jun" },
    { id: "a9", amount: 110, label: "Vanilla Latte", when: "1 Jun" },
  ],
};

// The main Rewards screen previews only the most recent few activities; the
// full list lives on /rewards/activity. Centralized here so the cap stays
// consistent and survives the move to a Supabase query.
export const RECENT_ACTIVITY_LIMIT = 3;

// A Bean bonus granted for hitting a streak checkpoint on a given day.
export type StreakAward = { label: string; beans: number };

// The streak bonuses earned on the day the streak reaches `streakDays`.
//
// Bonuses run on a repeating weekly cycle, not on absolute day counts: the
// week-position is ((day - 1) mod 7) + 1, so it climbs 1..7 then resets. The
// 3-day bonus pays at week-position 3 and the 7-day bonus at position 7 (a
// completed week). That's why a 10-day streak (week 2, day 3) earns the 3-day
// bonus again. The 30-day free-drink bonus pays every 30 days. A single day can
// trigger more than one (e.g. completing a week that also lands on a 30-day
// mark), so this returns every award that fires.
export function getStreakAwards(streakDays: number): StreakAward[] {
  if (streakDays <= 0) return [];
  const awards: StreakAward[] = [];
  const weekPosition = ((streakDays - 1) % 7) + 1;
  const m = (days: number) =>
    rewardsSummary.milestones.find((x) => x.days === days);

  const m3 = m(3);
  const m7 = m(7);
  const m30 = m(30);
  if (weekPosition === 3 && m3) {
    awards.push({ label: "3-Day Streak Bonus", beans: m3.beans });
  }
  if (weekPosition === 7 && m7) {
    awards.push({ label: "7-Day Streak Bonus", beans: m7.beans });
  }
  if (streakDays % 30 === 0 && m30) {
    awards.push({ label: "30-Day Streak Bonus", beans: m30.beans });
  }
  return awards;
}
