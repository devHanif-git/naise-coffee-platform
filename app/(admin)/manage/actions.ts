"use server";

import { revalidatePath } from "next/cache";
import { canManageOrders } from "@/lib/auth/session";
import {
  cancelOrder,
  completeOrder,
  getOrderByToken,
  setItemStatus,
} from "@/lib/orders/store";
import { buildOrderReadyMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import type { ItemStatus, OrderStatus } from "@/types/order";

export type OrderActionResult =
  | { ok: true; orderStatus: OrderStatus }
  | { ok: false; error: string };

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

  try {
    await sendTelegramMessage(buildOrderReadyMessage(order));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't notify the buyer: ${reason}` };
  }

  const completed = await completeOrder(token);
  if (!completed) return { ok: false, error: "Could not complete the order." };

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

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: updated.status };
}
