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
  // Set when this line was added by redeeming a Beans reward. The base drink is
  // free (its price is excluded from unitPrice); add-ons are still charged.
  // `rewardCost` is the Bean price, settled at checkout. Reward lines are always
  // quantity 1.
  isReward?: boolean;
  rewardId?: string;
  rewardCost?: number;
  // User id of the member who redeemed this reward line. Stamped at redemption
  // so the cart can drop the line when a different identity — a guest after
  // sign-out, or another member on the same device — takes over the browser. A
  // reward belongs to the member who claimed it, never to whoever checks out
  // next. Only set on reward lines.
  redeemedBy?: string;
  quantity: number;
};
