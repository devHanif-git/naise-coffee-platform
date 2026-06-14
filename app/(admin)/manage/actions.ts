"use server";

import { revalidatePath } from "next/cache";
import { canManageOrders } from "@/lib/auth/session";
import { cancelOrder, setItemStatus } from "@/lib/orders/store";
import type { ItemStatus, OrderStatus } from "@/types/order";

export type OrderActionResult =
  | { ok: true; orderStatus: OrderStatus }
  | { ok: false; error: string };

// Persist a single drink's fulfilment status. The store re-derives the order's
// overall status from all its drinks, so when the last one is marked done the
// order flips to "completed" — the future hook for the WhatsApp pickup notice
// and marking the manage link complete.
export async function updateDrinkStatus(
  token: string,
  itemIndex: number,
  status: ItemStatus,
): Promise<OrderActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }

  const updated = setItemStatus(token, itemIndex, status);
  if (!updated) return { ok: false, error: "Order not found." };

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: updated.status };
}

// Cancel the whole order. Surfaced as a manual override on the manage view.
export async function cancelOrderAction(
  token: string,
): Promise<OrderActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }

  const updated = cancelOrder(token);
  if (!updated) return { ok: false, error: "Order not found." };

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: updated.status };
}
