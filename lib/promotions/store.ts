import { createClient } from "@/lib/supabase/server";
import type { Discount } from "@/types/menu";

// Currently-active promotions mapped to the storefront Discount shape: is_active
// AND within the optional [starts_at, ends_at) window at now(). productIds hold
// product UUIDs; categories hold category slugs. Callers must run on a dynamic
// route (the menu pages set `export const dynamic = "force-dynamic"`).
export async function listActivePromotions(): Promise<Discount[]> {
  const db = await createClient();
  const nowIso = new Date().toISOString();
  const { data: promos } = await db
    .from("promotions")
    .select("*")
    .eq("is_active", true)
    .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order("sort_order");
  const active = promos ?? [];
  if (active.length === 0) return [];

  const ids = active.map((p) => p.id);
  const [prodLinks, catLinks, cats] = await Promise.all([
    db.from("promotion_products").select("*").in("promotion_id", ids),
    db.from("promotion_categories").select("*").in("promotion_id", ids),
    db.from("categories").select("id, slug"),
  ]);
  const catSlug = new Map((cats.data ?? []).map((c) => [c.id, c.slug]));

  return active.map((p) => ({
    id: p.slug,
    label: p.label,
    percentOff: p.percent_off,
    productIds: (prodLinks.data ?? [])
      .filter((l) => l.promotion_id === p.id)
      .map((l) => l.product_id),
    categories: (catLinks.data ?? [])
      .filter((l) => l.promotion_id === p.id)
      .map((l) => catSlug.get(l.category_id) ?? "")
      .filter(Boolean),
  }));
}
