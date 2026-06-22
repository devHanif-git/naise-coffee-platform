"use server";

import { createOrder } from "@/lib/orders/store";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";
import { getPaymentSettings } from "@/lib/settings/payments";
import { buildOrderMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import type { Order, OrderLine } from "@/types/order";
import { CUSTOM_OWNER_ID } from "@/constants/custom-order";

type CustomOrderItem = { name: string; unitPrice: number; quantity: number };

export type PlaceCustomOrderInput = {
  items: CustomOrderItem[];
  paymentMethod: "cash" | "duitnow-qr";
  notes?: string;
};

export type PlaceCustomOrderResult =
  | { ok: true; orderNumber: string }
  | { ok: false; error: string };

export async function placeCustomOrder(
  input: PlaceCustomOrderInput,
): Promise<PlaceCustomOrderResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };

  // Validate lines: non-empty name, positive integer price (sen), qty >= 1.
  const items = input.items
    .map((i) => ({
      name: i.name.trim(),
      unitPrice: Math.round(i.unitPrice),
      quantity: Math.floor(i.quantity),
    }))
    .filter((i) => i.name !== "" && i.unitPrice > 0 && i.quantity >= 1);
  if (items.length === 0) return { ok: false, error: "Add at least one custom drink." };

  // The chosen method must be enabled server-side (same gate as store orders).
  const payments = await getPaymentSettings();
  const cashOk = payments.categories.cash && payments.methods.cash;
  const qrOk = payments.categories.qr && payments.methods["duitnow-qr"];
  if (input.paymentMethod === "cash" && !cashOk)
    return { ok: false, error: "Cash is not available." };
  if (input.paymentMethod === "duitnow-qr" && !qrOk)
    return { ok: false, error: "QR is not available." };

  const lines: OrderLine[] = items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    addonNames: [],
    unitPrice: item.unitPrice,
    lineTotal: item.unitPrice * item.quantity,
    status: "pending",
    isCustom: true,
  }));
  const total = lines.reduce((s, l) => s + l.lineTotal, 0);

  let order: Order;
  try {
    order = await createOrder(
      {
        ownerId: CUSTOM_OWNER_ID,
        paymentMethod: input.paymentMethod,
        items: lines,
        subtotal: total,
        total,
        notes: input.notes?.trim() || undefined,
        source: "custom",
      },
      { userId: null },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't save the order: ${reason}` };
  }

  // Auto-save presets (best-effort — the order is already saved). Admin-gated RPC.
  try {
    const db = await createClient();
    await db.rpc("record_custom_drinks", {
      p_drinks: items.map((i) => ({ name: i.name, price: i.unitPrice })),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.error(`Custom order ${order.orderNumber} saved but preset upsert failed: ${reason}`);
  }

  // Notify staff (best-effort), mirroring placeStoreOrder.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const manageUrl = `${baseUrl}/manage/${order.token}`;
  const canUseButton = /^https:\/\//i.test(manageUrl) && !/localhost|127\.0\.0\.1/.test(manageUrl);
  try {
    await sendTelegramMessage(
      buildOrderMessage(order, manageUrl, !canUseButton),
      canUseButton ? { buttons: [[{ text: "📋 Manage Order", url: manageUrl }]] } : {},
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.error(`Custom order ${order.orderNumber} placed but Telegram notice failed: ${reason}`);
  }

  return { ok: true, orderNumber: order.orderNumber };
}
