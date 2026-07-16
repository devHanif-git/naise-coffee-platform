"use server";

import { getOrderByToken, cancelOrderAsSystem } from "@/lib/orders/store";
import { getOwnerIdFromCookie } from "@/lib/auth/owner-id-server";
import { createClient } from "@/lib/supabase/server";

// Cancel an awaiting_payment order the caller owns (Cancel on the review screen).
// Ownership mirrors the customer order detail page: match user_id or owner_id.
export async function cancelPendingPayment(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const order = await getOrderByToken(token);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "awaiting_payment") {
    return { ok: false, error: "This order can no longer be cancelled." };
  }

  const ownerId = await getOwnerIdFromCookie();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const owned =
    (user?.id != null && order.userId === user.id) ||
    (ownerId != null && order.ownerId === ownerId);
  if (!owned) return { ok: false, error: "Not authorized." };

  await cancelOrderAsSystem(token);
  return { ok: true };
}
