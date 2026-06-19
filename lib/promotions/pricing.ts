import type { Discount, Product, ProductPricing } from "@/types/menu";
import { getBasePrice } from "@/lib/menu/pricing";

// The active discount already resolved onto the product server-side, if any.
export function getProductDiscount(product: Product): Discount | undefined {
  return product.discount;
}

// Apply a discount to a single price point (sen). Returns full pricing info, or a
// no-op result (percentOff 0) when nothing applies. Pure + client-safe.
export function applyDiscount(
  price: number,
  discount: Discount | undefined,
): ProductPricing {
  const percentOff = Math.min(100, Math.max(0, discount?.percentOff ?? 0));
  if (!discount || percentOff === 0) {
    return { original: price, final: price, saving: 0, percentOff: 0 };
  }
  const final = Math.round((price * (100 - percentOff)) / 100);
  return { original: price, final, saving: price - final, percentOff, discount };
}

// Pricing for the product's base ("from") price, with any active discount applied.
export function getProductPricing(product: Product): ProductPricing {
  return applyDiscount(getBasePrice(product), getProductDiscount(product));
}

// Pure resolver: the best (highest percent) discount that applies to a product
// from a list of currently-active discounts. productIds hold product UUIDs;
// categories hold category slugs — matching product.id / product.category. Used
// server-side by the menu store.
export function resolveActiveDiscount(
  product: Product,
  discounts: Discount[],
): Discount | undefined {
  const applicable = discounts.filter(
    (d) =>
      d.productIds?.includes(product.id) ||
      d.categories?.includes(product.category),
  );
  if (applicable.length === 0) return undefined;
  return applicable.reduce((best, d) => (d.percentOff > best.percentOff ? d : best));
}

// Admin-side promotion lifecycle state for the list badge. Pure; pass `now`.
export type PromotionStatus = "active" | "scheduled" | "expired" | "off";

export function promotionStatus(
  p: { isActive: boolean; startsAt: string | null; endsAt: string | null },
  now: Date,
): PromotionStatus {
  if (!p.isActive) return "off";
  if (p.startsAt && new Date(p.startsAt) > now) return "scheduled";
  if (p.endsAt && new Date(p.endsAt) <= now) return "expired";
  return "active";
}
