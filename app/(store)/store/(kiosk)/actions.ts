"use server";

import { createOrder } from "@/lib/orders/store";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { inStoreMode } from "@/lib/auth/store-mode";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";
import { getStoreSettingsForCheckout } from "@/lib/settings/store";
import { getPaymentSettings } from "@/lib/settings/payments";
import { buildOrderMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import type { OrderLine } from "@/types/order";
import { STORE_OWNER_ID } from "@/constants/store";
import { UNPAID_PAYMENT_METHOD } from "@/data/payment-methods";

type StoreOrderItem = {
  productId?: string;
  name: string;
  quantity: number;
  sizeName?: string;
  addonNames: string[];
  unitPrice: number;
  // True for a staff-entered off-menu drink (no menu product). Maps to
  // order_items.is_custom and skips the live-catalogue availability check.
  isCustom?: boolean;
};

export type PlaceStoreOrderInput = {
  items: StoreOrderItem[];
  paymentMethod: "cash" | "duitnow-qr" | "unpaid";
  notes?: string;
  subtotal: number;
  total: number;
};

export type PlaceStoreOrderResult =
  | { ok: true; orderNumber: string; token: string }
  | { ok: false; error: string };

export async function placeStoreOrder(
  input: PlaceStoreOrderInput,
): Promise<PlaceStoreOrderResult> {
  if (input.items.length === 0) return { ok: false, error: "The order is empty." };

  // Defense in depth (the kiosk layout already gates these).
  if (!(await inStoreMode())) return { ok: false, error: "Not authorized." };
  if (!(await getStoreAccountEnabled())) return { ok: false, error: "Store ordering is off." };

  const settings = await getStoreSettingsForCheckout();
  if (!settings.isOpen) return { ok: false, error: settings.closedMessage };

  // The chosen method must be enabled server-side.
  const payments = await getPaymentSettings();
  const cashOk = payments.categories.cash && payments.methods.cash;
  const qrOk = payments.categories.qr && payments.methods["duitnow-qr"];
  if (input.paymentMethod === "cash" && !cashOk)
    return { ok: false, error: "Cash is not available." };
  if (input.paymentMethod === "duitnow-qr" && !qrOk)
    return { ok: false, error: "QR is not available." };
  if (input.paymentMethod === UNPAID_PAYMENT_METHOD && !payments.payLaterEnabled)
    return { ok: false, error: "Pay later is not available." };

  // Re-validate availability against the live catalogue. Custom lines have no
  // product, so only real menu lines are checked.
  const supabase = await createClient();
  const productIds = [
    ...new Set(
      input.items.map((i) => i.productId).filter((id): id is string => !!id),
    ),
  ];
  if (productIds.length > 0) {
    const { data: prods, error } = await supabase
      .from("products")
      .select("id, is_available")
      .in("id", productIds);
    if (error) return { ok: false, error: "Couldn't verify availability. Try again." };
    const ok = new Map((prods ?? []).map((p) => [p.id, p.is_available]));
    const blocked = [
      ...new Set(
        input.items
          // Skip custom / product-less lines — they can't be "unavailable".
          .filter((i) => !i.isCustom && i.productId)
          .filter((i) => ok.get(i.productId!) !== true)
          .map((i) => i.name),
      ),
    ];
    if (blocked.length > 0)
      return { ok: false, error: `No longer available: ${blocked.join(", ")}.` };
  }

  const lines: OrderLine[] = input.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    sizeName: item.sizeName,
    addonNames: item.addonNames,
    unitPrice: item.unitPrice,
    lineTotal: item.unitPrice * item.quantity,
    status: "pending",
    isCustom: item.isCustom ?? false,
    productId: item.isCustom ? null : item.productId,
  }));

  let order;
  try {
    order = await createOrder(
      {
        ownerId: STORE_OWNER_ID,
        paymentMethod: input.paymentMethod,
        items: lines,
        subtotal: input.subtotal,
        total: input.total,
        notes: input.notes?.trim() || undefined,
        source: "store",
      },
      { userId: null },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't save the order: ${reason}` };
  }

  // No rewards for store orders (no user_id). Notify staff best-effort.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const manageUrl = `${baseUrl}/manage/${order.token}`;
  const canUseButton = /^https:\/\//i.test(manageUrl) && !/localhost|127\.0\.0\.1/.test(manageUrl);
  try {
    await sendTelegramMessage(
      buildOrderMessage(order, manageUrl, !canUseButton),
      canUseButton ? { buttons: [[{ text: "📋 Manage Order", url: manageUrl }]] } : {},
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.error(`Store order ${order.orderNumber} placed but Telegram notice failed: ${reason}`);
  }

  return { ok: true, orderNumber: order.orderNumber, token: order.token };
}

// Attach a member to a just-placed kiosk order so they earn their loyalty stamp.
// The kiosk has no staff Supabase session (it authenticates via the store
// passcode → a signed store-mode cookie on a guest/store session), so it cannot
// call the staff-gated attach_order_member. Instead we re-enforce the SAME
// store-mode boundary placeStoreOrder uses, then call the service-role-only
// attach_order_member_store via the admin client. Returns minimal identity.
export type AttachStoreMemberResult =
  | { ok: true; displayName: string; phoneMasked: string | null }
  | { ok: false; error: string };

export async function attachStoreMember(
  token: string,
  identifier: string,
): Promise<AttachStoreMemberResult> {
  if (!(await inStoreMode())) return { ok: false, error: "Not authorized." };
  if (!(await getStoreAccountEnabled())) return { ok: false, error: "Store ordering is off." };

  const trimmed = identifier.trim();
  if (!trimmed) return { ok: false, error: "Enter a phone number or email." };

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("attach_order_member_store", {
    p_token: token,
    p_identifier: trimmed,
  });
  if (error) return { ok: false, error: "Couldn't add the member. Try again." };

  const row = data as unknown as
    | { ok: true; display_name: string; avatar_url: string | null; phone_masked: string | null }
    | { ok: false; error: string };
  if (!row?.ok) {
    const code = (row as { error?: string })?.error;
    const msg =
      code === "member_not_found"
        ? "No member found for that phone or email."
        : code === "different_member_attached"
          ? "This order already has a different member."
          : code === "order_not_found"
            ? "Order not found."
            : "Couldn't add the member. Try again.";
    return { ok: false, error: msg };
  }
  return { ok: true, displayName: row.display_name, phoneMasked: row.phone_masked };
}
