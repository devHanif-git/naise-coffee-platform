// Server-only CHIP Collect API client. Thin wrappers over the REST endpoints we
// use — create + retrieve purchase. Endpoint paths are copied verbatim from the
// CHIP OpenAPI spec (see chip-skill/CHIP-INTEGRATION-REFERENCE.md). All money is
// integer sen (== CHIP cents). Never import into a client component.

import { getChipConfig } from "@/lib/payments/chip/config";

export type ChipProduct = {
  name: string;
  // Integer sen (CHIP cents). 100 = RM 1.00.
  price: number;
  quantity?: number;
};

export type CreatePurchaseInput = {
  email: string;
  fullName?: string;
  products: ChipProduct[];
  // Our order number, stored on the CHIP purchase for cross-reference.
  reference: string;
  // Overrides the charged total (integer sen). Used for an order-level voucher
  // discount, which can't be a product line (CHIP product price has a min of 0,
  // so a discount can't be a negative line).
  totalOverride?: number;
  // Visual-only discount line on the CHIP receipt (integer sen); pair with
  // totalOverride so the itemised products reconcile with the charged total.
  totalDiscountOverride?: number;
  // Server-to-server webhook (source of truth). Optional: CHIP rejects callback
  // URLs on non-80/443 ports (i.e. localhost dev), so it's omitted there and the
  // order page's retrievePurchase reconciliation confirms payment instead.
  successCallback?: string;
  // Browser redirects after the hosted payment page.
  successRedirect: string;
  failureRedirect: string;
  cancelRedirect: string;
};

// Only the fields we read back. CHIP returns far more (see reference doc).
export type ChipPurchase = {
  id: string;
  status: string;
  checkout_url: string;
  is_test: boolean;
};

// Create a purchase locked to DuitNow QR. Returns the purchase (with its
// checkout_url). Throws with the CHIP error body on any non-2xx so callers can
// fail the checkout cleanly.
export async function createPurchase(
  input: CreatePurchaseInput,
): Promise<ChipPurchase> {
  const { baseUrl, brandId, secretKey } = getChipConfig();

  const body = {
    brand_id: brandId,
    client: {
      email: input.email,
      ...(input.fullName ? { full_name: input.fullName } : {}),
    },
    purchase: {
      currency: "MYR",
      products: input.products.map((p) => ({
        name: p.name,
        price: p.price,
        quantity: p.quantity ?? 1,
      })),
      // Order-level voucher discount: CHIP product prices can't be negative, so
      // the discount is applied as a total override (the charged amount) plus a
      // visual discount line so the hosted receipt reconciles.
      ...(input.totalOverride !== undefined ? { total_override: input.totalOverride } : {}),
      ...(input.totalDiscountOverride !== undefined
        ? { total_discount_override: input.totalDiscountOverride }
        : {}),
    },
    reference: input.reference,
    // Restrict the hosted page to DuitNow QR only. Our live brand serves the
    // working QR checkout under the `dnqr` identifier; `duitnow_qr` returns an
    // invoice/receipt URL instead (CHIP's documented migration caveat).
    payment_method_whitelist: ["dnqr"],
    // Only send the webhook callback when we have one (omitted on localhost —
    // CHIP rejects non-80/443 callback ports).
    ...(input.successCallback ? { success_callback: input.successCallback } : {}),
    success_redirect: input.successRedirect,
    failure_redirect: input.failureRedirect,
    cancel_redirect: input.cancelRedirect,
  };

  const res = await fetch(`${baseUrl}/purchases/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    // Never cache a payment creation.
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`CHIP create purchase failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as ChipPurchase;
}

// Retrieve a purchase to re-verify status server-side (webhook reconciliation,
// review-screen belt-and-braces). Throws on non-2xx.
export async function retrievePurchase(id: string): Promise<ChipPurchase> {
  const { baseUrl, secretKey } = getChipConfig();
  const res = await fetch(`${baseUrl}/purchases/${id}/`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`CHIP retrieve purchase failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as ChipPurchase;
}

// Refund a paid purchase. Full refund when `amount` is omitted; pass integer sen
// for a partial (unused today, kept for the signature). CHIP settles DuitNow QR
// refunds asynchronously, so a 2xx returning "pending_refund" is as good as
// "refunded" — callers decide via isRefundAccepted. Throws with the CHIP error
// body on non-2xx so the caller can record the failure. Endpoint path is
// cross-checked against the CHIP Collect OpenAPI spec.
export async function refundPurchase(
  purchaseId: string,
  amount?: number,
): Promise<{ status: string }> {
  const { baseUrl, secretKey } = getChipConfig();
  const res = await fetch(`${baseUrl}/purchases/${purchaseId}/refund/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    // Empty body = full refund; { amount } for a partial.
    body: JSON.stringify(amount !== undefined ? { amount } : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`CHIP refund failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { status?: string };
  return { status: data.status ?? "" };
}

// Append the DuitNow-QR direct-post param so the hosted page skips method
// selection and lands straight on the QR screen. Our live brand uses `dnqr`
// (the docs' migration value); plain `duitnow_qr` returns an invoice page.
export function duitnowQrCheckoutUrl(checkoutUrl: string): string {
  const sep = checkoutUrl.includes("?") ? "&" : "?";
  return `${checkoutUrl}${sep}preferred=dnqr`;
}
