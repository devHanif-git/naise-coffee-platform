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
  | { kind: "free"; text: string }
  // Per-drink directives against an inherited category-base ingredient. They
  // carry no cost/step themselves — mergeRecipe resolves them against the base.
  | { kind: "exclude"; costItemId: string }
  | { kind: "override"; costItemId: string; grams: number }
  // Position marker for an inherited base ingredient inside the drink's own
  // ordered list. Its presence means the drink has PINNED its step order, so
  // category order changes no longer re-flow (ingredients/cost still do). Only
  // written once a drink rearranges; a drink at the default order stores none.
  | { kind: "inherited"; costItemId: string };

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
// unless custom (then their text). Free steps are their text. Directive kinds
// (exclude/override) render nothing — they carry no step and are resolved by
// mergeRecipe before rendering.
export function renderStep(
  entry: RecipeEntry,
  templateById: Map<string, string | null>,
): string {
  if (entry.kind === "free") return entry.text;
  if (entry.kind !== "ingredient") return "";
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

// Goods cost (sen): packaging-type always-included items (no prep template) +
// each ingredient entry's price. Grams don't affect cost. Unknown ids and free
// entries add 0.
//
// Templated always-included items (e.g. ice — "Add ice") are NOT counted here:
// they flow into the recipe as inherited base steps (see composeInheritedBase)
// and are priced via the ingredient entries below, so skipping one on a drink
// drops its cost too. Only packaging-type always items (no template, e.g. the
// cup) are counted flat, since they never become steps.
export function deriveGoodsCost(
  recipe: RecipeEntry[] | null,
  costItems: {
    id: string;
    price: number;
    alwaysIncluded: boolean;
    isArchived: boolean;
    prepTemplate: string | null;
  }[],
): number {
  const priceById = new Map(costItems.map((c) => [c.id, c.price]));
  const base = costItems
    .filter((c) => c.alwaysIncluded && !c.isArchived && !c.prepTemplate)
    .reduce((sum, c) => sum + c.price, 0);
  const fromRecipe = (recipe ?? [])
    .filter((e): e is Extract<RecipeEntry, { kind: "ingredient" }> => e.kind === "ingredient")
    .reduce((sum, e) => sum + (priceById.get(e.costItemId) ?? 0), 0);
  return base + fromRecipe;
}

// Ingredient entries for templated, non-archived always-included items — the
// global "in every cup" steps (e.g. ice). They flow into every drink as
// inherited base steps (draggable, skippable, grams-overridable) and are priced
// via the recipe, not the always base sum. Packaging items (no template) are
// excluded — they stay flat cost, never a step.
export function alwaysIncludedSteps(
  costItems: {
    id: string;
    alwaysIncluded: boolean;
    isArchived: boolean;
    prepTemplate: string | null;
  }[],
): RecipeEntry[] {
  return costItems
    .filter((c) => c.alwaysIncluded && !c.isArchived && !!c.prepTemplate)
    .map((c) => ({
      kind: "ingredient",
      costItemId: c.id,
      grams: null,
      text: null,
      custom: false,
    }));
}

// The full inherited base for a drink: global always-included steps first, then
// the category's own base recipe. This is what flows into mergeRecipe as the
// `inherited` base, so ice + category steps all behave identically per drink.
export function composeInheritedBase(
  costItems: {
    id: string;
    alwaysIncluded: boolean;
    isArchived: boolean;
    prepTemplate: string | null;
  }[],
  categoryRecipe: RecipeEntry[] | null,
): RecipeEntry[] {
  return [...alwaysIncludedSteps(costItems), ...(categoryRecipe ?? [])];
}

// Resolve one inherited base ingredient into its effective entry given the
// drink's directives, or null if the drink excluded it. Applies grams override.
function resolveInherited(
  baseById: Map<string, Extract<RecipeEntry, { kind: "ingredient" }>>,
  costItemId: string,
  excluded: Set<string>,
  overrides: Map<string, number>,
): Extract<RecipeEntry, { kind: "ingredient" }> | null {
  const base = baseById.get(costItemId);
  if (!base || excluded.has(costItemId)) return null;
  const g = overrides.get(costItemId);
  return g === undefined ? base : { ...base, grams: g };
}

// Resolve a drink's effective recipe from its category base + its own entries.
// Returns an ordered list of ONLY ingredient/free entries (the shape every
// downstream consumer — cost, prep sheet — already understands).
//
// Two ordering modes, chosen by whether the drink has PINNED its order (i.e.
// its recipe contains any `inherited` position markers):
//
//   Default (no markers): category base first (in category order, with
//   exclude/override applied), then the drink's own ingredient/free entries.
//   Category order re-flows to the drink automatically.
//
//   Pinned (markers present): walk the drink's own list in its saved order,
//   expanding each `inherited` marker to its resolved base entry in place; the
//   drink's own steps interleave exactly where placed. Any base ingredient the
//   drink has NOT pinned (e.g. added to the category after this drink pinned)
//   is appended after, so new base ingredients/cost still flow in — only their
//   ORDER isn't guaranteed.
//
// Dedupe (both modes): an own-ingredient whose costItemId is in the base is
// dropped (base wins). exclude beats override beats a duplicate own-ingredient.
export function mergeRecipe(
  categoryRecipe: RecipeEntry[] | null,
  productRecipe: RecipeEntry[] | null,
): RecipeEntry[] {
  const own = productRecipe ?? [];
  const base = (categoryRecipe ?? []).filter(
    (e): e is Extract<RecipeEntry, { kind: "ingredient" }> => e.kind === "ingredient",
  );
  const baseFree = (categoryRecipe ?? []).filter(
    (e): e is Extract<RecipeEntry, { kind: "free" }> => e.kind === "free",
  );
  const baseById = new Map(base.map((e) => [e.costItemId, e]));
  const baseIds = new Set(baseById.keys());
  const excluded = new Set(
    own.flatMap((e) => (e.kind === "exclude" ? [e.costItemId] : [])),
  );
  const overrides = new Map(
    own.flatMap((e) => (e.kind === "override" ? [[e.costItemId, e.grams] as const] : [])),
  );

  const pinned = own.some((e) => e.kind === "inherited");
  const result: RecipeEntry[] = [];

  if (!pinned) {
    // Default order: base (with directives) first, then own entries.
    for (const e of base) {
      const resolved = resolveInherited(baseById, e.costItemId, excluded, overrides);
      if (resolved) result.push(resolved);
    }
    for (const e of baseFree) result.push(e);
    for (const e of own) {
      if (e.kind === "free") result.push(e);
      else if (e.kind === "ingredient" && !baseIds.has(e.costItemId)) result.push(e);
    }
    return result;
  }

  // Pinned order: expand markers in place, interleaving the drink's own steps.
  const placedBaseIds = new Set<string>();
  for (const e of own) {
    if (e.kind === "inherited") {
      const resolved = resolveInherited(baseById, e.costItemId, excluded, overrides);
      placedBaseIds.add(e.costItemId);
      if (resolved) result.push(resolved);
    } else if (e.kind === "free") {
      result.push(e);
    } else if (e.kind === "ingredient" && !baseIds.has(e.costItemId)) {
      result.push(e);
    }
    // exclude/override are directives, not output.
  }
  // Append base ingredients this drink never pinned (added to the category
  // after it pinned), so new base items still flow in for cost + prep.
  for (const e of base) {
    if (placedBaseIds.has(e.costItemId)) continue;
    const resolved = resolveInherited(baseById, e.costItemId, excluded, overrides);
    if (resolved) result.push(resolved);
  }
  for (const e of baseFree) result.push(e);
  return result;
}

// The ordered list the product form edits: the drink's saved order if it has
// pinned (markers already present), otherwise the default order with an
// `inherited` marker synthesized for each base ingredient so every inherited
// step is a real, draggable row. Directives (exclude/override) are kept so the
// form can derive skip/grams; they carry no position.
export function buildDisplayRecipe(
  categoryRecipe: RecipeEntry[] | null,
  productRecipe: RecipeEntry[] | null,
): RecipeEntry[] {
  const own = productRecipe ?? [];
  const directives = own.filter(
    (e) => e.kind === "exclude" || e.kind === "override",
  );
  const baseIds = (categoryRecipe ?? [])
    .filter((e) => e.kind === "ingredient")
    .map((e) => (e as Extract<RecipeEntry, { kind: "ingredient" }>).costItemId);

  if (own.some((e) => e.kind === "inherited")) {
    // Already pinned: the ordered rows are the own ingredient/free/inherited
    // entries as saved; keep directives too (the form reads them separately).
    const ordered: RecipeEntry[] = own.filter(
      (e) =>
        e.kind === "inherited" || e.kind === "ingredient" || e.kind === "free",
    );
    return [...ordered, ...directives];
  }

  // Not pinned: synthesize markers for the base (default order), then own steps.
  const markers: RecipeEntry[] = baseIds.map((id) => ({
    kind: "inherited",
    costItemId: id,
  }));
  const ownSteps = own.filter(
    (e) => e.kind === "ingredient" || e.kind === "free",
  );
  return [...markers, ...ownSteps, ...directives];
}

// Prepare the form's ordered list for saving. If the drink's order still equals
// the category's default (markers appear first, in category order, before any
// own step), strip the markers so the drink stays UNPINNED and keeps re-flowing
// category order. Otherwise keep the markers (pinned). Directives pass through.
export function prepareRecipeForSave(
  categoryRecipe: RecipeEntry[] | null,
  displayRecipe: RecipeEntry[],
): RecipeEntry[] {
  const baseOrder = (categoryRecipe ?? [])
    .filter((e) => e.kind === "ingredient")
    .map((e) => (e as Extract<RecipeEntry, { kind: "ingredient" }>).costItemId);

  // Positions of inherited markers and whether they lead the list in base order.
  const markerIds: string[] = [];
  let firstOwnIndex = displayRecipe.length;
  displayRecipe.forEach((e, i) => {
    if (e.kind === "inherited") markerIds.push(e.costItemId);
    else if (
      (e.kind === "ingredient" || e.kind === "free") &&
      i < firstOwnIndex
    )
      firstOwnIndex = i;
  });

  const markersLead = displayRecipe
    .slice(0, markerIds.length)
    .every((e) => e.kind === "inherited");
  const sameAsBase =
    markerIds.length === baseOrder.length &&
    markerIds.every((id, i) => id === baseOrder[i]);

  const isDefault = markersLead && sameAsBase && firstOwnIndex >= markerIds.length;

  const kept = isDefault
    ? displayRecipe.filter((e) => e.kind !== "inherited")
    : displayRecipe;
  return kept;
}
