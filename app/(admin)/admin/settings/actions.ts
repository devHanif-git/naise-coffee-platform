"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";
import type { StoreSettings } from "@/lib/settings/types";
import type { PaymentSettings } from "@/lib/settings/payments";

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

export async function updatePaymentSettings(input: PaymentSettings): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };

  const db = await createClient();
  const { data, error } = await db
    .from("payment_settings")
    .update({
      cash_enabled: input.categories.cash,
      qr_enabled: input.categories.qr,
      card_enabled: input.categories.card,
      ewallet_enabled: input.categories.ewallet,
      bank_enabled: input.categories.bank,
      cash_method_enabled: input.methods.cash,
      duitnow_qr_enabled: input.methods["duitnow-qr"],
      apple_pay_enabled: input.methods["apple-pay"],
      google_pay_enabled: input.methods["google-pay"],
      tng_ewallet_enabled: input.methods["tng-ewallet"],
      boost_enabled: input.methods.boost,
      grabpay_enabled: input.methods.grabpay,
      bank_transfer_enabled: input.methods["bank-transfer"],
      bank_name: input.bank.name.trim(),
      bank_account_number: input.bank.accountNumber.trim(),
      bank_account_holder: input.bank.accountHolder.trim(),
    })
    .eq("id", true)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Payment settings row is missing." };

  // Revalidate the CMS settings page and checkout, where the enabled-method
  // list and bank details are read.
  revalidatePath("/admin/settings");
  revalidatePath("/checkout");
  return { ok: true };
}
