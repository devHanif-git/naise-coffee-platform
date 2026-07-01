# Unified Recipe & Prep Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the item form's "Recipe & cost" and "Prep steps" panels into one Recipe panel where ticking an ingredient auto-generates an ordered, reorderable prep step (wording from the cost item's template, grams inline), interleaved with free-text steps.

**Architecture:** Replace the split storage (`product_recipe_items` table + `products.recipe_steps text[]`) with a single ordered `products.recipe` JSONB list of tagged entries. Cost becomes a pure function over the `ingredient` entries. Cost items gain a `prep_template` string. Pure logic (template render + cost derivation) is isolated in `lib/menu/recipe.ts` so it is unit-testable; the form panel and staff resolver consume it.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Supabase (Postgres + RLS), Tailwind, shadcn/ui, lucide-react. No new dependencies (reorder is hand-rolled pointer drag + up/down buttons, matching the existing pattern in `components/drink-row.tsx`).

## Global Constraints

- **No new libraries** — AGENTS.md requires approval; none added here. Reorder uses native pointer events + buttons.
- **TypeScript strict, no `any`.**
- **Money in sen** (integers). Cost item `price` is a flat cost per tick; grams never scale cost.
- **Schema changes ship as migrations** in `supabase/migrations/`, additive and reviewable. Do NOT drop `product_recipe_items` or `recipe_steps` in this plan (deferred cleanup).
- **RLS unchanged** — `cost_items` and cost data stay admin-only; `products.recipe` rides on the existing products policies.
- **No test runner exists** in this repo (no `test` script, zero app tests). Verification is `npm run build` + `npm run lint` + explicit manual steps. Pure logic is isolated in `lib/menu/recipe.ts` with a runnable Node smoke-check script so correctness is proven without adding a framework.
- **`types/database.ts` is hand-maintained** (no supabase CLI in package.json) — edit it directly.
- **Migration timestamps** must sort after `20260629110000`. Use `20260701*` prefixes.

---

## File Structure

- `supabase/migrations/20260701090000_unified_recipe.sql` — **create.** Adds `cost_items.prep_template`, `products.recipe jsonb`, backfills `recipe` from existing data, seeds templates.
- `lib/menu/recipe.ts` — **create.** Pure helpers: `RecipeEntry` type re-export, `renderStep(entry, costItemsById)`, `resolveRecipeStrings(recipe, costItemsById)`, `deriveGoodsCost(recipe, costItems)`. No React, no DB — unit-testable.
- `scripts/check-recipe.mjs` — **create.** Node smoke check exercising `lib/menu/recipe.ts` logic (run with `node`), since there is no test runner.
- `lib/menu/types.ts` — **modify.** Add `RecipeEntry`, `prepTemplate` on `AdminCostItem`, replace `recipeSteps`/`recipeItems` with `recipe: RecipeEntry[]` on `AdminProductDetail` and `ProductFormData`.
- `types/database.ts` — **modify.** Add `prep_template` to `cost_items` Row/Insert/Update; add `recipe: Json | null` to `products` Row/Insert/Update.
- `lib/menu/admin.ts` — **modify.** `listAdminCostItems` selects `prep_template`; `getAdminProduct`/`listAdminProducts` read `recipe` JSONB into `RecipeEntry[]`.
- `lib/menu/cost.ts` — **modify.** `getProductCosts` scans `products.recipe` instead of `product_recipe_items`.
- `app/(admin)/admin/costs/actions.ts` — **modify.** Persist `prep_template`.
- `components/admin/cost-manager.tsx` — **modify.** Add a prep-template input per row.
- `app/(admin)/admin/menu/actions.ts` — **modify.** `saveProduct` validates + writes `products.recipe`; stops writing `product_recipe_items`/`recipe_steps`.
- `components/admin/product-form.tsx` — **modify.** Replace the two panels with one Recipe panel (ingredient picker + ordered reorderable step list + live cost bar).
- `app/(admin)/manage/[token]/page.tsx` — **modify.** Build `recipeMap` by resolving `recipe` JSONB against cost-item templates.
- `app/(admin)/admin/costs/actions.ts` type for cost item save — check shape.

---

## Task 1: Migration — schema, backfill, template seeds

**Files:**
- Create: `supabase/migrations/20260701090000_unified_recipe.sql`

**Interfaces:**
- Produces: `cost_items.prep_template text` (nullable); `products.recipe jsonb` (nullable, default null) holding an ordered array of entries shaped `{kind:"ingredient",costItemId,grams,text,custom}` or `{kind:"free",text}`.

- [ ] **Step 1: Write the migration**

