# Unified Recipe & Prep Steps — Design

**Date:** 2026-07-01
**Surface:** Admin item form (`/admin/menu/[id]`), Cost Goods (`/admin/costs`), staff prep sheet (`/manage`).

## Problem

The item form has two disconnected panels:

- **Recipe & cost** — tick cost items (Milk, Coffee…) + grams, computes goods cost. Stored in `product_recipe_items` (costItemId + grams, ordered by `sort_order` but treated as an unordered tick list). Grams are staff guidance only; cost is the cost item's flat price.
- **Prep steps** — a separate ordered free-text list stored in `products.recipe_steps text[]`, shown to staff as a numbered recipe sheet on the drink row.

Ticking an ingredient does nothing to the prep steps. The user wants ticking an ingredient to **auto-generate an ordered, reorderable prep step** with sensible wording (grams filled in), interleaved with free-text steps, so the recipe and the prep sheet are one thing.

## Decisions (from brainstorming)

1. **Step wording lives on the cost item** — a `prep_template` authored once in Cost Goods, reused by every drink, with grams auto-filled. Not literally hardcoded in source, so wording can be tuned without a code change.
2. **Merge into one Recipe panel** — ticking an ingredient adds cost AND drops a reorderable step; free-text steps interleave in the same list; the cost total stays visible.
3. **Generated steps are editable and linked** — an untouched generated step re-renders from its template when grams change; once hand-edited it freezes as custom text and the template no longer overwrites it; unticking the ingredient removes its step.
4. **Grams entered inline** in the step row (not beside the checkbox).
5. **Storage: one ordered `recipe` JSONB list** on `products` (chosen over keeping two tables). Cost is a pure function of the `ingredient` entries in this list.
6. **Reorder: hand-rolled** pointer drag + up/down arrows (no new library like dnd-kit), consistent with the existing pointer-drag in `drink-row.tsx`.

### Cost model clarification

A cost item's `price` is a **flat cost per tick**, already representing the standard portion (e.g. syrup = 2 pumps ≈ 15g at one fixed price). Grams are display/guidance only and never scale cost. Each ingredient is ticked once per drink; the grams on that step capture the portion for staff. Cost math is unchanged from today: sum of ticked ingredients' flat prices + always-included items. Duplicate ingredient entries are a non-goal — the list model doesn't police it because you only tick once.

## Data model

New column on `products`:

```
recipe jsonb  -- nullable, default null; ordered list of steps
```

Entry shapes (order = array position):

```jsonc
// Ingredient-linked step
{ "kind": "ingredient", "costItemId": "uuid", "grams": 150, "text": null, "custom": false }
// Free-text step
{ "kind": "free", "text": "Add ice to the cup" }
```

Field rules:

- `kind: "ingredient"`:
  - `costItemId` — the cost item; drives cost lookup and (when not custom) the rendered wording.
  - `grams` — integer or null; fills `{g}` in the template; display only.
  - `custom: false` → render from the cost item's `prep_template` with grams filled.
  - `custom: true` + `text` → show `text` verbatim; template no longer overwrites (frozen after hand-edit).
- `kind: "free"`:
  - `text` — plain free-text step.

New column on `cost_items`:

```
prep_template text  -- nullable; short instruction with a {g} placeholder for grams
```

Examples: `Steam {g}g milk`, `Grind {g}g coffee, pull 2 shots espresso`, `Whisk {g}g matcha with 40ml water`.

Rendering a template: replace `{g}g` (and bare `{g}`) with the grams value. If grams is empty/null, remove the placeholder token cleanly so no stray `{g}` shows. If a cost item has no `prep_template`, ticking it still adds cost and creates an ingredient step, but the step starts as blank editable text (staff type their own; effectively behaves like a custom step from creation).

**Cost** is derived by scanning `recipe` for `kind: "ingredient"` entries, summing each `costItemId`'s price, plus all always-included cost items. No separate table read.

## Item form — merged Recipe panel

Replaces the two panels ("Recipe & cost" + "Prep steps") in `components/admin/product-form.tsx` with one **Recipe** panel, top to bottom:

