import type { Product } from "@/types/menu";

// Lowest price to show as the product's "from" price. Falls back to the flat
// `price` when a product has no sizes; 0 if neither is set. Pure + client-safe.
export function getBasePrice(product: Product): number {
  if (product.sizes && product.sizes.length > 0) {
    return Math.min(...product.sizes.map((s) => s.price));
  }
  return product.price ?? 0;
}
