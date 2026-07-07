import { createClient } from "@/lib/supabase/server";
import type { RecipeEntry } from "@/lib/menu/recipe";
import type {
  AdminAddon,
  AdminCategory,
  AdminCostItem,
  AdminProduct,
  AdminProductDetail,
} from "@/lib/menu/types";

// All reads here run under the caller's RLS. The admin SELECT policy returns
// archived rows too, so these include archived items (callers gate with isAdmin
// before rendering).

export async function listAdminAddons(): Promise<AdminAddon[]> {
  const db = await createClient();
  const { data, error } = await db.from("addons").select("*").order("name");
  if (error) throw new Error(`listAdminAddons failed: ${error.message}`);
  return (data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    price: a.price,
    isArchived: a.is_archived,
  }));
}

// Cost-of-goods items, sorted for display. Admin-only under RLS.
export async function listAdminCostItems(): Promise<AdminCostItem[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("cost_items")
    .select("*")
    .order("sort_order")
    .order("name");
  if (error) throw new Error(`listAdminCostItems failed: ${error.message}`);
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    price: c.price,
    alwaysIncluded: c.is_always_included,
    isArchived: c.is_archived,
    sortOrder: c.sort_order,
    prepTemplate: c.prep_template,
  }));
}

export async function listAdminCategories(): Promise<AdminCategory[]> {
  const db = await createClient();
  const [cats, links] = await Promise.all([
    db.from("categories").select("*").order("sort_order").order("name"),
    db.from("category_addons").select("*").order("sort_order"),
  ]);
  if (cats.error) throw new Error(`listAdminCategories failed: ${cats.error.message}`);
  if (links.error) throw new Error(`listAdminCategories failed: ${links.error.message}`);
  return (cats.data ?? []).map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    sortOrder: c.sort_order,
    maxAddons: c.max_addons,
    isArchived: c.is_archived,
    addonIds: (links.data ?? [])
      .filter((l) => l.category_id === c.id)
      .map((l) => l.addon_id),
  }));
}

export async function listAdminProducts(): Promise<AdminProduct[]> {
  const db = await createClient();
  const [products, variants, cats] = await Promise.all([
    db.from("products").select("*").order("sort_order").order("name"),
    db.from("product_variants").select("*"),
    db.from("categories").select("id,name"),
  ]);
  if (products.error) throw new Error(`listAdminProducts failed: ${products.error.message}`);
  if (variants.error) throw new Error(`listAdminProducts failed: ${variants.error.message}`);
  if (cats.error) throw new Error(`listAdminProducts failed: ${cats.error.message}`);
  const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
  return (products.data ?? []).map((p) => {
    const vs = (variants.data ?? []).filter((v) => v.product_id === p.id);
    const fromPrice =
      vs.length > 0 ? Math.min(...vs.map((v) => v.price)) : p.base_price ?? 0;
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      categoryId: p.category_id,
      categoryName: catName.get(p.category_id) ?? "",
      fromPrice,
      imageUrl: p.image_url,
      isBestSeller: p.is_best_seller,
      isNew: p.is_new,
      isFeatured: p.is_featured,
      isAvailable: p.is_available,
      isArchived: p.is_archived,
      sortOrder: p.sort_order,
    };
  });
}

export async function getAdminProduct(
  id: string,
): Promise<AdminProductDetail | null> {
  const db = await createClient();
  const { data: p, error } = await db
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getAdminProduct failed: ${error.message}`);
  if (!p) return null;
  const [variants, overrides, cats] = await Promise.all([
    db.from("product_variants").select("*").eq("product_id", id).order("sort_order"),
    db.from("product_addons").select("*").eq("product_id", id),
    db.from("categories").select("id,name"),
  ]);
  if (variants.error) throw new Error(`getAdminProduct failed: ${variants.error.message}`);
  if (overrides.error) throw new Error(`getAdminProduct failed: ${overrides.error.message}`);
  if (cats.error) throw new Error(`getAdminProduct failed: ${cats.error.message}`);
  // Ordered unified recipe list stored as JSONB on the product.
  const recipe = ((p.recipe as unknown) as RecipeEntry[] | null) ?? [];
  const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
  const vs = variants.data ?? [];
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    categoryId: p.category_id,
    categoryName: catName.get(p.category_id) ?? "",
    fromPrice: vs.length > 0 ? Math.min(...vs.map((v) => v.price)) : p.base_price ?? 0,
    imageUrl: p.image_url,
    isBestSeller: p.is_best_seller,
    isNew: p.is_new,
    isFeatured: p.is_featured,
    isAvailable: p.is_available,
    isArchived: p.is_archived,
    sortOrder: p.sort_order,
    description: p.description,
    basePrice: p.base_price,
    maxAddons: p.max_addons,
    variants: vs.map((v) => ({ id: v.id, name: v.name, price: v.price })),
    addonOverrides: (overrides.data ?? []).map((o) => ({
      addonId: o.addon_id,
      mode: o.mode as "add" | "remove",
    })),
    recipe,
  };
}
