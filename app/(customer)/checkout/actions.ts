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
  // Stable per-browser id (`naise_owner_id`). Used so a guest's orders carry
  // over to the account they later register — the new account adopts this
  // same id. Validated to a non-empty string before persisting.
  ownerId: string;
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
  if (!input.ownerId) {
    // The owner id should always be supplied by the client — guard so we
    // never persist an order with no attribution (RLS will require it later).
    return { ok: false, error: "Missing session id. Refresh and try again." };
  }

  const lines: OrderLine[] = input.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    sizeName: item.sizeName,
    addonNames: item.addonNames,
    unitPrice: item.unitPrice,
    lineTotal: item.unitPrice * item.quantity,
    status: "pending",
  }));

  const order = createOrder({
    ownerId: input.ownerId,
    paymentMethod: input.paymentMethod,
    items: lines,
    subtotal: input.subtotal,
    total: input.total,
    notes: input.notes?.trim() || undefined,
  });

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const manageUrl = `${baseUrl}/manage/${order.token}`;

  // Telegram inline buttons require a publicly reachable https URL — it rejects
  // localhost/private hosts. Use a tappable button when we can, and fall back
  // to a raw-text link in the body (e.g. local dev) otherwise.
  const canUseButton = /^https:\/\//i.test(manageUrl) && !isLocalUrl(manageUrl);
  const message = buildOrderMessage(order, manageUrl, !canUseButton);

  try {
    await sendTelegramMessage(
      message,
      canUseButton
        ? { buttons: [[{ text: "📋 Manage Order", url: manageUrl }]] }
        : {},
    );
  } catch (err) {
    // The order is created either way; surface a clear failure so the customer
    // can retry or fall back to WhatsApp rather than silently dropping it.
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't notify the store: ${reason}` };
  }

  return { ok: true, orderNumber: order.orderNumber };
}

// True for hosts Telegram won't accept in an inline button URL (localhost and
// private/loopback addresses). Keeps local dev working via the text fallback.
function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    );
  } catch {
    return true;
  }
}
