# Recipe Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drink recipes to the CMS (product form) and show them on the `/manage/{token}` page via an (i) info icon on each drink row.

**Architecture:** `products.recipe_steps text[]` is the single source of truth, editable in the admin product form. `order_items.product_id` links order items back to products so the manage page can do a live recipe lookup. The (i) icon on `DrinkRow` opens a shadcn/ui Sheet with the numbered recipe steps.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui (Sheet), Supabase (Postgres + RLS), Lucide React icons.

## Global Constraints

- Use Postgres via Supabase; schema changes go through migrations
- Money in sen (integer); not relevant here but don't change the convention
- Use `cn()` from `lib/utils` for conditional class merging
- Use Tailwind utility classes; avoid CSS modules
- `"use client"` only when needed for interactivity/state/browser APIs
- No new libraries without approval
- RLS already covers `products` and `order_items` — no new policies needed

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_recipe.sql`

**Interfaces:**
- Produces: `products.recipe_steps text[]` (nullable), `order_items.product_id uuid` (nullable FK to products)

- [ ] **Step 1: Write the migration**

```sql
-- Add recipe steps column to products table (CMS source of truth)
alter table public.products
  add column if not exists recipe_steps text[] default null;

-- Link order items back to menu products for live recipe lookup
alter table public.order_items
  add column if not exists product_id uuid references public.products (id) on delete set null;

-- Index for the FK (used when looking up recipes from order items)
create index if not exists order_items_product_id_idx on public.order_items (product_id);
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`
Or via MCP: apply_migration with name `add_recipe_steps_and_order_item_product_id`

- [ ] **Step 3: Verify the migration applied**

Run: `npx supabase db diff --schema public`
Expected: migration appears in the diff, no unexpected changes

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/YYYYMMDDHHMMSS_recipe.sql
git commit -m "feat(db): add recipe_steps to products and product_id to order_items"
```

---

### Task 2: Update Admin Menu Types

**Files:**
- Modify: `lib/menu/types.ts`

**Interfaces:**
- Produces: `recipeSteps` on `AdminProduct`, `AdminProductDetail`, `ProductFormData`
- Consumes: nothing (types only)

- [ ] **Step 1: Add `recipeSteps` to the three types**

In `lib/menu/types.ts`, add `recipeSteps` to `AdminProduct`:

```ts
export type AdminProduct = {
  // ... existing fields ...
  isArchived: boolean;
  sortOrder: number;
  recipeSteps: string[] | null;  // <-- add this
};
```

Add to `AdminProductDetail`:

```ts
export type AdminProductDetail = AdminProduct & {
  // ... existing fields ...
  addonOverrides: { addonId: string; mode: "add" | "remove" }[];
  recipeSteps: string[] | null;  // <-- add this
};
```

Add to `ProductFormData`:

```ts
export type ProductFormData = {
  // ... existing fields ...
  isAvailable: boolean;
  addonOverrides: { addonId: string; mode: "add" | "remove" }[];
  recipeSteps: string[];  // <-- add this (array, not nullable — form always sends array)
};
```

- [ ] **Step 2: Verify no type errors**

Run: `npx tsc --noEmit`
Expected: Zero type errors

- [ ] **Step 3: Commit**

```bash
git add lib/menu/types.ts
git commit -m "feat(types): add recipeSteps to admin menu types"
```

---

### Task 3: Update Admin Menu Query to Include recipe_steps

**Files:**
- Modify: `lib/menu/admin.ts`

**Interfaces:**
- Consumes: `AdminProduct.recipeSteps`, `AdminProductDetail.recipeSteps` from Task 2
- Produces: `listAdminProducts()`, `getAdminProduct()` return objects with `recipeSteps`

- [ ] **Step 1: Include `recipe_steps` in `listAdminProducts`**

In `lib/menu/admin.ts`, in the `listAdminProducts` function, add to the return object:

```ts
return (products.data ?? []).map((p) => {
  const vs = (variants.data ?? []).filter((v) => v.product_id === p.id);
  const fromPrice =
    vs.length > 0 ? Math.min(...vs.map((v) => v.price)) : p.base_price ?? 0;
  return {
    // ... existing fields ...
    isArchived: p.is_archived,
    sortOrder: p.sort_order,
    recipeSteps: p.recipe_steps ?? null,  // <-- add this
  };
});
```

- [ ] **Step 2: Include `recipe_steps` in `getAdminProduct`**

In the `getAdminProduct` function, add to the return object:

```ts
return {
  // ... existing fields ...
  addonOverrides: (overrides.data ?? []).map((o) => ({
    addonId: o.addon_id,
    mode: o.mode as "add" | "remove",
  })),
  recipeSteps: p.recipe_steps ?? null,  // <-- add this
};
```

- [ ] **Step 3: Verify types**

