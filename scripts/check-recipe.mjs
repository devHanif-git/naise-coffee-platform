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
  alwaysIncludedSteps,
  composeInheritedBase,
  mergeRecipe,
  buildDisplayRecipe,
  prepareRecipeForSave,
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

// deriveGoodsCost: ingredient prices + packaging-type always-included, ignores
// archived, skips missing ids and free entries.
const items = [
  { id: "milk", price: 85, alwaysIncluded: false, isArchived: false, prepTemplate: null },
  { id: "coffee", price: 151, alwaysIncluded: false, isArchived: false, prepTemplate: null },
  { id: "cup", price: 46, alwaysIncluded: true, isArchived: false, prepTemplate: null },
  { id: "old", price: 999, alwaysIncluded: true, isArchived: true, prepTemplate: null },
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

// --- templated always-included item (e.g. ice) ---------------------------
// Ice is always-included AND has a prep template, so it is NOT counted in the
// flat always-base; it is priced only when present as a recipe ingredient.
const iceItems = [
  { id: "cup", price: 46, alwaysIncluded: true, isArchived: false, prepTemplate: null },
  { id: "ice", price: 12, alwaysIncluded: true, isArchived: false, prepTemplate: "Add ice" },
  { id: "milk", price: 85, alwaysIncluded: false, isArchived: false, prepTemplate: null },
];
// No recipe: only packaging cup counts (ice not counted flat).
assert.equal(deriveGoodsCost(null, iceItems), 46);
// Ice present as an ingredient (via inherited base): now it's priced.
assert.equal(
  deriveGoodsCost(
    [{ kind: "ingredient", costItemId: "ice", grams: null, text: null, custom: false }],
    iceItems,
  ),
  46 + 12,
);

// alwaysIncludedSteps: only templated, non-archived always items become steps.
assert.deepEqual(alwaysIncludedSteps(iceItems), [
  { kind: "ingredient", costItemId: "ice", grams: null, text: null, custom: false },
]);
assert.deepEqual(alwaysIncludedSteps(items), []); // none templated

// composeInheritedBase: always steps first, then the category recipe.
assert.deepEqual(
  composeInheritedBase(iceItems, [
    { kind: "ingredient", costItemId: "milk", grams: 150, text: null, custom: false },
  ]),
  [
    { kind: "ingredient", costItemId: "ice", grams: null, text: null, custom: false },
    { kind: "ingredient", costItemId: "milk", grams: 150, text: null, custom: false },
  ],
);
assert.deepEqual(composeInheritedBase(iceItems, null), [
  { kind: "ingredient", costItemId: "ice", grams: null, text: null, custom: false },
]);

// Skipping ice on a drink (exclude directive) drops both its step and its cost.
{
  const inheritedBase = composeInheritedBase(iceItems, null);
  const merged = mergeRecipe(inheritedBase, [{ kind: "exclude", costItemId: "ice" }]);
  assert.deepEqual(merged, []); // ice excluded, nothing else
  assert.equal(deriveGoodsCost(merged, iceItems), 46); // only packaging cup
}

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
  { id: "milk", price: 85, alwaysIncluded: false, isArchived: false, prepTemplate: null },
  { id: "matcha", price: 155, alwaysIncluded: false, isArchived: false, prepTemplate: null },
  { id: "syrup", price: 106, alwaysIncluded: false, isArchived: false, prepTemplate: null },
  { id: "cup", price: 46, alwaysIncluded: true, isArchived: false, prepTemplate: null },
];
assert.equal(
  deriveGoodsCost(mergeRecipe(base, [{ kind: "ingredient", costItemId: "milk", grams: 999, text: null, custom: false }]), mItems),
  85 + 155 + 46, // milk once (dedup) + matcha + always-included cup
);

// --- pinned order (inherited markers) ------------------------------------
// Pinned: markers expand in place, own step interleaves where placed.
assert.deepEqual(
  mergeRecipe(base, [
    { kind: "inherited", costItemId: "matcha" },
    { kind: "free", text: "Add ice" },
    { kind: "inherited", costItemId: "milk" },
  ]),
  [
    { kind: "ingredient", costItemId: "matcha", grams: 4, text: null, custom: false },
    { kind: "free", text: "Add ice" },
    { kind: "ingredient", costItemId: "milk", grams: 150, text: null, custom: false },
  ],
);

// Pinned + a base item never placed (added to category later): appended after.
assert.deepEqual(
  mergeRecipe(base, [{ kind: "inherited", costItemId: "milk" }]),
  [
    { kind: "ingredient", costItemId: "milk", grams: 150, text: null, custom: false },
    { kind: "ingredient", costItemId: "matcha", grams: 4, text: null, custom: false },
  ],
);

