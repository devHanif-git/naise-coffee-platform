// CMS-facing shapes. Distinct from the storefront `Product` (which hides
// archived rows and resolves add-ons): admin views need raw flags and ids.
import type { RecipeEntry } from "@/lib/menu/recipe";
export type { RecipeEntry };

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
  prepTemplate: string | null;
};

export type AdminProductDetail = AdminProduct & {
  description: string;
  basePrice: number | null;
  maxAddons: number | null;
  variants: AdminVariant[];
  // Per-product override rows keyed by addon id.
  addonOverrides: { addonId: string; mode: "add" | "remove" }[];
  // Ordered, unified recipe list (ingredient steps + free-text steps).
  recipe: RecipeEntry[];
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
  // Ordered unified recipe list the form submits.
  recipe: RecipeEntry[];
};
