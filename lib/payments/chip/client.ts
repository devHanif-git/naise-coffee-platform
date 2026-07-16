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
    },
    reference: input.reference,
    // Restrict the hosted page to DuitNow QR only.
    payment_method_whitelist: ["duitnow_qr"],
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

// Append the DuitNow-QR direct-post param so the hosted page skips method
// selection and lands straight on the QR screen. `duitnow_qr` is the canonical
// value (the docs note `dnqr` as a migration fallback).
export function duitnowQrCheckoutUrl(checkoutUrl: string): string {
  const sep = checkoutUrl.includes("?") ? "&" : "?";
  return `${checkoutUrl}${sep}preferred=duitnow_qr`;
}
