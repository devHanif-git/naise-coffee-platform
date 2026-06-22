import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { Discount } from "@/types/menu";

// Currently-active promotions mapped to the storefront Discount shape: is_active
// AND within the optional [starts_at, ends_at) window at now(). productIds hold
// product UUIDs; categories hold category slugs.
//
// Pass a client to control caching: the cached catalog path passes the
// cookie-free public client (so it can run inside unstable_cache); other callers
// get the default cookie-bound server client.
export async function listActivePromotions(
  client?: SupabaseClient<Database>,
): Promise<Discount[]> {
  const db = client ?? (await createClient());
  const nowIso = new Date().toISOString();
  const { data: promos, error } = await db
    .from("promotions")
    .select("*")
    .eq("is_active", true)
    .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order("sort_order");
  // Fail open: a promotions-read hiccup leaves the storefront at full price
  // rather than 500-ing. Log so the silent no-discount state is observable.
  if (error) {
    console.error(`listActivePromotions failed: ${error.message}`);
    return [];
  }
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
