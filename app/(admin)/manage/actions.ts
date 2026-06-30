"use server";

import { revalidatePath } from "next/cache";
import { canManageOrders } from "@/lib/auth/session";
import { reverseOrderRewards } from "@/lib/rewards/store";
import { UNPAID_PAYMENT_METHOD } from "@/data/payment-methods";
import {
  cancelOrder,
  completeOrder,
  countOrdersByGroup,
  getOrderByToken,
  listOrdersPage,
  setItemStatus,
  setOrderPayment,
} from "@/lib/orders/store";
import { buildOrderReadyMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  isOrderFilter,
  type OrderFilter,
  type OrderGroupCounts,
} from "@/lib/orders/status";
import { isDateRangeKey, type DateRangeKey } from "@/lib/orders/range";
import type { ItemStatus, Order, OrderStatus } from "@/types/order";

export type OrderActionResult =
  | { ok: true; orderStatus: OrderStatus }
  | { ok: false; error: string };

export type LoadOrdersResult =
  | { ok: true; orders: Order[]; hasMore: boolean; counts: OrderGroupCounts }
  | { ok: false; error: string };

// Fetch a page of orders for the staff board, filtered by status tab and date
// range, plus the per-tab counts for that range. Drives the initial reload,
// "Load more", and the realtime refresh. Staff-only.
export async function loadOrdersAction(opts: {
  filter: OrderFilter;
  range: DateRangeKey;
  offset: number;
}): Promise<LoadOrdersResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const filter = isOrderFilter(opts.filter) ? opts.filter : "pending";
  const range = isDateRangeKey(opts.range) ? opts.range : "all";
  const offset = Number.isFinite(opts.offset) ? Math.max(opts.offset, 0) : 0;

  const [{ orders, hasMore }, counts] = await Promise.all([
    listOrdersPage({ filter, range, offset }),
    countOrdersByGroup(range),
  ]);
  return { ok: true, orders, hasMore, counts };
}

// Persist a single drink's fulfilment status. When all drinks are done the store
// derives status "ready"; the client then opens the completion modal, which
// calls markReadyAndNotify on confirm.
export async function updateDrinkStatus(
  token: string,
  itemIndex: number,
  status: ItemStatus,
): Promise<OrderActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const updated = await setItemStatus(token, itemIndex, status);
  if (!updated) return { ok: false, error: "Order not found." };

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: updated.status };
}

// Confirm completion: mark the order completed and send the buyer the ready
// notice over Telegram. Called from the completion modal's confirm button.
export async function markReadyAndNotify(
  token: string,
): Promise<OrderActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const order = await getOrderByToken(token);
  if (!order) return { ok: false, error: "Order not found." };

  if (order.paymentMethod === UNPAID_PAYMENT_METHOD) {
    return { ok: false, error: "Set the payment method before completing this order." };
  }

  // Persist completion FIRST — the DB is the source of truth, and the customer's
  // live tracking flips to completed via the broadcast trigger regardless of
  // Telegram. Then send the pickup notice best-effort; a Telegram failure must
  // not leave the order half-done or tell the buyer to collect an order the DB
  // still shows as preparing.
  const completed = await completeOrder(token);
  if (!completed) return { ok: false, error: "Could not complete the order." };

  // Counter-placed orders (in-store kiosk and admin custom orders) are handed to
  // the customer at the counter, so there's nobody to notify — never fire a ready
  // notice for them. For online orders: if we have the customer's number, staff
  // send the ready notice over WhatsApp by hand (the wa.me button on the completed
  // order); only fall back to the Telegram notice when there is no number to
  // message. The order is already completed above regardless.
  const isCounterOrder =
    completed.source === "store" || completed.source === "custom";
  if (!isCounterOrder && !completed.contactPhone) {
    try {
      await sendTelegramMessage(buildOrderReadyMessage(completed));
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      console.error(
        `Order ${completed.orderNumber} completed but ready-notice failed: ${reason}`,
      );
    }
  }

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: completed.status };
}

// Cancel the whole order (manual override).
export async function cancelOrderAction(
  token: string,
): Promise<OrderActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const updated = await cancelOrder(token);
  if (!updated) return { ok: false, error: "Order not found." };

  await reverseOrderRewards(token);

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: updated.status };
}

// Resolve the payment method on a "pay later" store order. Only Cash / DuitNow QR
// are accepted — never 'unpaid' (resolution only moves away from unpaid).
export async function setOrderPaymentAction(
  token: string,
  method: "cash" | "duitnow-qr",
): Promise<OrderActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  if (method !== "cash" && method !== "duitnow-qr") {
    return { ok: false, error: "Invalid payment method." };
  }
  const updated = await setOrderPayment(token, method);
  if (!updated) return { ok: false, error: "Order not found." };

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: updated.status };
}
