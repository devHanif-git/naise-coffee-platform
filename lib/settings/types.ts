// Store-level settings shared by the CMS (edit) and the storefront (read).
export type StoreSettings = {
  isOpen: boolean;
  closedMessage: string;
  rewardsEnabled: boolean;
  referralEnabled: boolean;
  streakEnabled: boolean;
};

// Safe defaults if the row is missing or unreadable — the storefront must never
// hard-fail on a settings read, so it degrades to "open, all features on".
export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  isOpen: true,
  closedMessage: "We're currently closed. Please check back soon.",
  rewardsEnabled: true,
  referralEnabled: true,
  streakEnabled: true,
};
