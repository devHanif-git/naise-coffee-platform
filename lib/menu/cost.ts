import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { deriveGoodsCost, type RecipeEntry } from "@/lib/menu/recipe";

type Db = SupabaseClient<Database>;

// Goods cost (sen) for each product id: every always-included cost item plus
// each ingredient entry in the product's recipe list. Editing a cost item
// changes these figures going forward only — orders snapshot cost at sale time.
//
// Reads products.recipe and cost_items. cost_items is admin-only under RLS:
// pass an admin (service-role) client when the caller isn't an admin (e.g. at
// checkout). Returns baseCost (always-included only) for ids with no recipe.
export async function getProductCosts(
  db: Db,
  productIds: string[],
): Promise<Map<string, number>> {
  const costs = new Map<string, number>();
  if (productIds.length === 0) return costs;

  const [items, prods] = await Promise.all([
    db.from("cost_items").select("id, price, is_always_included, is_archived"),
    db.from("products").select("id, recipe").in("id", productIds),
  ]);
  if (items.error) throw new Error(`getProductCosts failed: ${items.error.message}`);
  if (prods.error) throw new Error(`getProductCosts failed: ${prods.error.message}`);

  const costItems = (items.data ?? []).map((i) => ({
    id: i.id,
    price: i.price,
    alwaysIncluded: i.is_always_included,
    isArchived: i.is_archived,
  }));
  const recipeById = new Map(
    (prods.data ?? []).map((p) => [
      p.id,
      ((p.recipe as unknown) as RecipeEntry[] | null) ?? null,
    ]),
  );

  for (const id of productIds) {
    costs.set(id, deriveGoodsCost(recipeById.get(id) ?? null, costItems));
  }
  return costs;
}
