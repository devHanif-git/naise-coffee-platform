// CMS-facing shapes. Distinct from the storefront `Product` (which hides
// archived rows and resolves add-ons): admin views need raw flags and ids.
export type AdminAddon = {
  id: string;
  name: string;
  price: number;
  isArchived: boolean;
};

export type AdminCategory = {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  maxAddons: number;
  isArchived: boolean;
  addonIds: string[]; // category default add-on set
};

export type AdminProduct = {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  categoryName: string;
  fromPrice: number; // min variant price, or base_price, or 0
  imageUrl: string | null;
  isBestSeller: boolean;
  isNew: boolean;
  isFeatured: boolean;
  isAvailable: boolean;
  isArchived: boolean;
  sortOrder: number;
  recipeSteps: string[] | null;
};

export type AdminVariant = { id: string; name: string; price: number };

// A raw cost-of-goods item (milk, matcha, packaging…). Price in sen is the flat
// cost it contributes to a drink; alwaysIncluded items are added to every drink.
export type AdminCostItem = {
  id: string;
  name: string;
  price: number;
  alwaysIncluded: boolean;
  isArchived: boolean;
  sortOrder: number;
};

// One line of a product's recipe: a cost item plus optional grams (staff
// guidance; does not change cost).
export type RecipeItem = { costItemId: string; amountGrams: number | null };

export type AdminProductDetail = AdminProduct & {
  description: string;
  basePrice: number | null;
  maxAddons: number | null;
  variants: AdminVariant[];
  // Per-product override rows keyed by addon id.
  addonOverrides: { addonId: string; mode: "add" | "remove" }[];
  // Ticked cost items and their gram amounts. Excludes always-included items
  // (those apply automatically and aren't stored per product).
  recipeItems: RecipeItem[];
};

// Payload the item form submits (server action parses this).
export type ProductFormData = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  categoryId: string;
  imageUrl: string | null;
  pricingMode: "variants" | "flat";
  basePrice: number | null;
  variants: { name: string; price: number }[];
  maxAddons: number | null;
  isBestSeller: boolean;
  isNew: boolean;
  isFeatured: boolean;
  isAvailable: boolean;
  addonOverrides: { addonId: string; mode: "add" | "remove" }[];
  recipeSteps: string[];
  // Ticked cost items + grams. Always-included items aren't listed here.
  recipeItems: RecipeItem[];
};
