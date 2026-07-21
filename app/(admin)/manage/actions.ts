"use server";

import { revalidatePath } from "next/cache";
import { canManageOrders } from "@/lib/auth/session";
import { reverseOrderRewards } from "@/lib/rewards/store";
import { grantOrderStamp, reverseOrderStamp } from "@/lib/stamps/store";
import { attachOrderMember, searchMembers } from "@/lib/stamps/member";
import { verifyStorePasscode } from "@/lib/auth/store-passcode";
import { requireOpenShift } from "@/lib/shifts/require-open";
import { getPaymentSettings, getEnabledPaymentMethods } from "@/lib/settings/payments";
import { UNPAID_PAYMENT_METHOD, isKnownPaymentValue } from "@/data/payment-methods";
import {
  cancelOrder,
  completeOrder,
  countOrdersByGroup,
  getOrderByToken,
  listOrdersPage,
  refundChipPurchase,
  setItemStatus,
  setOrderPayment,
  swapOrderItem,
  voidOrderItem,
} from "@/lib/orders/store";
import { listProducts } from "@/lib/menu/store";
import { applyDiscount, getProductDiscount } from "@/lib/promotions/pricing";
import { buildOrderReadyMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  isOrderFilter,
  type OrderFilter,
  type OrderGroupCounts,
} from "@/lib/orders/status";
import { isDateRangeKey, type DateRangeKey } from "@/lib/orders/range";
import type { ItemStatus, Order, OrderStatus } from "@/types/order";
import type { MemberSearchResult } from "@/types/reward";

export type OrderActionResult =
  | { ok: true; orderStatus: OrderStatus }
  | { ok: false; error: string };

export type AttachActionResult =
  | { ok: true; displayName: string; phoneMasked: string | null }
  | { ok: false; error: string };

export type SearchMembersResult =
  | { ok: true; members: MemberSearchResult[] }
  | { ok: false; error: string };

// Amendment actions (void/swap) return the fully refreshed order so the client
// re-renders lines, adjustments, and totals from the source of truth.
export type AmendActionResult =
  | { ok: true; order: Order }
  | { ok: false; error: string };

// Cancel returns the new status and, when a CHIP refund was requested, its
// outcome. The cancel always succeeds server-side; refund.status "failed" means
// the order is cancelled but the money wasn't returned (staff can retry).
export type CancelOrderResult =
  | {
      ok: true;
      orderStatus: OrderStatus;
      refund?: { status: "refunded" | "failed"; error?: string };
    }
  | { ok: false; error: string };

export type RetryRefundResult = { ok: true } | { ok: false; error: string };

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
  // Payment filter: "all" (or anything unrecognized) means no payment
  // constraint; otherwise a canonical method id / the `unpaid` sentinel.
  payment?: string;
}): Promise<LoadOrdersResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const filter = isOrderFilter(opts.filter) ? opts.filter : "pending";
  const range = isDateRangeKey(opts.range) ? opts.range : "all";
  const offset = Number.isFinite(opts.offset) ? Math.max(opts.offset, 0) : 0;
  // Only pass a payment constraint for a known method value; "all"/unknown
  // degrades to undefined (no filter) so a stale chip never yields an empty board.
  const payment =
    opts.payment && isKnownPaymentValue(opts.payment) ? opts.payment : undefined;

  const [{ orders, hasMore }, counts] = await Promise.all([
    listOrdersPage({ filter, range, offset, payment }),
    countOrdersByGroup(range, payment),
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
  if (!(await requireOpenShift())) {
    return { ok: false, error: "Open a shift before making drinks." };
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
  if (!(await requireOpenShift())) {
    return { ok: false, error: "Open a shift before making drinks." };
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

  // Grant the loyalty stamp (member orders only; no-ops otherwise). Best-effort:
  // a failure must not block completion — the RPC is idempotent so a retry is safe.
  await grantOrderStamp(token);

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

// Cancel the whole order (manual override). When `refund` is true and the order
// was CHIP-paid, refund the full captured amount via CHIP AFTER the cancel
// commits — a refund failure is reported in the result, never blocks the cancel.
export async function cancelOrderAction(
  token: string,
  refund = false,
): Promise<CancelOrderResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const updated = await cancelOrder(token);
  if (!updated) return { ok: false, error: "Order not found." };

  await reverseOrderRewards(token);
  await reverseOrderStamp(token);

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");

  if (!refund) {
    return { ok: true, orderStatus: updated.status };
  }

  // Cancel already stands; fold the refund outcome in.
  const res = await refundChipPurchase(token);
  return {
    ok: true,
    orderStatus: updated.status,
    refund: res.ok
      ? { status: "refunded" }
      : { status: "failed", error: res.error },
  };
}

// Retry a failed CHIP refund on an already-cancelled order. Staff-gated. Drives
// the "Refund failed — retry" affordance on the manage detail view.
export async function retryChipRefundAction(
  token: string,
): Promise<RetryRefundResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const res = await refundChipPurchase(token);
  revalidatePath(`/manage/${token}`);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}

// Void drinks on an order line (staff amendment). `count` is how many units to
// void — omit (or pass the full quantity) to void the whole line, which strikes
// it from the bill and keeps it for history; a smaller count is a partial void
// that drops the line's quantity and recharges it. Recalculates the total either
// way and returns the refreshed order. The "last active drink" case is surfaced
// so the client can steer staff to cancel the whole order instead.
export async function voidDrinkAction(
  token: string,
  position: number,
  count?: number,
): Promise<AmendActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const res = await voidOrderItem(token, position, count);
  if (!res.ok) {
    const error =
      res.reason === "last_line"
        ? "That's the only drink left — cancel the whole order instead."
        : res.reason === "not_found"
          ? "Order not found."
          : "This drink can no longer be voided.";
    return { ok: false, error };
  }
  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, order: res.order };
}

