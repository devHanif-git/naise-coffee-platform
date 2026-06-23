"use server";

import { createOrder } from "@/lib/orders/store";
import { createClient } from "@/lib/supabase/server";
import { inStoreMode } from "@/lib/auth/store-mode";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";
import { getStoreSettingsForCheckout } from "@/lib/settings/store";
import { getPaymentSettings } from "@/lib/settings/payments";
import { buildOrderMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import type { OrderLine } from "@/types/order";
import { STORE_OWNER_ID } from "@/constants/store";

type StoreOrderItem = {
  productId: string;
  name: string;
  quantity: number;
  sizeName?: string;
  addonNames: string[];
  unitPrice: number;
};

export type PlaceStoreOrderInput = {
  items: StoreOrderItem[];
  paymentMethod: "cash" | "duitnow-qr";
  notes?: string;
  subtotal: number;
  total: number;
};

export type PlaceStoreOrderResult =
  | { ok: true; orderNumber: string }
  | { ok: false; error: string };

export async function placeStoreOrder(
  input: PlaceStoreOrderInput,
): Promise<PlaceStoreOrderResult> {
  if (input.items.length === 0) return { ok: false, error: "The order is empty." };

  // Defense in depth (the kiosk layout already gates these).
  if (!(await inStoreMode())) return { ok: false, error: "Not authorized." };
  if (!(await getStoreAccountEnabled())) return { ok: false, error: "Store ordering is off." };

  const settings = await getStoreSettingsForCheckout();
  if (!settings.isOpen) return { ok: false, error: settings.closedMessage };

  // The chosen method must be enabled server-side.
  const payments = await getPaymentSettings();
  const cashOk = payments.categories.cash && payments.methods.cash;
  const qrOk = payments.categories.qr && payments.methods["duitnow-qr"];
  if (input.paymentMethod === "cash" && !cashOk)
    return { ok: false, error: "Cash is not available." };
  if (input.paymentMethod === "duitnow-qr" && !qrOk)
    return { ok: false, error: "QR is not available." };

  // Re-validate availability against the live catalogue.
  const supabase = await createClient();
  const productIds = [...new Set(input.items.map((i) => i.productId).filter(Boolean))];
  if (productIds.length > 0) {
    const { data: prods, error } = await supabase
      .from("products")
      .select("id, is_available")
      .in("id", productIds);
    if (error) return { ok: false, error: "Couldn't verify availability. Try again." };
    const ok = new Map((prods ?? []).map((p) => [p.id, p.is_available]));
    const blocked = [
      ...new Set(input.items.filter((i) => ok.get(i.productId) !== true).map((i) => i.name)),
    ];
    if (blocked.length > 0)
      return { ok: false, error: `No longer available: ${blocked.join(", ")}.` };
  }

  const lines: OrderLine[] = input.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    sizeName: item.sizeName,
    addonNames: item.addonNames,
    unitPrice: item.unitPrice,
    lineTotal: item.unitPrice * item.quantity,
    status: "pending",
    productId: item.productId,
  }));

  let order;
  try {
    order = await createOrder(
      {
        ownerId: STORE_OWNER_ID,
        paymentMethod: input.paymentMethod,
        items: lines,
        subtotal: input.subtotal,
        total: input.total,
        notes: input.notes?.trim() || undefined,
        source: "store",
      },
      { userId: null },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't save the order: ${reason}` };
  }

  // No rewards for store orders (no user_id). Notify staff best-effort.
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
    console.error(`Store order ${order.orderNumber} placed but Telegram notice failed: ${reason}`);
  }

  return { ok: true, orderNumber: order.orderNumber };
}