```sql
-- Unify recipe (ingredient ticks) and prep steps into one ordered list on the
-- product, and give each cost item a reusable prep-step template. Additive:
-- product_recipe_items and products.recipe_steps are left in place (a later
-- migration drops them once this is verified in production).

-- 1. Prep-step template on each cost item. {g} is replaced with the grams
--    entered on the step; author once, reused by every drink.
alter table public.cost_items
  add column if not exists prep_template text;

-- 2. One ordered recipe list per product. Entries are tagged objects; order is
--    array position. Cost is derived from the "ingredient" entries.
alter table public.products
  add column if not exists recipe jsonb default null;

-- 3. Backfill: ingredient entries first (existing recipe items, in their
--    sort_order), then existing free-text prep steps appended after.
update public.products p
set recipe = coalesce(ing.arr, '[]'::jsonb) || coalesce(free.arr, '[]'::jsonb)
from
  (select product_id,
          jsonb_agg(
            jsonb_build_object(
              'kind', 'ingredient',
              'costItemId', cost_item_id,
              'grams', amount_grams,
              'text', null,
              'custom', false
            ) order by sort_order
          ) as arr
   from public.product_recipe_items
   group by product_id) ing
  full outer join
  (select p2.id as product_id,
          jsonb_agg(
            jsonb_build_object('kind', 'free', 'text', step)
            order by ord
          ) as arr
   from public.products p2,
        lateral unnest(p2.recipe_steps) with ordinality as s(step, ord)
   where p2.recipe_steps is not null
   group by p2.id) free
  on ing.product_id = free.product_id
where p.id = coalesce(ing.product_id, free.product_id)
  and (ing.arr is not null or free.arr is not null);

-- Normalise empty results to null so "no recipe" stays null, not '[]'.
update public.products set recipe = null where recipe = '[]'::jsonb;

-- 4. Seed prep templates for the known cost items (grams shown via {g}).
--    Packaging-type and no-portion items get no template (steps start blank).
update public.cost_items set prep_template = 'Steam {g}g milk'                         where name = 'Milk';
update public.cost_items set prep_template = 'Grind {g}g coffee, pull 2 shots espresso' where name = 'Coffee';
update public.cost_items set prep_template = 'Whisk {g}g matcha with 40ml water'        where name = 'Matcha';
update public.cost_items set prep_template = 'Add {g}g sauce'                           where name = 'Sauce';
update public.cost_items set prep_template = 'Pump {g}g syrup'                          where name = 'Syrup';
update public.cost_items set prep_template = 'Add {g}g yogurt'                          where name = 'Yogurt';
update public.cost_items set prep_template = 'Add {g}g chocolate'                       where name = 'Chocolate';
update public.cost_items set prep_template = 'Add {g}g taro'                            where name = 'Taro';
update public.cost_items set prep_template = 'Add {g}g fruit crush'                     where name = 'Fruit Crush';
update public.cost_items set prep_template = 'Add {g}g condensed milk'                  where name = 'Condensed milk';
update public.cost_items set prep_template = 'Add {g}g Joss'                            where name = 'Extra Joss';
update public.cost_items set prep_template = 'Top with {g}g whipped cream'              where name = 'Whipp cream';
update public.cost_items set prep_template = 'Add {g}g cheese'                          where name = 'Cheese';
update public.cost_items set prep_template = 'Steam {g}g Oatside'                       where name = 'Oatside';
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase migration up` (or apply via the Supabase MCP `apply_migration` with name `unified_recipe` and the SQL above).
Expected: success, no error. `product_recipe_items` and `recipe_steps` still exist.

- [ ] **Step 3: Verify schema + backfill**

Run this SQL (via `execute_sql` MCP or psql):

```sql
select
  (select count(*) from information_schema.columns
     where table_name='cost_items' and column_name='prep_template') as has_prep_template,
  (select count(*) from information_schema.columns
     where table_name='products' and column_name='recipe') as has_recipe,
  (select count(*) from public.products where recipe is not null) as products_with_recipe,
  (select count(*) from public.cost_items where prep_template is not null) as items_with_template;
```

