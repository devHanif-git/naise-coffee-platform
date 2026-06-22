import type { Product } from "@/types/menu";
import { getBasePrice } from "@/lib/menu/pricing";

export type SortKey = "recommended" | "price-asc" | "price-desc";

// Orders products for display. "recommended" surfaces new drinks first, then
// best sellers, then everything else — each group ordered by lowest price.
// The explicit price sorts ignore that grouping and sort purely by price.
// Pure and non-mutating; Array.sort is stable in modern JS so equal items keep
// their incoming order.
export function sortProducts(products: Product[], sort: SortKey): Product[] {
  const copy = [...products];
  if (sort === "price-asc") {
    return copy.sort((a, b) => getBasePrice(a) - getBasePrice(b));
  }
  if (sort === "price-desc") {
    return copy.sort((a, b) => getBasePrice(b) - getBasePrice(a));
  }
  const rank = (p: Product) => (p.isNew ? 0 : p.isBestSeller ? 1 : 2);
  return copy.sort(
    (a, b) => rank(a) - rank(b) || getBasePrice(a) - getBasePrice(b),
  );
}
