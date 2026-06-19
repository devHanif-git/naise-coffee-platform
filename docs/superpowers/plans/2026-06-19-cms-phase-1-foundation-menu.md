# CMS Phase 1 — Foundation + Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the NAISE COFFEE menu (categories, products, sizes, add-ons) from the hardcoded `data/menu.ts` into Postgres, point the storefront at the database with zero visible change, then build an admin-only CMS at `/admin` to manage it.

**Architecture:** Read-path first (Approach 1 from the spec). Build the schema + seed, flip the storefront to a new `lib/menu/store.ts` and verify pixel parity, then layer the admin shell + menu editor on top. The storefront keeps the existing `Product`/`Category` TypeScript shapes so UI components barely change; the store maps DB rows into those shapes. Writes go through Server Actions gated to the `admin` role and backed by RLS.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), TypeScript (strict, no `any`), Tailwind, shadcn/ui, Supabase (Postgres + Storage + RLS). Migrations applied via the Supabase MCP tools (the pattern this repo already uses — see the comment in `supabase/migrations/20260616222010_auth_profiles.sql`).

## Global Constraints

- **Money is integer sen** (1 MYR = 100 sen). Never floats. (`AGENTS.md`, `lib/format.ts`.)
- **No `any`; strict TypeScript.** (`AGENTS.md`.)
- **No new libraries** beyond shadcn/ui primitives, which `AGENTS.md` explicitly says to add via the shadcn CLI. Do not install anything else without asking.
- **Images via `next/image`** (the repo's `SmartImage` wraps it). `next.config.ts` already whitelists the Supabase host at `/storage/v1/**`.
- **Server-only Supabase**: the service-role `createAdminClient()` must never be imported into a client component. Reads that need cookies use `createClient()` from `lib/supabase/server.ts`.
- **No test harness exists** in this repo. Verify each task with `npx tsc --noEmit`, `npm run lint`, Supabase SQL/RLS checks via MCP, and manual storefront parity. Do **not** add a test runner.
- **Migrations**: write the SQL file into `supabase/migrations/` with a timestamp later than `20260619093000`, AND apply it through the Supabase MCP `apply_migration` tool. Keep both in sync (file = source of truth in git).
- **Money/role helpers already exist**: `public.set_updated_at()` (updated_at trigger) and `public.current_user_role()` (returns the caller's role; **execute is granted to `authenticated` only, NOT `anon`** — so anon RLS policies must never call it).
- **Add-on resolution rule** (the hybrid model): an item's effective add-ons = *(its category's `category_addons`) − (its `product_addons` rows with `mode='remove'`) ∪ (its `product_addons` rows with `mode='add'`)*, ordered by `sort_order`.
- **Archive, never hard-delete**, in the CMS UI. `order_items` snapshot name/size/addon/price and have no FK to products, so editing/archiving is always safe for history.

---

## File Structure

**Created:**
- `supabase/migrations/20260619100000_menu_schema.sql` — 6 tables, indexes, triggers, RLS.
- `supabase/migrations/20260619100100_menu_seed.sql` — seed from current `data/menu.ts`.
- `supabase/migrations/20260619100200_products_storage.sql` — `products` Storage bucket + policies.
- `lib/menu/pricing.ts` — pure `getBasePrice(product)` (relocated from `data/menu.ts`); client-safe.
- `lib/menu/mappers.ts` — pure DB-row → `Product`/`Category` mappers + add-on resolution.
- `lib/menu/store.ts` — server-only public catalog reads.
- `lib/menu/admin.ts` — server-only admin reads (includes archived rows + edit detail).
- `lib/menu/types.ts` — admin-facing view types (e.g. `AdminProduct`, `ProductFormData`).
- `app/(admin)/admin/layout.tsx` — admin role gate + shell.
- `app/(admin)/admin/page.tsx` — Dashboard placeholder.
- `app/(admin)/admin/menu/page.tsx` — menu list (server) → `MenuListLive`.
- `app/(admin)/admin/menu/actions.ts` — product/flag/availability/archive Server Actions.
- `app/(admin)/admin/menu/new/page.tsx` and `app/(admin)/admin/menu/[id]/page.tsx` — item editor.
- `app/(admin)/admin/categories/page.tsx` + `actions.ts` — categories CRUD.
- `app/(admin)/admin/addons/page.tsx` + `actions.ts` — add-ons CRUD.
- `app/(admin)/admin/_stub/coming-soon.tsx` — shared "Coming soon" stub.
- `components/admin/admin-shell.tsx` — client drawer nav.
- `components/admin/menu-list-live.tsx`, `components/admin/product-form.tsx`, `components/admin/category-manager.tsx`, `components/admin/addon-manager.tsx`, `components/admin/image-upload.tsx` — CMS UI.

**Modified:**
- `types/menu.ts` — `CategoryType` becomes `string`; `Discount.categories: string[]`.
- `data/discounts.ts` — import `getBasePrice` from `lib/menu/pricing`.
- `components/menu-browser.tsx` — import `getBasePrice` from `lib/menu/pricing`.
- `app/(customer)/home/page.tsx`, `app/(customer)/menu/page.tsx`, `app/(customer)/menu/[slug]/page.tsx` — read from `lib/menu/store.ts`.
- `lib/auth/session.ts` — add `isAdmin()`.
- `types/database.ts` — regenerated after the schema migration.

**Deleted (end of read-path stage):**
- `data/menu.ts`.

---

# STAGE A — Read-path first (schema → seed → cutover)

## Task 1: Menu schema migration (6 tables, indexes, triggers, RLS)

**Files:**
- Create: `supabase/migrations/20260619100000_menu_schema.sql`

**Interfaces:**
- Produces: tables `public.categories`, `public.addons`, `public.products`, `public.product_variants`, `public.category_addons`, `public.product_addons`. Column names are consumed by every later task.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260619100000_menu_schema.sql`:

```sql
-- Menu catalog: categories, products, variants, add-ons, and the hybrid add-on
-- link tables. Replaces the hardcoded data/menu.ts. Money in sen.
-- RLS: public read of non-archived rows; all writes restricted to admin.
-- Reuses public.set_updated_at() and public.current_user_role() from the
-- profiles migration. current_user_role() is NOT executable by anon, so the
-- anon SELECT policies below never call it.

-- Tables ----------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  sort_order  int not null default 0,
  max_addons  int not null default 3 check (max_addons >= 0),
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.addons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  price       integer not null check (price >= 0),
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.products (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references public.categories (id) on delete restrict,
  slug           text not null unique,
  name           text not null,
  description    text not null default '',
  image_url      text,
  base_price     integer check (base_price is null or base_price >= 0),
  max_addons     int check (max_addons is null or max_addons >= 0),
  is_best_seller boolean not null default false,
  is_new         boolean not null default false,
  is_featured    boolean not null default false,
  is_available   boolean not null default true,
  is_archived    boolean not null default false,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.product_variants (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name       text not null,
  price      integer not null check (price >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.category_addons (
  category_id uuid not null references public.categories (id) on delete cascade,
  addon_id    uuid not null references public.addons (id) on delete cascade,
  sort_order  int not null default 0,
  primary key (category_id, addon_id)
);

create table public.product_addons (
  product_id uuid not null references public.products (id) on delete cascade,
  addon_id   uuid not null references public.addons (id) on delete cascade,
  mode       text not null check (mode in ('add', 'remove')),
  sort_order int not null default 0,
  primary key (product_id, addon_id)
);

-- Indexes ---------------------------------------------------------------------
create index products_category_id_idx on public.products (category_id);
create index products_best_seller_idx on public.products (is_best_seller)
  where is_best_seller and not is_archived;
create index products_featured_idx on public.products (is_featured)
  where is_featured and not is_archived;
create index product_variants_product_id_idx on public.product_variants (product_id);
create index category_addons_category_id_idx on public.category_addons (category_id);
create index product_addons_product_id_idx on public.product_addons (product_id);

-- updated_at triggers ---------------------------------------------------------
create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger addons_set_updated_at before update on public.addons
  for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger product_variants_set_updated_at before update on public.product_variants
  for each row execute function public.set_updated_at();

-- RLS -------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.addons enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.category_addons enable row level security;
alter table public.product_addons enable row level security;

-- Public read of non-archived rows. Split by role so anon never calls
-- current_user_role() (which it cannot execute).
create policy "categories_read_anon" on public.categories for select to anon
  using (not is_archived);
create policy "categories_read_auth" on public.categories for select to authenticated
  using (not is_archived or public.current_user_role() = 'admin');

create policy "addons_read_anon" on public.addons for select to anon
  using (not is_archived);
create policy "addons_read_auth" on public.addons for select to authenticated
  using (not is_archived or public.current_user_role() = 'admin');

create policy "products_read_anon" on public.products for select to anon
  using (not is_archived);
create policy "products_read_auth" on public.products for select to authenticated
  using (not is_archived or public.current_user_role() = 'admin');

-- Variants + link tables only reference catalog rows; readable by everyone.
create policy "product_variants_read_all" on public.product_variants for select
  to anon, authenticated using (true);
create policy "category_addons_read_all" on public.category_addons for select
  to anon, authenticated using (true);
create policy "product_addons_read_all" on public.product_addons for select
  to anon, authenticated using (true);

-- Writes: admin only, every table. (FOR ALL also grants admin full SELECT.)
create policy "categories_write_admin" on public.categories for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "addons_write_admin" on public.addons for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "products_write_admin" on public.products for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "product_variants_write_admin" on public.product_variants for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "category_addons_write_admin" on public.category_addons for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "product_addons_write_admin" on public.product_addons for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Call the `apply_migration` tool with `name: "menu_schema"` and `query` set to the full SQL above.

- [ ] **Step 3: Verify the tables and RLS exist**

Call `list_tables` (schemas: `["public"]`). Expected: `categories`, `addons`, `products`, `product_variants`, `category_addons`, `product_addons` all present with RLS enabled.
Then call `execute_sql` with:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
  and tablename in ('categories','addons','products','product_variants','category_addons','product_addons')
order by tablename;
```

Expected: 6 rows, all `rowsecurity = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619100000_menu_schema.sql
git commit -m "feat(cms): menu catalog schema + RLS"
```

---

## Task 2: Seed migration from current `data/menu.ts`

**Files:**
- Create: `supabase/migrations/20260619100100_menu_seed.sql`

**Interfaces:**
- Consumes: tables from Task 1.
- Produces: 3 categories, 7 add-ons, 10 products, 18 variants, 8 category-addon links — byte-identical to today's `data/menu.ts`. Category slugs stay `coffee` / `non_coffee` / `matcha` so `data/discounts.ts` keeps matching.

- [ ] **Step 1: Write the seed SQL**

Create `supabase/migrations/20260619100100_menu_seed.sql`. The whole block is guarded so it only runs when the catalog is empty (idempotent on re-runs / fresh DBs):

```sql
-- One-time seed mirroring data/menu.ts exactly. Guarded: runs only if there are
-- no products yet. Large variants are Regular + RM2. Americano is flat-priced.
do $$
begin
  if exists (select 1 from public.products) then
    return;
  end if;

  insert into public.categories (slug, name, sort_order, max_addons) values
    ('coffee', 'Coffee', 0, 3),
    ('non_coffee', 'Non Coffee', 1, 3),
    ('matcha', 'Matcha', 2, 3);

  insert into public.addons (name, price) values
    ('Extra Shot', 200),
    ('Oat Milk', 250),
    ('Vanilla Syrup', 150),
    ('Caramel Syrup', 150),
    ('Pearls', 150),
    ('Extra Syrup', 150),
    ('Extra Matcha', 300);

  insert into public.products
    (category_id, slug, name, description, base_price, is_best_seller, is_new, sort_order)
  select c.id, v.slug, v.name, v.description, v.base_price, v.is_best_seller, v.is_new, v.sort_order
  from (values
    ('coffee','naise-signature-latte','Naise Signature Latte','Smooth. Bold. Naise.', null::int, true,  false, 0),
    ('coffee','spanish-latte','Spanish Latte','Sweet & creamy.',                       null::int, false, false, 1),
    ('coffee','americano','Americano','Bold and classic.',                              990,       false, false, 2),
    ('coffee','caramel-macchiato','Caramel Macchiato','Rich. Sweet. Balanced.',          null::int, true,  false, 3),
    ('coffee','vanilla-latte','Vanilla Latte','Smooth vanilla vibe.',                    null::int, true,  false, 4),
    ('coffee','mocha','Mocha','Chocolate meets coffee.',                                 null::int, false, false, 5),
    ('non_coffee','iced-chocolate','Iced Chocolate','Rich and velvety.',                 null::int, false, false, 0),
    ('non_coffee','brown-sugar-milk','Brown Sugar Milk','Sweet and comforting.',         null::int, false, true,  1),
    ('matcha','matcha-latte','Matcha Latte','Earthy and smooth.',                        null::int, false, false, 0),
    ('matcha','strawberry-matcha','Strawberry Matcha','Fruity meets earthy.',            null::int, false, true,  1)
  ) as v(cat_slug, slug, name, description, base_price, is_best_seller, is_new, sort_order)
  join public.categories c on c.slug = v.cat_slug;

  insert into public.product_variants (product_id, name, price, sort_order)
  select p.id, x.name, x.price, x.sort_order
  from (values
    ('naise-signature-latte','Regular',1290,0),('naise-signature-latte','Large',1490,1),
    ('spanish-latte','Regular',1390,0),('spanish-latte','Large',1590,1),
    ('caramel-macchiato','Regular',1390,0),('caramel-macchiato','Large',1590,1),
    ('vanilla-latte','Regular',1290,0),('vanilla-latte','Large',1490,1),
    ('mocha','Regular',1390,0),('mocha','Large',1590,1),
    ('iced-chocolate','Regular',1190,0),('iced-chocolate','Large',1390,1),
    ('brown-sugar-milk','Regular',1290,0),('brown-sugar-milk','Large',1490,1),
    ('matcha-latte','Regular',1490,0),('matcha-latte','Large',1690,1),
    ('strawberry-matcha','Regular',1690,0),('strawberry-matcha','Large',1890,1)
  ) as x(slug, name, price, sort_order)
  join public.products p on p.slug = x.slug;

  insert into public.category_addons (category_id, addon_id, sort_order)
  select c.id, a.id, x.sort_order
  from (values
    ('coffee','Extra Shot',0),('coffee','Oat Milk',1),('coffee','Vanilla Syrup',2),('coffee','Caramel Syrup',3),
    ('non_coffee','Pearls',0),('non_coffee','Extra Syrup',1),
    ('matcha','Oat Milk',0),('matcha','Extra Matcha',1)
  ) as x(cat_slug, addon_name, sort_order)
  join public.categories c on c.slug = x.cat_slug
  join public.addons a on a.name = x.addon_name;
end $$;
```

- [ ] **Step 2: Apply via Supabase MCP**

Call `apply_migration` with `name: "menu_seed"` and the SQL above.

- [ ] **Step 3: Verify row counts and a sample**

Call `execute_sql`:

```sql
select
  (select count(*) from public.categories) as categories,
  (select count(*) from public.addons) as addons,
  (select count(*) from public.products) as products,
  (select count(*) from public.product_variants) as variants,
  (select count(*) from public.category_addons) as category_addons;
```

Expected: `categories=3, addons=7, products=10, variants=18, category_addons=8`.
Then verify Americano is flat and Naise latte is sized:

```sql
select p.slug, p.base_price, count(v.id) as variant_count
from public.products p
left join public.product_variants v on v.product_id = p.id
where p.slug in ('americano','naise-signature-latte')
group by p.slug, p.base_price order by p.slug;
```

Expected: `americano | 990 | 0` and `naise-signature-latte | (null) | 2`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619100100_menu_seed.sql
git commit -m "feat(cms): seed menu catalog from data/menu.ts"
```

---

## Task 3: Regenerate database types

**Files:**
- Modify: `types/database.ts`

**Interfaces:**
- Produces: `Database["public"]["Tables"]["products"|"categories"|"addons"|"product_variants"|"category_addons"|"product_addons"]` row types used by the store/admin/actions.

- [ ] **Step 1: Generate types via Supabase MCP**

Call the `generate_typescript_types` tool. It returns the full TypeScript source for the DB.

- [ ] **Step 2: Write the result into `types/database.ts`**

Overwrite `types/database.ts` with the returned content verbatim.

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). The new tables now appear in the `Database` type.

- [ ] **Step 4: Commit**

```bash
git add types/database.ts
git commit -m "chore(cms): regenerate Supabase types for menu tables"
```

---

## Task 4: Relocate `getBasePrice` + loosen `CategoryType`

This keeps the build green while making the pricing helper survive the deletion of `data/menu.ts`, and lets categories be arbitrary slugs.

**Files:**
- Create: `lib/menu/pricing.ts`
- Modify: `types/menu.ts`, `data/menu.ts`, `data/discounts.ts`, `components/menu-browser.tsx`

**Interfaces:**
- Produces: `getBasePrice(product: Product): number` from `@/lib/menu/pricing`.
- Produces: `CategoryType = string` (a category slug).

- [ ] **Step 1: Create the pure pricing helper**

Create `lib/menu/pricing.ts`:

```ts
import type { Product } from "@/types/menu";

// Lowest price to show as the product's "from" price. Falls back to the flat
// `price` when a product has no sizes; 0 if neither is set. Pure + client-safe.
export function getBasePrice(product: Product): number {
  if (product.sizes && product.sizes.length > 0) {
    return Math.min(...product.sizes.map((s) => s.price));
  }
  return product.price ?? 0;
}
```

- [ ] **Step 2: Loosen `CategoryType` and `Discount.categories` in `types/menu.ts`**

In `types/menu.ts`, change line 1 and the `Discount` type:

```ts
// A category is identified by its slug (e.g. "coffee"). Once categories became
// editable rows in the CMS, this is a plain string, not a fixed union.
export type CategoryType = string;
```

And in the `Discount` type, change `categories?: CategoryType[];` — it already reads `CategoryType[]`, which is now `string[]`, so no literal edit is needed beyond Step 2's alias. Leave the rest of `types/menu.ts` unchanged (`Category`, `Product`, `ProductSize`, `Addon`, `ProductPricing` stay exactly as they are).

- [ ] **Step 3: Repoint `data/menu.ts` to drop its own `getBasePrice`**

In `data/menu.ts`, delete the local `getBasePrice` function (lines 165-172) and re-export the relocated one so any lingering importer still resolves:

```ts
export { getBasePrice } from "@/lib/menu/pricing";
```

Place that line near the other exports. Leave `getProduct`, `getProductsByCategory`, `getBestSellers`, `categories`, `products` intact for now.

- [ ] **Step 4: Repoint the two real importers**

In `data/discounts.ts` line 2, change:

```ts
import { getBasePrice } from "@/lib/menu/pricing";
```

In `components/menu-browser.tsx` line 11, change:

```ts
import { getBasePrice } from "@/lib/menu/pricing";
```

- [ ] **Step 5: Verify build is green and storefront unchanged**

Run: `npx tsc --noEmit` → Expected: PASS.
Run: `npm run lint` → Expected: PASS.
Run: `npm run dev`, open `/menu`, `/menu/americano`, `/home`. Expected: identical to before (still reading `data/menu.ts`).

- [ ] **Step 6: Commit**

```bash
git add lib/menu/pricing.ts types/menu.ts data/menu.ts data/discounts.ts components/menu-browser.tsx
git commit -m "refactor(menu): relocate getBasePrice, make CategoryType a slug string"
```

---

## Task 5: Menu mappers + server read store

**Files:**
- Create: `lib/menu/mappers.ts`, `lib/menu/store.ts`

**Interfaces:**
- Consumes: `Database` row types (Task 3); `getBasePrice` indirectly (not needed here); `images.coffeeWithLogo` placeholder.
- Produces (server-only, from `@/lib/menu/store`):
  - `listCategories(): Promise<Category[]>`
  - `listProducts(): Promise<Product[]>`
  - `getProductBySlug(slug: string): Promise<Product | null>`
  - `getBestSellers(): Promise<Product[]>`
- Produces (pure, from `@/lib/menu/mappers`):
  - `resolveAddons(...)` and `buildProducts(...)` used by the store.

- [ ] **Step 1: Create the pure mappers**

Create `lib/menu/mappers.ts`:

```ts
import type { Category, Product, Addon, ProductSize } from "@/types/menu";
import { images } from "@/constants/images";
import type { Database } from "@/types/database";

type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
type ProductRow = Database["public"]["Tables"]["products"]["Row"];
type VariantRow = Database["public"]["Tables"]["product_variants"]["Row"];
type AddonRow = Database["public"]["Tables"]["addons"]["Row"];
type CategoryAddonRow = Database["public"]["Tables"]["category_addons"]["Row"];
type ProductAddonRow = Database["public"]["Tables"]["product_addons"]["Row"];

export function mapCategory(row: CategoryRow): Category {
  return { type: row.slug, name: row.name };
}

function mapVariant(row: VariantRow): ProductSize {
  return { id: row.id, name: row.name, price: row.price };
}

function mapAddon(row: AddonRow): Addon {
  return { id: row.id, name: row.name, price: row.price };
}

// Effective add-ons for one product: category defaults, minus per-product
// "remove" overrides, plus per-product "add" overrides. Ordered by the override
// sort_order when present, else the category sort_order. Archived add-ons drop
// out (not in the addon map).
export function resolveAddons(
  productId: string,
  categoryId: string,
  addonsById: Map<string, Addon>,
  categoryAddons: CategoryAddonRow[],
  productAddons: ProductAddonRow[],
): Addon[] {
  const removed = new Set(
    productAddons.filter((r) => r.product_id === productId && r.mode === "remove").map((r) => r.addon_id),
  );
  const ordered: { id: string; sort: number }[] = [];
  for (const ca of categoryAddons) {
    if (ca.category_id !== categoryId) continue;
    if (removed.has(ca.addon_id)) continue;
    ordered.push({ id: ca.addon_id, sort: ca.sort_order });
  }
  for (const pa of productAddons) {
    if (pa.product_id !== productId || pa.mode !== "add") continue;
    if (ordered.some((o) => o.id === pa.addon_id)) continue;
    ordered.push({ id: pa.addon_id, sort: 1000 + pa.sort_order });
  }
  return ordered
    .sort((a, b) => a.sort - b.sort)
    .map((o) => addonsById.get(o.id))
    .filter((a): a is Addon => Boolean(a));
}

// Assemble full Product shapes from the raw row sets fetched by the store.
export function buildProducts(opts: {
  productRows: ProductRow[];
  variantRows: VariantRow[];
  addonRows: AddonRow[];
  categoryRows: CategoryRow[];
  categoryAddonRows: CategoryAddonRow[];
  productAddonRows: ProductAddonRow[];
}): Product[] {
  const { productRows, variantRows, addonRows, categoryRows, categoryAddonRows, productAddonRows } = opts;
  const addonsById = new Map<string, Addon>(addonRows.map((a) => [a.id, mapAddon(a)]));
  const categoryById = new Map<string, CategoryRow>(categoryRows.map((c) => [c.id, c]));

  return productRows.map((p) => {
    const category = categoryById.get(p.category_id);
    const sizes = variantRows
      .filter((v) => v.product_id === p.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(mapVariant);
    const addons = resolveAddons(p.id, p.category_id, addonsById, categoryAddonRows, productAddonRows);
    const product: Product = {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      category: category?.slug ?? "",
      image: p.image_url ?? images.coffeeWithLogo,
      addons,
      maxAddons: p.max_addons ?? category?.max_addons ?? addons.length,
      isBestSeller: p.is_best_seller || undefined,
      isNew: p.is_new || undefined,
      isFeatured: p.is_featured || undefined,
    };
    if (sizes.length > 0) product.sizes = sizes;
    else product.price = p.base_price ?? 0;
    return product;
  });
}
```

- [ ] **Step 2: Create the server store**

Create `lib/menu/store.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { mapCategory, buildProducts } from "@/lib/menu/mappers";
import type { Category, Product } from "@/types/menu";

// Public catalog reads. RLS returns only non-archived rows to non-admins, so the
// storefront automatically hides archived items. Available + unavailable both
// return; the UI greys unavailable ones. Ordered by sort_order then name.
async function fetchCatalog(): Promise<Product[]> {
  const db = await createClient();
  const [products, variants, addons, categories, categoryAddons, productAddons] = await Promise.all([
    db.from("products").select("*").order("sort_order").order("name"),
    db.from("product_variants").select("*"),
    db.from("addons").select("*"),
    db.from("categories").select("*"),
    db.from("category_addons").select("*"),
    db.from("product_addons").select("*"),
  ]);
  if (products.error) return [];
  return buildProducts({
    productRows: products.data ?? [],
    variantRows: variants.data ?? [],
    addonRows: addons.data ?? [],
    categoryRows: categories.data ?? [],
    categoryAddonRows: categoryAddons.data ?? [],
    productAddonRows: productAddons.data ?? [],
  });
}

export async function listCategories(): Promise<Category[]> {
  const db = await createClient();
  const { data } = await db.from("categories").select("*").order("sort_order").order("name");
  return (data ?? []).map(mapCategory);
}

export async function listProducts(): Promise<Product[]> {
  return fetchCatalog();
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const all = await fetchCatalog();
  return all.find((p) => p.slug === slug) ?? null;
}

export async function getBestSellers(): Promise<Product[]> {
  const all = await fetchCatalog();
  return all.filter((p) => p.isBestSeller);
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit` → Expected: PASS.
Run: `npm run lint` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/menu/mappers.ts lib/menu/store.ts
git commit -m "feat(menu): DB-backed read store + row mappers"
```

---

## Task 6: Cut the storefront over to the store + verify parity

**Files:**
- Modify: `app/(customer)/menu/page.tsx`, `app/(customer)/menu/[slug]/page.tsx`, `app/(customer)/home/page.tsx`

**Interfaces:**
- Consumes: `listProducts`, `listCategories`, `getProductBySlug`, `getBestSellers` from `@/lib/menu/store`.

- [ ] **Step 1: Menu list page → DB**

Replace `app/(customer)/menu/page.tsx` body (keep the existing `metadata` export) so the default export becomes:

```tsx
import { listCategories, listProducts } from "@/lib/menu/store";
import { MenuBrowser } from "@/components/menu-browser";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  const [categories, products] = await Promise.all([listCategories(), listProducts()]);
  return <MenuBrowser categories={categories} products={products} />;
}
```

Remove the `import { categories, products } from "@/data/menu";` line.

- [ ] **Step 2: Product detail page → DB**

In `app/(customer)/menu/[slug]/page.tsx`:
- Remove `import { getProduct, products } from "@/data/menu";`.
- Remove the `generateStaticParams` function (lines 12-14).
- Add `import { getProductBySlug } from "@/lib/menu/store";` and `export const dynamic = "force-dynamic";`.
- In `generateMetadata`, change `const product = getProduct(slug);` to `const product = await getProductBySlug(slug);`.
- In `ProductPage`, change `const product = getProduct(slug);` to `const product = await getProductBySlug(slug);`.

(The rest of the JSX is unchanged — it reads `product.*` and `getProductPricing(product)` from `data/discounts`, which still works.)

- [ ] **Step 3: Home page → DB**

In `app/(customer)/home/page.tsx`:
- Remove `import { getBestSellers } from "@/data/menu";`.
- Add `import { getBestSellers } from "@/lib/menu/store";` and `export const dynamic = "force-dynamic";`.
- Make the component async and await the data:

```tsx
export default async function HomePage() {
  const bestSellers = await getBestSellers();
  // ...unchanged JSX...
}
```

- [ ] **Step 4: Verify parity against the pre-cutover storefront**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
Run: `npm run dev` and check each surface renders **identically** to before:
- `/home` — best-seller carousel shows Naise Signature Latte, Caramel Macchiato, Vanilla Latte; discounts/badges intact.
- `/menu` — all 10 drinks, category tabs (All/Coffee/Non Coffee/Matcha), search, sort by price work.
- `/menu/americano` — flat price RM 9.90, no size selector, 4 coffee add-ons, "Choose up to 3".
- `/menu/matcha-latte` — Regular/Large, Matcha Monday 20% off badge, 2 matcha add-ons.
- Add a drink to cart and confirm the cart line shows the right name/price/add-ons.

- [ ] **Step 5: Commit**

```bash
git add "app/(customer)/menu/page.tsx" "app/(customer)/menu/[slug]/page.tsx" "app/(customer)/home/page.tsx"
git commit -m "feat(menu): storefront reads catalog from the database"
```

---

## Task 7: Delete `data/menu.ts`

**Files:**
- Delete: `data/menu.ts`

- [ ] **Step 1: Confirm nothing imports `data/menu` anymore**

Run: `grep -rn "data/menu" app components lib hooks store data` (exclude node_modules).
Expected: no results. (If `data/discounts.ts` still references it, fix to import `getBasePrice` from `@/lib/menu/pricing` — done in Task 4.)

- [ ] **Step 2: Delete the file**

```bash
git rm data/menu.ts
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS. `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(menu): remove hardcoded data/menu.ts; catalog now lives in Postgres"
```

---

# STAGE B — Admin CMS (`/admin`)

## Task 8: Products Storage bucket + admin auth helper

**Files:**
- Create: `supabase/migrations/20260619100200_products_storage.sql`
- Modify: `lib/auth/session.ts`

**Interfaces:**
- Produces: public Storage bucket `products`; `isAdmin(): Promise<boolean>` from `@/lib/auth/session`.

- [ ] **Step 1: Write the storage migration**

Create `supabase/migrations/20260619100200_products_storage.sql`:

```sql
-- Product images. Public bucket (catalog images render without auth), capped at
-- 5 MB, images only. Only admins may write. Path convention: "<product-id>/<file>".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('products', 'products', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "products_read_public" on storage.objects for select
  using (bucket_id = 'products');

create policy "products_insert_admin" on storage.objects for insert to authenticated
  with check (bucket_id = 'products' and public.current_user_role() = 'admin');

create policy "products_update_admin" on storage.objects for update to authenticated
  using (bucket_id = 'products' and public.current_user_role() = 'admin');

create policy "products_delete_admin" on storage.objects for delete to authenticated
  using (bucket_id = 'products' and public.current_user_role() = 'admin');
```

- [ ] **Step 2: Apply via Supabase MCP**

Call `apply_migration` with `name: "products_storage"` and the SQL above.

- [ ] **Step 3: Verify the bucket**

Call `execute_sql`: `select id, public, file_size_limit from storage.buckets where id = 'products';`
Expected: one row, `public = true`, `file_size_limit = 5242880`.

- [ ] **Step 4: Add `isAdmin()` to the session helper**

In `lib/auth/session.ts`, append:

```ts
// Whether the current session is an admin (full CMS access). Staff/manager are
// NOT admin — they keep the order board only.
export async function isAdmin(): Promise<boolean> {
  return (await getSessionRole()) === "admin";
}
```

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit` → PASS.

```bash
git add supabase/migrations/20260619100200_products_storage.sql lib/auth/session.ts
git commit -m "feat(cms): products storage bucket + isAdmin helper"
```

---

## Task 9: Admin shell — gate, drawer nav, dashboard + stubs

**Files:**
- Create: `app/(admin)/admin/layout.tsx`, `app/(admin)/admin/page.tsx`, `app/(admin)/admin/_stub/coming-soon.tsx`, and stub pages for orders/promotions/rewards/customers/reports/settings.
- Create: `components/admin/admin-shell.tsx`
- Add shadcn primitives.

**Interfaces:**
- Consumes: `isAdmin()`.
- Produces: the `/admin` shell that wraps all CMS pages; `ComingSoon` stub component.

- [ ] **Step 1: Add the shadcn primitives the CMS needs**

Run: `npx shadcn@latest add sheet dialog alert-dialog label switch select textarea`
Expected: new files under `components/ui/` (`sheet.tsx`, `dialog.tsx`, `alert-dialog.tsx`, `label.tsx`, `switch.tsx`, `select.tsx`, `textarea.tsx`). Run `npx tsc --noEmit` → PASS.

```bash
git add components/ui package.json package-lock.json
git commit -m "chore(cms): add shadcn sheet/dialog/alert-dialog/label/switch/select/textarea"
```

- [ ] **Step 2: Create the role-gated layout**

Create `app/(admin)/admin/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth/session";
import { AdminShell } from "@/components/admin/admin-shell";

export const metadata: Metadata = {
  title: "Naise Admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect("/");
  return <AdminShell>{children}</AdminShell>;
}
```

- [ ] **Step 3: Create the drawer shell**

Create `components/admin/admin-shell.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu, LayoutDashboard, ClipboardList, Coffee, Tag, Star, Users, BarChart3, Settings,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/manage", label: "Orders", icon: ClipboardList },
  { href: "/admin/menu", label: "Menu", icon: Coffee },
  { href: "/admin/promotions", label: "Promotions", icon: Tag },
  { href: "/admin/rewards", label: "Rewards", icon: Star },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-black px-4 text-white">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            aria-label="Open menu"
            className="flex size-9 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-white/40"
          >
            <Menu className="size-6" />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetTitle className="border-b border-border px-5 py-4 font-heading text-base font-bold uppercase tracking-[0.2em]">
              Naise Admin
            </SheetTitle>
            <nav className="flex flex-col py-2">
              {NAV.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-5 py-3 text-sm font-medium transition-colors",
                      active ? "bg-neutral-100 text-black" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </SheetContent>
        </Sheet>
        <span className="font-heading text-sm font-bold uppercase tracking-[0.2em]">Naise Admin</span>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Create the dashboard placeholder + stub component + stub pages**

Create `app/(admin)/admin/_stub/coming-soon.tsx`:

```tsx
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-20 text-center">
      <h1 className="font-heading text-lg font-bold tracking-tight">{title}</h1>
      <p className="max-w-[16rem] text-sm text-muted-foreground">
        This module is coming in a later phase.
      </p>
    </div>
  );
}
```

Create `app/(admin)/admin/page.tsx`:

```tsx
import { ComingSoon } from "@/app/(admin)/admin/_stub/coming-soon";

export default function AdminDashboardPage() {
  return <ComingSoon title="Dashboard" />;
}
```

Create these five stub pages, each importing `ComingSoon` with the matching title:
- `app/(admin)/admin/promotions/page.tsx` → `<ComingSoon title="Promotions" />`
- `app/(admin)/admin/rewards/page.tsx` → `<ComingSoon title="Rewards" />`
- `app/(admin)/admin/customers/page.tsx` → `<ComingSoon title="Customers" />`
- `app/(admin)/admin/reports/page.tsx` → `<ComingSoon title="Reports" />`
- `app/(admin)/admin/settings/page.tsx` → `<ComingSoon title="Settings" />`

Example (`app/(admin)/admin/promotions/page.tsx`):

```tsx
import { ComingSoon } from "@/app/(admin)/admin/_stub/coming-soon";

export default function PromotionsPage() {
  return <ComingSoon title="Promotions" />;
}
```

(The "Orders" nav item links to the existing `/manage` board — no stub needed.)

- [ ] **Step 5: Verify the gate and nav**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
Run `npm run dev`:
- Signed out, or as a `customer`/`staff`: visiting `/admin` redirects to `/`.
- As an `admin` (set a profile's role to `admin` via `execute_sql`: `update public.profiles set role='admin' where id='<your-uid>';`): `/admin` shows the shell with a working drawer; tapping Menu/stubs navigates; "Coming soon" renders for stubs.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/admin" components/admin/admin-shell.tsx
git commit -m "feat(cms): admin shell with role gate, drawer nav, dashboard + stubs"
```

---

## Task 10: Admin reads + admin view types

**Files:**
- Create: `lib/menu/types.ts`, `lib/menu/admin.ts`

**Interfaces:**
- Consumes: `Database` row types.
- Produces (server-only, from `@/lib/menu/admin`):
  - `listAdminProducts(): Promise<AdminProduct[]>` — all products incl. archived, with category name + price summary.
  - `getAdminProduct(id: string): Promise<AdminProductDetail | null>` — full edit payload.
  - `listAdminCategories(): Promise<AdminCategory[]>` — incl. archived, with addon ids.
  - `listAdminAddons(): Promise<AdminAddon[]>` — incl. archived.
- Produces (from `@/lib/menu/types`): the `AdminProduct`, `AdminProductDetail`, `AdminCategory`, `AdminAddon`, `ProductFormData` types.

- [ ] **Step 1: Define admin view types**

Create `lib/menu/types.ts`:

```ts
// CMS-facing shapes. Distinct from the storefront `Product` (which hides
// archived rows and resolves add-ons): admin views need raw flags and ids.
export type AdminAddon = {
  id: string;
  name: string;
  price: number;
  isArchived: boolean;
};

export type AdminCategory = {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  maxAddons: number;
  isArchived: boolean;
  addonIds: string[]; // category default add-on set
};

export type AdminProduct = {
  id: string;
  slug: string;
  name: string;
  categoryId: string;
  categoryName: string;
  fromPrice: number; // min variant price, or base_price, or 0
  imageUrl: string | null;
  isBestSeller: boolean;
  isNew: boolean;
  isFeatured: boolean;
  isAvailable: boolean;
  isArchived: boolean;
  sortOrder: number;
};

export type AdminVariant = { id: string; name: string; price: number };

export type AdminProductDetail = AdminProduct & {
  description: string;
  basePrice: number | null;
  maxAddons: number | null;
  variants: AdminVariant[];
  // Per-product override rows keyed by addon id.
  addonOverrides: { addonId: string; mode: "add" | "remove" }[];
};

// Payload the item form submits (server action parses this).
export type ProductFormData = {
  id?: string;
  name: string;
  slug: string;
  description: string;
  categoryId: string;
  imageUrl: string | null;
  pricingMode: "variants" | "flat";
  basePrice: number | null;
  variants: { name: string; price: number }[];
  maxAddons: number | null;
  isBestSeller: boolean;
  isNew: boolean;
  isFeatured: boolean;
  isAvailable: boolean;
  addonOverrides: { addonId: string; mode: "add" | "remove" }[];
};
```

- [ ] **Step 2: Implement admin reads**

Create `lib/menu/admin.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type {
  AdminAddon, AdminCategory, AdminProduct, AdminProductDetail,
} from "@/lib/menu/types";

// All reads here run under the caller's RLS. The admin SELECT policy returns
// archived rows too, so these include archived items (callers gate with isAdmin
// before rendering).

export async function listAdminAddons(): Promise<AdminAddon[]> {
  const db = await createClient();
  const { data } = await db.from("addons").select("*").order("name");
  return (data ?? []).map((a) => ({
    id: a.id, name: a.name, price: a.price, isArchived: a.is_archived,
  }));
}

export async function listAdminCategories(): Promise<AdminCategory[]> {
  const db = await createClient();
  const [cats, links] = await Promise.all([
    db.from("categories").select("*").order("sort_order").order("name"),
    db.from("category_addons").select("*").order("sort_order"),
  ]);
  return (cats.data ?? []).map((c) => ({
    id: c.id, slug: c.slug, name: c.name, sortOrder: c.sort_order,
    maxAddons: c.max_addons, isArchived: c.is_archived,
    addonIds: (links.data ?? []).filter((l) => l.category_id === c.id).map((l) => l.addon_id),
  }));
}

export async function listAdminProducts(): Promise<AdminProduct[]> {
  const db = await createClient();
  const [products, variants, cats] = await Promise.all([
    db.from("products").select("*").order("sort_order").order("name"),
    db.from("product_variants").select("*"),
    db.from("categories").select("id,name"),
  ]);
  const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
  return (products.data ?? []).map((p) => {
    const vs = (variants.data ?? []).filter((v) => v.product_id === p.id);
    const fromPrice = vs.length > 0 ? Math.min(...vs.map((v) => v.price)) : p.base_price ?? 0;
    return {
      id: p.id, slug: p.slug, name: p.name, categoryId: p.category_id,
      categoryName: catName.get(p.category_id) ?? "", fromPrice, imageUrl: p.image_url,
      isBestSeller: p.is_best_seller, isNew: p.is_new, isFeatured: p.is_featured,
      isAvailable: p.is_available, isArchived: p.is_archived, sortOrder: p.sort_order,
    };
  });
}

export async function getAdminProduct(id: string): Promise<AdminProductDetail | null> {
  const db = await createClient();
  const { data: p } = await db.from("products").select("*").eq("id", id).maybeSingle();
  if (!p) return null;
  const [variants, overrides, cats] = await Promise.all([
    db.from("product_variants").select("*").eq("product_id", id).order("sort_order"),
    db.from("product_addons").select("*").eq("product_id", id),
    db.from("categories").select("id,name"),
  ]);
  const catName = new Map((cats.data ?? []).map((c) => [c.id, c.name]));
  const vs = variants.data ?? [];
  return {
    id: p.id, slug: p.slug, name: p.name, categoryId: p.category_id,
    categoryName: catName.get(p.category_id) ?? "",
    fromPrice: vs.length > 0 ? Math.min(...vs.map((v) => v.price)) : p.base_price ?? 0,
    imageUrl: p.image_url, isBestSeller: p.is_best_seller, isNew: p.is_new,
    isFeatured: p.is_featured, isAvailable: p.is_available, isArchived: p.is_archived,
    sortOrder: p.sort_order, description: p.description, basePrice: p.base_price,
    maxAddons: p.max_addons,
    variants: vs.map((v) => ({ id: v.id, name: v.name, price: v.price })),
    addonOverrides: (overrides.data ?? []).map((o) => ({ addonId: o.addon_id, mode: o.mode as "add" | "remove" })),
  };
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` → PASS.

```bash
git add lib/menu/types.ts lib/menu/admin.ts
git commit -m "feat(cms): admin menu reads + view types"
```

---

## Task 11: Menu list screen + inline toggle/archive actions

**Files:**
- Create: `app/(admin)/admin/menu/page.tsx`, `app/(admin)/admin/menu/actions.ts`, `components/admin/menu-list-live.tsx`

**Interfaces:**
- Consumes: `listAdminProducts`, `listAdminCategories`, `isAdmin`.
- Produces Server Actions: `setAvailability(id, value)`, `setFlag(id, flag, value)`, `setArchived(id, value)` where `flag ∈ "best_seller" | "new" | "featured"`. Each returns `{ ok: true } | { ok: false; error: string }`.

- [ ] **Step 1: Write the list actions**

Create `app/(admin)/admin/menu/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

const FLAG_COLUMN = {
  best_seller: "is_best_seller",
  new: "is_new",
  featured: "is_featured",
} as const;
type Flag = keyof typeof FLAG_COLUMN;

// Revalidate the CMS list and the storefront surfaces a menu change affects.
function revalidateStorefront() {
  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  revalidatePath("/menu/[slug]", "page");
  revalidatePath("/home");
}

export async function setAvailability(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("products").update({ is_available: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateStorefront();
  return { ok: true };
}

export async function setFlag(id: string, flag: Flag, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("products").update({ [FLAG_COLUMN[flag]]: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateStorefront();
  return { ok: true };
}

export async function setArchived(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("products").update({ is_archived: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateStorefront();
  return { ok: true };
}
```

- [ ] **Step 2: Write the list page (server)**

Create `app/(admin)/admin/menu/page.tsx`:

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";
import { listAdminProducts, listAdminCategories } from "@/lib/menu/admin";
import { MenuListLive } from "@/components/admin/menu-list-live";

export const dynamic = "force-dynamic";

export default async function AdminMenuPage() {
  const [products, categories] = await Promise.all([listAdminProducts(), listAdminCategories()]);
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-5 py-4">
        <h1 className="font-heading text-lg font-bold tracking-tight">Menu</h1>
        <div className="flex items-center gap-2">
          <Link href="/admin/categories" className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold">
            Categories
          </Link>
          <Link href="/admin/addons" className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold">
            Add-ons
          </Link>
          <Link href="/admin/menu/new" className="flex items-center gap-1 rounded-full bg-black px-3 py-1.5 text-xs font-semibold text-white">
            <Plus className="size-4" /> New
          </Link>
        </div>
      </div>
      <MenuListLive products={products} categories={categories} />
    </div>
  );
}
```

- [ ] **Step 3: Write the interactive list**

Create `components/admin/menu-list-live.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { SmartImage } from "@/components/ui/smart-image";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AdminCategory, AdminProduct } from "@/lib/menu/types";
import { setAvailability, setFlag, setArchived } from "@/app/(admin)/admin/menu/actions";

export function MenuListLive({
  products, categories,
}: { products: AdminProduct[]; categories: AdminCategory[] }) {
  const [rows, setRows] = useState(products);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [, startTransition] = useTransition();

  const visible = rows.filter((p) => {
    if (!showArchived && p.isArchived) return false;
    const q = query.trim().toLowerCase();
    return q === "" || p.name.toLowerCase().includes(q);
  });

  function patch(id: string, next: Partial<AdminProduct>) {
    setRows((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));
  }

  function onAvailability(p: AdminProduct, value: boolean) {
    patch(p.id, { isAvailable: value });
    startTransition(async () => {
      const res = await setAvailability(p.id, value);
      if (!res.ok) patch(p.id, { isAvailable: !value });
    });
  }

  function onFlag(p: AdminProduct, flag: "best_seller" | "new" | "featured", value: boolean) {
    const key = flag === "best_seller" ? "isBestSeller" : flag === "new" ? "isNew" : "isFeatured";
    patch(p.id, { [key]: value } as Partial<AdminProduct>);
    startTransition(async () => {
      const res = await setFlag(p.id, flag, value);
      if (!res.ok) patch(p.id, { [key]: !value } as Partial<AdminProduct>);
    });
  }

  function onArchiveToggle(p: AdminProduct) {
    const value = !p.isArchived;
    patch(p.id, { isArchived: value });
    startTransition(async () => {
      const res = await setArchived(p.id, value);
      if (!res.ok) patch(p.id, { isArchived: !value });
    });
  }

  const byCategory = categories.map((c) => ({
    category: c,
    items: visible.filter((p) => p.categoryId === c.id),
  }));

  return (
    <div className="flex flex-col gap-3 px-5 pb-8">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items..."
          aria-label="Search items" className="h-10 pl-10" />
      </div>
      <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Switch checked={showArchived} onCheckedChange={setShowArchived} /> Show archived
      </label>

      {byCategory.map(({ category, items }) => (
        <section key={category.id} className="flex flex-col gap-2">
          <h2 className="pt-2 text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
            {category.name}
          </h2>
          {items.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">No items.</p>
          ) : (
            items.map((p) => (
              <div key={p.id} className={cn("flex flex-col gap-2 rounded-2xl border border-border p-3", p.isArchived && "opacity-50")}>
                <div className="flex items-center gap-3">
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
                    <SmartImage src={p.imageUrl ?? "/brand/coffee_with_logo.png"} alt={p.name} fill sizes="48px" className="object-contain" />
                  </div>
                  <Link href={`/admin/menu/${p.id}`} className="flex flex-1 flex-col">
                    <span className="text-sm font-semibold">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{formatPrice(p.fromPrice)}</span>
                  </Link>
                  <label className="flex flex-col items-center gap-1 text-[0.625rem] font-medium text-muted-foreground">
                    Available
                    <Switch checked={p.isAvailable} onCheckedChange={(v) => onAvailability(p, v)} />
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <FlagChip label="Best Seller" active={p.isBestSeller} onClick={() => onFlag(p, "best_seller", !p.isBestSeller)} />
                  <FlagChip label="New" active={p.isNew} onClick={() => onFlag(p, "new", !p.isNew)} />
                  <FlagChip label="Featured" active={p.isFeatured} onClick={() => onFlag(p, "featured", !p.isFeatured)} />
                  <button onClick={() => onArchiveToggle(p)} className="ml-auto text-[0.625rem] font-semibold text-muted-foreground underline">
                    {p.isArchived ? "Restore" : "Archive"}
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      ))}
    </div>
  );
}

function FlagChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={cn("rounded-full border px-2.5 py-1 text-[0.625rem] font-semibold transition-colors",
        active ? "border-black bg-black text-white" : "border-border bg-white text-muted-foreground")}>
      {label}
    </button>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
As admin, open `/admin/menu`: items grouped by category; toggling Available flips the switch and persists (reload confirms); toggling a flag persists; Archive hides the item (toggle "Show archived" to restore). On the storefront, an unavailable item still shows; an archived item disappears from `/menu`.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/menu/page.tsx" "app/(admin)/admin/menu/actions.ts" components/admin/menu-list-live.tsx
git commit -m "feat(cms): menu list with inline availability/flag/archive toggles"
```

---

## Task 12: Item editor (create/edit) + image upload + write actions

**Files:**
- Create: `app/(admin)/admin/menu/new/page.tsx`, `app/(admin)/admin/menu/[id]/page.tsx`, `components/admin/product-form.tsx`, `components/admin/image-upload.tsx`
- Modify: `app/(admin)/admin/menu/actions.ts` (add `saveProduct`, `uploadProductImage`, `slugify`)

**Interfaces:**
- Consumes: `getAdminProduct`, `listAdminCategories`, `listAdminAddons`; `ProductFormData`.
- Produces Server Actions: `saveProduct(data: ProductFormData): Promise<{ ok: true; id: string } | { ok: false; error: string }>`, `uploadProductImage(formData: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }>`.

- [ ] **Step 1: Add the write actions**

Append to `app/(admin)/admin/menu/actions.ts`:

```ts
import { createAdminClient } from "@/lib/supabase/admin";
import type { ProductFormData } from "@/lib/menu/types";

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Validate, then upsert the product, replace its variants, and replace its
// add-on overrides. Variants/overrides are replace-all (delete then insert) —
// simplest correct approach for a small menu.
export async function saveProduct(data: ProductFormData): Promise<SaveResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };

  const name = data.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!data.categoryId) return { ok: false, error: "Pick a category." };

  if (data.pricingMode === "flat") {
    if (data.basePrice == null || data.basePrice < 0) return { ok: false, error: "Enter a valid price." };
  } else {
    if (data.variants.length === 0) return { ok: false, error: "Add at least one size." };
    if (data.variants.some((v) => !v.name.trim() || v.price < 0)) {
      return { ok: false, error: "Every size needs a name and a valid price." };
    }
  }

  const db = await createClient();
  const slug = data.slug.trim() ? slugify(data.slug) : slugify(name);

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
  };

  let productId = data.id;
  if (productId) {
    const { error } = await db.from("products").update(payload).eq("id", productId);
    if (error) return { ok: false, error: error.code === "23505" ? "That slug is already used." : error.message };
  } else {
    const { data: row, error } = await db.from("products").insert(payload).select("id").single();
    if (error || !row) return { ok: false, error: error?.code === "23505" ? "That slug is already used." : error?.message ?? "Insert failed." };
    productId = row.id;
  }

  // Replace variants.
  await db.from("product_variants").delete().eq("product_id", productId);
  if (data.pricingMode === "variants") {
    const rows = data.variants.map((v, i) => ({ product_id: productId!, name: v.name.trim(), price: v.price, sort_order: i }));
    const { error } = await db.from("product_variants").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  // Replace add-on overrides.
  await db.from("product_addons").delete().eq("product_id", productId);
  if (data.addonOverrides.length > 0) {
    const rows = data.addonOverrides.map((o, i) => ({ product_id: productId!, addon_id: o.addonId, mode: o.mode, sort_order: i }));
    const { error } = await db.from("product_addons").insert(rows);
    if (error) return { ok: false, error: error.message };
  }

  revalidateStorefront();
  return { ok: true, id: productId };
}

// Upload a product image to the public `products` bucket and return its URL.
// Uses the service-role client so the write succeeds regardless of cookie
// propagation; the action is already admin-gated above.
export async function uploadProductImage(formData: FormData): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file." };
  if (file.size > 5_242_880) return { ok: false, error: "Image must be under 5 MB." };

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;
  const db = createAdminClient();
  const { error } = await db.storage.from("products").upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { ok: false, error: error.message };
  const { data } = db.storage.from("products").getPublicUrl(path);
  return { ok: true, url: data.publicUrl };
}
```

- [ ] **Step 2: Image upload component**

Create `components/admin/image-upload.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { SmartImage } from "@/components/ui/smart-image";
import { uploadProductImage } from "@/app/(admin)/admin/menu/actions";

export function ImageUpload({
  value, onChange,
}: { value: string | null; onChange: (url: string | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadProductImage(fd);
      if (res.ok) onChange(res.url);
      else setError(res.error);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-neutral-100">
        <SmartImage src={value ?? "/brand/coffee_with_logo.png"} alt="Product image" fill sizes="80px" className="object-contain" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-semibold">
          {pending ? "Uploading…" : value ? "Replace image" : "Upload image"}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPick} disabled={pending} />
        </label>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="text-left text-[0.625rem] font-semibold text-muted-foreground underline">
            Remove
          </button>
        )}
        {error && <p className="text-[0.625rem] text-rose-600">{error}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: The product form**

Create `components/admin/product-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ImageUpload } from "@/components/admin/image-upload";
import { saveProduct } from "@/app/(admin)/admin/menu/actions";
import type { AdminAddon, AdminCategory, AdminProductDetail, ProductFormData } from "@/lib/menu/types";

// Convert RM string <-> sen for the price inputs.
const toSen = (rm: string) => Math.round(parseFloat(rm || "0") * 100);
const toRm = (sen: number | null) => (sen == null ? "" : (sen / 100).toFixed(2));

export function ProductForm({
  product, categories, addons,
}: { product: AdminProductDetail | null; categories: AdminCategory[]; addons: AdminAddon[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(product?.name ?? "");
  const [slug, setSlug] = useState(product?.slug ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(product?.imageUrl ?? null);
  const [pricingMode, setPricingMode] = useState<"variants" | "flat">(
    product ? (product.variants.length > 0 ? "variants" : "flat") : "variants",
  );
  const [basePrice, setBasePrice] = useState(toRm(product?.basePrice ?? null));
  const [variants, setVariants] = useState(
    product?.variants.map((v) => ({ name: v.name, price: toRm(v.price) })) ?? [{ name: "Regular", price: "" }],
  );
  const [maxAddons, setMaxAddons] = useState(product?.maxAddons != null ? String(product.maxAddons) : "");
  const [isBestSeller, setIsBestSeller] = useState(product?.isBestSeller ?? false);
  const [isNew, setIsNew] = useState(product?.isNew ?? false);
  const [isFeatured, setIsFeatured] = useState(product?.isFeatured ?? false);
  const [isAvailable, setIsAvailable] = useState(product?.isAvailable ?? true);

  const selectedCategory = categories.find((c) => c.id === categoryId);
  const overrideMap = new Map(product?.addonOverrides.map((o) => [o.addonId, o.mode]) ?? []);
  // Effective state per addon: checked if (category default && not removed) || added.
  const [overrides, setOverrides] = useState<Map<string, "add" | "remove">>(new Map(overrideMap));

  function isChecked(addonId: string): boolean {
    const mode = overrides.get(addonId);
    const isDefault = selectedCategory?.addonIds.includes(addonId) ?? false;
    if (mode === "add") return true;
    if (mode === "remove") return false;
    return isDefault;
  }

  function toggleAddon(addonId: string) {
    const isDefault = selectedCategory?.addonIds.includes(addonId) ?? false;
    const next = new Map(overrides);
    const checkedNow = isChecked(addonId);
    if (checkedNow) {
      if (isDefault) next.set(addonId, "remove");
      else next.delete(addonId);
    } else {
      if (isDefault) next.delete(addonId);
      else next.set(addonId, "add");
    }
    setOverrides(next);
  }

  function submit() {
    setError(null);
    const data: ProductFormData = {
      id: product?.id,
      name, slug, description, categoryId, imageUrl,
      pricingMode,
      basePrice: pricingMode === "flat" ? toSen(basePrice) : null,
      variants: pricingMode === "variants" ? variants.map((v) => ({ name: v.name, price: toSen(v.price) })) : [],
      maxAddons: maxAddons.trim() === "" ? null : Number(maxAddons),
      isBestSeller, isNew, isFeatured, isAvailable,
      addonOverrides: [...overrides.entries()].map(([addonId, mode]) => ({ addonId, mode })),
    };
    startTransition(async () => {
      const res = await saveProduct(data);
      if (res.ok) router.push("/admin/menu");
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-5 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">{product ? "Edit item" : "New item"}</h1>

      <ImageUpload value={imageUrl} onChange={setImageUrl} />

      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Slug (optional — auto from name)"><Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto" /></Field>
      <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></Field>

      <Field label="Category">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
          className="h-10 rounded-md border border-border bg-white px-3 text-sm">
          {categories.filter((c) => !c.isArchived).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>

      <div className="flex flex-col gap-2">
        <Label>Pricing</Label>
        <div className="flex gap-2">
          <ModeButton active={pricingMode === "variants"} onClick={() => setPricingMode("variants")}>Sizes</ModeButton>
          <ModeButton active={pricingMode === "flat"} onClick={() => setPricingMode("flat")}>Flat price</ModeButton>
        </div>
        {pricingMode === "flat" ? (
          <Input inputMode="decimal" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} placeholder="0.00" />
        ) : (
          <div className="flex flex-col gap-2">
            {variants.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input value={v.name} onChange={(e) => setVariants((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Size name" className="flex-1" />
                <Input inputMode="decimal" value={v.price} onChange={(e) => setVariants((p) => p.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} placeholder="0.00" className="w-24" />
                <button type="button" onClick={() => setVariants((p) => p.filter((_, j) => j !== i))} aria-label="Remove size" className="text-muted-foreground"><Trash2 className="size-4" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setVariants((p) => [...p, { name: "", price: "" }])} className="flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Plus className="size-4" /> Add size</button>
          </div>
        )}
      </div>

      <Field label="Max add-ons (optional — defaults to category)">
        <Input inputMode="numeric" value={maxAddons} onChange={(e) => setMaxAddons(e.target.value)} placeholder={String(selectedCategory?.maxAddons ?? 3)} className="w-24" />
      </Field>

      <div className="flex flex-col gap-2">
        <Label>Add-ons {selectedCategory && <span className="font-normal text-muted-foreground">(category defaults pre-checked)</span>}</Label>
        <div className="flex flex-col gap-1">
          {addons.filter((a) => !a.isArchived).map((a) => (
            <label key={a.id} className="flex items-center gap-3 py-1.5 text-sm">
              <input type="checkbox" checked={isChecked(a.id)} onChange={() => toggleAddon(a.id)} className="size-4" />
              <span className="flex-1">{a.name}</span>
              <span className="text-xs text-muted-foreground">{toRm(a.price)}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
        <ToggleRow label="Available" checked={isAvailable} onChange={setIsAvailable} />
        <ToggleRow label="Best Seller" checked={isBestSeller} onChange={setIsBestSeller} />
        <ToggleRow label="New" checked={isNew} onChange={setIsNew} />
        <ToggleRow label="Featured" checked={isFeatured} onChange={setIsFeatured} />
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex gap-2 pb-8">
        <button type="button" onClick={() => router.push("/admin/menu")} className="flex-1 rounded-2xl border border-border py-3 text-sm font-semibold">Cancel</button>
        <button type="button" onClick={submit} disabled={pending} className="flex-1 rounded-2xl bg-black py-3 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5"><Label>{label}</Label>{children}</div>;
}
function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", active ? "border-black bg-black text-white" : "border-border")}>{children}</button>;
}
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center justify-between text-sm font-medium"><span>{label}</span><Switch checked={checked} onCheckedChange={onChange} /></label>;
}
```

- [ ] **Step 4: The new + edit pages**

Create `app/(admin)/admin/menu/new/page.tsx`:

```tsx
import { listAdminCategories, listAdminAddons } from "@/lib/menu/admin";
import { ProductForm } from "@/components/admin/product-form";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const [categories, addons] = await Promise.all([listAdminCategories(), listAdminAddons()]);
  return <ProductForm product={null} categories={categories} addons={addons} />;
}
```

Create `app/(admin)/admin/menu/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getAdminProduct, listAdminCategories, listAdminAddons } from "@/lib/menu/admin";
import { ProductForm } from "@/components/admin/product-form";

export const dynamic = "force-dynamic";

export default async function EditProductPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const [product, categories, addons] = await Promise.all([
    getAdminProduct(id), listAdminCategories(), listAdminAddons(),
  ]);
  if (!product) notFound();
  return <ProductForm product={product} categories={categories} addons={addons} />;
}
```

- [ ] **Step 5: Verify end to end**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
As admin:
- `/admin/menu/new`: upload an image (appears in preview), create a sized coffee, save → returns to list, item appears, image shows on `/menu`.
- Edit Americano: switch to "Sizes", add Regular/Large, save → `/menu/americano` now shows a size selector.
- Edit a coffee: uncheck "Extra Shot" (a category default) → on `/menu/<that item>` the add-on list no longer offers Extra Shot, while other coffees still do.
- Edit a coffee: check an add-on not in its category (e.g. Pearls) → it now appears for that item only.
- Try saving with a duplicate slug → inline error "That slug is already used."

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/admin/menu/actions.ts" "app/(admin)/admin/menu/new" "app/(admin)/admin/menu/[id]" components/admin/product-form.tsx components/admin/image-upload.tsx
git commit -m "feat(cms): item editor with variants, add-on overrides, image upload"
```

---

## Task 13: Categories screen + actions

**Files:**
- Create: `app/(admin)/admin/categories/page.tsx`, `app/(admin)/admin/categories/actions.ts`, `components/admin/category-manager.tsx`

**Interfaces:**
- Consumes: `listAdminCategories`, `listAdminAddons`.
- Produces Server Actions: `saveCategory(input)`, `reorderCategories(ids: string[])`, `setCategoryArchived(id, value)`, `setCategoryAddons(categoryId, addonIds: string[])`.

- [ ] **Step 1: Category actions**

Create `app/(admin)/admin/categories/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function revalidateAll() {
  revalidatePath("/admin/categories");
  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  revalidatePath("/home");
}

export async function saveCategory(input: { id?: string; name: string; maxAddons: number }): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (input.maxAddons < 0) return { ok: false, error: "Max add-ons must be 0 or more." };
  const db = await createClient();
  if (input.id) {
    const { error } = await db.from("categories").update({ name, max_addons: input.maxAddons }).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from("categories").insert({ name, slug: slugify(name), max_addons: input.maxAddons });
    if (error) return { ok: false, error: error.code === "23505" ? "That category already exists." : error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function reorderCategories(ids: string[]): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  for (let i = 0; i < ids.length; i++) {
    const { error } = await db.from("categories").update({ sort_order: i }).eq("id", ids[i]);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function setCategoryArchived(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("categories").update({ is_archived: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// Replace a category's default add-on set.
export async function setCategoryAddons(categoryId: string, addonIds: string[]): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  await db.from("category_addons").delete().eq("category_id", categoryId);
  if (addonIds.length > 0) {
    const rows = addonIds.map((addon_id, i) => ({ category_id: categoryId, addon_id, sort_order: i }));
    const { error } = await db.from("category_addons").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}
```

- [ ] **Step 2: Category manager component**

Create `components/admin/category-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AdminAddon, AdminCategory } from "@/lib/menu/types";
import {
  saveCategory, reorderCategories, setCategoryArchived, setCategoryAddons,
} from "@/app/(admin)/admin/categories/actions";

export function CategoryManager({
  initial, addons,
}: { initial: AdminCategory[]; addons: AdminAddon[] }) {
  const [cats, setCats] = useState(initial);
  const [, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  function refreshFromServer() { startTransition(() => window.location.reload()); }

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await saveCategory({ name: newName, maxAddons: 3 });
      if (res.ok) { setNewName(""); refreshFromServer(); } else setError(res.error);
    });
  }
  function move(i: number, dir: -1 | 1) {
    const next = [...cats];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setCats(next);
    startTransition(async () => { await reorderCategories(next.map((c) => c.id)); });
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Categories</h1>

      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>New category</Label>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Pastries" />
        </div>
        <button onClick={add} className="rounded-2xl bg-black px-4 py-2.5 text-sm font-semibold text-white">Add</button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex flex-col gap-2">
        {cats.map((c, i) => (
          <CategoryRow key={c.id} category={c} addons={addons}
            onUp={() => move(i, -1)} onDown={() => move(i, 1)} onChanged={refreshFromServer} />
        ))}
      </div>
    </div>
  );
}

function CategoryRow({
  category, addons, onUp, onDown, onChanged,
}: { category: AdminCategory; addons: AdminAddon[]; onUp: () => void; onDown: () => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(category.name);
  const [maxAddons, setMaxAddons] = useState(String(category.maxAddons));
  const [picked, setPicked] = useState<Set<string>>(new Set(category.addonIds));
  const [, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      await saveCategory({ id: category.id, name, maxAddons: Number(maxAddons) });
      await setCategoryAddons(category.id, [...picked]);
      onChanged();
    });
  }
  function toggleAddon(id: string) {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  }

  return (
    <div className={cn("rounded-2xl border border-border p-3", category.isArchived && "opacity-50")}>
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <button onClick={onUp} aria-label="Move up"><ChevronUp className="size-4 text-muted-foreground" /></button>
          <button onClick={onDown} aria-label="Move down"><ChevronDown className="size-4 text-muted-foreground" /></button>
        </div>
        <span className="flex-1 text-sm font-semibold">{category.name}</span>
        <button onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-muted-foreground underline">{open ? "Close" : "Edit"}</button>
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="flex flex-col gap-1.5"><Label>Max add-ons</Label><Input inputMode="numeric" value={maxAddons} onChange={(e) => setMaxAddons(e.target.value)} className="w-24" /></div>
          <div className="flex flex-col gap-1.5">
            <Label>Default add-ons</Label>
            {addons.filter((a) => !a.isArchived).map((a) => (
              <label key={a.id} className="flex items-center gap-3 py-1 text-sm">
                <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggleAddon(a.id)} className="size-4" />
                <span className="flex-1">{a.name}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => startTransition(async () => { await setCategoryArchived(category.id, !category.isArchived); onChanged(); })}
              className="rounded-2xl border border-border px-4 py-2 text-sm font-semibold">
              {category.isArchived ? "Restore" : "Archive"}
            </button>
            <button onClick={save} className="flex-1 rounded-2xl bg-black py-2 text-sm font-semibold text-white">Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Categories page**

Create `app/(admin)/admin/categories/page.tsx`:

```tsx
import { listAdminCategories, listAdminAddons } from "@/lib/menu/admin";
import { CategoryManager } from "@/components/admin/category-manager";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const [categories, addons] = await Promise.all([listAdminCategories(), listAdminAddons()]);
  return <CategoryManager initial={categories} addons={addons} />;
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
As admin: add "Pastries"; it appears on `/menu` tabs. Reorder with up/down → tab order on `/menu` changes. Edit a category's default add-ons → a product in that category (with no overrides) reflects the new set on `/menu/<slug>`. Archive an empty category → it disappears from `/menu` tabs. (Archiving a category with products fails at DB level due to `on delete restrict`; that's fine — the archive flag still hides it; products keep their category_id.)

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/categories" components/admin/category-manager.tsx
git commit -m "feat(cms): category management (CRUD, reorder, default add-ons)"
```

---

## Task 14: Add-ons screen + actions

**Files:**
- Create: `app/(admin)/admin/addons/page.tsx`, `app/(admin)/admin/addons/actions.ts`, `components/admin/addon-manager.tsx`

**Interfaces:**
- Consumes: `listAdminAddons`.
- Produces Server Actions: `saveAddon({ id?, name, price })`, `setAddonArchived(id, value)`.

- [ ] **Step 1: Add-on actions**

Create `app/(admin)/admin/addons/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/admin/addons");
  revalidatePath("/admin/menu");
  revalidatePath("/menu");
}

export async function saveAddon(input: { id?: string; name: string; price: number }): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (input.price < 0) return { ok: false, error: "Price must be 0 or more." };
  const db = await createClient();
  if (input.id) {
    const { error } = await db.from("addons").update({ name, price: input.price }).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from("addons").insert({ name, price: input.price });
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function setAddonArchived(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("addons").update({ is_archived: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}
```

- [ ] **Step 2: Add-on manager component**

Create `components/admin/addon-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AdminAddon } from "@/lib/menu/types";
import { saveAddon, setAddonArchived } from "@/app/(admin)/admin/addons/actions";

const toSen = (rm: string) => Math.round(parseFloat(rm || "0") * 100);
const toRm = (sen: number) => (sen / 100).toFixed(2);

export function AddonManager({ initial }: { initial: AdminAddon[] }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function reload() { startTransition(() => window.location.reload()); }
  function add() {
    setError(null);
    startTransition(async () => {
      const res = await saveAddon({ name, price: toSen(price) });
      if (res.ok) { setName(""); setPrice(""); reload(); } else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Add-ons</h1>

      <div className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Oat Milk" /></div>
        <div className="flex w-24 flex-col gap-1.5"><Label>Price</Label><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" /></div>
        <button onClick={add} className="rounded-2xl bg-black px-4 py-2.5 text-sm font-semibold text-white">Add</button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex flex-col gap-2">
        {initial.map((a) => <AddonRow key={a.id} addon={a} onChanged={reload} />)}
      </div>
    </div>
  );
}

function AddonRow({ addon, onChanged }: { addon: AdminAddon; onChanged: () => void }) {
  const [name, setName] = useState(addon.name);
  const [price, setPrice] = useState(toRm(addon.price));
  const [, startTransition] = useTransition();

  return (
    <div className={cn("flex items-center gap-2 rounded-2xl border border-border p-3", addon.isArchived && "opacity-50")}>
      <Input value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
      <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="w-20" />
      <button onClick={() => startTransition(async () => { await saveAddon({ id: addon.id, name, price: toSen(price) }); onChanged(); })}
        className="rounded-xl bg-black px-3 py-2 text-xs font-semibold text-white">Save</button>
      <button onClick={() => startTransition(async () => { await setAddonArchived(addon.id, !addon.isArchived); onChanged(); })}
        className="text-[0.625rem] font-semibold text-muted-foreground underline">{addon.isArchived ? "Restore" : "Archive"}</button>
    </div>
  );
}
```

- [ ] **Step 3: Add-ons page**

Create `app/(admin)/admin/addons/page.tsx`:

```tsx
import { listAdminAddons } from "@/lib/menu/admin";
import { AddonManager } from "@/components/admin/addon-manager";

export const dynamic = "force-dynamic";

export default async function AddonsPage() {
  const addons = await listAdminAddons();
  return <AddonManager initial={addons} />;
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
As admin: add "Whipped Cream" RM2.50; it becomes selectable in the item editor's add-on list and in the category default picker. Edit an add-on's price → the new price shows on `/menu/<slug>` for items that offer it. Archive an add-on → it drops out of the customizer.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/addons" components/admin/addon-manager.tsx
git commit -m "feat(cms): add-on pool management"
```

---

## Task 15: Final RLS + parity verification

**Files:** none (verification only).

- [ ] **Step 1: Verify RLS enforcement via Supabase MCP**

Call `get_advisors` with `type: "security"`. Expected: no new "RLS disabled" findings for the six menu tables. Address any that appear (every menu table must have RLS on).

- [ ] **Step 2: Verify a non-admin cannot write**

Confirm by reasoning + policy: the only write policy on each menu table is `*_write_admin` requiring `current_user_role() = 'admin'`. As a sanity check, run `execute_sql`:

```sql
select tablename, policyname, cmd from pg_policies
where schemaname = 'public'
  and tablename in ('products','categories','addons','product_variants','category_addons','product_addons')
order by tablename, cmd;
```

Expected: each table has SELECT policies (anon/auth read) and exactly one `ALL` admin write policy. No INSERT/UPDATE/DELETE policy open to non-admins.

- [ ] **Step 3: Full storefront + CMS smoke test**

Run `npm run build` → succeeds. Run `npm run dev` and confirm end to end:
- Storefront `/home`, `/menu`, `/menu/[slug]`, add-to-cart, checkout flow all work and match pre-Phase-1 behavior for the seeded menu.
- As `customer`/`staff`: `/admin` redirects to `/`.
- As `admin`: full menu/category/add-on management works; changes reflect on the storefront after navigation.

- [ ] **Step 4: Final typecheck + lint**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.

- [ ] **Step 5: Commit any cleanup**

```bash
git add -A
git commit -m "test(cms): verify Phase 1 RLS + storefront/CMS parity" --allow-empty
```

---

## Self-review notes (addressed in this plan)

- **Spec coverage:** schema & RLS (Tasks 1, 8, 15), seed (Task 2), cutover + parity (Tasks 4-7), admin shell + drawer + gating (Task 9), menu list with inline toggles + archive (Task 11), item editor with variants + hybrid add-on overrides + image upload (Task 12), categories CRUD/reorder/default-add-ons (Task 13), add-ons CRUD (Task 14), data layer + Server Actions + error handling (Tasks 5, 10-14). Stubs for the other 6 modules (Task 9).
- **`getBasePrice` relocation** (Task 4) prevents the `data/menu.ts` deletion (Task 7) from breaking the still-live discount layer.
- **`current_user_role()` is anon-unsafe** → SELECT policies split by role (Task 1).
- **Type consistency:** `ActionResult`/`SaveResult` shapes, `ProductFormData`, and the `AdminProduct*` types are defined once (Tasks 10-11) and reused; action names (`saveProduct`, `saveCategory`, `saveAddon`, `setAvailability`, `setFlag`, `setArchived`, `setCategoryAddons`) are referenced consistently by their components.
- **Out of scope (per spec):** promotions, rewards config, dashboard metrics, reports, customers, settings — stubbed only.