Expected: `has_prep_template=1`, `has_recipe=1`, `items_with_template=14`, `products_with_recipe` = number of products that had recipe items or prep steps. Spot-check one: `select recipe from public.products where recipe is not null limit 1;` — array of tagged objects, ingredient entries before free entries.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260701090000_unified_recipe.sql
git commit -m "feat(db): unified recipe list + cost-item prep templates"
```

---

## Task 2: Pure recipe logic module + smoke check

**Files:**
- Create: `lib/menu/recipe.ts`
- Create: `scripts/check-recipe.mjs`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `type RecipeEntry = { kind: "ingredient"; costItemId: string; grams: number | null; text: string | null; custom: boolean } | { kind: "free"; text: string }`
  - `renderStep(entry: RecipeEntry, templateById: Map<string, string | null>): string`
  - `resolveRecipeStrings(recipe: RecipeEntry[] | null, templateById: Map<string, string | null>): string[]`
  - `deriveGoodsCost(recipe: RecipeEntry[] | null, costItems: { id: string; price: number; alwaysIncluded: boolean; isArchived: boolean }[]): number`
  - `fillTemplate(template: string, grams: number | null): string`

- [ ] **Step 1: Write the failing smoke check**

Create `scripts/check-recipe.mjs`:

```js
// Smoke check for lib/menu/recipe logic. No test runner in this repo, so this
// is a plain Node script: run with `node scripts/check-recipe.mjs`. Exits
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/check-recipe.mjs`
Expected: FAIL — cannot resolve `../lib/menu/recipe.ts` (module doesn't exist yet). If Node can't import `.ts` directly in this environment, run with `npx tsx scripts/check-recipe.mjs`; note which command works and use it consistently. (tsx is already transitively available via Next; if not, this step's fallback is Step-4 typecheck via build.)

- [ ] **Step 3: Write the implementation**

Create `lib/menu/recipe.ts`:

```ts
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
```

- [ ] **Step 4: Run the smoke check to verify it passes**

Run: `node scripts/check-recipe.mjs` (or `npx tsx scripts/check-recipe.mjs` if that was the working command in Step 2)
Expected: prints `recipe.ts smoke check passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add lib/menu/recipe.ts scripts/check-recipe.mjs
git commit -m "feat(menu): pure recipe render + cost logic with smoke check"
```

---

## Task 3: Types — RecipeEntry across menu types and database types

**Files:**
- Modify: `lib/menu/types.ts`
- Modify: `types/database.ts:151` (cost_items block) and `types/database.ts:600-656` (products block)

**Interfaces:**
- Consumes: `RecipeEntry` from `lib/menu/recipe.ts` (Task 2).
- Produces: `AdminCostItem.prepTemplate: string | null`; `AdminProductDetail.recipe: RecipeEntry[]`; `ProductFormData.recipe: RecipeEntry[]` (replacing `recipeSteps`/`recipeItems`); DB types expose `cost_items.prep_template` and `products.recipe`.

- [ ] **Step 1: Update `lib/menu/types.ts`**

Add the import at the top:

```ts
import type { RecipeEntry } from "@/lib/menu/recipe";
export type { RecipeEntry };
```

Add `prepTemplate` to `AdminCostItem` (after `sortOrder`):

```ts
export type AdminCostItem = {
  id: string;
  name: string;
  price: number;
  alwaysIncluded: boolean;
  isArchived: boolean;
  sortOrder: number;
  prepTemplate: string | null;
};
```

Remove the `RecipeItem` type (lines 50-52) and its uses. Replace the recipe fields on `AdminProductDetail`: delete `recipeItems: RecipeItem[]` and the inherited `recipeSteps` handling — change `AdminProductDetail` to carry `recipe`:

```ts
export type AdminProductDetail = AdminProduct & {
  description: string;
  basePrice: number | null;
  maxAddons: number | null;
  variants: AdminVariant[];
  addonOverrides: { addonId: string; mode: "add" | "remove" }[];
  // Ordered, unified recipe list (ingredient steps + free-text steps).
  recipe: RecipeEntry[];
};
```

Change `AdminProduct.recipeSteps` (line 34) — remove it from `AdminProduct` (the list view doesn't need step data):

```ts
// delete this line from AdminProduct:
//   recipeSteps: string[] | null;
```

Replace the recipe fields on `ProductFormData`: delete `recipeSteps: string[]` and `recipeItems: RecipeItem[]`, add:

```ts
  // Ordered unified recipe list the form submits.
  recipe: RecipeEntry[];
```

- [ ] **Step 2: Update `types/database.ts` — cost_items block**

In the `cost_items` table type (around line 151), add `prep_template: string | null` to `Row`, `prep_template?: string | null` to `Insert` and `Update`.

- [ ] **Step 3: Update `types/database.ts` — products block**

In the `products` table type (lines 600-656): keep `recipe_steps` (column still exists), and add to each of Row/Insert/Update:
- Row: `recipe: Json | null`
- Insert: `recipe?: Json | null`
- Update: `recipe?: Json | null`

(Confirm `Json` is the exported helper type at the top of `types/database.ts`; it is the standard supabase-gen alias. If the file uses a different name, match it.)

- [ ] **Step 4: Typecheck via build**

Run: `npm run build`
Expected: FAILS with type errors in `lib/menu/admin.ts`, `product-form.tsx`, `actions.ts`, `cost.ts`, `manage/[token]/page.tsx` (they still reference the old fields). This is expected — those are fixed in Tasks 4-9. Confirm the errors are only about `recipeSteps`/`recipeItems`/`recipe`/`prepTemplate`, not syntax errors in the type files themselves.

- [ ] **Step 5: Commit**

```bash
git add lib/menu/types.ts types/database.ts
git commit -m "feat(types): RecipeEntry + prep_template + products.recipe"
```

---

## Task 4: Admin reads — cost items template + product recipe

**Files:**
- Modify: `lib/menu/admin.ts` (`listAdminCostItems`, `getAdminProduct`, `listAdminProducts`)

**Interfaces:**
- Consumes: `RecipeEntry` (Task 2), updated types (Task 3).
- Produces: `listAdminCostItems()` returns items with `prepTemplate`; `getAdminProduct()` returns `recipe: RecipeEntry[]`; `listAdminProducts()` no longer returns `recipeSteps`.

- [ ] **Step 1: Update `listAdminCostItems`**

In the `.map` (lines 35-42), add `prepTemplate: c.prep_template`:

```ts
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    price: c.price,
    alwaysIncluded: c.is_always_included,
    isArchived: c.is_archived,
    sortOrder: c.sort_order,
    prepTemplate: c.prep_template,
  }));
```

- [ ] **Step 2: Update `getAdminProduct`**

Remove the `product_recipe_items` query (lines 119-124). Parse `recipe` from the product row instead. After fetching `p`, build the recipe list:

```ts
  // Ordered unified recipe list stored as JSONB on the product.
  const recipe = ((p.recipe as unknown) as RecipeEntry[] | null) ?? [];
```

Replace the returned `recipeItems: ...` (lines 150-153) and the inherited `recipeSteps` with:

```ts
    recipe,
