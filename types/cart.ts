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
  // Price per unit in sen (base size price + selected add-ons).
  unitPrice: number;
  quantity: number;
};
