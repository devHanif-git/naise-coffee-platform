import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { deriveGoodsCost, mergeRecipe, type RecipeEntry } from "@/lib/menu/recipe";

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
    db.from("products").select("id, recipe, category_id").in("id", productIds),
  ]);
  if (items.error) throw new Error(`getProductCosts failed: ${items.error.message}`);
  if (prods.error) throw new Error(`getProductCosts failed: ${prods.error.message}`);

  // Each product's cost is its category base recipe merged with its own recipe
  // (see mergeRecipe): inherited ingredients count once, per-drink
  // exclude/override apply, duplicates resolve to the base.
  const categoryIds = [
    ...new Set(
      (prods.data ?? [])
        .map((p) => p.category_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const cats = categoryIds.length
    ? await db.from("categories").select("id, recipe").in("id", categoryIds)
    : { data: [], error: null };
  if (cats.error) throw new Error(`getProductCosts failed: ${cats.error.message}`);
  const categoryRecipeById = new Map(
    (cats.data ?? []).map((c) => [
      c.id,
      ((c.recipe as unknown) as RecipeEntry[] | null) ?? null,
    ]),
  );

  const costItems = (items.data ?? []).map((i) => ({
    id: i.id,
    price: i.price,
    alwaysIncluded: i.is_always_included,
    isArchived: i.is_archived,
  }));
  const prodById = new Map(
    (prods.data ?? []).map((p) => [
      p.id,
      {
        recipe: ((p.recipe as unknown) as RecipeEntry[] | null) ?? null,
        categoryId: p.category_id,
      },
    ]),
  );

  for (const id of productIds) {
    const p = prodById.get(id);
    const merged = mergeRecipe(
      p?.categoryId ? categoryRecipeById.get(p.categoryId) ?? null : null,
      p?.recipe ?? null,
    );
    costs.set(id, deriveGoodsCost(merged, costItems));
  }
  return costs;
}
