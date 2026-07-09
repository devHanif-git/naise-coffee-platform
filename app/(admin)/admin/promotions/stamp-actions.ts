"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";
import { STAMP_CONFIG_TAG } from "@/lib/stamps/config-store";

export type StampActionResult = { ok: true } | { ok: false; error: string };

export type StampSettingsInput = {
  isEnabled: boolean;
  cardSize: number;
  milestoneSmall: number;
  rmOffAmount: number;
  rmOffMinSpend: number;
  freeDrinkMaxValue: number;
  voucherExpiryDays: number;
};

// Persist the singleton stamp_settings row (admin only) and invalidate every
// surface that reads it. Config changes apply to FUTURE voucher issues only.
export async function saveStampSettings(input: StampSettingsInput): Promise<StampActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  if (input.milestoneSmall >= input.cardSize) {
    return { ok: false, error: "Milestone must be smaller than card size." };
  }
  const db = await createClient();
  const { error } = await db.from("stamp_settings").update({
    is_enabled: input.isEnabled,
    card_size: input.cardSize,
    milestone_small: input.milestoneSmall,
    rm_off_amount: input.rmOffAmount,
    rm_off_min_spend: input.rmOffMinSpend,
    free_drink_max_value: input.freeDrinkMaxValue,
    voucher_expiry_days: input.voucherExpiryDays,
  }).eq("id", true);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/promotions");
  revalidatePath("/rewards");
  revalidateTag(STAMP_CONFIG_TAG, "max");
  return { ok: true };
}
