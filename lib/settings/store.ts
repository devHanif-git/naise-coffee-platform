import { createClient } from "@/lib/supabase/server";
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from "@/lib/settings/types";

// Reads the single store_settings row. Degrades to DEFAULT_STORE_SETTINGS so a
// transient read failure never blocks the storefront.
export async function getStoreSettings(): Promise<StoreSettings> {
  const db = await createClient();
  const { data } = await db
    .from("store_settings")
    .select("is_open, closed_message, rewards_enabled, referral_enabled, streak_enabled")
    .limit(1)
    .maybeSingle();
  if (!data) return DEFAULT_STORE_SETTINGS;
  return {
    isOpen: data.is_open,
    closedMessage: data.closed_message,
    rewardsEnabled: data.rewards_enabled,
    referralEnabled: data.referral_enabled,
    streakEnabled: data.streak_enabled,
  };
}
