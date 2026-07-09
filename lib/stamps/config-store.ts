import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import type { StampSettings } from "@/types/reward";

export const STAMP_CONFIG_TAG = "stamp-config";

// The single admin-editable config row, with safe defaults if missing. Cached in
// the Data Cache and invalidated by the admin save action via revalidateTag.
export const getStampSettings = cache(
  unstable_cache(
    async (): Promise<StampSettings> => {
      const db = createPublicClient();
      const { data } = await db.from("stamp_settings").select("*").limit(1).maybeSingle();
      return {
        isEnabled: data?.is_enabled ?? true,
        cardSize: data?.card_size ?? 8,
        milestoneSmall: data?.milestone_small ?? 4,
        rmOffAmount: data?.rm_off_amount ?? 500,
        rmOffMinSpend: data?.rm_off_min_spend ?? 1100,
        freeDrinkMaxValue: data?.free_drink_max_value ?? 1200,
        voucherExpiryDays: data?.voucher_expiry_days ?? 30,
      };
    },
    ["stamp-settings"],
    { tags: [STAMP_CONFIG_TAG], revalidate: 60 },
  ),
);