```

Remove `recipeSteps: p.recipe_steps,` from the returned object (line 141). Add the import at top:

```ts
import type { RecipeEntry } from "@/lib/menu/recipe";
```

- [ ] **Step 3: Update `listAdminProducts`**

Remove `recipeSteps: p.recipe_steps,` (line 95) from the returned object.

- [ ] **Step 4: Verify partial build**

Run: `npm run build`
Expected: still FAILS, but the errors in `lib/menu/admin.ts` are gone. Remaining errors are in `product-form.tsx`, `cost-manager.tsx`, `actions.ts` (both), `cost.ts`, `manage/[token]/page.tsx`.

- [ ] **Step 5: Commit**

```bash
git add lib/menu/admin.ts
git commit -m "feat(menu): read prep_template and unified recipe in admin loaders"
```

---

## Task 5: Cost derivation from the recipe JSONB

**Files:**
- Modify: `lib/menu/cost.ts` (`getProductCosts`)

**Interfaces:**
- Consumes: `deriveGoodsCost` (Task 2), `products.recipe` (Task 1).
- Produces: `getProductCosts(db, productIds)` unchanged signature → `Map<productId, sen>`, now sourced from `products.recipe`.

- [ ] **Step 1: Rewrite `getProductCosts`**

Replace the body so it reads `products.recipe` + `cost_items` and uses `deriveGoodsCost`:

```ts
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
```

- [ ] **Step 2: Verify partial build**

Run: `npm run build`
Expected: errors in `cost.ts` gone. Remaining: `product-form.tsx`, `cost-manager.tsx`, both `actions.ts`, `manage/[token]/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add lib/menu/cost.ts
git commit -m "feat(menu): derive goods cost from unified recipe list"
```

---

## Task 6: Cost Goods — persist and edit prep_template

**Files:**
- Modify: `app/(admin)/admin/costs/actions.ts`
- Modify: `components/admin/cost-manager.tsx`

**Interfaces:**
- Consumes: `AdminCostItem.prepTemplate` (Task 3).
- Produces: cost items round-trip `prepTemplate` through save; manager UI has a template input per row.

- [ ] **Step 1: Read `app/(admin)/admin/costs/actions.ts`**

Run: open the file. Find the `saveCostItems` action and the payload type it accepts (rows with `id?`, `name`, `price`, `alwaysIncluded`, `isArchived`).

- [ ] **Step 2: Add `prepTemplate` to the save payload + write**

In `saveCostItems`, extend the input row type with `prepTemplate: string | null` and include `prep_template: r.prepTemplate?.trim() || null` in the upsert/insert/update payload for each row. (Match the file's existing upsert pattern exactly — replace-all or per-row update as written.)

- [ ] **Step 3: Add the template field to `cost-manager.tsx` Row + state**

Extend the `Row` type (lines 22-29) with `prepTemplate: string;`. In `toRow` (lines 31-40) add `prepTemplate: item.prepTemplate ?? "",`. In `addRow` (line 92-95) the new blank row object add `prepTemplate: "",`. In the `save` mapping (lines 114-120) add `prepTemplate: r.prepTemplate.trim() || null,`.

- [ ] **Step 4: Render a template input in `CostRow`**

In `CostRow` (after the Cost field block, before the toggle), add a full-width row for the template. Keep it on its own line on both mobile and desktop (place it outside the `COLS` grid by rendering it after the grid row, OR add a second stacked row). Simplest: add it as a stacked field inside the row container spanning full width:

```tsx
      {/* Prep template — the step text this ingredient generates. {g} is
          replaced with the grams entered on the step. */}
      <div className="mt-3 flex flex-col gap-1 sm:col-span-4">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Prep step text <span className="normal-case font-normal">— use {"{g}"} for grams</span>
        </span>
        <Input
          value={row.prepTemplate}
          onChange={(e) => onChange({ prepTemplate: e.target.value })}
          placeholder="e.g. Steam {g}g milk"
          aria-label={`${row.name || "Ingredient"} prep step text`}
          className="w-full"
        />
      </div>
```

Note: the row container uses `COLS` (a 4-col grid on desktop). To make the template span the full width cleanly, wrap the existing grid cells and this field so the template sits on a second line. Adjust the row container: change the outer `div` to `className={cn("border-b ... ", cols)}` → keep the four existing children in the grid, and render the template block *after* the grid by moving to a flex-col wrapper:

```tsx
  return (
    <div data-row={row.key} className="border-b border-border px-4 py-4 last:border-b-0 sm:py-3">
      <div className={cn(row.alwaysIncluded && "bg-muted/30", cols)}>
        {/* existing: name, cost, toggle, remove cells */}
      </div>
      {/* template field (full width, second line) */}
    </div>
  );
