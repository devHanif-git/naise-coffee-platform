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

// --- Stamp card + vouchers (loyalty program #2, separate from streak) ---

export type VoucherType = "rm_off" | "free_drink";
export type VoucherStatus = "active" | "redeemed" | "expired";

// Cached per-member stamp state (mirrors the DB stamp_cards row, camelCased).
export type StampCard = {
  currentCount: number;
  cycle: number;
  totalStamps: number;
};

// A voucher issued at a stamp milestone.
export type Voucher = {
  id: string;
  type: VoucherType;
  status: VoucherStatus;
  discountAmount: number;   // sen
  minSpend: number;         // sen
  freeDrinkMaxValue: number; // sen
  expiresAt: string;        // ISO
};

// Admin-editable stamp/voucher config.
export type StampSettings = {
  isEnabled: boolean;
  cardSize: number;
  milestoneSmall: number;
  rmOffAmount: number;
  rmOffMinSpend: number;
  freeDrinkMaxValue: number;
  voucherExpiryDays: number;
};

// Result of grant_order_stamp.
export type GrantStampResult = {
  stamped: boolean;
  count: number;
  cycle: number;
  vouchersIssued: { type: VoucherType }[];
} | null;

// Result of attach_order_member (minimal identity only).
export type AttachMemberResult =
  | { ok: true; displayName: string; avatarUrl: string | null; phoneMasked: string | null }
  | { ok: false; error: string };

// One candidate from the staff member search (search_members RPC). Staff-facing,
// so full contact details are included to positively identify the right person.
export type MemberSearchResult = {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
};
