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

console.log("recipe.ts smoke check passed");