```

Keep the existing four cells (name, cost, toggle, remove) inside the inner grid `div`; move `data-row` and the outer padding to the new outer `div`. Preserve the `naise-flash` target (the `data-row` element) and the "first input is name" assumption in the parent's focus effect — the name Input must remain the first `input` in DOM order, which it is.

- [ ] **Step 5: Manual verify**

Run: `npm run dev`, open `/admin/costs`.
Expected: each ingredient row shows a "Prep step text" input. Type `Steam {g}g milk` on Milk, Save. Reload — value persists. Check DB: `select name, prep_template from cost_items where name='Milk';` → shows the template.

- [ ] **Step 6: Build + lint + commit**

Run: `npm run lint`
Expected: no errors in the two files.

```bash
git add "app/(admin)/admin/costs/actions.ts" components/admin/cost-manager.tsx
git commit -m "feat(costs): author a prep-step template per ingredient"
```

---

## Task 7: saveProduct — validate and write the unified recipe

**Files:**
- Modify: `app/(admin)/admin/menu/actions.ts` (`saveProduct`)

**Interfaces:**
- Consumes: `ProductFormData.recipe: RecipeEntry[]` (Task 3).
- Produces: `products.recipe` written as JSONB; `product_recipe_items` / `recipe_steps` no longer written.

- [ ] **Step 1: Replace recipe validation**

Replace the `data.recipeItems.some(...)` grams check (lines 101-108) with validation over `data.recipe`:

```ts
  // Validate the unified recipe list: grams non-negative ints or null;
  // ingredient entries must carry a cost item id; entries must be well-formed.
  for (const entry of data.recipe) {
    if (entry.kind === "ingredient") {
      if (!entry.costItemId)
        return { ok: false, error: "A recipe ingredient is missing its cost item." };
      if (
        entry.grams != null &&
        (!Number.isInteger(entry.grams) || entry.grams < 0)
      )
        return { ok: false, error: "Recipe amounts must be non-negative whole numbers." };
    } else if (entry.kind === "free") {
      // free steps may be blank in-flight; trimmed out below
    } else {
      return { ok: false, error: "Invalid recipe step." };
    }
  }
```

- [ ] **Step 2: Build the recipe payload and write it on the product**

Replace `recipe_steps: data.recipeSteps?...` in `payload` (lines 127-129) with a cleaned `recipe`:

```ts
  // Drop blank free steps and blank custom/no-template ingredient steps; keep
  // ingredient steps that render from a template even with empty text.
  const cleanRecipe = data.recipe.filter((e) =>
    e.kind === "ingredient" ? true : e.text.trim().length > 0,
  );

  const payload = {
    category_id: data.categoryId,
    slug,
    name,
    description: data.description.trim(),
    image_url: data.imageUrl,
    base_price: data.pricingMode === "flat" ? data.basePrice : null,
    max_addons: data.maxAddons,
    is_best_seller: data.isBestSeller,
    is_new: data.isNew,
    is_featured: data.isFeatured,
    is_available: data.isAvailable,
    recipe: cleanRecipe.length > 0 ? cleanRecipe : null,
  };
```

- [ ] **Step 3: Remove the `product_recipe_items` replace-all block**

Delete the recipe-items delete+insert block (lines 193-210). The recipe now lives entirely on the product row written above. Leave `product_variants` and `product_addons` blocks untouched.

- [ ] **Step 4: Verify partial build**

Run: `npm run build`
Expected: errors in `actions.ts` gone. Only `product-form.tsx` and `manage/[token]/page.tsx` remain.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/menu/actions.ts"
git commit -m "feat(menu): save unified recipe JSONB on the product"
```

---

## Task 8: Item form — merged Recipe panel with reorderable steps

**Files:**
- Modify: `components/admin/product-form.tsx`

**Interfaces:**
- Consumes: `RecipeEntry`, `deriveGoodsCost`, `renderStep`, `fillTemplate` (Task 2); `AdminCostItem.prepTemplate`, `ProductFormData.recipe` (Task 3).
- Produces: the form emits `recipe: RecipeEntry[]` in submit; no more `recipeSteps`/`recipeItems`.

- [ ] **Step 1: Replace recipe state**

Remove the `recipeSteps` state (lines 71-73) and the `recipe` Map state (lines 77-101, i.e. `recipe`, `toggleRecipe`, `setGrams`). Add a single ordered list state + a template lookup:

```ts
  const [recipe, setRecipe] = useState<RecipeEntry[]>(product?.recipe ?? []);

  const templateById = new Map(costItems.map((c) => [c.id, c.prepTemplate]));
```

Import at top:

```ts
import { deriveGoodsCost, renderStep, fillTemplate, type RecipeEntry } from "@/lib/menu/recipe";
import { GripVertical, ChevronUp, ChevronDown } from "lucide-react";
```

- [ ] **Step 2: Recompute cost from the list**

Replace the `goodsCost` computation (lines 105-109) with:

```ts
  const goodsCost = deriveGoodsCost(
    recipe,
    activeCostItems.map((c) => ({
      id: c.id,
      price: c.price,
      alwaysIncluded: c.alwaysIncluded,
      isArchived: c.isArchived,
    })),
  );
```

Keep `activeCostItems`, `alwaysItems`, `optionalItems` (lines 86-88).

- [ ] **Step 3: Add list mutation helpers**

Add these inside the component:

