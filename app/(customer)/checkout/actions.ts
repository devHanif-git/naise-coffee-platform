"use server";

import { cancelOrder, createOrder } from "@/lib/orders/store";
import { applyOrderRewards } from "@/lib/rewards/store";
import type { OrderRewardsResult } from "@/types/reward";
import { createClient } from "@/lib/supabase/server";
import { buildOrderMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import type { OrderLine } from "@/types/order";

type PlaceOrderItem = {
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
  // Public URL of the uploaded DuitNow QR receipt, if any.
  proofOfPaymentUrl?: string;
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
        proofOfPaymentUrl: input.proofOfPaymentUrl,
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
      await cancelOrder(order.token);
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

  try {
    await sendTelegramMessage(
      message,
      canUseButton
        ? { buttons: [[{ text: "📋 Manage Order", url: manageUrl }]] }
        : {},
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't notify the store: ${reason}` };
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