Run: `npx tsc --noEmit`
Expected: Zero type errors

- [ ] **Step 4: Commit**

```bash
git add lib/menu/admin.ts
git commit -m "feat(admin): include recipe_steps in menu queries"
```

---

### Task 4: Handle recipeSteps in Save Product Server Action

**Files:**
- Modify: `app/(admin)/admin/menu/actions.ts`

**Interfaces:**
- Consumes: `ProductFormData.recipeSteps` from Task 2
- Produces: `saveProduct` persists `recipe_steps` to DB

- [ ] **Step 1: Extract and persist recipe steps in `saveProduct`**

In `saveProduct`, add to the `payload` object after the `is_available` line:

```ts
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
  recipe_steps: data.recipeSteps?.filter(s => s.trim()).length
    ? data.recipeSteps.filter(s => s.trim())
    : null,  // <-- add this
};
```

This filters out empty strings and stores `null` when there are no steps (consistent with the spec: null = no recipe).

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: Zero type errors

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/menu/actions.ts"
git commit -m "feat(admin): persist recipe_steps in saveProduct server action"
```

---

### Task 5: Add Recipe Panel to Product Form

**Files:**
- Modify: `components/admin/product-form.tsx`

**Interfaces:**
- Consumes: `AdminProductDetail.recipeSteps` (from product prop), `ProductFormData.recipeSteps` (in submit)
- Produces: Recipe editing UI in the product form

- [ ] **Step 1: Add recipe state and wire it to the product prop**

In `ProductForm`, after the `isAvailable` state line (line 64), add:

```tsx
const [recipeSteps, setRecipeSteps] = useState<string[]>(
  product?.recipeSteps ?? [],
);
```

- [ ] **Step 2: Add a step to the submit function**

In the `submit` function, add `recipeSteps` to the data object. After `isAvailable: isAvailable`:

```tsx
recipeSteps,
```

- [ ] **Step 3: Add the Recipe panel UI**

Add the Recipe panel between the Pricing panel and the Add-ons panel. Insert this JSX after the Pricing panel's closing `</Panel>` (around line 255 of the current file):

```tsx
<Panel title="Recipe" hint={`${recipeSteps.length} step${recipeSteps.length === 1 ? "" : "s"}`}>
  {recipeSteps.length === 0 ? (
    <p className="text-sm text-muted-foreground">
      No steps yet. Add preparation instructions for staff.
    </p>
  ) : (
    <div className="flex flex-col gap-2">
      {recipeSteps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground tabular-nums">
            {i + 1}
          </span>
          <Input
            value={step}
            onChange={(e) =>
              setRecipeSteps((prev) =>
                prev.map((s, j) => (j === i ? e.target.value : s)),
              )
            }
            placeholder={`Step ${i + 1}`}
            className="flex-1"
          />
          <button
            type="button"
            onClick={() =>
              setRecipeSteps((prev) => prev.filter((_, j) => j !== i))
            }
            aria-label={`Remove step ${i + 1}`}
            className="rounded-sm p-1 text-muted-foreground outline-none transition-colors hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
    </div>
  )}
  <button
    type="button"
    onClick={() => setRecipeSteps((prev) => [...prev, ""])}
    className="flex w-fit items-center gap-1 rounded-sm text-xs font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
  >
    <Plus className="size-4" /> Add step
  </button>
</Panel>
```

Note: `Trash2`, `Plus`, and `Input` are already imported in the file.

- [ ] **Step 4: Verify types and build**

Run: `npx tsc --noEmit`
Expected: Zero type errors

- [ ] **Step 5: Commit**

```bash
git add components/admin/product-form.tsx
git commit -m "feat(admin): add recipe editing panel to product form"
```

---

### Task 6: Add productId to OrderLine Type

**Files:**
- Modify: `types/order.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `OrderLine.productId`

- [ ] **Step 1: Add `productId` to `OrderLine`**

In `types/order.ts`, in the `OrderLine` type, add after the `isCustom` field:

```ts
export type OrderLine = {
  name: string;
  quantity: number;
  sizeName?: string;
  addonNames: string[];
  unitPrice: number;
  lineTotal: number;
  status: ItemStatus;
  isReward?: boolean;
  rewardCost?: number;
  isCustom?: boolean;
  productId?: string | null;  // <-- add this — links to products table for recipe lookup
};
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: Zero type errors (new field is optional, no existing code breaks)

- [ ] **Step 3: Commit**

```bash
git add types/order.ts
git commit -m "feat(types): add productId to OrderLine"
```

---

### Task 7: Map product_id in Order Mapper

**Files:**
- Modify: `lib/orders/mappers.ts`

**Interfaces:**
- Consumes: `OrderItemRow.product_id` (from regenerated Supabase types after migration)
- Produces: `OrderLine.productId`

Note: After Task 1's migration, regenerate Supabase types with `npx supabase gen types typescript --local > types/database.ts` (or the project's equivalent) so `OrderItemRow` includes `product_id`.

- [ ] **Step 1: Map `product_id` in `rowToOrderLine`**

In `lib/orders/mappers.ts`, in `rowToOrderLine`, add `productId` to the return object:

```ts
export function rowToOrderLine(item: OrderItemRow): OrderLine {
  return {
    name: item.name,
    quantity: item.quantity,
    sizeName: item.size_name ?? undefined,
    addonNames: item.addon_names ?? [],
    unitPrice: item.unit_price,
    lineTotal: item.line_total,
    status: item.status,
    isCustom: item.is_custom,
    productId: item.product_id ?? undefined,  // <-- add this
  };
}
```

- [ ] **Step 2: Verify types**

Run: `npx tsc --noEmit`
Expected: Zero type errors

- [ ] **Step 3: Commit**

```bash
git add lib/orders/mappers.ts
git commit -m "feat(orders): map product_id from order items to OrderLine"
```

---

### Task 8: Store product_id at Order Creation

**Files:**
- Modify: `lib/orders/store.ts`
- Modify: `app/(customer)/checkout/actions.ts` (pass productId in OrderLine)
- Modify: `app/(store)/store/(kiosk)/actions.ts` (pass productId in OrderLine)
- Modify: `app/(customer)/custom-order/actions.ts` (custom drinks — no change needed but verify)

**Interfaces:**
- Consumes: `OrderLine.productId` from Task 6
- Produces: `createOrder` writes `product_id` to `order_items`

- [ ] **Step 1: Include `product_id` in `createOrder` inserts**

In `lib/orders/store.ts`, in `createOrder`, add `product_id` to the `itemsPayload`:

```ts
const itemsPayload = draft.items.map((item, position) => ({
  order_id: orderRow.id,
  position,
  name: item.name,
  quantity: item.quantity,
  size_name: item.sizeName ?? null,
  addon_names: item.addonNames,
  unit_price: item.unitPrice,
  line_total: item.lineTotal,
  status: item.status,
  is_reward: item.isReward ?? false,
  reward_cost: item.rewardCost ?? 0,
  is_custom: item.isCustom ?? false,
  product_id: item.productId ?? null,  // <-- add this
}));
```

- [ ] **Step 2: Pass `productId` in checkout `placeOrder`**

In `app/(customer)/checkout/actions.ts`, in the `lines` mapping (around line 127), add `productId`:

```ts
const lines: OrderLine[] = input.items.map((item) => ({
  name: item.name,
  quantity: item.quantity,
  sizeName: item.sizeName,
  addonNames: item.addonNames,
  unitPrice: item.unitPrice,
  lineTotal: item.unitPrice * item.quantity,
  status: "pending",
  isReward: item.isReward,
  rewardCost: item.rewardCost,
  productId: item.productId,  // <-- add this
}));
```

- [ ] **Step 3: Pass `productId` in kiosk actions**

In `app/(store)/store/(kiosk)/actions.ts`, in the `OrderLine` mapping, add:

```ts
productId: item.productId,  // <-- add this to the OrderLine object
```

- [ ] **Step 4: Verify custom orders are covered**

Custom orders set `isCustom: true` and do NOT set `productId` — the field is undefined, which maps to `null` in the DB. No change needed, but verify by reading the file.

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit`
Expected: Zero type errors

- [ ] **Step 6: Commit**

```bash
git add lib/orders/store.ts "app/(customer)/checkout/actions.ts" "app/(store)/store/(kiosk)/actions.ts"
git commit -m "feat(orders): store product_id on order items at creation"
```

---

### Task 9: Pass Recipe Map from Manage Page to DrinkRow

**Files:**
- Modify: `app/(admin)/manage/[token]/page.tsx`
- Modify: `components/order-detail.tsx`
- Modify: `components/drink-row.tsx`

**Interfaces:**
- Consumes: `OrderLine.productId` from Task 6 (order items now carry productId)
- Produces: `DrinkRow` receives `recipeSteps` prop, shows (i) icon + Sheet

- [ ] **Step 1: Fetch product recipes on the manage page**

In `app/(admin)/manage/[token]/page.tsx`, after fetching the order and before returning JSX, add:

```tsx
import { createAdminClient } from "@/lib/supabase/admin";

// ... inside the component, after the order check ...

// Collect unique product IDs from non-custom order items
const productIds = [...new Set(
  order.items
    .filter((item) => item.productId)
    .map((item) => item.productId!)
)];

// Fetch recipe_steps for those products
const recipeMap = new Map<string, string[]>();
if (productIds.length > 0) {
  const db = createAdminClient();
  const { data: prods } = await db
    .from("products")
    .select("id, recipe_steps")
    .in("id", productIds);
  for (const p of prods ?? []) {
    if (p.recipe_steps?.length) {
      recipeMap.set(p.id, p.recipe_steps);
    }
  }
}
```

Then pass `recipeMap` to `OrderDetail`:

```tsx
return <OrderDetail order={order} recipeMap={recipeMap} />;
```

- [ ] **Step 2: Accept recipeMap in OrderDetail**

In `components/order-detail.tsx`, add the prop to the component signature (after `backHref`):

```tsx
export function OrderDetail({
  order,
  persist = true,
  backHref = "/manage",
  recipeMap,  // <-- add
}: {
  order: Order;
  persist?: boolean;
  backHref?: string;
  recipeMap?: Map<string, string[]>;  // <-- add
}) {
```

Then pass individual recipes to `DrinkRow`. In the JSX where `DrinkRow` is rendered (around line 254), add:

```tsx
<DrinkRow
  key={`${item.name}-${i}`}
  item={item}
  status={statuses[i]}
  onAdvance={() => advanceDrink(i)}
  recipeSteps={item.productId ? recipeMap?.get(item.productId) ?? null : null}
/>
```

- [ ] **Step 3: Add recipeSteps prop and (i) icon to DrinkRow**

In `components/drink-row.tsx`:

First, add the `Info` import at the top:

```tsx
import { Check, ChevronLeft, ChevronRight, Info } from "lucide-react";
```

Add the `Sheet` import:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
```

Add `useState` import (add to existing React import):

```tsx
import { useRef, useState } from "react";
```

Add `recipeSteps` to the props destructuring:

```tsx
export function DrinkRow({
  item,
  status,
  onAdvance,
  recipeSteps,  // <-- add
}: {
  item: OrderLine;
  status: DrinkStatus;
  onAdvance: () => void;
  recipeSteps?: string[] | null;  // <-- add
}) {
```

Add sheet state at the top of the component body:

```tsx
const [showRecipe, setShowRecipe] = useState(false);
```

Add the (i) icon button in the drink row, between the name/details column and the advance button. In the JSX, find the advance button div (around line 143) and insert the (i) button BEFORE it:

```tsx
<div className="flex shrink-0 items-center gap-2">
  {recipeSteps && recipeSteps.length > 0 && (
    <>
      <button
        type="button"
        onClick={() => setShowRecipe(true)}
        aria-label={`Recipe for ${item.name}`}
        className="flex size-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Info className="size-3.5" strokeWidth={2.5} />
      </button>
      <Sheet open={showRecipe} onOpenChange={setShowRecipe}>
        <SheetContent side="bottom" className="max-h-[60vh] overflow-y-auto rounded-t-3xl px-5 pb-8 pt-6">
          <SheetHeader className="mb-4 text-left">
            <SheetTitle className="font-heading text-lg font-bold">
              {item.name}
            </SheetTitle>
          </SheetHeader>
          <ol className="flex flex-col gap-3">
            {recipeSteps.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
        </SheetContent>
      </Sheet>
    </>
  )}
  {canAdvance ? (
    <button ...>
      ...
```

- [ ] **Step 4: Verify types**

Run: `npx tsc --noEmit`
Expected: Zero type errors

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/manage/[token]/page.tsx" components/order-detail.tsx components/drink-row.tsx
git commit -m "feat(manage): show recipe (i) icon on drink rows with sheet"
```

---

### Task 10: End-to-End Verification

**Files:**
- No files created/modified — manual verification

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Test CMS — add recipe to a product**

1. Sign in as admin
2. Go to `/admin/menu`
3. Click on an existing product (or create new)
4. Verify the "Recipe" panel appears between Pricing and Add-ons
5. Add a few steps: "Step 1", "Step 2", "Step 3"
6. Save
7. Re-open the product — verify steps are persisted

- [ ] **Step 3: Test CMS — remove recipe**

1. Open a product with recipe steps
2. Delete all steps
3. Save
4. Re-open — verify no steps shown, panel shows empty state

- [ ] **Step 4: Test manage page — recipe appears on drink row**

1. Create an order through the storefront (or use existing)
2. As staff/admin, go to `/manage/{token}`
3. Verify (i) icon appears on drink rows for menu products with recipes
4. Tap (i) — verify Sheet opens with numbered steps
5. Dismiss sheet — verify it closes

- [ ] **Step 5: Test manage page — no recipe**

1. Create a custom order (no recipe)
2. Go to `/manage/{token}`
3. Verify NO (i) icon on custom drink rows

- [ ] **Step 6: Test — CMS edit updates live on manage page**

1. Open a product in CMS, change a recipe step
2. Save
3. Open the manage page for an order containing that product
4. Verify the updated recipe is shown

- [ ] **Step 7: Run full type check**

Run: `npx tsc --noEmit`
Expected: Zero type errors

- [ ] **Step 8: Commit if any final adjustments were needed**