```ts
  // Is this optional cost item currently in the list?
  const tickedIds = new Set(
    recipe.flatMap((e) => (e.kind === "ingredient" ? [e.costItemId] : [])),
  );

  function toggleIngredient(costItemId: string) {
    setRecipe((prev) => {
      const exists = prev.some(
        (e) => e.kind === "ingredient" && e.costItemId === costItemId,
      );
      if (exists)
        return prev.filter(
          (e) => !(e.kind === "ingredient" && e.costItemId === costItemId),
        );
      // New ingredient step appended at the bottom; drag to reposition.
      return [
        ...prev,
        { kind: "ingredient", costItemId, grams: null, text: null, custom: false },
      ];
    });
  }

  function addFreeStep() {
    setRecipe((prev) => [...prev, { kind: "free", text: "" }]);
  }

  function removeAt(index: number) {
    setRecipe((prev) => prev.filter((_, i) => i !== index));
  }

  function move(index: number, dir: -1 | 1) {
    setRecipe((prev) => {
      const to = index + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  // Editing a step's grams: re-render an untouched ingredient step from its
  // template (text stays null); a custom step keeps its frozen text.
  function setGramsAt(index: number, gramsStr: string) {
    const grams = gramsStr.trim() === "" ? null : Number(gramsStr);
    setRecipe((prev) =>
      prev.map((e, i) =>
        i === index && e.kind === "ingredient" ? { ...e, grams } : e,
      ),
    );
  }

  // Editing the text of an ingredient step freezes it (custom=true). Free steps
  // just update text.
  function setTextAt(index: number, text: string) {
    setRecipe((prev) =>
      prev.map((e, i) => {
        if (i !== index) return e;
        if (e.kind === "free") return { ...e, text };
        return { ...e, text, custom: true };
      }),
    );
  }

  // Revert a frozen ingredient step back to its template.
  function resetToTemplate(index: number) {
    setRecipe((prev) =>
      prev.map((e, i) =>
        i === index && e.kind === "ingredient"
          ? { ...e, text: null, custom: false }
          : e,
      ),
    );
  }
```

- [ ] **Step 4: Update `submit()`**

In the `data: ProductFormData` object (lines 140-167), remove `recipeSteps` and `recipeItems`, add `recipe`:

```ts
      recipe,
```

- [ ] **Step 5: Replace the two panels with one Recipe panel**

Delete the entire `<Panel title="Recipe & cost" ...>` block (lines 307-398) and the `<Panel title="Prep steps" ...>` block (lines 400-443). In their place insert one panel:

```tsx
          <Panel title="Recipe" hint={`Cost ${formatPrice(goodsCost)}`}>
            {activeCostItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No cost items yet. Create them under Cost Goods to build a recipe.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Always-included items: locked, counted automatically. */}
                {alwaysItems.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Always included
                    </span>
                    <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-muted/30">
                      {alwaysItems.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                          <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-foreground text-background">
                            <Check className="size-3" aria-hidden />
                          </span>
                          <span className="flex-1">{c.name}</span>
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">
                            {formatPrice(c.price)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ingredient picker — tap to add a step, tap again to remove. */}
                <div className="flex flex-col gap-2">
                  <span className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Ingredients
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {optionalItems.map((c) => {
                      const on = tickedIds.has(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleIngredient(c.id)}
                          aria-pressed={on}
                          className={cn(
                            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                            on
                              ? "border-foreground bg-foreground text-background"
                              : "border-border hover:bg-muted",
                          )}
                        >
                          {on && <Check className="size-3" aria-hidden />}
                          {c.name}
                          <span className={cn("font-mono tabular-nums", on ? "text-background/70" : "text-muted-foreground")}>
                            {formatPrice(c.price)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Ordered step list — ingredient + free steps, reorderable. */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      Prep steps
                    </span>
                    <button
                      type="button"
                      onClick={addFreeStep}
                      className="flex items-center gap-1 rounded-sm text-xs font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <Plus className="size-4" /> Add step
                    </button>
                  </div>
                  {recipe.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                      Tick an ingredient above or add a step. Drag to reorder.
                    </p>
                  ) : (
                    <ol className="flex flex-col gap-2">
                      {recipe.map((entry, i) => (
                        <RecipeStepRow
                          key={i}
                          index={i}
                          total={recipe.length}
                          entry={entry}
                          templateById={templateById}
                          costName={
                            entry.kind === "ingredient"
                              ? activeCostItems.find((c) => c.id === entry.costItemId)?.name ?? "Ingredient"
                              : ""
                          }
                          onGrams={(g) => setGramsAt(i, g)}
                          onText={(t) => setTextAt(i, t)}
                          onReset={() => resetToTemplate(i)}
                          onRemove={() => removeAt(i)}
                          onMove={(dir) => move(i, dir)}
                          onReorder={(from, to) =>
                            setRecipe((prev) => {
                              if (to < 0 || to >= prev.length) return prev;
                              const next = [...prev];
                              const [moved] = next.splice(from, 1);
                              next.splice(to, 0, moved);
                              return next;
                            })
                          }
                        />
                      ))}
                    </ol>
                  )}
                </div>

                <div className="flex items-center justify-between rounded-xl bg-foreground px-4 py-3 text-background">
                  <span className="text-sm font-semibold">Goods cost per drink</span>
                  <span className="font-mono text-lg font-bold tabular-nums">
                    {formatPrice(goodsCost)}
                  </span>
                </div>
              </div>
            )}
          </Panel>
```

- [ ] **Step 6: Add the `RecipeStepRow` component**

