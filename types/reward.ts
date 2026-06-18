// Beans are Naise's loyalty currency: earned on orders, redeemed for free
// drinks. All Bean amounts are whole numbers.

// A reward the customer can redeem with Beans (e.g. a free drink).
export type Reward = {
  id: string;
  name: string;
  cost: number;
  image: string;
  // The menu item this reward grants for free. Redeeming opens this product so
  // the customer can pick size/add-ons; the base drink is then free.
  productSlug: string;
};

// A loyalty tier. `threshold` is the Bean total that unlocks the tier; `perk`
// describes the benefit the tier grants.
export type RewardTier = {
  id: string;
  name: string;
  threshold: number;
  perk: string;
};

// One day in the weekly streak. `done` marks days already earned this week.
export type StreakDay = {
  label: string;
  done: boolean;
};

// A streak milestone reward (e.g. 3 days = 50 Beans). `reward` is the display
// label; `beans` is the amount credited when the streak reaches `days`. The
// 30-day "Free Drink" is delivered as Beans equal to the cheapest reward.
export type StreakMilestone = {
  days: number;
  reward: string;
  beans: number;
};

// A single line in the recent Bean activity feed. Positive `amount` is earned,
// negative is redeemed.
export type BeanActivity = {
  id: string;
  amount: number;
  label: string;
  when: string;
};

// The full rewards snapshot for the signed-in customer. Server-fetched in the
// real app; mocked in data/rewards.ts for now.
export type RewardsSummary = {
  beans: number;
  nextDrinkAt: number;
  streakDays: number;
  week: StreakDay[];
  milestones: StreakMilestone[];
  tier: string;
  tierMax: number;
  nextTier: string;
  referralBeans: number;
  referralVoucher: string;
  rewards: Reward[];
  activity: BeanActivity[];
};

// The rewards outcome of placing an order, returned by apply_order_rewards and
// surfaced on the checkout confirmation. `bonuses` are streak-milestone awards
// granted by this order.
export type OrderRewardsResult = {
  earned: number;
  redeemedCost: number;
  streakDays: number;
  bonuses: { label: string; beans: number }[];
};

// A Bean bonus granted for hitting a streak checkpoint (e.g. a 3-day bonus).
// Matches the shape of OrderRewardsResult.bonuses entries; shown on the checkout
// confirmation.
export type StreakAward = { label: string; beans: number };
