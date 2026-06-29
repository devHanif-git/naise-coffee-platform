import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Db = SupabaseClient<Database>;

// Goods cost (sen) for each product id: sum of its recipe items' prices plus
// every always-included item (e.g. packaging). Editing a cost item changes
// these figures going forward only — orders snapshot their cost at sale time.
//
// Reads cost_items and product_recipe_items, which are admin-only under RLS:
// pass an admin (service-role) client when the caller isn't an admin, e.g. at
// checkout. Returns 0 for ids with no recipe (still includes always-on items).
export async function getProductCosts(
  db: Db,
  productIds: string[],
): Promise<Map<string, number>> {
  const costs = new Map<string, number>();
  if (productIds.length === 0) return costs;

  const [items, recipes] = await Promise.all([
    db.from("cost_items").select("id, price, is_always_included, is_archived"),
    db.from("product_recipe_items").select("product_id, cost_item_id").in("product_id", productIds),
  ]);
  if (items.error) throw new Error(`getProductCosts failed: ${items.error.message}`);
  if (recipes.error) throw new Error(`getProductCosts failed: ${recipes.error.message}`);

  const priceById = new Map((items.data ?? []).map((i) => [i.id, i.price]));
  // Always-included items apply to every drink and are added unconditionally.
  const baseCost = (items.data ?? [])
    .filter((i) => i.is_always_included && !i.is_archived)
    .reduce((sum, i) => sum + i.price, 0);

  for (const id of productIds) costs.set(id, baseCost);
  for (const r of recipes.data ?? []) {
    // Skip an always-included item if it's also explicitly in the recipe, so it
    // isn't double-counted against baseCost.
    const item = (items.data ?? []).find((i) => i.id === r.cost_item_id);
    if (item?.is_always_included) continue;
    const price = priceById.get(r.cost_item_id) ?? 0;
    costs.set(r.product_id, (costs.get(r.product_id) ?? baseCost) + price);
  }
  return costs;
}