At the bottom of the file (after `ToggleRow`), add a row component with a drag handle (pointer-based reorder), up/down buttons, inline grams for ingredient steps, editable text, and a reset for frozen steps:

```tsx
function RecipeStepRow({
  index,
  total,
  entry,
  templateById,
  costName,
  onGrams,
  onText,
  onReset,
  onRemove,
  onMove,
  onReorder,
}: {
  index: number;
  total: number;
  entry: RecipeEntry;
  templateById: Map<string, string | null>;
  costName: string;
  onGrams: (grams: string) => void;
  onText: (text: string) => void;
  onReset: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const isIngredient = entry.kind === "ingredient";
  const custom = isIngredient && entry.custom;
  const hasTemplate = isIngredient && !!templateById.get(entry.costItemId);
  // Untouched ingredient step shows its rendered template read-only-ish (as the
  // input value); editing it freezes to custom. Custom/free show their text.
  const shownText =
    isIngredient && !custom ? renderStep(entry, templateById) : entry.text ?? "";

  // Pointer-drag reordering: track the row under the pointer by measuring
  // sibling <li> centers. Falls back to the up/down buttons on touch/keyboard.
  function onHandlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    const li = (e.currentTarget as HTMLElement).closest("li");
    const list = li?.parentElement;
    if (!li || !list) return;
    const rows = Array.from(list.children) as HTMLElement[];
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    function centers() {
      return rows.map((r) => {
        const rect = r.getBoundingClientRect();
        return rect.top + rect.height / 2;
      });
    }
    function onMoveEvt(ev: PointerEvent) {
      const ys = centers();
      let to = ys.findIndex((c) => ev.clientY < c);
      if (to === -1) to = rows.length - 1;
      if (to !== index) {
        onReorder(index, to);
      }
    }
    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMoveEvt);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMoveEvt);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <li className="flex items-start gap-2 rounded-xl border border-border bg-card px-2 py-2">
      <div className="flex flex-col items-center gap-0.5 pt-1">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label="Move step up"
          className="rounded-sm p-0.5 text-muted-foreground outline-none transition-colors hover:text-foreground disabled:opacity-30 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronUp className="size-4" />
        </button>
        <span
          onPointerDown={onHandlePointerDown}
          aria-hidden
          className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label="Move step down"
          className="rounded-sm p-0.5 text-muted-foreground outline-none transition-colors hover:text-foreground disabled:opacity-30 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>

      <span className="mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground tabular-nums">
        {index + 1}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Input
            value={shownText}
            onChange={(e) => onText(e.target.value)}
            placeholder={isIngredient ? "Step text" : `Step ${index + 1}`}
            className="flex-1"
          />
          {isIngredient && (
            <div className="relative w-20 shrink-0">
              <Input
                inputMode="numeric"
                value={entry.grams == null ? "" : String(entry.grams)}
                onChange={(e) => onGrams(e.target.value)}
                placeholder="0"
                aria-label={`${costName} grams`}
                className="w-full pr-7 font-mono tabular-nums"
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                g
              </span>
            </div>
          )}
        </div>
        {isIngredient && (
          <div className="flex items-center gap-2 text-[0.7rem] text-muted-foreground">
            <span className="rounded-full bg-muted px-2 py-0.5 font-semibold">
              {costName}
            </span>
            {custom && hasTemplate && (
              <button
                type="button"
                onClick={onReset}
                className="rounded-sm font-semibold outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Reset to template
              </button>
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove step"
        className="mt-1.5 rounded-sm p-1 text-muted-foreground outline-none transition-colors hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
}
```

Note: `fillTemplate` is imported for potential reuse but `renderStep` covers rendering; if `fillTemplate` ends up unused, remove it from the import to satisfy lint.

- [ ] **Step 7: Manual verify — end to end**

Run: `npm run dev`, open an existing product at `/admin/menu/<id>`.
Expected:
- One "Recipe" panel. Always-included shows locked. Ingredient chips reflect ticked state from the loaded recipe.
- Tick "Milk" → a step appears at the bottom reading "Steam g milk" (empty grams). Type `150` in its grams box → text becomes "Steam 150g milk".
- Edit that step's text → a "Reset to template" link appears; grams edits no longer overwrite the text.
- Add a free step, type "Add ice".
- Drag the handle (or up/down arrows) to reorder; numbers renumber live.
- Untick "Milk" chip → its step disappears; cost drops.
- Cost bar updates live on every tick.
- Save → returns to menu. Reopen → the ordered list, grams, custom text, and free steps all persisted.

- [ ] **Step 8: Build + lint**

Run: `npm run build && npm run lint`
Expected: PASS, no type or lint errors.

- [ ] **Step 9: Commit**

```bash
git add components/admin/product-form.tsx
git commit -m "feat(menu): merged Recipe panel with reorderable auto-generated steps"
```

---

## Task 9: Staff prep sheet — resolve recipe to strings

**Files:**
- Modify: `app/(admin)/manage/[token]/page.tsx`

**Interfaces:**
- Consumes: `resolveRecipeStrings`, `RecipeEntry` (Task 2); `products.recipe`, `cost_items.prep_template` (Task 1).
- Produces: `recipeMap: Map<string, string[]>` unchanged shape → `components/drink-row.tsx` needs no change.

