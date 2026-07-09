import { createClient } from "@/lib/supabase/server";
import type { Voucher } from "@/types/reward";

// The caller's own vouchers (RLS-scoped), active first then by expiry. Marks
// past-date active rows expired first so the list never shows a stale "active".
export async function listMyVouchers(): Promise<Voucher[]> {
  const db = await createClient();
  await db.rpc("mark_expired_vouchers");
  const { data } = await db
    .from("vouchers")
    .select("id, type, status, discount_amount, min_spend, free_drink_max_value, expires_at")
    .order("status", { ascending: true })
    .order("expires_at", { ascending: true });
  return (data ?? []).map((v) => ({
    id: v.id,
    type: v.type,
    status: v.status,
    discountAmount: v.discount_amount,
    minSpend: v.min_spend,
    freeDrinkMaxValue: v.free_drink_max_value,
    expiresAt: v.expires_at,
  }));
}

export type RedeemVoucherResult =
  | { ok: true; type: "rm_off" | "free_drink"; discountAmount: number; minSpend: number; freeDrinkMaxValue: number }
  | { ok: false; error: string };

// Mark a voucher redeemed against an order. Called by placeOrder AFTER the order
// row exists and the discount has been applied to the order total.
export async function redeemVoucher(voucherId: string, orderToken: string): Promise<RedeemVoucherResult> {
  const db = await createClient();
  const { data, error } = await db.rpc("redeem_voucher", { p_voucher_id: voucherId, p_order_token: orderToken });
  if (error) return { ok: false, error: error.message };
  const row = data as unknown as
    | { ok: true; type: "rm_off" | "free_drink"; discount_amount: number; min_spend: number; free_drink_max_value: number }
    | { ok: false; error: string };
  if (!row?.ok) return { ok: false, error: (row as { error?: string })?.error ?? "unknown" };
  return {
    ok: true,
    type: row.type,
    discountAmount: row.discount_amount,
    minSpend: row.min_spend,
    freeDrinkMaxValue: row.free_drink_max_value,
  };
}
