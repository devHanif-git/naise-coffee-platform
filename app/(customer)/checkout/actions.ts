"use server";

import { cancelOrderAsSystem, createOrder } from "@/lib/orders/store";
import { signReceiptPath } from "@/lib/orders/receipt-server";
import { applyOrderRewards } from "@/lib/rewards/store";
import type { OrderRewardsResult } from "@/types/reward";
import { createClient } from "@/lib/supabase/server";
import { buildOrderMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import type { OrderLine } from "@/types/order";
import { getStoreSettingsForCheckout } from "@/lib/settings/store";
import { normalizeMyPhone } from "@/lib/phone";
import { redeemVoucher } from "@/lib/stamps/voucher-store";
import { listProductsFresh } from "@/lib/menu/store";
import { repriceLine } from "@/lib/promotions/reprice";

type PlaceOrderItem = {
  // Always present for storefront orders (every line is a menu product); typed
  // optional to match the shared CartItem shape.
  productId?: string;
  name: string;
  quantity: number;
  // Size + add-on ids drive the authoritative server-side re-price against the
  // live catalogue — the client-sent prices below are advisory (display) only.
  sizeId?: string;
  addonIds?: string[];
  sizeName?: string;
  addonNames: string[];
  unitPrice: number;
  // Per-unit price before any promo. Lets the manage view flag promo drinks.
  unitOriginalPrice?: number;
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
  // Unverified MY phone collected at checkout (member profile value or a number
  // entered in the prompt). Re-normalized server-side; dropped if invalid.
  contactPhone?: string;
  // Optional loyalty voucher to redeem on this order. Validated + applied
  // server-side; the client total is advisory only.
  voucherId?: string;
};

export type PlaceOrderResult =
  | { ok: true; orderNumber: string; rewards?: OrderRewardsResult; voucherDiscount?: number }
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

  // Hard block: an admin can close the store from the CMS. Fail-closed — a
  // settings read failure is treated as closed so it can't bypass a closure.
  const settings = await getStoreSettingsForCheckout();
  if (!settings.isOpen) {
    return { ok: false, error: settings.closedMessage };
  }

  // Derive identity server-side — never trust a user id from the client.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  // Login is required to order. The checkout route is gated, but enforce it
  // here too so the action can never create an unowned order.
  if (!userId) {
    return { ok: false, error: "Please sign in to place your order." };
  }

  // Re-validate availability against the live catalogue: the cart is client
  // localStorage and may hold a drink that went sold-out (or was archived)
  // after it was added. RLS returns non-archived products only, so a missing
  // id means archived/hidden; is_available=false means sold out. Either way,
  // block the order with a clear message rather than persisting a bad line.
  const productIds = [
    ...new Set(
      input.items.map((i) => i.productId).filter((id): id is string => !!id),
    ),
  ];
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
          .filter((i) => i.productId !== undefined && availableById.get(i.productId) !== true)
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
  // caller's own folder using the SERVER-derived user id — never the client
  // ownerId — so a client can't sign someone else's receipt path. (The receipts
  // bucket's insert policy allows any authenticated user to write any path, so
  // this prefix check is the only thing scoping the signed URL to the caller.)
  let proofOfPaymentUrl: string | undefined;
  if (input.proofOfPaymentPath) {
    if (!input.proofOfPaymentPath.startsWith(`${userId}/`)) {
      return { ok: false, error: "Invalid receipt reference." };
    }
    try {
      proofOfPaymentUrl = await signReceiptPath(input.proofOfPaymentPath);
    } catch {
      return { ok: false, error: "Couldn't attach your payment receipt. Please try again." };
    }
  }

  // Re-normalize the contact phone server-side — never trust the client. An
  // invalid value is dropped (the number is optional and must never fail the order).
  const contactPhone = input.contactPhone
    ? (normalizeMyPhone(input.contactPhone) ?? undefined)
    : undefined;

  // Re-price every menu line against the live catalogue — never trust the price
  // the client sent. A promotion may have started or ended after the item was
  // added to the (localStorage) cart, so the snapshot can be stale. A line we
  // can't faithfully re-price (custom/off-menu, or a size/add-on that changed)
  // falls back to its sent price; archived/sold-out products are already blocked
  // by the availability check above. The catalogue read is fresh (uncached) so a
  // promo toggled moments ago is seen immediately, not through the 60s cache.
  const catalog = await listProductsFresh();
  const lines: OrderLine[] = input.items.map((item) => {
    const repriced = repriceLine(
      {
        productId: item.productId,
        sizeId: item.sizeId,
        addonIds: item.addonIds ?? [],
        isReward: item.isReward,
      },
      catalog,
    );
    const unitPrice = repriced?.unitPrice ?? item.unitPrice;
    const unitOriginalPrice =
      repriced?.unitOriginalPrice ?? item.unitOriginalPrice ?? item.unitPrice;
    return {
      name: item.name,
      quantity: item.quantity,
      sizeName: item.sizeName,
      addonNames: item.addonNames,
      unitPrice,
      unitOriginalPrice,
      lineTotal: unitPrice * item.quantity,
      status: "pending",
      isReward: item.isReward,
      rewardCost: item.rewardCost,
      productId: item.productId,
    };
  });

  // Authoritative money, recomputed from the re-priced lines — this is what the
  // order stores and the customer is charged. subtotal is the pre-promo sum;
  // total is the promo-applied sum. The client-sent input.subtotal/input.total
  // are ignored for charging (they only informed the optimistic UI).
  const subtotal = lines.reduce(
    (sum, l) => sum + (l.unitOriginalPrice ?? l.unitPrice) * l.quantity,
    0,
  );
  const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  // Resolve the voucher discount server-side. We read the voucher row (RLS
  // scopes it to the caller), validate status/expiry/min-spend against the
  // SERVER subtotal, and compute the discount. The actual redeem (status flip)
  // happens after the order row exists, so a failed order never burns a voucher.
  let voucherDiscount = 0;
  let voucherToRedeem: string | null = null;
  // Human label for the applied voucher, for the Telegram "NEW ORDER!" note.
  let voucherLabel: string | undefined;
  if (input.voucherId) {
    const { data: v } = await supabase
      .from("vouchers")
      .select("id, type, status, discount_amount, min_spend, free_drink_max_value, expires_at, user_id")
      .eq("id", input.voucherId)
      .maybeSingle();
    if (!v || v.user_id !== userId || v.status !== "active" || new Date(v.expires_at) <= new Date()) {
      return { ok: false, error: "That voucher is no longer available." };
    }
    if (v.type === "rm_off") {
      if (subtotal < v.min_spend) {
        return { ok: false, error: `Spend at least RM${(v.min_spend / 100).toFixed(2)} to use this voucher.` };
      }
      voucherDiscount = Math.min(v.discount_amount, subtotal);
    } else {
      // free_drink: discount the cheapest PAID drink up to the cap. Reward lines
      // are already free (unitPrice 0), so including them would peg "cheapest" at
      // 0 and waste the voucher — exclude them. The customer pays for the rest,
      // so the free drink is the lowest-value paid line (e.g. RM9 + RM10 → the
      // RM9 is free). Uses re-priced unit prices so a promo can't shift which
      // line is "cheapest". No paid line means nothing for the voucher to apply
      // to, so reject rather than burn it for zero.
      const paidUnitPrices = lines
        .filter((l) => !l.isReward)
        .map((l) => l.unitPrice);
      if (paidUnitPrices.length === 0) {
        return { ok: false, error: "Add a paid drink to use this voucher." };
      }
      const cheapest = Math.min(...paidUnitPrices);
      voucherDiscount = Math.min(v.free_drink_max_value, cheapest, subtotal);
    }
    voucherToRedeem = v.id;
    voucherLabel =
      v.type === "free_drink"
        ? "Free Drink"
        : `RM${(v.discount_amount / 100).toFixed(0)} Off`;
  }

  // Discount off the promo-applied total (server-recomputed `total`), NOT the
  // pre-promo subtotal — otherwise an active promotion's saving would be
  // silently dropped and the customer overcharged.
  const discountedTotal = Math.max(0, total - voucherDiscount);

  let order;
  try {
    order = await createOrder(
      {
        // Scope the order to the authenticated user (a UUID, satisfying the
        // orders.owner_id NOT NULL + uuid-format constraint). user_id below is
        // the source of truth; owner_id mirrors it for legacy compatibility.
        ownerId: userId,
        paymentMethod: input.paymentMethod,
        items: lines,
        subtotal,
        total: discountedTotal,
        notes: input.notes?.trim() || undefined,
        contactPhone,
        proofOfPaymentUrl,
      },
      { userId },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't save your order: ${reason}` };
  }

  // Consume the voucher now that the order exists. The discounted total above
  // assumes the voucher is burned, so if the redeem fails (e.g. another order
  // won the race and already redeemed it) we must NOT keep the discount — roll
  // the order back and bail, exactly like the rewards failure path below.
  // Redeem runs BEFORE applyOrderRewards on purpose: a redeem failure here
  // leaves the voucher untouched (redeem_voucher flips status only on success),
  // so the plain cancel is clean. (Residual edge: redeem-ok then rewards-fail
  // cancels the order with the voucher already burned — rare, needs a voucher
  // and an unaffordable bean-reward in one cart, and costs only the voucher, no
  // ledger corruption since the reward RPC raises before inserting rows.)
  if (voucherToRedeem) {
    const redeemed = await redeemVoucher(voucherToRedeem, order.token);
    if (!redeemed.ok) {
      await cancelOrderAsSystem(order.token);
      return {
        ok: false,
        error: "That voucher is no longer available. Please try again.",
      };
    }
  }

  // Settle rewards (earn + redeem + streak). If it fails (e.g. a redemption the
  // live balance can't cover after a race), roll the order back so we never keep
  // an unsettled free-drink order, and bail before notifying the store.
  let rewards: OrderRewardsResult | undefined;
  {
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
  // Name the voucher in the order note (the order object from createOrder doesn't
  // carry it; the manage read path sets it separately).
  const message = buildOrderMessage(
    { ...order, voucherLabel },
    manageUrl,
    !canUseButton,
  );

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

  return { ok: true, orderNumber: order.orderNumber, rewards, voucherDiscount };
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