// What the client submits for a swap: which line, the chosen product + size +
// add-ons, and how many units to swap (omit / full quantity swaps the whole
// line; fewer splits the line). Price is recomputed here from the catalog — the
// client value is never trusted.
export type SwapDrinkInput = {
  productId: string;
  sizeId?: string;
  addonIds: string[];
  // How many units of the line to swap. Undefined swaps the whole line.
  count?: number;
};

// Swap a single drink for another menu product (staff amendment). Prices the
// replacement server-side from the live catalog (chosen size + add-ons, active
// promotion applied to the drink only), then rewrites the line and logs the price
// difference. Returns the refreshed order.
export async function swapDrinkAction(
  token: string,
  position: number,
  input: SwapDrinkInput,
): Promise<AmendActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }

  const products = await listProducts();
  const product = products.find((p) => p.id === input.productId);
  if (!product) return { ok: false, error: "That drink isn't on the menu." };
  if (!product.isAvailable) {
    return { ok: false, error: `${product.name} is sold out right now.` };
  }

  // Resolve the base (drink) price: the chosen size, or the flat price. A sized
  // product requires a valid size selection.
  const sizes = product.sizes ?? [];
  const selectedSize = input.sizeId
    ? sizes.find((s) => s.id === input.sizeId)
    : undefined;
  if (sizes.length > 0 && !selectedSize) {
    return { ok: false, error: "Choose a size for this drink." };
  }
  const baseOriginal =
    sizes.length > 0 ? (selectedSize?.price ?? 0) : (product.price ?? 0);

  // Only real add-ons for this product count; discounts apply to the drink only.
  const selectedAddons = product.addons.filter((a) =>
    input.addonIds.includes(a.id),
  );
  const addonsTotal = selectedAddons.reduce((sum, a) => sum + a.price, 0);
  const drinkPrice = applyDiscount(baseOriginal, getProductDiscount(product)).final;
  const unitPrice = drinkPrice + addonsTotal;

  const res = await swapOrderItem(
    token,
    position,
    {
      productId: product.id,
      name: product.name,
      sizeName: selectedSize?.name,
      addonNames: selectedAddons.map((a) => a.name),
      unitPrice,
    },
    input.count,
  );
  if (!res.ok) {
    const error =
      res.reason === "not_found"
        ? "Order not found."
        : "This drink can no longer be swapped.";
    return { ok: false, error };
  }
  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, order: res.order };
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

// Correct a mis-keyed payment method on an order that already has one set
// (e.g. staff recorded Cash but it was QR). Manager-gated: requires the store
// passcode that only managers know, the same secret that gates store mode. The
// new method must be one of the currently-enabled methods in payment settings.
export async function changeOrderPaymentAction(
  token: string,
  method: string,
  passcode: string,
): Promise<OrderActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  if (!(await verifyStorePasscode(passcode))) {
    return { ok: false, error: "Incorrect manager passcode." };
  }
  // The target must be a currently-enabled, real method (never 'unpaid').
  const settings = await getPaymentSettings();
  const enabled = getEnabledPaymentMethods(settings).map((m) => m.id);
  if (method === UNPAID_PAYMENT_METHOD || !enabled.includes(method as never)) {
    return { ok: false, error: "That payment method isn't available." };
  }
  const updated = await setOrderPayment(token, method);
  if (!updated) return { ok: false, error: "Order not found." };

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: updated.status };
}

// Staff attach a member to an order by scanned QR (uuid) / phone / email. Grants
// retroactively if the order is already completed (handled in the RPC).
export async function attachMemberAction(
  token: string,
  identifier: string,
): Promise<AttachActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const res = await attachOrderMember(token, identifier.trim());
  if (!res.ok) {
    const msg =
      res.error === "member_not_found"
        ? "No member found for that QR, phone, or email."
        : res.error === "different_member_attached"
          ? "This order already has a different member."
          : res.error === "order_not_found"
            ? "Order not found."
            : "Couldn't attach the member. Try again.";
    return { ok: false, error: msg };
  }
  revalidatePath(`/manage/${token}`);
  return { ok: true, displayName: res.displayName, phoneMasked: res.phoneMasked };
}

// Staff wildcard member search for the attach flow. Returns up to 10 candidates
// matching partial name / phone / email; staff then pick one to attach. The RPC
// enforces the staff gate + a 2-char minimum, so a short query returns empty.
export async function searchMembersAction(
  query: string,
): Promise<SearchMembersResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const members = await searchMembers(query.trim());
  return { ok: true, members };
}
