"use client";

import { useEffect, useRef } from "react";
import { useCart } from "@/store/cart";
import { useRepriceCart } from "@/hooks/use-reprice-cart";

// Keeps the localStorage-backed cart's prices honest against the live catalogue.
//
// The cart stores a price snapshot taken when each item was added. A promotion
// that starts or ends afterwards would leave that snapshot stale — the menu
// would show the new price while the cart and checkout still used the old one.
// This mounts once per cart surface (customer + kiosk) and re-prices whenever the
// set of lines changes.
//
// Note: this only fires on line-composition changes, so it can't catch a promo
// toggled in the CMS while the cart sits unchanged. The cart sheet and checkout
// screen call useRepriceCart() directly on open/mount to cover that case — this
// component just handles the "item added while a promo changed" path. Display
// only: the authoritative charge is recomputed at checkout server-side.
export function CartRepricer() {
  const { items, hydrated } = useCart();
  const reprice = useRepriceCart();

  // Signature of the lines that matter for pricing — product, size, add-ons,
  // reward flag. Deliberately excludes quantity (re-pricing per unit doesn't
  // change with count) so bumping a quantity doesn't trigger a needless fetch.
  const signature = items
    .map((i) =>
      [i.key, i.productId ?? "", i.sizeId ?? "", i.addonIds.join(","), i.isReward ? "r" : ""].join(":"),
    )
    .join("|");

  const lastSignature = useRef<string | null>(null);

  useEffect(() => {
    if (!hydrated || items.length === 0) return;
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    void reprice();
    // Re-run only when the pricing-relevant signature changes, not on every
    // quantity tweak or unrelated cart mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, hydrated]);

  return null;
}
