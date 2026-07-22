import type { CartItem } from "@/types/cart";

// Guards a persisted cart line before it re-enters state on hydrate. A stale
// schema or corrupt entry would otherwise survive the length check and produce
// NaN totals. Validates only the always-required fields: productId and
// unitOriginalPrice are optional by design (custom lines / pre-discount carts).
export function isValidCartItem(x: unknown): x is CartItem {
  if (!x || typeof x !== "object") return false;
  const i = x as Record<string, unknown>;
  return (
    typeof i.key === "string" &&
    typeof i.name === "string" &&
    Number.isInteger(i.unitPrice) &&
    (i.unitPrice as number) >= 0 &&
    Number.isInteger(i.quantity) &&
    (i.quantity as number) > 0 &&
    Array.isArray(i.addonIds) &&
    Array.isArray(i.addonNames)
  );
}
