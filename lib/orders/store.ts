import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProductCosts } from "@/lib/menu/cost";
import {
  rowToOrder,
  rowToOrderAdjustment,
  type OrderAdjustmentRow,
  type OrderItemRow,
} from "@/lib/orders/mappers";
import {
  statusesForFilter,
  ORDERS_PAGE_SIZE,
  type OrderFilter,
  type OrderGroupCounts,
} from "@/lib/orders/status";
import { rangeBounds, type DateRangeKey } from "@/lib/orders/range";
import type {
  ItemStatus,
  Order,
  OrderDraft,
  OrderStatus,
} from "@/types/order";

// Supabase-backed order store. Members read/write under RLS via the cookie
// client; guests (no auth identity) go through the service-role admin client in
// these server-only functions. Money is in sen.

// Overall status derived from the drinks. Voided lines are ignored — they've
// been removed from the order, so they never hold it in "pending"/"preparing"
// nor count toward "ready". All active drinks done -> "ready" (awaiting the
// staff completion confirm); "completed" and "cancelled" are set explicitly by
// their own actions, never derived here.
export function deriveOrderStatus(
  items: { status: ItemStatus; voidedAt?: string | null }[],
): OrderStatus {
  const active = items.filter((i) => !i.voidedAt);
  if (active.length > 0 && active.every((i) => i.status === "done")) {
    return "ready";
  }
  if (active.some((i) => i.status !== "pending")) {
    return "preparing";
  }
  return "pending";
}

