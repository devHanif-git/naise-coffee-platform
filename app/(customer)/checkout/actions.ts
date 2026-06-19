"use server";

import { cancelOrderAsSystem, createOrder } from "@/lib/orders/store";
import { signReceiptPath } from "@/lib/orders/receipt-server";
import { applyOrderRewards } from "@/lib/rewards/store";
import type { OrderRewardsResult } from "@/types/reward";
import { createClient } from "@/lib/supabase/server";
import { buildOrderMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import type { OrderLine } from "@/types/order";

type PlaceOrderItem = {
  productId: string;
  name: string;
  quantity: number;
  sizeName?: string;
  addonNames: string[];
  unitPrice: number;
  isReward?: boolean;
  rewardCost?: number;
};

export type PlaceOrderInput = {
  items: PlaceOrderItem[];
  paymentMethod: string;
  notes?: string;
  subtotal: number;
  total: number;
  ownerId: string;
  // Storage path of the uploaded DuitNow QR receipt, if any (`<ownerId>/<uuid>`).
  // Signed into a URL server-side here — the bucket's read policy is staff-only.
  proofOfPaymentPath?: string;
};

export type PlaceOrderResult =
  | { ok: true; orderNumber: string; rewards?: OrderRewardsResult }
  | { ok: false; error: string };

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  if (input.items.length === 0) {
    return { ok: false, error: "Your cart is empty." };
  }
  if (!input.ownerId) {
    return { ok: false, error: "Missing session id. Refresh and try again." };
  }

  // Derive identity server-side — never trust a user id from the client.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  // Re-validate availability against the live catalogue: the cart is client
  // localStorage and may hold a drink that went sold-out (or was archived)
  // after it was added. RLS returns non-archived products only, so a missing
  // id means archived/hidden; is_available=false means sold out. Either way,
  // block the order with a clear message rather than persisting a bad line.
  const productIds = [...new Set(input.items.map((i) => i.productId).filter(Boolean))];
  if (productIds.length > 0) {
    const { data: prods, error: prodErr } = await supabase
      .from("products")
      .select("id, is_available")
      .in("id", productIds);
    if (prodErr) {
      return { ok: false, error: "Couldn't verify item availability. Please try again." };
    }
    const availableById = new Map((prods ?? []).map((p) => [p.id, p.is_available]));
    const blocked = [
      ...new Set(
        input.items
          .filter((i) => availableById.get(i.productId) !== true)
          .map((i) => i.name),
      ),
    ];
    if (blocked.length > 0) {
      return {
        ok: false,
        error: `No longer available: ${blocked.join(", ")}. Please remove ${blocked.length > 1 ? "them" : "it"} from your cart and try again.`,
      };
    }
  }

  // Sign the receipt server-side (staff-only read policy). Constrain to the
  // caller's own folder so a client can't sign someone else's receipt path.
  let proofOfPaymentUrl: string | undefined;
  if (input.proofOfPaymentPath) {
    if (!input.proofOfPaymentPath.startsWith(`${input.ownerId}/`)) {
      return { ok: false, error: "Invalid receipt reference." };
    }
    try {
      proofOfPaymentUrl = await signReceiptPath(input.proofOfPaymentPath);
    } catch {
      return { ok: false, error: "Couldn't attach your payment receipt. Please try again." };
    }
  }

  const lines: OrderLine[] = input.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    sizeName: item.sizeName,
    addonNames: item.addonNames,
    unitPrice: item.unitPrice,
    lineTotal: item.unitPrice * item.quantity,
    status: "pending",
    isReward: item.isReward,
    rewardCost: item.rewardCost,
  }));

  let order;
  try {
    order = await createOrder(
      {
        ownerId: input.ownerId,
        paymentMethod: input.paymentMethod,
        items: lines,
        subtotal: input.subtotal,
        total: input.total,
        notes: input.notes?.trim() || undefined,
        proofOfPaymentUrl,
      },
      { userId },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't save your order: ${reason}` };
  }

  // Settle rewards for members (earn + redeem + streak). Guests earn nothing.
  // If it fails (e.g. a redemption the live balance can't cover after a race),
  // roll the order back so we never keep an unsettled free-drink order, and
  // bail before notifying the store.
  let rewards: OrderRewardsResult | undefined;
  if (userId) {
    const applied = await applyOrderRewards(order.token);
    if (!applied.ok) {
      // The reward RPC raises before inserting any ledger rows, so nothing to
      // reverse — just cancel the just-created order so it never lingers as
      // `pending`. Members can't UPDATE orders under RLS (staff-only), so this
      // rollback must run via the service-role client.
      await cancelOrderAsSystem(order.token);
      return {
        ok: false,
        error: applied.insufficient
          ? "You don't have enough Beans to redeem the reward in your cart. Remove it and try again."
          : "Couldn't apply your rewards. Please try again.",
      };
    }
    rewards = applied.rewards;
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const manageUrl = `${baseUrl}/manage/${order.token}`;

  const canUseButton = /^https:\/\//i.test(manageUrl) && !isLocalUrl(manageUrl);
  const message = buildOrderMessage(order, manageUrl, !canUseButton);

  // The order is already persisted (and rewards settled). The Telegram alert is
  // a supplemental staff notice — the manage board shows the order live via
  // Postgres Changes regardless — so a notify failure must NOT fail the order,
  // or the customer sees an error and re-orders, creating a duplicate paid
  // order. Best-effort: log and continue.
  try {
    await sendTelegramMessage(
      message,
      canUseButton
        ? { buttons: [[{ text: "📋 Manage Order", url: manageUrl }]] }
        : {},
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.error(`Order ${order.orderNumber} placed but Telegram notice failed: ${reason}`);
  }

  return { ok: true, orderNumber: order.orderNumber, rewards };
}

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
