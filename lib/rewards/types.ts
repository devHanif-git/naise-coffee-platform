// CMS-facing shapes. Distinct from the storefront Reward/RewardTier/StreakMilestone
// (which hide archived/inactive rows and reshape for display): admin views need
// raw ids, flags, and the ledger label.
export type AdminLoyaltySettings = {
  beansPerRinggit: number;
  referralBeans: number;
  referralVoucherLabel: string;
};

export type AdminTier = {
  id: string;
  slug: string;
  name: string;
  threshold: number;
  perk: string;
  sortOrder: number;
  isArchived: boolean;
};

export type AdminMilestone = {
  id: string;
  label: string; // ledger label, e.g. "3-Day Streak Bonus"
  displayLabel: string; // stamp-card text, e.g. "50 Beans"
  beans: number;
  triggerDay: number;
  repeatEveryDays: number | null;
  sortOrder: number;
  isActive: boolean;
};

export type AdminRewardItem = {
  id: string;
  slug: string;
  name: string;
  cost: number;
  productId: string;
  productName: string; // resolved for display in the list
  imageUrl: string | null;
  isActive: boolean;
  isArchived: boolean;
  sortOrder: number;
};
