import type { Discount, Product, ProductPricing } from "@/types/menu";
import { getBasePrice } from "@/data/menu";

// CMS-driven discounts ("discount day"). A discount targets specific drinks
// (`productIds`), whole sections (`categories`), or both. Mocked here until the
// admin CMS + Supabase land. When several apply to one drink, the biggest
// percent wins (see getProductDiscount).
export const discounts: Discount[] = [
  {
    id: "matcha-monday",
    label: "Matcha Monday",
    percentOff: 20,
    categories: ["matcha"],
  },
  {
    id: "drink-of-the-day",
    label: "Drink of the Day",
    percentOff: 15,
    productIds: ["spanish-latte"],
  },
  {
    id: "flash-deal",
    label: "Flash Deal",
    percentOff: 25,
    productIds: ["iced-chocolate"],
  },
];

// The best (highest percent) discount that applies to a product, if any.
export function getProductDiscount(product: Product): Discount | undefined {
  const applicable = discounts.filter(
    (d) =>
      d.productIds?.includes(product.id) ||
      d.categories?.includes(product.category),
  );
  if (applicable.length === 0) return undefined;
  return applicable.reduce((best, d) =>
    d.percentOff > best.percentOff ? d : best,
  );
}

// Apply a discount to a single price point (sen). Returns full pricing info,
// or a no-op result (percentOff 0, no discount) when nothing applies.
export function applyDiscount(
  price: number,
  discount: Discount | undefined,
): ProductPricing {
  if (!discount || discount.percentOff <= 0) {
    return { original: price, final: price, saving: 0, percentOff: 0 };
  }
  const final = Math.round((price * (100 - discount.percentOff)) / 100);
  return {
    original: price,
    final,
    saving: price - final,
    percentOff: discount.percentOff,
    discount,
  };
}

// Pricing for the product's base ("from") price, with any discount applied.
export function getProductPricing(product: Product): ProductPricing {
  return applyDiscount(getBasePrice(product), getProductDiscount(product));
}