- [ ] **Step 1: Rebuild `recipeMap` from `recipe` + templates**

Replace the recipe fetch block (lines 52-65) so it reads `recipe` and cost-item templates, then resolves to ordered strings:

```ts
  // Resolve each product's unified recipe list into ordered display strings for
  // the staff prep sheet (ingredient steps rendered from cost-item templates
  // with grams filled; custom + free steps as written).
  const recipeMap = new Map<string, string[]>();
  if (productIds.length > 0) {
    const db = createAdminClient();
    const [prods, items] = await Promise.all([
      db.from("products").select("id, recipe").in("id", productIds),
      db.from("cost_items").select("id, prep_template"),
    ]);
    const templateById = new Map(
      (items.data ?? []).map((c) => [c.id, c.prep_template]),
    );
    for (const p of prods.data ?? []) {
      const strings = resolveRecipeStrings(
        ((p.recipe as unknown) as RecipeEntry[] | null) ?? null,
        templateById,
      );
      if (strings.length > 0) recipeMap.set(p.id, strings);
    }
  }
```

Add the import at top:

```ts
import { resolveRecipeStrings, type RecipeEntry } from "@/lib/menu/recipe";
```

- [ ] **Step 2: Manual verify**

Run: `npm run dev`. Place/open an order containing a drink whose product has a recipe. Open the staff board `/manage`, open that drink's recipe sheet.
Expected: the numbered steps show the resolved recipe in the same order set in the form (e.g. "1. Steam 150g milk", "2. Grind 18g coffee, pull 2 shots espresso", "3. Add ice").

- [ ] **Step 3: Build + lint + commit**

Run: `npm run build && npm run lint`
Expected: PASS.

```bash
git add "app/(admin)/manage/[token]/page.tsx"
git commit -m "feat(manage): resolve unified recipe into the staff prep sheet"
```

---

## Task 10: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Clean build**

Run: `npm run build`
Expected: PASS, no type errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors/warnings in changed files.

- [ ] **Step 3: Logic smoke check**

Run: `node scripts/check-recipe.mjs` (or the working variant from Task 2)
Expected: `recipe.ts smoke check passed`.

- [ ] **Step 4: Cost integrity check**

Run this SQL comparing legacy-derived cost vs new. For a product that had recipe items, confirm the new `deriveGoodsCost` matches the old sum (always-included + ticked prices):

```sql
-- Old model total for one product:
select p.id,
  (select coalesce(sum(ci.price),0) from public.cost_items ci
     where ci.is_always_included and not ci.is_archived)
  + (select coalesce(sum(ci.price),0)
       from public.product_recipe_items pri
       join public.cost_items ci on ci.id = pri.cost_item_id
       where pri.product_id = p.id and not ci.is_always_included)
    as old_cost
from public.products p
where p.recipe is not null
limit 5;
```

Expected: cross-check these `old_cost` values against what the item form's cost bar shows for the same products. They should match (ingredient set unchanged by the migration).

- [ ] **Step 5: Manual regression**

- Create a brand-new product with a recipe (mix ingredient + free steps, reorder), save, reopen — persists.
- A product with NO recipe still saves and shows empty state.
- Checkout a drink (storefront) — order still records `unit_cost` correctly (cost path via `getProductCosts`).

- [ ] **Step 6: Final commit (if any fixups)**

```bash
git add -A
git commit -m "chore: verification fixups for unified recipe"
```

---

## Self-Review

**Spec coverage:**
- Prep template on cost item → Task 1 (column+seed), Task 6 (edit UI). ✓
- Unified `recipe` JSONB model → Task 1 (column+backfill), Task 3 (types). ✓
- Merge into one panel → Task 8. ✓
- Editable + linked steps, freeze-on-edit, reset-to-template, untick removes → Task 8 (`setTextAt`/`setGramsAt`/`resetToTemplate`/`toggleIngredient`). ✓
- Grams inline → Task 8 (`RecipeStepRow`). ✓
- Reorder hand-rolled (drag + up/down) → Task 8. ✓
- Cost derived from list → Task 2 (`deriveGoodsCost`), Task 5 (`getProductCosts`). ✓
- Staff sheet resolves templates, same `string[]` shape → Task 9; drink-row unchanged. ✓
- `{g}` empty-grams renders cleanly → Task 2 (`fillTemplate`) + smoke check. ✓
- Additive migration, keep legacy columns → Task 1 (no drops); non-goal noted. ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code. `fillTemplate` import caveat noted in Task 8 Step 6.

**Type consistency:** `RecipeEntry` defined once in `lib/menu/recipe.ts` (Task 2), re-exported from `types.ts` (Task 3), consumed by admin/cost/actions/form/manage with matching field names (`kind`, `costItemId`, `grams`, `text`, `custom`). `deriveGoodsCost`/`renderStep`/`resolveRecipeStrings`/`fillTemplate` signatures match across producer (Task 2) and consumers (Tasks 5, 8, 9). `prepTemplate` (camel, app types) vs `prep_template` (snake, DB) consistently mapped in `admin.ts` and actions.

One gap found and fixed inline: Task 8's `onReorder` (splice-based, for pointer drag) and `move` (swap-based, for buttons) are both defined — the pointer handler needs insert-at-index semantics, the buttons need adjacent swap; both are present and used.
