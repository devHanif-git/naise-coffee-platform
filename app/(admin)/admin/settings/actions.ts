"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth/session";
import { STORE_SETTINGS_TAG } from "@/lib/settings/store";
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
  revalidateTag(STORE_SETTINGS_TAG, "max");
  return { ok: true };
}

export async function updatePaymentSettings(input: PaymentSettings): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };

  // Account numbers are digits only (spaces/dashes allowed for readability).
  // Validate server-side too — never rely on the client filter alone.
  const accountNumber = input.bank.accountNumber.trim();
  if (accountNumber && !/^[0-9\s-]+$/.test(accountNumber)) {
    return { ok: false, error: "Account number can only contain digits, spaces, or dashes." };
  }

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
      bank_account_number: accountNumber,
      bank_account_holder: input.bank.accountHolder.trim(),
      // Empty/blank normalizes to null so checkout falls back to the bundled QR.
      duitnow_qr_url: input.duitnowQrUrl?.trim() ? input.duitnowQrUrl.trim() : null,
      pay_later_enabled: input.payLaterEnabled,
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

// Upload the merchant DuitNow QR to the public `payments` bucket and return its
// URL. Uses the service-role client so the write succeeds regardless of cookie
// propagation; the action is admin-gated above. Mirrors uploadProductImage.
export async function uploadDuitnowQr(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, error: "No file." };
  if (file.size > 5_242_880) return { ok: false, error: "Image must be under 5 MB." };
  const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowed.has(file.type))
    return { ok: false, error: "Only JPEG, PNG, and WebP images are allowed." };

  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${crypto.randomUUID()}.${ext}`;
  const db = createAdminClient();
  const { error } = await db.storage
    .from("payments")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };
  const { data } = db.storage.from("payments").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
