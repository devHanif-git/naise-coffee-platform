export type CategoryType = "coffee" | "non_coffee" | "matcha";

export type Category = {
  type: CategoryType;
  name: string;
};

// Prices are stored in sen (1 MYR = 100 sen) to avoid floating-point money.
export type ProductSize = {
  id: string;
  name: string;
  price: number;
};

export type Addon = {
  id: string;
  name: string;
  price: number;
};

// A CMS-driven discount (e.g. a "discount day"). Targets specific products,
// whole sections (categories), or both. `percentOff` is a whole-number percent.
export type Discount = {
  id: string;
  label: string;
  percentOff: number;
  productIds?: string[];
  categories?: CategoryType[];
};

// Resolved pricing for a single price point (base price or a size price).
// `percentOff` is 0 and `discount` is undefined when nothing applies.
export type ProductPricing = {
  original: number;
  final: number;
  saving: number;
  percentOff: number;
  discount?: Discount;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: CategoryType;
  image: string;
  // Size options drive price. Optional: a product may have none (CMS-driven).
  sizes?: ProductSize[];
  // Flat price (sen) for products without sizes. Ignored when sizes exist.
  price?: number;
  addons: Addon[];
  // Max add-ons a customer may pick. Driven by CMS data per product.
  maxAddons?: number;
  isBestSeller?: boolean;
  isNew?: boolean;
  isFeatured?: boolean;
};
