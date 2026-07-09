import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { mapCategory, buildProducts } from "@/lib/menu/mappers";
import { listActivePromotions } from "@/lib/promotions/store";
import { resolveActiveDiscount } from "@/lib/promotions/pricing";
import type { Category, Product } from "@/types/menu";

// Tag that buckets every cached catalog read (products, variants, add-ons,
// categories, promotions). Admin mutations call revalidateTag(CATALOG_TAG) to
// drop these entries the moment the menu changes — see the admin actions.
export const CATALOG_TAG = "catalog";

// Public catalog reads. RLS returns only non-archived rows to non-admins, so the
// storefront automatically hides archived items. Available + unavailable both
// return; the UI greys unavailable ones. Ordered by sort_order then name.
//
// Uses the cookie-free public client so the read can live in the Next Data Cache
// (cookies() is forbidden inside unstable_cache). The result is cached across
// requests under CATALOG_TAG and refreshed at most every 60s as a backstop for
// time-activated promotions; admin edits invalidate it instantly via the tag.
const buildCatalog = async (): Promise<Product[]> => {
  const db = createPublicClient();
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
  const built = buildProducts({
    productRows: products.data ?? [],
    variantRows: variants.data ?? [],
    addonRows: addons.data ?? [],
    categoryRows: categories.data ?? [],
    categoryAddonRows: categoryAddons.data ?? [],
    productAddonRows: productAddons.data ?? [],
  });

  // Attach the active promotion (best percent) to each product so the pure
  // pricing helpers can stay synchronous in client components.
  const promotions = await listActivePromotions(db);
  if (promotions.length === 0) return built;
  return built.map((p) => {
    const discount = resolveActiveDiscount(p, promotions);
    return discount ? { ...p, discount } : p;
  });
};

// Cross-request Data Cache wrapper. React's request-scoped cache() sits on top so
// a single request that calls this more than once (e.g. generateMetadata + page
// render on /menu/[slug]) reuses one result.
const fetchCatalog = cache(
  unstable_cache(buildCatalog, ["catalog"], {
    tags: [CATALOG_TAG],
    revalidate: 60,
  }),
);

const fetchCategories = cache(
  unstable_cache(
    async (): Promise<Category[]> => {
      const db = createPublicClient();
      const { data } = await db
        .from("categories")
        .select("*")
        .order("sort_order")
        .order("name");
      return (data ?? []).map(mapCategory);
    },
    ["categories"],
    { tags: [CATALOG_TAG], revalidate: 60 },
  ),
);

export async function listCategories(): Promise<Category[]> {
  return fetchCategories();
}

export async function listProducts(): Promise<Product[]> {
  return fetchCatalog();
}

// Uncached catalogue read for price-authoritative paths (cart re-pricing and the
// checkout server actions). listProducts() is fine for the storefront — a ~60s
// stale window there is harmless — but re-pricing exists specifically to catch a
// promotion an admin just toggled, so it MUST see the live DB, not the cached
// catalogue. Reads directly from Postgres every call; use only where correctness
// beats the cache (never in hot storefront render paths).
export async function listProductsFresh(): Promise<Product[]> {
  return buildCatalog();
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const all = await fetchCatalog();
  return all.find((p) => p.slug === slug) ?? null;
}

export async function getBestSellers(): Promise<Product[]> {
  const all = await fetchCatalog();
  return all.filter((p) => p.isBestSeller);
}

// Ids of products that are currently orderable (non-archived AND available). The
// cart uses this to flag lines whose drink went sold-out or was archived after
// being added — RLS already excludes archived rows, so this is just the
// available filter on top.
export async function getAvailableProductIds(): Promise<string[]> {
  const db = await createClient();
  const { data } = await db.from("products").select("id").eq("is_available", true);
  return (data ?? []).map((p) => p.id);
}
