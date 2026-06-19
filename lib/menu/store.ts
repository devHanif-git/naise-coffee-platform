import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { mapCategory, buildProducts } from "@/lib/menu/mappers";
import type { Category, Product } from "@/types/menu";

// Public catalog reads. RLS returns only non-archived rows to non-admins, so the
// storefront automatically hides archived items. Available + unavailable both
// return; the UI greys unavailable ones. Ordered by sort_order then name.
//
// Wrapped in React's request-scoped cache() so a single request that calls this
// more than once (e.g. generateMetadata + page render on /menu/[slug]) only hits
// the database once.
const fetchCatalog = cache(async (): Promise<Product[]> => {
  const db = await createClient();
  const [products, variants, addons, categories, categoryAddons, productAddons] = await Promise.all([
    db.from("products").select("*").order("sort_order").order("name"),
    db.from("product_variants").select("*"),
    db.from("addons").select("*"),
    db.from("categories").select("*"),
    db.from("category_addons").select("*"),
    db.from("product_addons").select("*"),
  ]);
  // Surface any read failure rather than silently building a partial catalog
  // (e.g. products with missing variants would render wrong prices).
  const firstError =
    products.error ??
    variants.error ??
    addons.error ??
    categories.error ??
    categoryAddons.error ??
    productAddons.error;
  if (firstError) throw new Error(`fetchCatalog failed: ${firstError.message}`);
  return buildProducts({
    productRows: products.data ?? [],
    variantRows: variants.data ?? [],
    addonRows: addons.data ?? [],
    categoryRows: categories.data ?? [],
    categoryAddonRows: categoryAddons.data ?? [],
    productAddonRows: productAddons.data ?? [],
  });
});

export async function listCategories(): Promise<Category[]> {
  const db = await createClient();
  const { data } = await db.from("categories").select("*").order("sort_order").order("name");
  return (data ?? []).map(mapCategory);
}

export async function listProducts(): Promise<Product[]> {
  return fetchCatalog();
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const all = await fetchCatalog();
  return all.find((p) => p.slug === slug) ?? null;
}

export async function getBestSellers(): Promise<Product[]> {
  const all = await fetchCatalog();
  return all.filter((p) => p.isBestSeller);
}
