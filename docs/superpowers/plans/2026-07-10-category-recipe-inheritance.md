# Category Recipe Inheritance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins define a shared recipe base per category (e.g. matcha = milk + matcha) that every drink in that category inherits for both goods cost and staff prep, with per-drink exclude/grams-override and automatic dedupe.

**Architecture:** Add a `categories.recipe` JSONB column holding the same `RecipeEntry[]` shape products already use. A new pure `mergeRecipe(categoryRecipe, productRecipe)` helper resolves base + drink entries (with `exclude`/`override` drink kinds and dedupe) into one ordered list. Every consumer that reads `products.recipe` today (`getProductCosts`, the staff prep sheet, the product form's live cost) instead reads the merged result. The recipe-builder UI is extracted into a shared component used by both the product form and the category editor.

**Tech Stack:** Next.js (App Router), TypeScript (strict, no `any`), Supabase (Postgres + RLS), Tailwind, shadcn/ui. No new libraries.

## Global Constraints

- Money is stored as integers in sen. RM↔sen: `Math.round(rm * 100)` / `sen / 100`.
- Grams are staff guidance only and NEVER scale cost.
- TypeScript strict mode; no `any`.
- No JS test framework in this repo. The recipe logic is verified by `node scripts/check-recipe.mjs` (plain Node asserts, imports `.ts` directly). Extend it — do not add a test runner.
- `npm run build` must exit 0 before any push (real type-check gate).
- Lint changed files only: `npx eslint <path>`.
- Schema changes ship as a new migration in `supabase/migrations/`; never edit existing migrations.
- Admin server actions must call `isAdmin()` and return `{ ok: false, error }` when not authorized.
- `cost_items` is admin-only under RLS; cost is computed server-side. When the caller may not be an admin (checkout), pass the service-role client (`createAdminClient()`), which existing callers already do.
- Work on the `development` branch; commit frequently. Do not open a PR (that's a separate deploy step).

---

### Task 1: Add `mergeRecipe` and override entry kinds to recipe.ts

**Files:**
- Modify: `lib/menu/recipe.ts`
- Test: `scripts/check-recipe.mjs`

**Interfaces:**
- Consumes: existing `RecipeEntry` (`ingredient | free`), `deriveGoodsCost`, `resolveRecipeStrings`.
- Produces:
  - Extended `RecipeEntry` union adding
    `{ kind: "exclude"; costItemId: string }` and
    `{ kind: "override"; costItemId: string; grams: number }`.
  - `mergeRecipe(categoryRecipe: RecipeEntry[] | null, productRecipe: RecipeEntry[] | null): RecipeEntry[]`
    — returns an ordered list of ONLY `ingredient` / `free` entries (overrides resolved, excludes dropped, duplicates removed).

- [ ] **Step 1: Write the failing tests** — append to `scripts/check-recipe.mjs` before the final `console.log`:

```js
import {
  fillTemplate,
  renderStep,
  resolveRecipeStrings,
  deriveGoodsCost,
  mergeRecipe,
} from "../lib/menu/recipe.ts";

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
```

Remove the now-duplicate `import` block at the top of the file that only listed the first four helpers (the new import above replaces it).

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/check-recipe.mjs`
Expected: FAIL — `mergeRecipe is not a function` (or import error).

- [ ] **Step 3: Implement `mergeRecipe` and extend the type** in `lib/menu/recipe.ts`.

Extend the union:

```ts
export type RecipeEntry =
  | {
      kind: "ingredient";
      costItemId: string;
      grams: number | null;
      text: string | null;
      custom: boolean;
    }
  | { kind: "free"; text: string }
  | { kind: "exclude"; costItemId: string }
  | { kind: "override"; costItemId: string; grams: number };
```

Add the helper (place it after `deriveGoodsCost`):

```ts
// Resolve a drink's effective recipe from its category base + its own entries.
// Returns an ordered list of ONLY ingredient/free entries (the shape every
// downstream consumer — cost, prep sheet — already understands):
//   1. category base, in order, with per-drink exclude/override applied;
//   2. the drink's own ingredient/free entries appended, in order.
// Dedupe: an own-ingredient whose costItemId is already in the base is dropped
// (the base wins). exclude beats override beats a duplicate own-ingredient.
export function mergeRecipe(
  categoryRecipe: RecipeEntry[] | null,
  productRecipe: RecipeEntry[] | null,
): RecipeEntry[] {
  const own = productRecipe ?? [];
  const excluded = new Set(
    own.flatMap((e) => (e.kind === "exclude" ? [e.costItemId] : [])),
  );
  const overrides = new Map(
    own.flatMap((e) => (e.kind === "override" ? [[e.costItemId, e.grams] as const] : [])),
  );

  const result: RecipeEntry[] = [];
  const baseIds = new Set<string>();
  for (const e of categoryRecipe ?? []) {
    if (e.kind === "ingredient") {
      if (excluded.has(e.costItemId)) continue;
      baseIds.add(e.costItemId);
      const g = overrides.get(e.costItemId);
      result.push(g === undefined ? e : { ...e, grams: g });
    } else if (e.kind === "free") {
      result.push(e);
    }
    // exclude/override on a category recipe are meaningless — skip.
  }

  for (const e of own) {
    if (e.kind === "free") {
      result.push(e);
    } else if (e.kind === "ingredient") {
      if (baseIds.has(e.costItemId)) continue; // dedupe: base wins
      result.push(e);
    }
    // own exclude/override entries are directives, not output.
  }
  return result;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node scripts/check-recipe.mjs`
Expected: PASS — ends with `recipe.ts smoke check passed`.

- [ ] **Step 5: Lint**

Run: `npx eslint lib/menu/recipe.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/menu/recipe.ts scripts/check-recipe.mjs
git commit -m "feat(cost): mergeRecipe helper + exclude/override recipe kinds"
```

---

### Task 2: Migration — add `categories.recipe`

**Files:**
- Create: `supabase/migrations/20260710120000_category_recipe.sql`

**Interfaces:**
- Produces: `public.categories.recipe jsonb default null` (same tagged-entry shape as `products.recipe`).

- [ ] **Step 1: Write the migration**

```sql
-- Category-level recipe base. Every drink in the category inherits these
-- ingredient/prep entries for cost AND staff prep (see lib/menu/recipe.ts
-- mergeRecipe). Same tagged-object shape as products.recipe. Additive: existing
-- rows default to null (no base). RLS unchanged — categories already carry a
-- public read policy; the recipe column is only ever selected server-side for
-- admin/cost paths and is not mapped into the storefront Category type.
alter table public.categories
  add column if not exists recipe jsonb default null;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push` (or the project's usual apply command; if unavailable, apply via the Supabase SQL editor).
Expected: migration applies without error; `categories` now has a `recipe` column.

- [ ] **Step 3: Regenerate DB types**

Run: `npx supabase gen types typescript --linked > types/database.ts` (project's usual command).
Verify `types/database.ts` shows `recipe: Json | null` under `categories` Row/Insert/Update.

- [ ] **Step 4: Verify build still compiles**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710120000_category_recipe.sql types/database.ts
git commit -m "feat(cost): add categories.recipe column"
```

---

### Task 3: Load & save category recipe (data layer)

**Files:**
- Modify: `lib/menu/types.ts:13-21` (`AdminCategory`)
- Modify: `lib/menu/admin.ts:47-66` (`listAdminCategories`)
- Modify: `app/(admin)/admin/categories/actions.ts`

**Interfaces:**
- Consumes: `RecipeEntry`, `mergeRecipe` (Task 1); `isAdmin`, `createClient`, `revalidateAll` (existing).
- Produces:
  - `AdminCategory.recipe: RecipeEntry[]` (empty array when null).
  - `saveCategoryRecipe(categoryId: string, recipe: RecipeEntry[]): Promise<ActionResult>` — validates and writes `categories.recipe` (null when empty), then `revalidateAll()`.

- [ ] **Step 1: Add `recipe` to `AdminCategory`** in `lib/menu/types.ts`:

```ts
export type AdminCategory = {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  maxAddons: number;
  isArchived: boolean;
  addonIds: string[]; // category default add-on set
  recipe: RecipeEntry[]; // category base recipe (empty when none)
};
```

(`RecipeEntry` is already imported/exported at the top of this file.)

- [ ] **Step 2: Map `recipe` in `listAdminCategories`** in `lib/menu/admin.ts` — add to the returned object:

```ts
    addonIds: (links.data ?? [])
      .filter((l) => l.category_id === c.id)
      .map((l) => l.addon_id),
    recipe: ((c.recipe as unknown) as RecipeEntry[] | null) ?? [],
```

(`RecipeEntry` is already imported at the top of `admin.ts`.)

- [ ] **Step 3: Add `saveCategoryRecipe`** to `app/(admin)/admin/categories/actions.ts`. Add the import at top:

```ts
import type { RecipeEntry } from "@/lib/menu/recipe";
```

Then append the action:

```ts
// Replace a category's base recipe. Validates each entry; stores null when the
// list is empty. Mirrors setCategoryAddons' replace-all shape.
export async function saveCategoryRecipe(
  categoryId: string,
  recipe: RecipeEntry[],
): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  for (const entry of recipe) {
    if (entry.kind === "ingredient") {
      if (!entry.costItemId)
        return { ok: false, error: "A recipe ingredient is missing its cost item." };
      if (
        entry.grams != null &&
        (!Number.isInteger(entry.grams) || entry.grams < 0)
      )
        return { ok: false, error: "Recipe amounts must be non-negative whole numbers." };
    } else if (entry.kind !== "free") {
      // Category base carries no exclude/override entries.
      return { ok: false, error: "Invalid recipe step." };
    }
  }
  // Drop blank free steps; keep ingredient steps (they render from a template).
  const clean = recipe.filter((e) =>
    e.kind === "ingredient" ? true : e.text.trim().length > 0,
  );
  const db = await createClient();
  const { error } = await db
    .from("categories")
    .update({ recipe: clean.length > 0 ? clean : null })
    .eq("id", categoryId);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 5: Lint**

Run: `npx eslint lib/menu/types.ts lib/menu/admin.ts "app/(admin)/admin/categories/actions.ts"`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/menu/types.ts lib/menu/admin.ts "app/(admin)/admin/categories/actions.ts"
git commit -m "feat(cost): load and save category recipe"
```

---

### Task 4: Extract shared `RecipeBuilder` component

**Files:**
- Create: `components/admin/recipe-builder.tsx`
- Modify: `components/admin/product-form.tsx` (replace inline recipe block with the component)

**Interfaces:**
- Consumes: `RecipeEntry`, `deriveGoodsCost`, `renderStep`, `fillTemplate` (`lib/menu/recipe`); `AdminCostItem` (`lib/menu/types`); existing UI primitives (`Input`, `filterDigits`, `cn`, `formatPrice`, lucide icons).
- Produces:
  ```ts
  export function RecipeBuilder(props: {
    costItems: AdminCostItem[];        // pass active (non-archived) items
    value: RecipeEntry[];              // current ingredient/free entries
    onChange: (next: RecipeEntry[]) => void;
    // Optional: base entries inherited from the category, shown read-only above
    // the builder with exclude/override controls. Omit on the category editor.
    inherited?: RecipeEntry[];
    // Called when the user toggles exclude / sets an override on an inherited
    // ingredient. The parent stores these as exclude/override entries.
    onInheritedChange?: (next: RecipeEntry[]) => void;
  }): JSX.Element
  ```
  - Internally renders: an "Always included" locked list, the ingredient picker chips, the ordered prep-step list with drag/reorder + grams, an "Add step" button, and the live "Goods cost per drink" figure computed from `deriveGoodsCost(mergeRecipe(inherited ?? null, value), costItems)`.

**Note:** This task is a pure refactor of the existing recipe UI in `product-form.tsx` (lines ~73-234 for state/handlers and ~428-566 for JSX, plus the `RecipeStepRow`/`DropPlaceholder` helpers) into the new file, generalized to accept `value`/`onChange`. The `inherited` zone (exclude/override) is wired in Task 5; in THIS task, implement the `inherited`/`onInheritedChange` props but they may be unused by the product form until Task 5.

- [ ] **Step 1: Create `components/admin/recipe-builder.tsx`.** Move the following out of `product-form.tsx` verbatim, adjusting to props:
  - The `RecipeStepRow` and `DropPlaceholder` components (copy as-is).
  - The recipe state helpers: `toggleIngredient`, `addFreeStep`, `removeAt`, `move`, `startDrag` + its `drag`/`dragInfo`/`grabDy` state, `setGramsAt`, `setTextAt`, `resetToTemplate` — but operate on `props.value`/`props.onChange` instead of local `recipe`/`setRecipe`. Use an internal helper `const setRecipe = (fn) => props.onChange(typeof fn === "function" ? fn(props.value) : fn)` to keep the moved code near-identical, OR convert the `setRecipe(prev => ...)` calls to `props.onChange(next)` computed from `props.value`.
  - The JSX from `<Panel title="Recipe" ...>`'s inner content: always-included list, ingredient picker, ordered step list, and the goods-cost footer. Do NOT include the `<Panel>` wrapper — the builder renders the inner content; the parent supplies the panel/heading. Compute `activeCostItems`, `alwaysItems`, `optionalItems`, `templateById`, `tickedIds`, and `goodsCost` inside the builder from `props.costItems` and `props.value` (+ `props.inherited`).

  For `goodsCost`, use:

```tsx
import { deriveGoodsCost, renderStep, mergeRecipe, type RecipeEntry } from "@/lib/menu/recipe";
// ...
const effective = mergeRecipe(props.inherited ?? null, props.value);
const goodsCost = deriveGoodsCost(
  effective,
  activeCostItems.map((c) => ({
    id: c.id, price: c.price, alwaysIncluded: c.alwaysIncluded, isArchived: c.isArchived,
  })),
);
```

  Add the inherited read-only zone above the "Ingredients" picker (rendered only when `props.inherited?.length`):

```tsx
{props.inherited && props.inherited.length > 0 && (
  <div className="flex flex-col gap-2">
    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      From category
    </span>
    <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-muted/30">
      {props.inherited
        .filter((e): e is Extract<RecipeEntry, { kind: "ingredient" }> => e.kind === "ingredient")
        .map((e) => (
          <InheritedRow
            key={e.costItemId}
            entry={e}
            costItem={props.costItems.find((c) => c.id === e.costItemId) ?? null}
            control={inheritedControl(e.costItemId)}
            onChange={(next) => setInheritedControl(e.costItemId, next)}
          />
        ))}
    </div>
  </div>
)}
```

  Where `inheritedControl(id)` reads the parent's exclude/override entries (passed via a small prop — see Step 2) and `InheritedRow` is a new local component:

```tsx
function InheritedRow({
  entry,
  costItem,
  control,
  onChange,
}: {
  entry: Extract<RecipeEntry, { kind: "ingredient" }>;
  costItem: { name: string; price: number } | null;
  control: { excluded: boolean; overrideGrams: number | null };
  onChange: (next: { excluded: boolean; overrideGrams: number | null }) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <span className={cn("flex-1", control.excluded && "text-muted-foreground line-through")}>
        {costItem?.name ?? "Ingredient"}
      </span>
      <div className="relative w-20 shrink-0">
        <Input
          inputMode="numeric"
          value={control.overrideGrams == null ? "" : String(control.overrideGrams)}
          onChange={(e) => {
            const digits = filterDigits(e.target.value);
            onChange({ ...control, overrideGrams: digits === "" ? null : Number(digits) });
          }}
          placeholder={entry.grams == null ? "—" : String(entry.grams)}
          aria-label={`${costItem?.name ?? "Ingredient"} grams override`}
          disabled={control.excluded}
          className="w-full pr-6 font-mono tabular-nums"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">g</span>
      </div>
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <input
          type="checkbox"
          checked={control.excluded}
          onChange={(e) => onChange({ ...control, excluded: e.target.checked })}
          className="size-4 accent-foreground"
        />
        Skip
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Define the builder's props and inherited-control plumbing.** Because exclude/override entries live on the PRODUCT recipe (Task 5), the builder exposes them via two props the parent owns:

```tsx
export function RecipeBuilder({
  costItems,
  value,
  onChange,
  inherited,
  inheritedControls,   // Map<costItemId, {excluded, overrideGrams}>
  onInheritedControlChange, // (costItemId, {excluded, overrideGrams}) => void
}: {
  costItems: AdminCostItem[];
  value: RecipeEntry[];
  onChange: (next: RecipeEntry[]) => void;
  inherited?: RecipeEntry[];
  inheritedControls?: Map<string, { excluded: boolean; overrideGrams: number | null }>;
  onInheritedControlChange?: (
    costItemId: string,
    next: { excluded: boolean; overrideGrams: number | null },
  ) => void;
}) { /* ... */ }
```

  Inside, `inheritedControl(id)` returns `inheritedControls?.get(id) ?? { excluded: false, overrideGrams: null }` and `setInheritedControl(id, next)` calls `onInheritedControlChange?.(id, next)`.

- [ ] **Step 3: Replace the inline block in `product-form.tsx`.** Delete the moved state/handlers and the inner JSX of the Recipe `<Panel>`, and render:

```tsx
<Panel title="Recipe" hint={`Cost ${formatPrice(goodsCost)}`}>
  {activeCostItems.length === 0 ? (
    <p className="text-sm text-muted-foreground">
      No cost items yet. Create them under Cost Goods to build a recipe.
    </p>
  ) : (
    <RecipeBuilder costItems={activeCostItems} value={recipe} onChange={setRecipe} />
  )}
</Panel>
```

  Keep `recipe`/`setRecipe` state and the `goodsCost` line in `product-form.tsx` for the Panel hint (compute it with `mergeRecipe(null, recipe)` for now — the inherited base is wired in Task 5). Keep the `deriveGoodsCost` import for that. Remove imports that moved to the builder (`renderStep`, `GripVertical`, etc.) if no longer used.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 5: Lint**

Run: `npx eslint components/admin/recipe-builder.tsx components/admin/product-form.tsx`
Expected: no errors.

- [ ] **Step 6: Manual smoke**

Run: `npm run dev`, open `/admin/menu/new`, confirm the Recipe panel still works exactly as before (tick ingredient, add step, reorder, grams, live cost). Stop dev server.

- [ ] **Step 7: Commit**

```bash
git add components/admin/recipe-builder.tsx components/admin/product-form.tsx
git commit -m "refactor(cost): extract shared RecipeBuilder from product form"
```

---

### Task 5: Wire category base into the product form (inherited zone + dedupe on save)

**Files:**
- Modify: `components/admin/product-form.tsx`
- Modify: `app/(admin)/admin/menu/[id]/page.tsx` and `app/(admin)/admin/menu/new/page.tsx` (already pass `categories`; no new fetch needed — `AdminCategory.recipe` now carries the base).

**Interfaces:**
- Consumes: `AdminCategory.recipe` (Task 3), `RecipeBuilder` inherited props (Task 4), `mergeRecipe`.
- Produces: product form that shows the selected category's base as an inherited zone, lets the user exclude/override base ingredients, dedupes the drink's own list against the base, and submits exclude/override entries inside `data.recipe`.

- [ ] **Step 1: Derive the inherited base from the selected category.** In `product-form.tsx`, after `selectedCategory` is computed:

```tsx
const inheritedBase: RecipeEntry[] = selectedCategory?.recipe ?? [];
```

  Split the product's own recipe into directives (exclude/override) and plain entries. Store exclude/override as a control map derived from `recipe`:

```tsx
// Controls for inherited ingredients, derived from exclude/override entries
// currently in `recipe`.
const inheritedControls = new Map<string, { excluded: boolean; overrideGrams: number | null }>();
for (const e of recipe) {
  if (e.kind === "exclude")
    inheritedControls.set(e.costItemId, {
      excluded: true,
      overrideGrams: inheritedControls.get(e.costItemId)?.overrideGrams ?? null,
    });
  else if (e.kind === "override")
    inheritedControls.set(e.costItemId, {
      excluded: inheritedControls.get(e.costItemId)?.excluded ?? false,
      overrideGrams: e.grams,
    });
}

// The plain ingredient/free entries the builder edits (directives filtered out).
const ownEntries = recipe.filter((e) => e.kind === "ingredient" || e.kind === "free");
```

- [ ] **Step 2: Handlers to update controls and own entries, recombining into `recipe`.**

```tsx
function setOwnEntries(next: RecipeEntry[]) {
  const directives = recipe.filter((e) => e.kind === "exclude" || e.kind === "override");
  setRecipe([...directives, ...next]);
}

function setInheritedControl(
  costItemId: string,
  ctrl: { excluded: boolean; overrideGrams: number | null },
) {
  const directives: RecipeEntry[] = [];
  // Rebuild all directives, replacing this one.
  const others = new Map(inheritedControls);
  others.set(costItemId, ctrl);
  for (const [id, c] of others) {
    if (c.excluded) directives.push({ kind: "exclude", costItemId: id });
    else if (c.overrideGrams != null)
      directives.push({ kind: "override", costItemId: id, grams: c.overrideGrams });
  }
  setRecipe([...directives, ...ownEntries]);
}
```

- [ ] **Step 3: Pass everything to `RecipeBuilder`** and update the Panel hint to use the merged cost:

```tsx
const goodsCost = deriveGoodsCost(
  mergeRecipe(inheritedBase, recipe),
  activeCostItems.map((c) => ({
    id: c.id, price: c.price, alwaysIncluded: c.alwaysIncluded, isArchived: c.isArchived,
  })),
);
// ...
<RecipeBuilder
  costItems={activeCostItems}
  value={ownEntries}
  onChange={setOwnEntries}
  inherited={inheritedBase}
  inheritedControls={inheritedControls}
  onInheritedControlChange={setInheritedControl}
/>
```

- [ ] **Step 4: Dedupe the drink's own list against the base on submit.** In `submit()`, before building `data`, drop any own-ingredient that's in the base (base wins), and drop stale directives for costItems no longer in the base:

```tsx
const baseIds = new Set(
  inheritedBase.flatMap((e) => (e.kind === "ingredient" ? [e.costItemId] : [])),
);
const cleanedRecipe = recipe.filter((e) => {
  if (e.kind === "ingredient") return !baseIds.has(e.costItemId); // dedupe: base wins
  if (e.kind === "exclude" || e.kind === "override") return baseIds.has(e.costItemId); // drop stale directives
  return true; // free
});
```

  Use `cleanedRecipe` for `data.recipe` instead of `recipe`.

- [ ] **Step 5: Allow directive entries through the save action.** In `app/(admin)/admin/menu/actions.ts` `saveProduct`, the recipe validation loop (lines ~106-118) currently rejects anything that isn't `ingredient` or `free`. Extend it to accept the directive kinds:

```ts
  for (const entry of data.recipe) {
    if (entry.kind === "ingredient") {
      if (!entry.costItemId)
        return { ok: false, error: "A recipe ingredient is missing its cost item." };
      if (entry.grams != null && (!Number.isInteger(entry.grams) || entry.grams < 0))
        return { ok: false, error: "Recipe amounts must be non-negative whole numbers." };
    } else if (entry.kind === "exclude") {
      if (!entry.costItemId)
        return { ok: false, error: "Invalid recipe step." };
    } else if (entry.kind === "override") {
      if (!entry.costItemId || !Number.isInteger(entry.grams) || entry.grams < 0)
        return { ok: false, error: "Recipe amounts must be non-negative whole numbers." };
    } else if (entry.kind !== "free") {
      return { ok: false, error: "Invalid recipe step." };
    }
  }
```

  Also update the `cleanRecipe` filter (line ~127) so it keeps directive entries (they have no `text`):

```ts
  const cleanRecipe = data.recipe.filter((e) =>
    e.kind === "free" ? e.text.trim().length > 0 : true,
  );
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 7: Lint**

Run: `npx eslint components/admin/product-form.tsx "app/(admin)/admin/menu/actions.ts"`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add components/admin/product-form.tsx "app/(admin)/admin/menu/actions.ts"
git commit -m "feat(cost): inherit category base recipe in product form"
```

---

### Task 6: Add Recipe section to the category editor

**Files:**
- Modify: `components/admin/category-manager.tsx`
- Modify: `app/(admin)/admin/categories/page.tsx` (pass `costItems` to the manager)
- Modify: `app/(admin)/admin/categories/page.tsx` import from `lib/menu/admin`

**Interfaces:**
- Consumes: `RecipeBuilder` (Task 4), `saveCategoryRecipe` (Task 3), `listAdminCostItems` (existing), `AdminCategory.recipe` (Task 3).
- Produces: category editor rows with a Recipe section that edits `categories.recipe` via the shared builder and persists with `saveCategoryRecipe`.

- [ ] **Step 1: Load cost items on the categories page.** In `app/(admin)/admin/categories/page.tsx`:

```tsx
import { listAdminCategories, listAdminAddons, listAdminCostItems } from "@/lib/menu/admin";
import { CategoryManager } from "@/components/admin/category-manager";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const [categories, addons, costItems] = await Promise.all([
    listAdminCategories(),
    listAdminAddons(),
    listAdminCostItems(),
  ]);
  return <CategoryManager initial={categories} addons={addons} costItems={costItems} />;
}
```

- [ ] **Step 2: Thread `costItems` through `CategoryManager` to `CategoryRow`.** Add `costItems: AdminCostItem[]` to both components' props (import `AdminCostItem` from `@/lib/menu/types`) and pass it down in the `.map(...)` that renders `CategoryRow`.

- [ ] **Step 3: Add recipe state + Recipe section to `CategoryRow`.** Add state and a builder inside the open panel (after the Default add-ons block, before the error line):

```tsx
import { RecipeBuilder } from "@/components/admin/recipe-builder";
import { saveCategoryRecipe } from "@/app/(admin)/admin/categories/actions";
import type { RecipeEntry } from "@/lib/menu/recipe";
// ...
const [recipe, setRecipe] = useState<RecipeEntry[]>(category.recipe);
// ...
<div className="flex flex-col gap-1.5">
  <Label>Base recipe (applies to every drink in this category)</Label>
  {costItems.filter((c) => !c.isArchived).length === 0 ? (
    <p className="text-sm text-muted-foreground">
      No cost items yet. Create them under Cost Goods first.
    </p>
  ) : (
    <RecipeBuilder
      costItems={costItems.filter((c) => !c.isArchived)}
      value={recipe}
      onChange={setRecipe}
    />
  )}
</div>
```

- [ ] **Step 4: Persist the recipe in `save()`.** Extend the existing `save()` in `CategoryRow` to also call `saveCategoryRecipe` after `setCategoryAddons`:

```tsx
        const addonsRes = await setCategoryAddons(category.id, [...picked]);
        if (!addonsRes.ok) return setError(addonsRes.error);
        const recipeRes = await saveCategoryRecipe(category.id, recipe);
        if (!recipeRes.ok) return setError(recipeRes.error);
        onChanged();
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 6: Lint**

Run: `npx eslint components/admin/category-manager.tsx "app/(admin)/admin/categories/page.tsx"`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add components/admin/category-manager.tsx "app/(admin)/admin/categories/page.tsx"
git commit -m "feat(cost): category recipe editor"
```

---

### Task 7: Merge category base in cost + staff prep consumers

**Files:**
- Modify: `lib/menu/cost.ts` (`getProductCosts`)
- Modify: `app/(admin)/manage/[token]/page.tsx` (staff prep sheet, lines ~56-73)

**Interfaces:**
- Consumes: `mergeRecipe` (Task 1), `categories.recipe`.
- Produces: `getProductCosts` and the staff prep sheet both operate on the merged (category base + product) recipe.

- [ ] **Step 1: Merge in `getProductCosts`.** In `lib/menu/cost.ts`, also load each product's `category_id` and the categories' recipes, then merge before `deriveGoodsCost`:

```ts
import { deriveGoodsCost, mergeRecipe, type RecipeEntry } from "@/lib/menu/recipe";
// ...
  const [items, prods] = await Promise.all([
    db.from("cost_items").select("id, price, is_always_included, is_archived"),
    db.from("products").select("id, recipe, category_id").in("id", productIds),
  ]);
  if (items.error) throw new Error(`getProductCosts failed: ${items.error.message}`);
  if (prods.error) throw new Error(`getProductCosts failed: ${prods.error.message}`);

  const categoryIds = [
    ...new Set((prods.data ?? []).map((p) => p.category_id).filter((id): id is string => !!id)),
  ];
  const cats = categoryIds.length
    ? await db.from("categories").select("id, recipe").in("id", categoryIds)
    : { data: [], error: null };
  if (cats.error) throw new Error(`getProductCosts failed: ${cats.error.message}`);
  const categoryRecipeById = new Map(
    (cats.data ?? []).map((c) => [c.id, ((c.recipe as unknown) as RecipeEntry[] | null) ?? null]),
  );

  const costItems = (items.data ?? []).map((i) => ({
    id: i.id, price: i.price, alwaysIncluded: i.is_always_included, isArchived: i.is_archived,
  }));
  const prodById = new Map(
    (prods.data ?? []).map((p) => [
      p.id,
      {
        recipe: ((p.recipe as unknown) as RecipeEntry[] | null) ?? null,
        categoryId: p.category_id,
      },
    ]),
  );

  for (const id of productIds) {
    const p = prodById.get(id);
    const merged = mergeRecipe(
      p?.categoryId ? categoryRecipeById.get(p.categoryId) ?? null : null,
      p?.recipe ?? null,
    );
    costs.set(id, deriveGoodsCost(merged, costItems));
  }
  return costs;
```

  (Remove the old `recipeById` map/loop this replaces.)

- [ ] **Step 2: Merge in the staff prep sheet.** In `app/(admin)/manage/[token]/page.tsx`, update the recipe resolution block to also load each product's `category_id` + the categories' recipes and merge:

```tsx
import { resolveRecipeStrings, mergeRecipe, type RecipeEntry } from "@/lib/menu/recipe";
// ...
  const recipeMap = new Map<string, string[]>();
  if (productIds.length > 0) {
    const db = createAdminClient();
    const [prods, items] = await Promise.all([
      db.from("products").select("id, recipe, category_id").in("id", productIds),
      db.from("cost_items").select("id, prep_template"),
    ]);
    const categoryIds = [
      ...new Set((prods.data ?? []).map((p) => p.category_id).filter((id): id is string => !!id)),
    ];
    const cats = categoryIds.length
      ? await db.from("categories").select("id, recipe").in("id", categoryIds)
      : { data: [] };
    const categoryRecipeById = new Map(
      (cats.data ?? []).map((c) => [c.id, ((c.recipe as unknown) as RecipeEntry[] | null) ?? null]),
    );
    const templateById = new Map(
      (items.data ?? []).map((c) => [c.id, c.prep_template]),
    );
    for (const p of prods.data ?? []) {
      const merged = mergeRecipe(
        p.category_id ? categoryRecipeById.get(p.category_id) ?? null : null,
        ((p.recipe as unknown) as RecipeEntry[] | null) ?? null,
      );
      const strings = resolveRecipeStrings(merged, templateById);
      if (strings.length > 0) recipeMap.set(p.id, strings);
    }
  }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 4: Lint**

Run: `npx eslint lib/menu/cost.ts "app/(admin)/manage/[token]/page.tsx"`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/menu/cost.ts "app/(admin)/manage/[token]/page.tsx"
git commit -m "feat(cost): merge category base into cost and prep sheet"
```

---

### Task 8: End-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Build gate**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 2: Recipe logic gate**

Run: `node scripts/check-recipe.mjs`
Expected: PASS.

- [ ] **Step 3: Manual flow** — `npm run dev`, then:
  1. `/admin/categories` → edit **Matcha** → add base recipe milk (150g) + matcha (4g) → Save.
  2. `/admin/menu/new` → pick Matcha → confirm the "From category" zone shows milk + matcha and "Goods cost per drink" already includes them with zero ticking. Save a test drink.
  3. Edit that drink → set matcha grams override to 6 → confirm cost unchanged (grams don't scale cost) and step text shows 6g. Toggle "Skip" on milk → confirm cost drops by milk's price and the milk step disappears.
  4. Find an existing matcha that had milk ticked in its own recipe → open it → confirm milk now shows only under "From category" (own duplicate deduped), cost not doubled. Save.
  5. `/manage/<token>` for an order with a matcha → confirm the prep sheet lists the merged steps (category base + drink extras) once each.
  6. Place a new order with that matcha → confirm `order_items.unit_cost` reflects the merged cost (check via reports/dashboard profit).

- [ ] **Step 4: Confirm end on `development`**

Run: `git status && git branch --show-current`
Expected: clean tree, branch `development`.

---

## Notes for the implementer

- **Do not** rewrite existing drinks via SQL. Dedupe on save (Task 5, Step 4) cleans each drink the next time it's saved.
- **Grams never change cost** anywhere — they're prep guidance only. Overrides change the displayed step text, not the price.
- **Past orders are immutable** — they keep their snapshotted `unit_cost`. Only new orders and live form/reports reflect the merge.
- If `npx supabase` commands aren't wired in this environment, apply the migration SQL through the Supabase dashboard SQL editor and hand-edit `types/database.ts` to add `recipe: Json | null` to the `categories` Row/Insert/Update types.
