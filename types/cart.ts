// A line in the cart. `key` is derived from product + size + add-ons, so the
// same drink with different settings becomes a separate line.
export type CartItem = {
  key: string;
  productId: string;
  slug: string;
  name: string;
  image: string;
  sizeId?: string;
  sizeName?: string;
  addonIds: string[];
  addonNames: string[];
  // Price per unit in sen (discounted base size price + selected add-ons).
  unitPrice: number;
  // Per-unit price before any discount (original base + add-ons). Equals
  // `unitPrice` when no promotion applies.
  unitOriginalPrice: number;
  // Promotion applied to this line, if any. Carried so the cart can show the
  // promo treatment without re-deriving it from the catalogue.
  discountLabel?: string;
  discountPercentOff?: number;
  quantity: number;
};
