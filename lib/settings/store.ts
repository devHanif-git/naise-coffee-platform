import { createClient } from "@/lib/supabase/server";
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from "@/lib/settings/types";

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
// transient read failure never hard-fails the storefront UI.
export async function getStoreSettings(): Promise<StoreSettings> {
  const db = await createClient();
  const { data } = await db.from("store_settings").select(COLUMNS).limit(1).maybeSingle();
  return data ? map(data) : DEFAULT_STORE_SETTINGS;
}

// Checkout path: FAIL-CLOSED. Any read error or missing row is treated as
// closed, so a transient read/RLS failure can never bypass an intentional
// store closure when placing an order. (The display path above stays fail-open.)
export async function getStoreSettingsForCheckout(): Promise<StoreSettings> {
  const db = await createClient();
  const { data, error } = await db.from("store_settings").select(COLUMNS).limit(1).maybeSingle();
  if (error || !data) return { ...DEFAULT_STORE_SETTINGS, isOpen: false };
  return map(data);
}
