"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";
import type { StoreSettings } from "@/lib/settings/types";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateStoreSettings(input: StoreSettings): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };

  const closedMessage = input.closedMessage.trim();
  if (!closedMessage) return { ok: false, error: "Closed message is required." };

  const db = await createClient();
  const { data, error } = await db
    .from("store_settings")
    .update({
      is_open: input.isOpen,
      closed_message: closedMessage,
      rewards_enabled: input.rewardsEnabled,
      referral_enabled: input.referralEnabled,
      streak_enabled: input.streakEnabled,
    })
    .eq("id", true)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Store settings row is missing." };

  // Revalidate the CMS page and every storefront surface a toggle can change.
  revalidatePath("/admin/settings");
  revalidatePath("/home");
  revalidatePath("/menu");
  revalidatePath("/cart");
  revalidatePath("/checkout");
  revalidatePath("/rewards");
  return { ok: true };
}