// Pinned + exclude still drops the excluded base ingredient.
assert.deepEqual(
  mergeRecipe(base, [
    { kind: "inherited", costItemId: "milk" },
    { kind: "inherited", costItemId: "matcha" },
    { kind: "exclude", costItemId: "milk" },
  ]),
  [{ kind: "ingredient", costItemId: "matcha", grams: 4, text: null, custom: false }],
);

// Pinned + override still applies grams, keeping pinned position.
assert.deepEqual(
  mergeRecipe(base, [
    { kind: "inherited", costItemId: "matcha" },
    { kind: "inherited", costItemId: "milk" },
    { kind: "override", costItemId: "matcha", grams: 6 },
  ]),
  [
    { kind: "ingredient", costItemId: "matcha", grams: 6, text: null, custom: false },
    { kind: "ingredient", costItemId: "milk", grams: 150, text: null, custom: false },
  ],
);

// Cost is order-independent: pinned vs default give the same goods cost.
assert.equal(
  deriveGoodsCost(
    mergeRecipe(base, [
      { kind: "inherited", costItemId: "matcha" },
      { kind: "inherited", costItemId: "milk" },
    ]),
    mItems,
  ),
  deriveGoodsCost(mergeRecipe(base, null), mItems),
);

// --- buildDisplayRecipe --------------------------------------------------
// Not pinned: synthesize a marker per base ingredient (default order) + own.
assert.deepEqual(
  buildDisplayRecipe(base, [{ kind: "free", text: "Add ice" }]),
  [
    { kind: "inherited", costItemId: "milk" },
    { kind: "inherited", costItemId: "matcha" },
    { kind: "free", text: "Add ice" },
  ],
);

// Not pinned but with directives: markers + own steps + directives kept.
assert.deepEqual(
  buildDisplayRecipe(base, [{ kind: "exclude", costItemId: "milk" }]),
  [
    { kind: "inherited", costItemId: "milk" },
    { kind: "inherited", costItemId: "matcha" },
    { kind: "exclude", costItemId: "milk" },
  ],
);

// Already pinned: returns the saved order (markers/own) + directives appended.
assert.deepEqual(
  buildDisplayRecipe(base, [
    { kind: "inherited", costItemId: "matcha" },
    { kind: "inherited", costItemId: "milk" },
    { kind: "override", costItemId: "matcha", grams: 6 },
  ]),
  [
    { kind: "inherited", costItemId: "matcha" },
    { kind: "inherited", costItemId: "milk" },
    { kind: "override", costItemId: "matcha", grams: 6 },
  ],
);

// --- prepareRecipeForSave ------------------------------------------------
// Display in default order (markers lead, in base order, own after) -> strip
// markers so the drink stays unpinned.
assert.deepEqual(
  prepareRecipeForSave(base, [
    { kind: "inherited", costItemId: "milk" },
    { kind: "inherited", costItemId: "matcha" },
    { kind: "free", text: "Add ice" },
  ]),
  [{ kind: "free", text: "Add ice" }],
);

// Display reordered (own step before a marker) -> keep markers (pinned).
assert.deepEqual(
  prepareRecipeForSave(base, [
    { kind: "free", text: "Add ice" },
    { kind: "inherited", costItemId: "milk" },
    { kind: "inherited", costItemId: "matcha" },
  ]),
  [
    { kind: "free", text: "Add ice" },
    { kind: "inherited", costItemId: "milk" },
    { kind: "inherited", costItemId: "matcha" },
  ],
);

// Display with markers swapped from base order -> keep markers (pinned).
assert.deepEqual(
  prepareRecipeForSave(base, [
    { kind: "inherited", costItemId: "matcha" },
    { kind: "inherited", costItemId: "milk" },
  ]),
  [
    { kind: "inherited", costItemId: "matcha" },
    { kind: "inherited", costItemId: "milk" },
  ],
);

// No base at all: nothing to strip, own entries pass through unchanged.
assert.deepEqual(
  prepareRecipeForSave(null, [{ kind: "free", text: "Add ice" }]),
  [{ kind: "free", text: "Add ice" }],
);

// Round-trip: default display -> save -> merge equals default merge.
{
  const display = buildDisplayRecipe(base, [{ kind: "free", text: "Add ice" }]);
  const saved = prepareRecipeForSave(base, display);
  assert.deepEqual(mergeRecipe(base, saved), mergeRecipe(base, [{ kind: "free", text: "Add ice" }]));
}

console.log("recipe.ts smoke check passed");
