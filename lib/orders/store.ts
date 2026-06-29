import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductCosts } from "@/lib/menu/cost";
import { rowToOrder, type OrderItemRow } from "@/lib/orders/mappers";
import {
  statusesForFilter,
  ORDERS_PAGE_SIZE,
  type OrderFilter,
  type OrderGroupCounts,
} from "@/lib/orders/status";
import { rangeBounds, type DateRangeKey } from "@/lib/orders/range";
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
      contact_phone: draft.contactPhone ?? null,
      proof_of_payment_url: draft.proofOfPaymentUrl ?? null,
      source: draft.source ?? "online",
    })
    .select()
    .single();
  if (orderErr || !orderRow) {
    throw new Error(orderErr?.message ?? "Failed to create order.");
  }

  // Snapshot each line's goods cost (sen) at sale time, mirroring unit_price:
  // editing a cost item later only affects future orders. Cost tables are
  // admin-only under RLS, so always read them with the service-role client even
  // when the order itself is inserted under the member's cookie client. Custom
  // drinks and unlinked lines have no product cost -> null.
  const productIds = [
    ...new Set(
      draft.items
        .map((i) => i.productId)
        .filter((id): id is string => !!id),
    ),
  ];
  const costByProduct = await getProductCosts(createAdminClient(), productIds);

  const itemsPayload = draft.items.map((item, position) => ({
    order_id: orderRow.id,
    position,
    name: item.name,
    quantity: item.quantity,
    size_name: item.sizeName ?? null,
    addon_names: item.addonNames,
    unit_price: item.unitPrice,
    line_total: item.lineTotal,
    unit_cost: item.productId ? costByProduct.get(item.productId) ?? null : null,
    status: item.status,
    is_reward: item.isReward ?? false,
    reward_cost: item.rewardCost ?? 0,
    is_custom: item.isCustom ?? false,
    product_id: item.productId ?? null,
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

export type OrdersPage = { orders: Order[]; hasMore: boolean };

// One page of orders for the staff board, newest first, filtered by status tab
// and date range. Fetches limit+1 rows to tell whether more remain. Staff only —
// callers gate with canManageOrders() first; reads under the caller's RLS.
export async function listOrdersPage(opts: {
  filter: OrderFilter;
  range: DateRangeKey;
  offset: number;
  limit?: number;
}): Promise<OrdersPage> {
  const limit = Math.min(opts.limit ?? ORDERS_PAGE_SIZE, ORDERS_PAGE_SIZE);
  const offset = Math.max(opts.offset, 0);
  const db = await createClient();
  let query = db
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);

  const statuses = statusesForFilter(opts.filter);
  if (statuses) query = query.in("status", statuses);
  const { fromIso, toIso } = rangeBounds(opts.range);
  if (fromIso) query = query.gte("created_at", fromIso);
  if (toIso) query = query.lt("created_at", toIso);

  const { data: orderRows, error } = await query;
  if (error || !orderRows) return { orders: [], hasMore: false };

  const hasMore = orderRows.length > limit;
  const page = hasMore ? orderRows.slice(0, limit) : orderRows;
  return {
    orders: page.map((row) =>
      rowToOrder(row, (row.order_items as OrderItemRow[]) ?? []),
    ),
    hasMore,
  };
}

// Count of orders matching one filter group within a date range. Head-only
// count query — no rows fetched.
async function countOrders(
  filter: OrderFilter,
  range: DateRangeKey,
): Promise<number> {
  const db = await createClient();
  let query = db.from("orders").select("id", { count: "exact", head: true });
  const statuses = statusesForFilter(filter);
  if (statuses) query = query.in("status", statuses);
  const { fromIso, toIso } = rangeBounds(range);
  if (fromIso) query = query.gte("created_at", fromIso);
  if (toIso) query = query.lt("created_at", toIso);
  const { count } = await query;
  return count ?? 0;
}

// Per-tab order counts for the current date range. Drives the numbers on the
// filter tabs. Staff only.
export async function countOrdersByGroup(
  range: DateRangeKey,
): Promise<OrderGroupCounts> {
  const [all, pending, in_progress, completed, cancelled] = await Promise.all([
    countOrders("all", range),
    countOrders("pending", range),
    countOrders("in_progress", range),
    countOrders("completed", range),
    countOrders("cancelled", range),
  ]);
  return { all, pending, in_progress, completed, cancelled };
}

// One customer's orders, newest first, via the admin client (these run
// server-side only). Members match on user_id alone: their guest orders were
// re-owned to the account at sign-in (claim_device_orders), so user_id is the
// single source of truth — and matching owner_id too would leak other guests'
// orders on a shared device. Guests match on owner_id AND user_id IS NULL, so a
// claimed order never reappears as a guest order from a stale cookie.
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

  if (userId) {
    query = query.eq("user_id", userId);
  } else {
    query = query.eq("owner_id", ownerId!).is("user_id", null);
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
    .select("id, status")
    .eq("token", token)
    .maybeSingle();
  if (!orderRow) return null;

  // A cancelled order is a terminal manual override — never reopen it by
  // advancing a drink. (Reopening a *completed* order is intentional below, so
  // staff can correct a premature completion.)
  if (orderRow.status === "cancelled") return getOrderByToken(token);

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

// Cancel an order via the service-role client, for server-side rollback paths
// where the caller is a member (who cannot UPDATE orders under RLS — that policy
// is staff-only). Used by placeOrder when reward settlement fails: the order was
// just created but must not linger as `pending`. Throws on failure so the caller
// never silently leaves an orphaned order.
export async function cancelOrderAsSystem(token: string): Promise<void> {
  const db = createAdminClient();
  const { error } = await db
    .from("orders")
    .update({ status: "cancelled" })
    .eq("token", token);
  if (error) throw new Error(error.message);
}