1. **Ingredient picker (compact).** Tappable chips/checkboxes for each optional cost item — tap to add, tap again to remove; ticked show a check. On/off only; holds no grams. Always-included items shown as a small locked "in every cup" note (not in the step list — automatic and unordered).
2. **Step list.** Ordered list mixing both kinds. Each row:
   - Drag handle (⠿) + up/down arrows for touch/keyboard reorder.
   - Auto step number (1..n by position), renumbering live.
   - Body:
     - Ingredient step → rendered template as an editable input, **grams inline** (e.g. `Steam [150]g milk`). Editing grams re-renders an untouched step; editing the text freezes it (`custom: true`). A small "linked to <ingredient>" tag + reset-to-template affordance for frozen steps.
     - Free step → plain text input.
   - Remove control (untick ingredient / delete free step).
3. **Add free step** button — appends a `kind: "free"` blank at the end.
4. **Cost total** — the existing dark "Goods cost per drink" bar stays pinned, recomputed live from ticked ingredients + always-included.

Interaction: a newly ticked ingredient drops its step at the **bottom** of the list; drag to reposition. Reordering is immediate and animated. Build-time polish via ui-ux-pro-max / frontend-design skills, matching existing card/token styling.

## Staff-side rendering

- `manage/[token]/page.tsx` builds `recipeMap: Map<string, string[]>` — keep the shape, change how it's built: resolve each product's `recipe` JSONB against cost-item `prep_template`s server-side into an ordered `string[]` (ingredient steps rendered with grams; custom steps use frozen text; free steps use text).
- `components/drink-row.tsx` recipe sheet — **no change** (still consumes `string[]`).
- `lib/menu/cost.ts` `getProductCosts` — switch from reading `product_recipe_items` to scanning the `recipe` JSONB for `ingredient` entries. Same return shape (`Map<productId, sen>`); checkout and downstream untouched.

## Types

- `lib/menu/types.ts`: add a `RecipeEntry` union type. Replace the split `recipeSteps: string[]` + `recipeItems: RecipeItem[]` on `AdminProductDetail` and `ProductFormData` with the ordered `recipe: RecipeEntry[]`. Add `prepTemplate` to `AdminCostItem`.
- `types/database.ts`: regenerate for the new columns.

## Save path

`saveProduct` (`app/(admin)/admin/menu/actions.ts`):

- Validate `recipe` entries: grams integer ≥ 0 or null; `ingredient` entries reference a valid cost item; `free`/custom text trimmed.
- Write the ordered `recipe` JSONB to `products.recipe` (null if empty after trimming).
- Stop writing `product_recipe_items` and `recipe_steps` (left intact in DB for one release; see migration).

`saveCostItems` (`app/(admin)/admin/costs/actions.ts`) + `cost-manager.tsx`: add the `prep_template` input per row and persist it.

## Migration & rollout

Additive migration in `supabase/migrations/`:

1. `alter table cost_items add column prep_template text` (nullable).
2. `alter table products add column recipe jsonb default null`.
3. **Backfill** `products.recipe` per product: existing `product_recipe_items` (ordered by `sort_order`) → `kind: "ingredient"` entries (`custom: false`, grams from `amount_grams`); then existing `recipe_steps` free-text appended as `kind: "free"` entries. Ingredient-first, free-text after; reorder later in the UI.
4. **Seed** `prep_template` for the known seeded cost items (Milk, Coffee, etc.) with sensible defaults so existing drinks render real instructions immediately.
5. **Keep** `product_recipe_items` and `recipe_steps` in place (do not drop) — new code stops reading them; leaving them one release avoids a destructive irreversible step. A later cleanup migration drops them once verified.

**Reversibility:** additive columns + backfill; rolling back code is safe because old columns still hold original data.

## Non-goals

- Dropping the legacy `product_recipe_items` / `recipe_steps` columns now (deferred to a later cleanup migration).
- Scaling cost by grams (cost stays flat per tick).
- Policing duplicate ingredient entries.
- A new drag-and-drop library.
