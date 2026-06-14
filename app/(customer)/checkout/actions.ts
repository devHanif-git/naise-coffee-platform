"use server";

import { createOrder } from "@/lib/orders/store";
import { buildOrderMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import type { OrderLine } from "@/types/order";

// Minimal shape the client sends per line — derived from the cart. We keep the
// server independent of the cart's internal CartItem type.
type PlaceOrderItem = {
  name: string;
  quantity: number;
  sizeName?: string;
  addonNames: string[];
  unitPrice: number;
};

export type PlaceOrderInput = {
  items: PlaceOrderItem[];
  paymentMethod: string;
  notes?: string;
  // Pre-discount and amount-due totals, in sen.
  subtotal: number;
  total: number;
};

export type PlaceOrderResult =
  | { ok: true; orderNumber: string }
  | { ok: false; error: string };

// Creates the order, then posts the team a management link over Telegram. The
// link is unguessable (uuid) and gated to staff roles by the manage page.
export async function placeOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  if (input.items.length === 0) {
    return { ok: false, error: "Your cart is empty." };
  }

  const lines: OrderLine[] = input.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    sizeName: item.sizeName,
    addonNames: item.addonNames,
    unitPrice: item.unitPrice,
    lineTotal: item.unitPrice * item.quantity,
  }));

  const order = createOrder({
    paymentMethod: input.paymentMethod,
    items: lines,
    subtotal: input.subtotal,
    total: input.total,
    notes: input.notes?.trim() || undefined,
  });

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const manageUrl = `${baseUrl}/manage/${order.token}`;
  const message = buildOrderMessage(order, manageUrl);

  try {
    await sendTelegramMessage(message);
  } catch (err) {
    // The order is created either way; surface a clear failure so the customer
    // can retry or fall back to WhatsApp rather than silently dropping it.
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't notify the store: ${reason}` };
  }

  return { ok: true, orderNumber: order.orderNumber };
}
