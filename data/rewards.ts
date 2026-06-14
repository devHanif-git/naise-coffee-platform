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

// Mock rewards snapshot for the signed-in customer. Replace with a server fetch
// (Supabase) once the rewards tables and RLS are in place.
export const rewardsSummary: RewardsSummary = {
  beans: 1250,
  nextDrinkAt: 1500,
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
    { days: 3, reward: "50 Beans" },
    { days: 7, reward: "100 Beans" },
    { days: 30, reward: "Free Drink" },
  ],
  tier: "Bold",
  tierMax: 3000,
  nextTier: "Naise Club",
  referralBeans: 200,
  referralVoucher: "RM5 Voucher",
  rewards: [
    { id: "free-americano", name: "Free Americano", cost: 500, image: images.coffeeWithLogo },
    { id: "free-latte", name: "Free Latte", cost: 800, image: images.coffeeWithLogo },
    { id: "free-matcha", name: "Free Matcha", cost: 1000, image: images.coffeeWithLogo },
    { id: "free-spanish-latte", name: "Free Spanish Latte", cost: 800, image: images.coffeeWithLogo },
  ],
  activity: [
    { id: "a1", amount: 120, label: "Spanish Latte", when: "Today" },
    { id: "a2", amount: 90, label: "Americano", when: "Yesterday" },
    { id: "a3", amount: -500, label: "Redeemed Americano", when: "12 Jun" },
    { id: "a4", amount: 140, label: "Caramel Macchiato", when: "10 Jun" },
    { id: "a5", amount: 50, label: "3-Day Streak Bonus", when: "9 Jun" },
    { id: "a6", amount: 130, label: "Matcha Latte", when: "7 Jun" },
    { id: "a7", amount: 200, label: "Referral Bonus", when: "5 Jun" },
    { id: "a8", amount: -800, label: "Redeemed Latte", when: "2 Jun" },
    { id: "a9", amount: 110, label: "Vanilla Latte", when: "1 Jun" },
  ],
};

// The main Rewards screen previews only the most recent few activities; the
// full list lives on /rewards/activity. Centralized here so the cap stays
// consistent and survives the move to a Supabase query.
export const RECENT_ACTIVITY_LIMIT = 3;
