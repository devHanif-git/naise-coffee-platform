import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rowToOrder, type OrderItemRow } from "@/lib/orders/mappers";
import type { ItemStatus, Order, OrderDraft, OrderStatus } from "@/types/order";

// Supabase-backed order store. Members read/write under RLS via the cookie
// client; guests (no auth identity) go through the service-role admin client in
// these server-only functions. Money is in sen.

// Overall status derived from the drinks. All done -> "ready" (awaiting the
// staff completion confirm); "completed" and "cancelled" are set explicitly by
// their own actions, never derived here.
export function deriveOrderStatus(items: { status: ItemStatus }[]): OrderStatus {
  if (items.length > 0 && items.every((i) => i.status === "done")) {
    return "ready";
  }
  if (items.some((i) => i.status !== "pending")) {
    return "preparing";
  }
  return "pending";
}

// Create an order + its lines. Members: userId is set, insert under RLS via the
// cookie client. Guests: userId is null, insert via the admin client.
export async function createOrder(
  draft: OrderDraft,
  opts: { userId: string | null },
): Promise<Order> {
  const db = opts.userId ? await createClient() : createAdminClient();

  const { data: orderRow, error: orderErr } = await db
    .from("orders")
    .insert({
      user_id: opts.userId,
      owner_id: draft.ownerId,
      payment_method: draft.paymentMethod,
      subtotal: draft.subtotal,
      total: draft.total,
      notes: draft.notes ?? null,
      proof_of_payment_url: draft.proofOfPaymentUrl ?? null,
    })
    .select()
    .single();
  if (orderErr || !orderRow) {
    throw new Error(orderErr?.message ?? "Failed to create order.");
  }

  const itemsPayload = draft.items.map((item, position) => ({
    order_id: orderRow.id,
    position,
    name: item.name,
    quantity: item.quantity,
    size_name: item.sizeName ?? null,
    addon_names: item.addonNames,
    unit_price: item.unitPrice,
    line_total: item.lineTotal,
    status: item.status,
  }));

  const { data: itemRows, error: itemsErr } = await db
    .from("order_items")
    .insert(itemsPayload)
    .select();
  if (itemsErr || !itemRows) {
    throw new Error(itemsErr?.message ?? "Failed to create order items.");
  }

  return rowToOrder(orderRow, itemRows);
}

// Single order by token. Uses the admin client so it works for staff (manage
// link) and guests (their own order detail) alike; the token is the secret.
export async function getOrderByToken(token: string): Promise<Order | null> {
  const db = createAdminClient();
  const { data: orderRow } = await db
    .from("orders")
    .select()
    .eq("token", token)
    .maybeSingle();
  if (!orderRow) return null;

  const { data: itemRows } = await db
    .from("order_items")
    .select()
    .eq("order_id", orderRow.id);
  return rowToOrder(orderRow, (itemRows as OrderItemRow[]) ?? []);
}

// All orders, newest first. Staff board only — callers gate with
// canManageOrders() first. Reads under the caller's RLS (staff role).
export async function listOrders(): Promise<Order[]> {
  const db = await createClient();
  const { data: orderRows, error } = await db
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: false });
  if (error || !orderRows) return [];
  return orderRows.map((row) =>
    rowToOrder(row, (row.order_items as OrderItemRow[]) ?? []),
  );
}

// One customer's orders, newest first. Members match on user_id (RLS-scoped via
// the cookie client); guests match on owner_id via the admin client. A member is
// also shown any guest orders that share this browser's owner_id (carry-over).
export async function listOrdersFor(
  ownerId: string | null | undefined,
  userId: string | null,
): Promise<Order[]> {
  if (!userId && !ownerId) return [];

  const db = createAdminClient();
  let query = db
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: false });

  if (userId && ownerId) {
    query = query.or(`user_id.eq.${userId},owner_id.eq.${ownerId}`);
  } else if (userId) {
    query = query.eq("user_id", userId);
  } else {
    query = query.eq("owner_id", ownerId!);
  }

  const { data: orderRows, error } = await query;
  if (error || !orderRows) return [];
  return orderRows.map((row) =>
    rowToOrder(row, (row.order_items as OrderItemRow[]) ?? []),
  );
}

// Set one drink's status, re-derive the order status, and (when it flips to
// "ready") leave completion to the explicit confirm action. Staff-only; callers
// gate first. Uses the cookie client so the staff RLS update policy applies.
export async function setItemStatus(
  token: string,
  itemIndex: number,
  status: ItemStatus,
): Promise<Order | null> {
  const db = await createClient();

  const { data: orderRow } = await db
    .from("orders")
    .select("id")
    .eq("token", token)
    .maybeSingle();
  if (!orderRow) return null;

  const { data: itemRows } = await db
    .from("order_items")
    .select()
    .eq("order_id", orderRow.id)
    .order("position", { ascending: true });
  if (!itemRows || itemIndex < 0 || itemIndex >= itemRows.length) return null;

  const target = itemRows[itemIndex];
  const { error: updErr } = await db
    .from("order_items")
    .update({ status })
    .eq("id", target.id);
  if (updErr) return null;

  const nextItems = itemRows.map((it, i) =>
    i === itemIndex ? { ...it, status } : it,
  );
  const derived = deriveOrderStatus(nextItems);

  // Re-deriving never sets completed/cancelled. If the order was completed and a
  // drink is reopened, fall back to the derived in-progress status and clear the
  // completion stamp.
  const { error: ordErr } = await db
    .from("orders")
    .update({ status: derived, completed_at: null })
    .eq("id", orderRow.id);
  if (ordErr) return null;

  return getOrderByToken(token);
}

// Explicitly complete an order: set status=completed, stamp completed_at.
// Returns the updated order (or null if unknown). Staff-only.
export async function completeOrder(token: string): Promise<Order | null> {
  const db = await createClient();
  const { error } = await db
    .from("orders")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("token", token);
  if (error) return null;
  return getOrderByToken(token);
}

// Cancel an order outright (manual staff override).
export async function cancelOrder(token: string): Promise<Order | null> {
  const db = await createClient();
  const { error } = await db
    .from("orders")
    .update({ status: "cancelled" })
    .eq("token", token);
  if (error) return null;
  return getOrderByToken(token);
}
