// Smoke check for lib/menu/recipe logic. No test runner in this repo, so this
// is a plain Node script: run with `node scripts/check-recipe.mjs` (or
// `npx tsx scripts/check-recipe.mjs` if Node can't import .ts directly). Exits
// non-zero on the first failed assertion.
import assert from "node:assert/strict";
import {
  fillTemplate,
  renderStep,
  resolveRecipeStrings,
  deriveGoodsCost,
  mergeRecipe,
} from "../lib/menu/recipe.ts";

// fillTemplate: {g}g -> "150g"; empty grams removes the token cleanly.
assert.equal(fillTemplate("Steam {g}g milk", 150), "Steam 150g milk");
assert.equal(fillTemplate("Steam {g}g milk", null), "Steam milk");
assert.equal(fillTemplate("Whisk {g}g matcha with 40ml water", 4), "Whisk 4g matcha with 40ml water");
assert.equal(fillTemplate("Bare {g} token", null), "Bare token");

const templates = new Map([
  ["milk", "Steam {g}g milk"],
  ["coffee", "Grind {g}g coffee, pull 2 shots espresso"],
  ["nopl", null],
]);

// renderStep: ingredient (not custom) -> template filled.
assert.equal(
  renderStep({ kind: "ingredient", costItemId: "milk", grams: 150, text: null, custom: false }, templates),
  "Steam 150g milk",
);
// renderStep: ingredient custom -> verbatim text.
assert.equal(
  renderStep({ kind: "ingredient", costItemId: "milk", grams: 150, text: "Steam 200g milk hot", custom: true }, templates),
  "Steam 200g milk hot",
);
// renderStep: ingredient with no template -> its text (or empty).
assert.equal(
  renderStep({ kind: "ingredient", costItemId: "nopl", grams: null, text: "do a thing", custom: true }, templates),
  "do a thing",
);
// renderStep: free -> text.
assert.equal(renderStep({ kind: "free", text: "Add ice" }, templates), "Add ice");

// resolveRecipeStrings: order preserved, empties dropped.
assert.deepEqual(
  resolveRecipeStrings(
    [
      { kind: "ingredient", costItemId: "coffee", grams: 18, text: null, custom: false },
      { kind: "free", text: "Add ice" },
      { kind: "free", text: "   " },
    ],
    templates,
  ),
  ["Grind 18g coffee, pull 2 shots espresso", "Add ice"],
);
assert.deepEqual(resolveRecipeStrings(null, templates), []);

// deriveGoodsCost: ingredient prices + always-included, ignores archived, skips
// missing ids and free entries.
const items = [
  { id: "milk", price: 85, alwaysIncluded: false, isArchived: false },
  { id: "coffee", price: 151, alwaysIncluded: false, isArchived: false },
  { id: "cup", price: 46, alwaysIncluded: true, isArchived: false },
  { id: "old", price: 999, alwaysIncluded: true, isArchived: true },
];
assert.equal(
  deriveGoodsCost(
    [
      { kind: "ingredient", costItemId: "milk", grams: 150, text: null, custom: false },
      { kind: "free", text: "stir" },
    ],
    items,
  ),
  85 + 46, // milk + always-included cup; archived always-item excluded
);
assert.equal(deriveGoodsCost(null, items), 46); // only always-included
assert.equal(
  deriveGoodsCost(
    [{ kind: "ingredient", costItemId: "missing", grams: null, text: null, custom: false }],
    items,
  ),
  46, // unknown id contributes 0, still adds always-included
);

// --- mergeRecipe ---------------------------------------------------------
const base = [
  { kind: "ingredient", costItemId: "milk", grams: 150, text: null, custom: false },
  { kind: "ingredient", costItemId: "matcha", grams: 4, text: null, custom: false },
];

// No product recipe: effective recipe is the base, in order.
assert.deepEqual(mergeRecipe(base, null), base);

// Null base, product-only: just the product's own entries.
const own = [{ kind: "ingredient", costItemId: "syrup", grams: 10, text: null, custom: false }];
assert.deepEqual(mergeRecipe(null, own), own);

// Base + product extra: base first, then the extra appended.
assert.deepEqual(mergeRecipe(base, own), [...base, ...own]);

// exclude drops a base ingredient.
assert.deepEqual(
  mergeRecipe(base, [{ kind: "exclude", costItemId: "milk" }]),
  [{ kind: "ingredient", costItemId: "matcha", grams: 4, text: null, custom: false }],
);

// override replaces a base ingredient's grams (base wording/template kept).
assert.deepEqual(
  mergeRecipe(base, [{ kind: "override", costItemId: "matcha", grams: 6 }]),
  [
    { kind: "ingredient", costItemId: "milk", grams: 150, text: null, custom: false },
    { kind: "ingredient", costItemId: "matcha", grams: 6, text: null, custom: false },
  ],
);

// Dedupe: a product ingredient already in the base is dropped (base wins).
assert.deepEqual(
  mergeRecipe(base, [
    { kind: "ingredient", costItemId: "milk", grams: 999, text: null, custom: false },
    { kind: "ingredient", costItemId: "syrup", grams: 10, text: null, custom: false },
  ]),
  [...base, { kind: "ingredient", costItemId: "syrup", grams: 10, text: null, custom: false }],
);

// Precedence: exclude beats override for the same costItemId.
assert.deepEqual(
  mergeRecipe(base, [
    { kind: "override", costItemId: "milk", grams: 200 },
    { kind: "exclude", costItemId: "milk" },
  ]),
  [{ kind: "ingredient", costItemId: "matcha", grams: 4, text: null, custom: false }],
);

// Free steps from the product are appended in order; free steps never dedupe.
assert.deepEqual(
  mergeRecipe(base, [{ kind: "free", text: "Add ice" }]),
  [...base, { kind: "free", text: "Add ice" }],
);

// Merged result feeds deriveGoodsCost unchanged: milk+matcha priced once.
const mItems = [
  { id: "milk", price: 85, alwaysIncluded: false, isArchived: false },
  { id: "matcha", price: 155, alwaysIncluded: false, isArchived: false },
  { id: "syrup", price: 106, alwaysIncluded: false, isArchived: false },
  { id: "cup", price: 46, alwaysIncluded: true, isArchived: false },
];
assert.equal(
  deriveGoodsCost(mergeRecipe(base, [{ kind: "ingredient", costItemId: "milk", grams: 999, text: null, custom: false }]), mItems),
  85 + 155 + 46, // milk once (dedup) + matcha + always-included cup
);

console.log("recipe.ts smoke check passed");
