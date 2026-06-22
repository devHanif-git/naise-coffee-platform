import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from "@/lib/settings/types";

// Shared store settings (open/closed, feature toggles), identical for every
// user. The DISPLAY read is cached under this tag and busted by the settings
// admin action; the CHECKOUT read is deliberately NOT cached — see below.
export const STORE_SETTINGS_TAG = "store-settings";

type Row = {
  is_open: boolean;
  closed_message: string;
  rewards_enabled: boolean;
  referral_enabled: boolean;
  streak_enabled: boolean;
};

const COLUMNS = "is_open, closed_message, rewards_enabled, referral_enabled, streak_enabled";

function map(row: Row): StoreSettings {
  return {
    isOpen: row.is_open,
    closedMessage: row.closed_message,
    rewardsEnabled: row.rewards_enabled,
    referralEnabled: row.referral_enabled,
    streakEnabled: row.streak_enabled,
  };
}

// Display path: degrades to DEFAULT_STORE_SETTINGS (open, all features on) so a
// transient read failure never hard-fails the storefront UI. Cached (cookie-free
// public client, anon-readable via RLS) since it runs in the customer/kiosk
// layout on every entry; busted instantly when an admin saves settings.
export const getStoreSettings = cache(
  unstable_cache(
    async (): Promise<StoreSettings> => {
      const db = createPublicClient();
      const { data } = await db.from("store_settings").select(COLUMNS).limit(1).maybeSingle();
      return data ? map(data) : DEFAULT_STORE_SETTINGS;
    },
    ["store-settings"],
    { tags: [STORE_SETTINGS_TAG], revalidate: 60 },
  ),
);

// Checkout path: FAIL-CLOSED, and intentionally UNCACHED. It gates order
// placement on an intentional store closure, so it must read live every time —
// a cached/stale "open" must never let an order through after the store closes.
export async function getStoreSettingsForCheckout(): Promise<StoreSettings> {
  const db = await createClient();
  const { data, error } = await db.from("store_settings").select(COLUMNS).limit(1).maybeSingle();
  if (error || !data) return { ...DEFAULT_STORE_SETTINGS, isOpen: false };
  return map(data);
}
