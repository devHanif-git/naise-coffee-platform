// Pure recipe helpers — no React, no DB — so the template/cost logic is
// testable in isolation (see scripts/check-recipe.mjs). Consumed by the item
// form (live cost + step rendering), the staff prep sheet, and cost.ts.

// One entry in a product's ordered recipe list. Order = array position.
export type RecipeEntry =
  | {
      kind: "ingredient";
      costItemId: string;
      // Portion for staff guidance; fills {g} in the template. Never scales cost.
      grams: number | null;
      // Frozen wording once hand-edited (custom=true); otherwise null and the
      // step renders from the cost item's template.
      text: string | null;
      custom: boolean;
    }
  | { kind: "free"; text: string };

// Replace {g}g / {g} with the grams value. Empty grams removes the token and
// any leftover double space, so no stray placeholder shows.
export function fillTemplate(template: string, grams: number | null): string {
  const value = grams == null ? "" : String(grams);
  return template
    .replace(/\{g\}g/g, grams == null ? "" : `${value}g`)
    .replace(/\{g\}/g, value)
    .replace(/\s{2,}/g, " ")
    .trim();
}

// The display string for one step. Ingredient steps render from their template
// unless custom (then their text). Free steps are their text.
export function renderStep(
  entry: RecipeEntry,
  templateById: Map<string, string | null>,
): string {
  if (entry.kind === "free") return entry.text;
  if (entry.custom) return entry.text ?? "";
  const template = templateById.get(entry.costItemId);
  if (!template) return entry.text ?? "";
  return fillTemplate(template, entry.grams);
}

// Ordered display strings for the staff sheet; blank steps dropped.
export function resolveRecipeStrings(
  recipe: RecipeEntry[] | null,
  templateById: Map<string, string | null>,
): string[] {
  if (!recipe) return [];
  return recipe
    .map((e) => renderStep(e, templateById).trim())
    .filter((s) => s.length > 0);
}

// Goods cost (sen): every non-archived always-included item + each ingredient
// entry's price. Grams don't affect cost. Unknown ids and free entries add 0.
export function deriveGoodsCost(
  recipe: RecipeEntry[] | null,
  costItems: { id: string; price: number; alwaysIncluded: boolean; isArchived: boolean }[],
): number {
  const priceById = new Map(costItems.map((c) => [c.id, c.price]));
  const base = costItems
    .filter((c) => c.alwaysIncluded && !c.isArchived)
    .reduce((sum, c) => sum + c.price, 0);
  const fromRecipe = (recipe ?? [])
    .filter((e): e is Extract<RecipeEntry, { kind: "ingredient" }> => e.kind === "ingredient")
    .reduce((sum, e) => sum + (priceById.get(e.costItemId) ?? 0), 0);
  return base + fromRecipe;
}
