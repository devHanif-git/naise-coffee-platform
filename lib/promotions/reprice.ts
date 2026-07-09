import type { Product } from "@/types/menu";
import { applyDiscount, getProductDiscount } from "@/lib/promotions/pricing";

// The identifying parts of a cart/order line needed to recompute its price from
// the live catalogue: which product, which size, which add-ons, and whether it's
// a redeemed reward (base drink free).
export type RepriceInput = {
  productId?: string;
  sizeId?: string;
  addonIds: string[];
  isReward?: boolean;
};

// The authoritative price fields for a line, recomputed from live catalogue data.
export type RepricedFields = {
  unitPrice: number;
  unitOriginalPrice: number;
  discountLabel?: string;
  discountPercentOff?: number;
};

// Recompute a line's price from the live catalogue, mirroring exactly what the
// product customizer computes at add-time (drink price + selected add-ons, with
// any active promotion applied to the drink only). This is the single source of
// truth for "what does this line cost right now", used both to re-price the cart
// for display and to charge the authoritative amount server-side.
//
// Returns null when the line can't be faithfully re-priced — no product (custom
// / off-menu line), the product is gone from the catalogue (archived), the
// stored size no longer exists, or a stored add-on no longer exists. Callers
// keep the line's existing snapshot in that case; the server's separate
// availability check blocks archived/sold-out products from being ordered.
export function repriceLine(
  line: RepriceInput,
  catalog: Product[],
): RepricedFields | null {
  if (!line.productId) return null;
  const product = catalog.find((p) => p.id === line.productId);
  if (!product) return null;

  const sizes = product.sizes ?? [];
  const hasSizes = sizes.length > 0;
  // A stored size that no longer exists means the menu changed under the line —
  // don't guess a price, keep the snapshot.
  const selectedSize = line.sizeId
    ? sizes.find((s) => s.id === line.sizeId)
    : undefined;
  if (hasSizes && !selectedSize) return null;

  // Sum only add-ons that still exist on the product. A stored add-on that's
  // gone from the catalogue means we can't reproduce the price faithfully.
  let addonsTotal = 0;
  for (const id of line.addonIds) {
    const addon = product.addons.find((a) => a.id === id);
    if (!addon) return null;
    addonsTotal += addon.price;
  }

  const discount = getProductDiscount(product);
  const baseOriginal = hasSizes ? (selectedSize?.price ?? 0) : (product.price ?? 0);
  const basePricing = applyDiscount(baseOriginal, discount);
  // A promo never discounts a reward's already-free drink.
  const onSale = !line.isReward && basePricing.percentOff > 0;
  // Reward mode: the base drink is free; add-ons are still charged.
  const drinkPrice = line.isReward ? 0 : basePricing.final;
  const drinkOriginal = line.isReward ? 0 : baseOriginal;

  return {
    unitPrice: drinkPrice + addonsTotal,
    unitOriginalPrice: drinkOriginal + addonsTotal,
    discountLabel: onSale ? discount?.label : undefined,
    discountPercentOff: onSale ? basePricing.percentOff : undefined,
  };
}
