# Recipe Feature — Design Spec

**Date:** 2026-06-23
**Status:** Approved

---

## Overview

Add drink recipes to the CMS so admins can define and update preparation instructions. Staff see the **current live recipe** on the `/manage/{token}` page via an (i) icon on each drink row. The CMS is the single source of truth — when an admin adjusts a recipe, staff see the updated version immediately.

---

## Scope

**In scope:**
- `recipe_steps` column on `products` table (CMS source of truth)
- `product_id` column on `order_items` table (link item → live product)
- Recipe editing panel in the admin product form (new/edit)
- (i) icon on drink rows in `/manage/{token}` — primary display surface
- Types updated: `AdminProduct`, `AdminProductDetail`, `ProductFormData`, `OrderLine`, order mappers

**Out of scope:**
- Customer-facing recipe display
- Ingredient inventory tracking
- Structured ingredient fields (quantity, unit, notes) — free-text steps are sufficient

---

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  CMS (admin) │     │   DB (source)    │     │  Manage (staff) │
│              │     │                  │     │                 │
│ ProductForm  │────▶│ products         │◀────│ /manage/[token] │
│ Recipe panel │     │ .recipe_steps    │     │ DrinkRow (i)    │
│              │     │                  │     │                 │
│              │     │ order_items      │     │ Reads LIVE      │
│              │     │ .product_id ─────┼─────│ recipe from     │
│              │     │                  │     │ product         │
└──────────────┘     └──────────────────┘     └─────────────────┘
```

The CMS writes recipes. The manage page reads the current recipe by joining through `product_id`. No snapshot — always live.

---

## Database

### Migration

```sql
-- Step 1: recipe on products (CMS source of truth)
alter table public.products
  add column recipe_steps text[] default null;

-- Step 2: link order items back to product for recipe lookup
alter table public.order_items
  add column product_id uuid references public.products (id) on delete set null;
```

- `products.recipe_steps`: `null` = no recipe, empty array = no recipe, populated = has recipe
- `order_items.product_id`: nullable FK. `null` for custom drinks (no product), set for menu items

### RLS

The `products` table read policies already cover the new column — no changes needed.

`order_items.product_id` is writeable on insert only. The existing insert policies cover it. A `select` policy lets staff read it (already in the `order_items_select_own_or_staff` policy — any order item column is readable). The field is set at order creation and never updated.

---

## CMS: Product Form

### Location

New **"Recipe"** panel in `ProductForm`, placed between the Pricing panel and the Add-ons panel.

### Behavior

- Follows the same list-editing pattern as the Sizes variant list
- Each row is a text input (one step)
- "Add step" button appends an empty row
- Trash icon button per row removes it
- If all rows are empty after trimming, no recipe is saved (null)

### Server Action

`saveProduct` in `app/(admin)/admin/menu/actions.ts`:

- Add `recipe_steps` to the upsert payload:
  ```ts
  recipe_steps: data.recipeSteps?.length ? data.recipeSteps.filter(s => s.trim()) : null
  ```

### Types

`ProductFormData` gains `recipeSteps: string[]`

`AdminProductDetail` gains `recipeSteps: string[] | null`

`AdminProduct` gains `recipeSteps: string[] | null`

---

## Manage Page: DrinkRow

### Link from Order Item to Product

At order creation (`createOrder` in `lib/orders/store.ts`), `product_id` is now stored on each `order_items` row:
- Cart already carries `productId` per line
- Custom drinks: `productId` is `null` → stored as `null`
- Menu products: `productId` is the product UUID

### Fetching Recipes on the Manage Page

`getOrderByToken` (or a new helper) fetches the product recipes for all items in the order. The approach:

Option: In the manage page server component, after fetching the order, query `products` for the `product_id`s present in the order items, selecting `id` and `recipe_steps`. Pass the recipe map down to `DrinkRow`.

### (i) Icon on DrinkRow

Each `DrinkRow` receives `recipeSteps: string[] | null` as a prop. If non-null/non-empty:

- A small (i) icon button appears between the drink name/details and the advance button
- Tapping it opens a `Sheet` with numbered recipe steps
- Title: drink name

```
┌──────────────────────────────────────────┐
│  [1]  Strawberry Yoghurt          (i) > │
│       Regular, Less Sugar               │
│       ● Making                          │
└──────────────────────────────────────────┘
```

### Types

`OrderLine` gains:
```ts
productId?: string | null;
```

The order mapper (`rowToOrderLine`) maps `item.product_id` → `productId`. The Cart's `productId` flows through to `order_items.product_id` at creation. Custom drinks store `null`.

`recipeSteps` is NOT stored on `OrderLine` — it lives on the `products` table only. The manage page fetches it separately and passes it as a prop.

### Manage Page Data Flow

In `app/(admin)/manage/[token]/page.tsx`:
1. Fetch order via `getOrderByToken(token)`
2. Collect unique non-null `productId`s from order items
3. Fetch those products' `id` and `recipe_steps` columns
4. Build a `Map<string, string[]>` (productId → recipeSteps)
5. Pass the map to `OrderDetail` → each `DrinkRow` receives its recipe

`DrinkRow` gets a new optional prop:
```tsx
recipeSteps?: string[] | null;
```

---

## Files to Change

| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDDHHMMSS_recipe.sql` | New migration: `products.recipe_steps` + `order_items.product_id` |
| `lib/menu/types.ts` | Add `recipeSteps` to `AdminProduct`, `AdminProductDetail`, `ProductFormData` |
| `lib/menu/admin.ts` | Include `recipe_steps` in admin queries (for product form) |
| `app/(admin)/admin/menu/actions.ts` | Handle `recipeSteps` in `saveProduct` |
| `components/admin/product-form.tsx` | Add Recipe panel |
| `types/order.ts` | Add `productId?` to `OrderLine` |
| `lib/orders/mappers.ts` | Map `product_id` from DB row |
| `lib/orders/store.ts` | Include `product_id` in `createOrder` inserts |
| `store/cart.tsx` | Ensure `productId` flows through checkout |
| `app/(admin)/manage/[token]/page.tsx` | Fetch product recipes, pass recipe map down |
| `components/order-detail.tsx` | Accept and forward recipe map to `DrinkRow` |
| `components/drink-row.tsx` | Add `recipeSteps` prop, (i) icon + recipe sheet |
