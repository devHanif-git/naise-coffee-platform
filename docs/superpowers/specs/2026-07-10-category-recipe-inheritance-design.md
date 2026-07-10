# Category Recipe Inheritance — Design

Date: 2026-07-10

## Problem

Cost Goods lets us price every drink from its raw ingredients so we can read
gross/nett profit, and the same list doubles as the staff prep recipe. Today
this is set up **one drink at a time**: for every matcha we tick milk + matcha,
for every non-coffee we tick milk, and so on. Most drinks in a category share
the same base, so this repetition makes setup slow.

## Goal

Define the shared base once **at the category level** (e.g. matcha = milk +
matcha, non-coffee = milk). Every drink in that category inherits it for both
**cost** and **recipe**, with no per-drink action. Drinks only add their own
extras on top, and can override the inherited base where they differ.

## Approach: live inheritance with per-drink override

Chosen over a copy-in "preset" model: a change to the category base flows to
every drink in that category instantly (except where a drink explicitly
overrode). No migration rewrites existing drinks — they self-clean via the
dedupe rule below as they are re-saved.

## Data Model

One additive schema change:

- **`categories.recipe jsonb default null`** — an ordered list of `RecipeEntry`
  items, the same shape `products.recipe` already uses (ingredient steps with
  grams + a prep-step template sourced from the cost item, plus free-text
  steps). This is the category base, authored once.

Unchanged:

- `products.recipe` — still holds drink-specific entries and, now, per-drink
  overrides of inherited base ingredients.
- `cost_items` — categories reuse the existing raw-ingredient list; no new
  cost concepts.
- Legacy `product_recipe_items` / `products.recipe_steps` — left as-is (already
  superseded by `products.recipe`).

### RecipeEntry: new override kinds

`RecipeEntry` today is `ingredient | free` (see `lib/menu/recipe.ts`). Add two
lightweight entry kinds that live on `products.recipe` and reference a base
`costItemId`, so the base still owns the price and prep template:

```ts
export type RecipeEntry =
  | { kind: "ingredient"; costItemId: string; grams: number | null; text: string | null; custom: boolean }
  | { kind: "free"; text: string }
  // NEW — per-drink overrides of an inherited category-base ingredient:
  | { kind: "exclude"; costItemId: string }                 // skip this base item on this drink
  | { kind: "override"; costItemId: string; grams: number } // use these grams instead of the base's
```

`exclude` and `override` are only meaningful against the category base; they add
no cost or step on their own.

## Merge + Dedupe Rules (core)

A drink's **effective recipe** is computed by a new pure helper,
`mergeRecipe(categoryRecipe, productRecipe)`, returning an ordered
`RecipeEntry[]` of resolved `ingredient` / `free` entries:

1. Start with the **category base**, in order.
2. Apply the drink's overrides to base ingredients:
   - `exclude` → drop that base ingredient from the result.
   - `override` → replace that base ingredient's `grams` with the override's.
3. Append the drink's **own** `ingredient` / `free` entries, in order.
4. **Dedupe:** if a `costItemId` appears in both the base and the drink's own
   `ingredient` entries, the **category entry wins** and the drink's own copy is
   dropped. (This is the "auto-untick if it already exists" behaviour.)

Precedence when a base ingredient has more than one signal on the drink:
`exclude` beats everything (the item is gone), otherwise `override` sets its
grams, otherwise a duplicate own-`ingredient` entry is dropped in favour of the
base. So each `costItemId` resolves to exactly one entry.

Downstream, unchanged in intent, now fed the merged result:

- **`deriveGoodsCost`** — runs on the merged, deduped recipe + always-included
  items. Cost per drink is identical to today's, just sourced from
  category + drink. Grams never scale cost.
- **`resolveRecipeStrings`** (staff prep sheet) — renders the merged result.
- **Always-included items** (packaging) — keep applying on top, as now.

## UI

### Shared recipe builder

Extract the recipe-builder block currently inline in `product-form.tsx`
(ingredient picker chips, ordered step list with grams, drag-to-reorder,
free-text steps, live cost) into `components/admin/recipe-builder.tsx`, so both
the category editor and the product form use one component. Any fix lands in
both; no copy-paste.

### Category editor (`components/admin/category-manager.tsx`)

Add a **Recipe** section per category using the shared builder. It edits
`categories.recipe` and shows a live "base cost" figure. Saving writes the
recipe replace-all, mirroring the existing `setCategoryAddons` pattern.

### Product form (`components/admin/product-form.tsx`)

The Recipe panel shows two zones:

- **From category (inherited)** — the base ingredients/steps, not editable
  inline. Each inherited ingredient carries two controls:
  - **Exclude** toggle → writes/removes an `exclude` entry on `products.recipe`.
  - **Grams override** input (blank = inherit) → writes/removes an `override`
    entry.
- **This drink only** — the existing builder, for drink-specific additions.
  Ticking an ingredient already in the base auto-resolves to the inherited one
  (dedupe) instead of adding a duplicate.

Live "Goods cost per drink" and the step preview compute from `mergeRecipe`, so
what's shown is the true cost/recipe.

## Cost/Profit Report Impact

`getProductCosts` (`lib/menu/cost.ts`) — used at checkout to snapshot
`order_items.unit_cost`, and by reports for gross/nett profit — switches from
reading only `products.recipe` to reading **category base + product recipe,
merged**. It already loads `cost_items`; it now also selects
`products.category_id` and the categories' `recipe`.

- **Past orders are untouched** — they keep their snapshotted `unit_cost`.
- Only future orders and the live product form reflect merged cost.
- Gross/nett profit math is unchanged.

## Security / RLS

`categories.recipe` is a new column on an existing table. Category catalog data
is already publicly readable, but the **recipe/cost detail is internal**. Follow
the existing `cost_items` posture: the merged cost is only ever computed
server-side, and `getProductCosts` already uses an admin/service-role client
when the caller isn't an admin (e.g. at checkout). No cost figure is exposed to
the client that isn't already. Storefront category reads don't need `recipe`, so
public selects continue to omit it.

## Scope Guardrails (YAGNI)

- No new cost-item concepts — categories reuse `cost_items`.
- No migration rewriting existing drinks — dedupe self-cleans on re-save.
- Legacy recipe columns stay untouched.
- No storefront-facing change — this is admin cost/recipe only.

## Files Touched

- `supabase/migrations/<new>_category_recipe.sql` — add `categories.recipe`.
- `lib/menu/recipe.ts` — new `exclude`/`override` entry kinds; `mergeRecipe`.
- `lib/menu/cost.ts` — `getProductCosts` merges category + product recipe.
- `lib/menu/types.ts` — `AdminCategory`/detail carries `recipe`; product detail
  unchanged in shape (overrides ride in existing `recipe`).
- `lib/menu/admin.ts` — load `categories.recipe`; expose for editor + form.
- `components/admin/recipe-builder.tsx` — extracted shared builder (new).
- `components/admin/product-form.tsx` — use shared builder; add inherited zone.
- `components/admin/category-manager.tsx` — add Recipe section.
- `app/(admin)/admin/categories/actions.ts` — `saveCategoryRecipe` action.
- `scripts/check-recipe.mjs` — extend with `mergeRecipe` cases.

## Verification

- `npm run build` (EXIT 0).
- `npx eslint` on changed files.
- `node scripts/check-recipe.mjs` — pure merge/dedupe/override/cost cases.
- Manual: set a matcha category base (milk+matcha); confirm a new matcha shows
  the cost with zero per-drink setup; confirm exclude + grams override work;
  confirm a drink that already had milk ticked stops double-counting.