// Human-readable label for a drink line, e.g. "Latte (Large, Oat Milk)" or just
// "Latte". Used in the amendment log so staff can read what was voided/swapped.
function drinkLabel(item: {
  name: string;
  sizeName?: string | null;
  addonNames?: string[] | null;
}): string {
  const extras = [item.sizeName, ...(item.addonNames ?? [])].filter(Boolean);
  return extras.length > 0 ? `${item.name} (${extras.join(", ")})` : item.name;
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
    unit_original_price: item.unitOriginalPrice ?? null,
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
// Attaches the amendment log (voids/swaps) so the manage screen can render the
// price-difference panel and the recalculated total together.
export async function getOrderByToken(token: string): Promise<Order | null> {
  const db = createAdminClient();
  const { data: orderRow } = await db
    .from("orders")
    .select()
    .eq("token", token)
    .maybeSingle();
  if (!orderRow) return null;

  const [{ data: itemRows }, { data: adjustmentRows }, { data: redeemedVoucher }] =
    await Promise.all([
      db.from("order_items").select().eq("order_id", orderRow.id),
      db
        .from("order_adjustments")
        .select()
        .eq("order_id", orderRow.id)
        .order("created_at", { ascending: true }),
      // The voucher redeemed against this order (if any), for naming the
      // voucher row in the manage totals breakdown.
      db
        .from("vouchers")
        .select("type, discount_amount")
        .eq("redeemed_order_id", orderRow.id)
        .maybeSingle(),
    ]);
  const order = rowToOrder(orderRow, (itemRows as OrderItemRow[]) ?? []);
  order.adjustments = ((adjustmentRows as OrderAdjustmentRow[]) ?? []).map(
    rowToOrderAdjustment,
  );
  if (redeemedVoucher) {
    order.voucherLabel =
      redeemedVoucher.type === "free_drink"
        ? "Free Drink"
        : `RM${(redeemedVoucher.discount_amount / 100).toFixed(0)} Off`;
  }
  // Resolve the attached member's display name so the manage view can show who
  // the stamp goes to. Best-effort — a missing profile just leaves it unset.
  if (orderRow.user_id) {
    const { data: profile } = await db
      .from("profiles")
      .select("display_name")
      .eq("id", orderRow.user_id)
      .maybeSingle();
    order.memberName = profile?.display_name ?? undefined;
  }
  return order;
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
  // Canonical payment_method id (or the `unpaid` sentinel) to narrow to. Omitted
  // / undefined means every method — no payment constraint.
  payment?: string;
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
  if (opts.payment) query = query.eq("payment_method", opts.payment);

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
  payment?: string,
): Promise<number> {
  const db = await createClient();
  let query = db.from("orders").select("id", { count: "exact", head: true });
  const statuses = statusesForFilter(filter);
  if (statuses) query = query.in("status", statuses);
  const { fromIso, toIso } = rangeBounds(range);
  if (fromIso) query = query.gte("created_at", fromIso);
  if (toIso) query = query.lt("created_at", toIso);
  if (payment) query = query.eq("payment_method", payment);
  const { count } = await query;
  return count ?? 0;
}

// Per-tab order counts for the current date range, optionally narrowed to one
// payment method so the tab numbers match the filtered list. Drives the numbers
// on the filter tabs. Staff only.
export async function countOrdersByGroup(
  range: DateRangeKey,
  payment?: string,
): Promise<OrderGroupCounts> {
  const [all, pending, in_progress, completed, cancelled] = await Promise.all([
    countOrders("all", range, payment),
    countOrders("pending", range, payment),
    countOrders("in_progress", range, payment),
    countOrders("completed", range, payment),
    countOrders("cancelled", range, payment),
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

  const orders = orderRows.map((row) =>
    rowToOrder(row, (row.order_items as OrderItemRow[]) ?? []),
  );

  // Name the voucher on each order that redeemed one, so the history cards can
  // label the discount ("Voucher · Free Drink") like the detail view. One
  // batched lookup keyed by redeemed_order_id; orders without a voucher are
  // simply absent from the map. `orders` mirrors `orderRows` positionally, so we
  // match each order to its DB row id by index.
  const orderIds = orderRows.map((row) => row.id);
  if (orderIds.length > 0) {
    const { data: voucherRows } = await db
      .from("vouchers")
      .select("redeemed_order_id, type, discount_amount")
      .in("redeemed_order_id", orderIds);
    const labelByOrderId = new Map(
      (voucherRows ?? []).map((v) => [
        v.redeemed_order_id as string,
        v.type === "free_drink"
          ? "Free Drink"
          : `RM${(v.discount_amount / 100).toFixed(0)} Off`,
      ]),
    );
    orders.forEach((order, i) => {
      const label = labelByOrderId.get(orderRows[i].id);
      if (label) order.voucherLabel = label;
    });
  }

  return orders;
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

  const nextItems = itemRows.map((it, i) => ({
    status: (i === itemIndex ? status : it.status) as ItemStatus,
    voidedAt: it.voided_at,
  }));
  const derived = deriveOrderStatus(nextItems);

  // Don't clobber a completed order. Re-deriving yields "ready" whenever every
  // drink is done, so a stray status write on an already-completed order (a
  // concurrent auto-complete, a realtime refresh, a double-tap) would knock it
  // back to "ready" and wipe completed_at — the order then sits in the In
  // Progress list despite all drinks being done. Only downgrade when a drink is
  // genuinely reopened (derived is preparing/pending); keep completed otherwise.
  if (orderRow.status === "completed" && derived === "ready") {
    return getOrderByToken(token);
  }

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

// The outcome of a per-drink amendment (void/swap). `last_line` means the target
// was the only active drink left — voiding it would empty the order, so the
// caller is told to cancel the whole order instead. `invalid` covers a locked
// order (completed/cancelled), a done/already-voided/reward line, or an unknown
// index. `not_found` means the token doesn't resolve.
export type AmendResult =
  | { ok: true; order: Order }
  | { ok: false; reason: "not_found" | "invalid" | "last_line" };

// Void a single drink: strike it from the bill but keep the row for history.
// Logs an order_adjustments row (delta = -line_total) and recalculates the
// order's subtotal/total and status from the remaining active drinks. Staff-only;
// callers gate first. Uses the cookie client so the staff RLS policies apply.
export async function voidOrderItem(
  token: string,
  position: number,
): Promise<AmendResult> {
  const db = await createClient();

  const { data: orderRow } = await db
    .from("orders")
    .select("id, status, subtotal, total")
    .eq("token", token)
    .maybeSingle();
  if (!orderRow) return { ok: false, reason: "not_found" };
  // Terminal orders can't be amended.
  if (orderRow.status === "completed" || orderRow.status === "cancelled") {
    return { ok: false, reason: "invalid" };
  }

  const { data: itemRows } = await db
    .from("order_items")
    .select()
    .eq("order_id", orderRow.id)
    .order("position", { ascending: true });
  if (!itemRows) return { ok: false, reason: "not_found" };

  const target = itemRows.find((it) => it.position === position);
  if (!target) return { ok: false, reason: "invalid" };
  // A ready drink must be re-opened before it can be amended; reward lines carry
  // committed Beans we don't unwind here; a voided line can't be voided twice.
  if (target.status === "done" || target.is_reward || target.voided_at) {
    return { ok: false, reason: "invalid" };
  }

  // Never empty the order by voiding — cancel the whole order instead.
  const activeCount = itemRows.filter((it) => !it.voided_at).length;
  if (activeCount <= 1) return { ok: false, reason: "last_line" };

  const voidedAt = new Date().toISOString();
  const { error: voidErr } = await db
    .from("order_items")
    .update({ voided_at: voidedAt })
    .eq("id", target.id);
  if (voidErr) return { ok: false, reason: "invalid" };

  await db.from("order_adjustments").insert({
    order_id: orderRow.id,
    item_position: position,
    kind: "void",
    from_label: drinkLabel(target),
    to_label: null,
    delta: -target.line_total,
  });

  // Recalc money (clamp at zero) and re-derive status from remaining active lines.
  const nextItems = itemRows.map((it) =>
    it.id === target.id
      ? { status: it.status as ItemStatus, voidedAt: voidedAt }
      : { status: it.status as ItemStatus, voidedAt: it.voided_at },
  );
  const { error: ordErr } = await db
    .from("orders")
    .update({
      subtotal: Math.max(0, orderRow.subtotal - target.line_total),
      total: Math.max(0, orderRow.total - target.line_total),
      status: deriveOrderStatus(nextItems),
      completed_at: null,
    })
    .eq("id", orderRow.id);
  if (ordErr) return { ok: false, reason: "invalid" };

  const order = await getOrderByToken(token);
  return order ? { ok: true, order } : { ok: false, reason: "not_found" };
}

// The replacement drink for a swap. Priced server-side by the caller (never trust
// a client price); quantity carries over from the line being replaced.
export type SwapInput = {
  productId: string;
  name: string;
  sizeName?: string;
  addonNames: string[];
  // Per-unit price in sen, already resolved (size + add-ons, promo applied).
  unitPrice: number;
};

// Swap a single drink for another product. Rewrites the line in place (new name,
// size, add-ons, price, cost snapshot) and resets it to "pending" — the new drink
// still needs making. Logs an order_adjustments row with the price difference and
// recalculates the order total/status. Staff-only; callers gate first.
export async function swapOrderItem(
  token: string,
  position: number,
  next: SwapInput,
): Promise<AmendResult> {
  const db = await createClient();

  const { data: orderRow } = await db
    .from("orders")
    .select("id, status, subtotal, total")
    .eq("token", token)
    .maybeSingle();
  if (!orderRow) return { ok: false, reason: "not_found" };
  if (orderRow.status === "completed" || orderRow.status === "cancelled") {
    return { ok: false, reason: "invalid" };
  }

  const { data: itemRows } = await db
    .from("order_items")
    .select()
    .eq("order_id", orderRow.id)
    .order("position", { ascending: true });
  if (!itemRows) return { ok: false, reason: "not_found" };

  const target = itemRows.find((it) => it.position === position);
  if (!target) return { ok: false, reason: "invalid" };
  if (target.status === "done" || target.is_reward || target.voided_at) {
    return { ok: false, reason: "invalid" };
  }

  const newLineTotal = next.unitPrice * target.quantity;
  // `total` tracks the charged amount, so its delta is against the charged
  // line_total. `subtotal` tracks the PRE-promo sum (unit_original_price * qty),
  // so if the swapped-out line was promo'd, its subtotal contribution was the
  // original price, not line_total — using `delta` there would leave subtotal
  // inflated and overstate promo savings in the breakdown. The swapped-in line
  // has no promo (original == unitPrice), so its subtotal contribution is
  // newLineTotal.
  const delta = newLineTotal - target.line_total;
  const oldSubtotalContribution =
    (target.unit_original_price ?? target.unit_price) * target.quantity;
  const subtotalDelta = newLineTotal - oldSubtotalContribution;

  // Re-snapshot goods cost for the new product (admin-only tables → admin client).
  const costByProduct = await getProductCosts(createAdminClient(), [
    next.productId,
  ]);
  const fromLabel = drinkLabel(target);

  const { error: swapErr } = await db
    .from("order_items")
    .update({
      name: next.name,
      size_name: next.sizeName ?? null,
      addon_names: next.addonNames,
      unit_price: next.unitPrice,
      // Staff swaps have no promo concept — original equals the resolved price,
      // so the swapped line never shows a promo flag on the manage view.
      unit_original_price: next.unitPrice,
      line_total: newLineTotal,
      unit_cost: costByProduct.get(next.productId) ?? null,
      product_id: next.productId,
      is_custom: false,
      status: "pending",
    })
    .eq("id", target.id);
  if (swapErr) return { ok: false, reason: "invalid" };

  await db.from("order_adjustments").insert({
    order_id: orderRow.id,
    item_position: position,
    kind: "swap",
    from_label: fromLabel,
    to_label: drinkLabel({
      name: next.name,
      sizeName: next.sizeName,
      addonNames: next.addonNames,
    }),
    delta,
  });

  const nextItems = itemRows.map((it) =>
    it.id === target.id
      ? { status: "pending" as ItemStatus, voidedAt: it.voided_at }
      : { status: it.status as ItemStatus, voidedAt: it.voided_at },
  );
  const { error: ordErr } = await db
    .from("orders")
    .update({
      subtotal: Math.max(0, orderRow.subtotal + subtotalDelta),
      total: Math.max(0, orderRow.total + delta),
      status: deriveOrderStatus(nextItems),
      completed_at: null,
    })
    .eq("id", orderRow.id);
  if (ordErr) return { ok: false, reason: "invalid" };

  const order = await getOrderByToken(token);
  return order ? { ok: true, order } : { ok: false, reason: "not_found" };
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

// Set the real payment method on an order. Used to resolve a "pay later" store
// order (payment_method = 'unpaid') once the customer pays, and to correct a
// mis-keyed method (manager-gated, in the action layer). Staff-only; callers
// gate first. Uses the cookie client so the staff RLS update policy applies.
// `method` is a payment-method id; never write 'unpaid' here — resolution and
// correction only ever move TO a real method.
export async function setOrderPayment(
  token: string,
  method: string,
): Promise<Order | null> {
  const db = await createClient();
  const { error } = await db
    .from("orders")
    .update({ payment_method: method })
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
