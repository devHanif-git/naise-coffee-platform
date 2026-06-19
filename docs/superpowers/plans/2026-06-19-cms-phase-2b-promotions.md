# CMS Phase 2B — Promotions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move NAISE COFFEE promotions (percent-off "discount days") out of the hardcoded `data/discounts.ts` into Postgres — adding an on/off toggle and an optional scheduling window — point the storefront at the DB with no visible change, then build the admin **Promotions** module at `/admin/promotions`.

**Architecture:** Read-path first, like Phase 1 and Phase 2A. Build the schema + seed, then resolve the active discount **server-side in the menu store** and attach it to each `Product` as `product.discount`; the pure pricing helpers (`getProductPricing`, `getProductDiscount`, `applyDiscount`) move to `lib/promotions/pricing.ts` and become pure reads of `product.discount`. So the client consumers (`menu-card`, `best-seller-carousel`, `product-customizer`) only change an import path. Verify parity, delete `data/discounts.ts`, then layer the admin module on top. Writes go through Server Actions gated to `admin` and backed by RLS.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), TypeScript (strict, no `any`), Tailwind, shadcn/ui, Supabase (Postgres + RLS). Migrations applied via the Supabase MCP tools.

**Scope note:** Second of two Phase-2 plans. The Rewards plan (`2026-06-19-cms-phase-2a-rewards.md`) is independent and can land before or after this one. This plan touches **only** promotions/discounts and the pricing read path; it does not touch rewards.

## Global Constraints

- **Money is integer sen** (1 MYR = 100 sen); `percent_off` is a whole-number percent. Never floats. (`AGENTS.md`, `lib/format.ts`.)
- **No `any`; strict TypeScript.** (`AGENTS.md`.)
- **No new libraries.** Needed shadcn primitives (`switch`, `label`, `select`, `alert-dialog`) already exist from Phase 1. Do not install anything else without asking.
- **Images via `next/image`** (`SmartImage`). Not central here; promotions have no images.
- **Server-only Supabase**: cookie-scoped reads use `createClient()` from `lib/supabase/server.ts`; the browser client is for client components. `createAdminClient()` (service role) must never reach a client component (not needed in this plan).
- **No test harness exists.** Verify each task with `npx tsc --noEmit`, `npm run lint`, Supabase SQL/RLS checks via MCP, and manual storefront parity. Do **not** add a test runner.
- **Migrations**: write the SQL file into `supabase/migrations/` with a timestamp later than `20260619100300` (the last Phase-1 migration; if the Rewards plan also ran, later than its `20260619110200`). Use the `20260619120000+` range here so it sorts after both. Apply through the Supabase MCP `apply_migration` tool. File = source of truth.
- **Helpers that already exist**: `public.set_updated_at()`, `public.current_user_role()` (execute granted to `authenticated` only, NOT `anon`), `isAdmin()` in `lib/auth/session.ts`, `getBasePrice()` in `lib/menu/pricing.ts`, `listAdminProducts`/`listAdminCategories` in `lib/menu/admin.ts`.
- **"Applies now"** = `is_active = true AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())`. When several apply to one product, the **biggest `percent_off` wins** (unchanged from `data/discounts.ts`).
- **Promotions may be hard-deleted in the UI.** Order lines snapshot `discountLabel`/`discountPercentOff` at add-time and have no FK to `promotions`, so deleting a promotion never corrupts history.

---

## File Structure

**Created:**
- `supabase/migrations/20260619120000_promotions_schema.sql` — 3 tables, indexes, triggers, RLS.
- `supabase/migrations/20260619120100_promotions_seed.sql` — seed from current `data/discounts.ts`.
- `lib/promotions/pricing.ts` — pure, client-safe pricing helpers (`applyDiscount`, `getProductPricing`, `getProductDiscount`, `resolveActiveDiscount`, `promotionStatus`).
- `lib/promotions/store.ts` — server-only `listActivePromotions()`.
- `lib/promotions/types.ts` — admin view types.
- `lib/promotions/admin.ts` — server-only admin reads (incl. inactive).
- `app/(admin)/admin/promotions/actions.ts` — promotion Server Actions.
- `components/admin/promotions-manager.tsx` — CMS UI (list + editor).

**Modified:**
- `types/menu.ts` — add optional `discount?: Discount` to `Product`.
- `lib/menu/store.ts` — attach the resolved active discount to each product in `fetchCatalog`.
- `components/menu-card.tsx`, `components/best-seller-carousel.tsx`, `components/product-customizer.tsx`, `app/(customer)/menu/[slug]/page.tsx` — import pricing helpers from `@/lib/promotions/pricing` instead of `@/data/discounts`.
- `types/database.ts` — regenerated after the schema migration.
- `app/(admin)/admin/promotions/page.tsx` — replace the "Coming soon" stub with the live module.

**Deleted (end of read-path stage):**
- `data/discounts.ts`.

---

# STAGE A — Read-path first (schema → seed → cutover)

## Task 1: Promotions schema migration (3 tables, indexes, triggers, RLS)

**Files:**
- Create: `supabase/migrations/20260619120000_promotions_schema.sql`

**Interfaces:**
- Produces: tables `public.promotions`, `public.promotion_products`, `public.promotion_categories`. Column names are consumed by every later task.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260619120000_promotions_schema.sql`:

```sql
-- Promotions: percent-off "discount days" targeting products and/or categories,
-- with an on/off toggle and an optional [starts_at, ends_at) window. Replaces
-- hardcoded data/discounts.ts. RLS: public read of active promotions; admin-only
-- writes. Reuses public.set_updated_at() and public.current_user_role() (anon
-- CANNOT execute current_user_role(), so anon SELECT policies never call it).

create table public.promotions (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  label       text not null,
  percent_off integer not null check (percent_off between 1 and 100),
  is_active   boolean not null default true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.promotion_products (
  promotion_id uuid not null references public.promotions (id) on delete cascade,
  product_id   uuid not null references public.products (id) on delete cascade,
  primary key (promotion_id, product_id)
);

create table public.promotion_categories (
  promotion_id uuid not null references public.promotions (id) on delete cascade,
  category_id  uuid not null references public.categories (id) on delete cascade,
  primary key (promotion_id, category_id)
);

-- Indexes ----------------------------------------------------------------------
create index promotions_active_idx on public.promotions (is_active) where is_active;
create index promotion_products_product_id_idx on public.promotion_products (product_id);
create index promotion_categories_category_id_idx on public.promotion_categories (category_id);

-- updated_at trigger -----------------------------------------------------------
create trigger promotions_set_updated_at before update on public.promotions
  for each row execute function public.set_updated_at();

-- RLS --------------------------------------------------------------------------
alter table public.promotions enable row level security;
alter table public.promotion_products enable row level security;
alter table public.promotion_categories enable row level security;

-- promotions: public read active; admin read all + write. (Window filtering is
-- done in the storefront query, not RLS.)
create policy "promotions_read_anon" on public.promotions for select to anon
  using (is_active);
create policy "promotions_read_auth" on public.promotions for select to authenticated
  using (is_active or public.current_user_role() = 'admin');
create policy "promotions_write_admin" on public.promotions for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

-- Link tables only reference promo + catalog rows; readable by everyone.
create policy "promotion_products_read_all" on public.promotion_products for select
  to anon, authenticated using (true);
create policy "promotion_categories_read_all" on public.promotion_categories for select
  to anon, authenticated using (true);

create policy "promotion_products_write_admin" on public.promotion_products for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "promotion_categories_write_admin" on public.promotion_categories for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
```

- [ ] **Step 2: Apply via Supabase MCP**

Call `apply_migration` with `name: "promotions_schema"` and the SQL above.

- [ ] **Step 3: Verify tables + RLS**

Call `execute_sql`:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
  and tablename in ('promotions','promotion_products','promotion_categories')
order by tablename;
```

Expected: 3 rows, all `rowsecurity = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619120000_promotions_schema.sql
git commit -m "feat(cms): promotions schema + RLS"
```

---

## Task 2: Seed migration from current `data/discounts.ts`

**Files:**
- Create: `supabase/migrations/20260619120100_promotions_seed.sql`

**Interfaces:**
- Consumes: tables from Task 1; `public.products` + `public.categories` (Phase 1) for the target links.
- Produces: 3 promotions + their target links, mirroring today's `data/discounts.ts`.

**Note:** today's `data/discounts.ts` targets products by *slug* string but matches them against `product.id` (a UUID since Phase 1), so the two product-targeted discounts silently stopped applying after the menu moved to Postgres. The DB links by the real `product_id`, which **restores** them — see Task 5's parity step.

- [ ] **Step 1: Write the seed SQL**

Create `supabase/migrations/20260619120100_promotions_seed.sql`. Guarded so it runs once:

```sql
-- One-time seed mirroring data/discounts.ts: Matcha Monday (20% off the matcha
-- category), Drink of the Day (15% off Vanilla Latte), Flash Deal (25% off Iced
-- Chocolate). Always-on (no window) and active, matching the current mock.
do $$
begin
  if exists (select 1 from public.promotions) then
    return;
  end if;

  insert into public.promotions (slug, label, percent_off, sort_order) values
    ('matcha-monday', 'Matcha Monday', 20, 0),
    ('drink-of-the-day', 'Drink of the Day', 15, 1),
    ('flash-deal', 'Flash Deal', 25, 2);

  -- Category targets.
  insert into public.promotion_categories (promotion_id, category_id)
  select pr.id, c.id
  from (values ('matcha-monday', 'matcha')) as v(promo_slug, cat_slug)
  join public.promotions pr on pr.slug = v.promo_slug
  join public.categories c on c.slug = v.cat_slug;

  -- Product targets.
  insert into public.promotion_products (promotion_id, product_id)
  select pr.id, p.id
  from (values
    ('drink-of-the-day', 'vanilla-latte'),
    ('flash-deal', 'iced-chocolate')
  ) as v(promo_slug, product_slug)
  join public.promotions pr on pr.slug = v.promo_slug
  join public.products p on p.slug = v.product_slug;
end $$;
```

- [ ] **Step 2: Apply via Supabase MCP**

Call `apply_migration` with `name: "promotions_seed"` and the SQL above.

- [ ] **Step 3: Verify counts + links**

Call `execute_sql`:

```sql
select
  (select count(*) from public.promotions) as promotions,
  (select count(*) from public.promotion_categories) as cat_targets,
  (select count(*) from public.promotion_products) as prod_targets;
```

Expected: `promotions=3, cat_targets=1, prod_targets=2`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619120100_promotions_seed.sql
git commit -m "feat(cms): seed promotions from data/discounts.ts"
```

---

## Task 3: Regenerate database types

**Files:**
- Modify: `types/database.ts`

**Interfaces:**
- Produces: `Database["public"]["Tables"]["promotions"|"promotion_products"|"promotion_categories"]` row types.

- [ ] **Step 1: Generate types via Supabase MCP**

Call `generate_typescript_types`.

- [ ] **Step 2: Write the result into `types/database.ts`**

Overwrite `types/database.ts` with the returned content verbatim.

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**

```bash
git add types/database.ts
git commit -m "chore(cms): regenerate Supabase types for promotions tables"
```

---

## Task 4: Pure pricing helpers + active-promotions store + `Product.discount` (additive)

Additive — creates the new modules and adds the optional `Product.discount` field without touching any consumer, so the build stays green and the storefront keeps reading `data/discounts.ts`.

**Files:**
- Modify: `types/menu.ts` (add `discount?: Discount` to `Product`)
- Create: `lib/promotions/pricing.ts`, `lib/promotions/store.ts`

**Interfaces:**
- Produces (pure, client-safe, from `@/lib/promotions/pricing`): `applyDiscount(price, discount)`, `getProductPricing(product)`, `getProductDiscount(product)`, `resolveActiveDiscount(product, discounts)`, `promotionStatus(p, now)` + `PromotionStatus`.
- Produces (server-only, from `@/lib/promotions/store`): `listActivePromotions(): Promise<Discount[]>`.

- [ ] **Step 1: Add the `discount` field to `Product`**

In `types/menu.ts`, add to the `Product` type (after `isFeatured?: boolean;`):

```ts
  // The active promotion resolved onto this product server-side (highest percent),
  // if any. Populated by the menu store; the pure pricing helpers read it.
  discount?: Discount;
```

- [ ] **Step 2: Create the pure pricing helpers**

Create `lib/promotions/pricing.ts`:

```ts
import type { Discount, Product, ProductPricing } from "@/types/menu";
import { getBasePrice } from "@/lib/menu/pricing";

// The active discount already resolved onto the product server-side, if any.
export function getProductDiscount(product: Product): Discount | undefined {
  return product.discount;
}

// Apply a discount to a single price point (sen). Returns full pricing info, or a
// no-op result (percentOff 0) when nothing applies. Pure + client-safe.
export function applyDiscount(
  price: number,
  discount: Discount | undefined,
): ProductPricing {
  const percentOff = Math.min(100, Math.max(0, discount?.percentOff ?? 0));
  if (!discount || percentOff === 0) {
    return { original: price, final: price, saving: 0, percentOff: 0 };
  }
  const final = Math.round((price * (100 - percentOff)) / 100);
  return { original: price, final, saving: price - final, percentOff, discount };
}

// Pricing for the product's base ("from") price, with any active discount applied.
export function getProductPricing(product: Product): ProductPricing {
  return applyDiscount(getBasePrice(product), getProductDiscount(product));
}

// Pure resolver: the best (highest percent) discount that applies to a product
// from a list of currently-active discounts. productIds hold product UUIDs;
// categories hold category slugs — matching product.id / product.category. Used
// server-side by the menu store.
export function resolveActiveDiscount(
  product: Product,
  discounts: Discount[],
): Discount | undefined {
  const applicable = discounts.filter(
    (d) =>
      d.productIds?.includes(product.id) ||
      d.categories?.includes(product.category),
  );
  if (applicable.length === 0) return undefined;
  return applicable.reduce((best, d) => (d.percentOff > best.percentOff ? d : best));
}

// Admin-side promotion lifecycle state for the list badge. Pure; pass `now`.
export type PromotionStatus = "active" | "scheduled" | "expired" | "off";

export function promotionStatus(
  p: { isActive: boolean; startsAt: string | null; endsAt: string | null },
  now: Date,
): PromotionStatus {
  if (!p.isActive) return "off";
  if (p.startsAt && new Date(p.startsAt) > now) return "scheduled";
  if (p.endsAt && new Date(p.endsAt) <= now) return "expired";
  return "active";
}
```

- [ ] **Step 3: Create the active-promotions store**

Create `lib/promotions/store.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { Discount } from "@/types/menu";

// Currently-active promotions mapped to the storefront Discount shape: is_active
// AND within the optional [starts_at, ends_at) window at now(). productIds hold
// product UUIDs; categories hold category slugs. Callers must run on a dynamic
// route (the menu pages set `export const dynamic = "force-dynamic"`).
export async function listActivePromotions(): Promise<Discount[]> {
  const db = await createClient();
  const nowIso = new Date().toISOString();
  const { data: promos } = await db
    .from("promotions")
    .select("*")
    .eq("is_active", true)
    .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order("sort_order");
  const active = promos ?? [];
  if (active.length === 0) return [];

  const ids = active.map((p) => p.id);
  const [prodLinks, catLinks, cats] = await Promise.all([
    db.from("promotion_products").select("*").in("promotion_id", ids),
    db.from("promotion_categories").select("*").in("promotion_id", ids),
    db.from("categories").select("id, slug"),
  ]);
  const catSlug = new Map((cats.data ?? []).map((c) => [c.id, c.slug]));

  return active.map((p) => ({
    id: p.slug,
    label: p.label,
    percentOff: p.percent_off,
    productIds: (prodLinks.data ?? [])
      .filter((l) => l.promotion_id === p.id)
      .map((l) => l.product_id),
    categories: (catLinks.data ?? [])
      .filter((l) => l.promotion_id === p.id)
      .map((l) => catSlug.get(l.category_id) ?? "")
      .filter(Boolean),
  }));
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS. (Nothing imports the new modules yet; `Product.discount` is optional, so existing code is unaffected.)

- [ ] **Step 5: Commit**

```bash
git add types/menu.ts lib/promotions/pricing.ts lib/promotions/store.ts
git commit -m "feat(promotions): active-promotions store + pure pricing helpers"
```

---

## Task 5: Attach the discount in the menu store + cut consumers over + verify parity

**Files:**
- Modify: `lib/menu/store.ts`, `components/menu-card.tsx`, `components/best-seller-carousel.tsx`, `components/product-customizer.tsx`, `app/(customer)/menu/[slug]/page.tsx`

**Interfaces:**
- Consumes: `listActivePromotions` + `resolveActiveDiscount`. After this task, every `Product` returned by the menu store carries its resolved `discount`, and the pricing helpers read it.

- [ ] **Step 1: Attach the resolved discount in `fetchCatalog`**

In `lib/menu/store.ts`:

Add two imports after the existing `mapCategory, buildProducts` import:

```ts
import { listActivePromotions } from "@/lib/promotions/store";
import { resolveActiveDiscount } from "@/lib/promotions/pricing";
```

Then change the end of the `fetchCatalog` body — replace the final `return buildProducts({ ... });` with:

```ts
  const built = buildProducts({
    productRows: products.data ?? [],
    variantRows: variants.data ?? [],
    addonRows: addons.data ?? [],
    categoryRows: categories.data ?? [],
    categoryAddonRows: categoryAddons.data ?? [],
    productAddonRows: productAddons.data ?? [],
  });

  // Attach the active promotion (best percent) to each product so the pure
  // pricing helpers can stay synchronous in client components.
  const promotions = await listActivePromotions();
  if (promotions.length === 0) return built;
  return built.map((p) => {
    const discount = resolveActiveDiscount(p, promotions);
    return discount ? { ...p, discount } : p;
  });
```

- [ ] **Step 2: Repoint the four consumers' import paths**

Change the discount import in each file from `@/data/discounts` to `@/lib/promotions/pricing` (the function names are identical, so only the path changes):

- `components/menu-card.tsx` line 5: `import { getProductPricing } from "@/lib/promotions/pricing";`
- `components/best-seller-carousel.tsx` line 9: `import { getProductPricing } from "@/lib/promotions/pricing";`
- `components/product-customizer.tsx` line 12: `import { applyDiscount, getProductDiscount } from "@/lib/promotions/pricing";`
- `app/(customer)/menu/[slug]/page.tsx` line 7: `import { getProductPricing } from "@/lib/promotions/pricing";`

(No other code in these files changes — they already call `getProductPricing(product)` / `getProductDiscount(product)` / `applyDiscount(price, discount)`, which now read `product.discount`.)

- [ ] **Step 3: Verify parity**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
Run `npm run dev` and confirm the storefront pricing/badges render correctly:
- `/menu/matcha-latte` and other matcha drinks show the **20% Off** badge and discounted size prices (Matcha Monday, category-targeted) — identical to before.
- `/menu/vanilla-latte` shows **15% Off** and `/menu/iced-chocolate` shows **25% Off**. (These product-targeted promos were silently inactive before — they matched by slug against a UUID — so they now correctly apply; this is expected, not a regression.)
- `/menu` cards and the `/home` best-seller carousel show the same badges/prices as the detail pages.
- A non-discounted drink (e.g. Americano) shows no badge and its normal price.
- Add a discounted drink to the cart → the cart line carries the discounted unit price and the discount label.

- [ ] **Step 4: Commit**

```bash
git add lib/menu/store.ts components/menu-card.tsx components/best-seller-carousel.tsx components/product-customizer.tsx "app/(customer)/menu/[slug]/page.tsx"
git commit -m "feat(promotions): storefront resolves discounts from the database"
```

---

## Task 6: Delete `data/discounts.ts`

**Files:**
- Delete: `data/discounts.ts`

- [ ] **Step 1: Confirm nothing imports `data/discounts` anymore**

Run: `grep -rn "data/discounts" app components lib hooks store data` (exclude node_modules).
Expected: no results.

- [ ] **Step 2: Delete the file**

```bash
git rm data/discounts.ts
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS. `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(promotions): remove hardcoded data/discounts.ts; promotions live in Postgres"
```

---

# STAGE B — Admin Promotions module (`/admin/promotions`)

## Task 7: Admin reads + admin view types

**Files:**
- Create: `lib/promotions/types.ts`, `lib/promotions/admin.ts`

**Interfaces:**
- Produces (from `@/lib/promotions/types`): `AdminPromotion`, `PromotionFormData`.
- Produces (server-only, from `@/lib/promotions/admin`): `listAdminPromotions(): Promise<AdminPromotion[]>` — all promotions incl. inactive, with target product/category ids.

- [ ] **Step 1: Define admin view types**

Create `lib/promotions/types.ts`:

```ts
// CMS-facing promotion shape. Dates are ISO strings (or null = open-ended).
export type AdminPromotion = {
  id: string;
  slug: string;
  label: string;
  percentOff: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  productIds: string[];
  categoryIds: string[];
};

// Payload the promotion editor submits.
export type PromotionFormData = {
  id?: string;
  label: string;
  percentOff: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  productIds: string[];
  categoryIds: string[];
};
```

- [ ] **Step 2: Implement admin reads**

Create `lib/promotions/admin.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { AdminPromotion } from "@/lib/promotions/types";

// All promotions (incl. inactive), with their target ids. Runs under the caller's
// RLS; the admin SELECT policy returns inactive rows too. Callers gate with
// isAdmin before rendering.
export async function listAdminPromotions(): Promise<AdminPromotion[]> {
  const db = await createClient();
  const [promos, prodLinks, catLinks] = await Promise.all([
    db.from("promotions").select("*").order("sort_order").order("label"),
    db.from("promotion_products").select("*"),
    db.from("promotion_categories").select("*"),
  ]);
  return (promos.data ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    label: p.label,
    percentOff: p.percent_off,
    isActive: p.is_active,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    sortOrder: p.sort_order,
    productIds: (prodLinks.data ?? []).filter((l) => l.promotion_id === p.id).map((l) => l.product_id),
    categoryIds: (catLinks.data ?? []).filter((l) => l.promotion_id === p.id).map((l) => l.category_id),
  }));
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` → PASS.

```bash
git add lib/promotions/types.ts lib/promotions/admin.ts
git commit -m "feat(cms): admin promotions reads + view types"
```

---

## Task 8: Promotions admin Server Actions

**Files:**
- Create: `app/(admin)/admin/promotions/actions.ts`

**Interfaces:**
- Consumes: `isAdmin()`, `PromotionFormData`.
- Produces Server Actions returning `{ ok: true } | { ok: false; error: string }`: `savePromotion`, `setPromotionActive`, `deletePromotion`.

- [ ] **Step 1: Write the actions**

Create `app/(admin)/admin/promotions/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";
import type { PromotionFormData } from "@/lib/promotions/types";

export type ActionResult = { ok: true } | { ok: false; error: string };

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Revalidate the CMS page and the storefront surfaces a promotion affects.
function revalidateAll() {
  revalidatePath("/admin/promotions");
  revalidatePath("/menu");
  revalidatePath("/menu/[slug]", "page");
  revalidatePath("/home");
}

// Upsert the promotion, then replace its product/category target links.
export async function savePromotion(input: PromotionFormData): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const label = input.label.trim();
  if (!label) return { ok: false, error: "Label is required." };
  if (input.percentOff < 1 || input.percentOff > 100) {
    return { ok: false, error: "Percent off must be between 1 and 100." };
  }
  if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) {
    return { ok: false, error: "End must be after start." };
  }
  if (input.productIds.length === 0 && input.categoryIds.length === 0) {
    return { ok: false, error: "Target at least one product or category." };
  }

  const db = await createClient();
  const payload = {
    label,
    percent_off: input.percentOff,
    is_active: input.isActive,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
  };

  let promoId = input.id;
  if (promoId) {
    const { error } = await db.from("promotions").update(payload).eq("id", promoId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await db
      .from("promotions")
      .insert({ ...payload, slug: slugify(label) })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: error?.code === "23505" ? "That promotion slug is already used." : error?.message ?? "Insert failed." };
    }
    promoId = data.id;
  }

  // Replace target links (delete-then-insert; simplest correct approach).
  await db.from("promotion_products").delete().eq("promotion_id", promoId);
  await db.from("promotion_categories").delete().eq("promotion_id", promoId);
  if (input.productIds.length > 0) {
    const { error } = await db
      .from("promotion_products")
      .insert(input.productIds.map((product_id) => ({ promotion_id: promoId!, product_id })));
    if (error) return { ok: false, error: error.message };
  }
  if (input.categoryIds.length > 0) {
    const { error } = await db
      .from("promotion_categories")
      .insert(input.categoryIds.map((category_id) => ({ promotion_id: promoId!, category_id })));
    if (error) return { ok: false, error: error.message };
  }

  revalidateAll();
  return { ok: true };
}

export async function setPromotionActive(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("promotions").update({ is_active: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// Order lines snapshot the discount label/percent at add-time and have no FK to
// promotions, so a hard delete is safe for history.
export async function deletePromotion(id: string): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("promotions").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` → PASS.

```bash
git add "app/(admin)/admin/promotions/actions.ts"
git commit -m "feat(cms): promotions admin server actions"
```

---

## Task 9: Promotions admin UI (list + editor)

**Files:**
- Create: `components/admin/promotions-manager.tsx`
- Modify (replace the stub): `app/(admin)/admin/promotions/page.tsx`

**Interfaces:**
- Consumes: `listAdminPromotions` (Task 7), actions (Task 8), `promotionStatus` (Task 4), `listAdminProducts` + `listAdminCategories` from `@/lib/menu/admin` (Phase 1) for the target pickers.

- [ ] **Step 1: Write the manager component**

Create `components/admin/promotions-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { promotionStatus, type PromotionStatus } from "@/lib/promotions/pricing";
import type { AdminPromotion } from "@/lib/promotions/types";
import type { AdminProduct, AdminCategory } from "@/lib/menu/types";
import { savePromotion, setPromotionActive, deletePromotion } from "@/app/(admin)/admin/promotions/actions";

// datetime-local helpers: input value is local "YYYY-MM-DDTHH:mm".
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(value: string): string | null {
  return value.trim() === "" ? null : new Date(value).toISOString();
}

const STATUS_STYLE: Record<PromotionStatus, string> = {
  active: "bg-emerald-600 text-white",
  scheduled: "bg-amber-500 text-white",
  expired: "bg-neutral-300 text-neutral-700",
  off: "bg-neutral-200 text-neutral-500",
};

export function PromotionsManager({
  initial, products, categories,
}: { initial: AdminPromotion[]; products: AdminProduct[]; categories: AdminCategory[] }) {
  const [creating, setCreating] = useState(false);
  const [, startTransition] = useTransition();
  function reload() { startTransition(() => window.location.reload()); }

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-lg font-bold tracking-tight">Promotions</h1>
        <button onClick={() => setCreating((v) => !v)} className="rounded-full bg-black px-3 py-1.5 text-xs font-semibold text-white">
          {creating ? "Close" : "New promotion"}
        </button>
      </div>

      {creating && (
        <PromotionEditor products={products} categories={categories}
          onDone={() => { setCreating(false); reload(); }} />
      )}

      <div className="flex flex-col gap-2">
        {initial.map((p) => (
          <PromotionRow key={p.id} promo={p} products={products} categories={categories} onChanged={reload} />
        ))}
        {initial.length === 0 && <p className="text-sm text-muted-foreground">No promotions yet.</p>}
      </div>
    </div>
  );
}

function PromotionRow({
  promo, products, categories, onChanged,
}: { promo: AdminPromotion; products: AdminProduct[]; categories: AdminCategory[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const status = promotionStatus(promo, new Date());
  const window = promo.startsAt || promo.endsAt
    ? `${promo.startsAt ? new Date(promo.startsAt).toLocaleDateString() : "—"} → ${promo.endsAt ? new Date(promo.endsAt).toLocaleDateString() : "—"}`
    : "Always";

  return (
    <div className="rounded-2xl border border-border p-3">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-semibold">{promo.label} · {promo.percentOff}% off</span>
          <span className="text-xs text-muted-foreground">{window}</span>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-[0.625rem] font-bold uppercase", STATUS_STYLE[status])}>{status}</span>
        <label className="flex flex-col items-center gap-1 text-[0.625rem] font-medium text-muted-foreground">
          On
          <Switch checked={promo.isActive} onCheckedChange={(v) => startTransition(async () => { await setPromotionActive(promo.id, v); onChanged(); })} />
        </label>
        <button onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-muted-foreground underline">{open ? "Close" : "Edit"}</button>
      </div>
      {open && (
        <div className="mt-3 border-t border-border pt-3">
          <PromotionEditor promo={promo} products={products} categories={categories} onDone={onChanged} />
          <button onClick={() => startTransition(async () => { await deletePromotion(promo.id); onChanged(); })}
            className="mt-2 flex items-center gap-1 text-[0.625rem] font-semibold text-rose-600">
            <Trash2 className="size-3.5" /> Delete promotion
          </button>
        </div>
      )}
    </div>
  );
}

function PromotionEditor({
  promo, products, categories, onDone,
}: { promo?: AdminPromotion; products: AdminProduct[]; categories: AdminCategory[]; onDone: () => void }) {
  const [label, setLabel] = useState(promo?.label ?? "");
  const [percentOff, setPercentOff] = useState(promo ? String(promo.percentOff) : "");
  const [isActive, setIsActive] = useState(promo?.isActive ?? true);
  const [startsAt, setStartsAt] = useState(toLocalInput(promo?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(promo?.endsAt ?? null));
  const [productIds, setProductIds] = useState<Set<string>>(new Set(promo?.productIds ?? []));
  const [categoryIds, setCategoryIds] = useState<Set<string>>(new Set(promo?.categoryIds ?? []));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(set: Set<string>, id: string, apply: (s: Set<string>) => void) {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    apply(next);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await savePromotion({
        id: promo?.id,
        label,
        percentOff: Number(percentOff || "0"),
        isActive,
        startsAt: fromLocalInput(startsAt),
        endsAt: fromLocalInput(endsAt),
        productIds: [...productIds],
        categoryIds: [...categoryIds],
      });
      if (res.ok) onDone();
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Flash Deal)" className="flex-1" />
        <Input inputMode="numeric" value={percentOff} onChange={(e) => setPercentOff(e.target.value)} placeholder="% off" className="w-20" />
      </div>
      <label className="flex items-center justify-between text-sm font-medium">
        <span>Active</span>
        <Switch checked={isActive} onCheckedChange={setIsActive} />
      </label>
      <div className="flex gap-2">
        <div className="flex flex-1 flex-col gap-1.5"><Label>Starts (optional)</Label>
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></div>
        <div className="flex flex-1 flex-col gap-1.5"><Label>Ends (optional)</Label>
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Target categories</Label>
        {categories.filter((c) => !c.isArchived).map((c) => (
          <label key={c.id} className="flex items-center gap-3 py-1 text-sm">
            <input type="checkbox" checked={categoryIds.has(c.id)} onChange={() => toggle(categoryIds, c.id, setCategoryIds)} className="size-4" />
            <span>{c.name}</span>
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Target products</Label>
        {products.filter((p) => !p.isArchived).map((p) => (
          <label key={p.id} className="flex items-center gap-3 py-1 text-sm">
            <input type="checkbox" checked={productIds.has(p.id)} onChange={() => toggle(productIds, p.id, setProductIds)} className="size-4" />
            <span>{p.name}</span>
          </label>
        ))}
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button onClick={save} disabled={pending} className="self-start rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Saving…" : promo ? "Save promotion" : "Add promotion"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Replace the Promotions stub page**

Replace `app/(admin)/admin/promotions/page.tsx` with:

```tsx
import { listAdminPromotions } from "@/lib/promotions/admin";
import { listAdminProducts, listAdminCategories } from "@/lib/menu/admin";
import { PromotionsManager } from "@/components/admin/promotions-manager";

export const dynamic = "force-dynamic";

export default async function PromotionsAdminPage() {
  const [promotions, products, categories] = await Promise.all([
    listAdminPromotions(), listAdminProducts(), listAdminCategories(),
  ]);
  return <PromotionsManager initial={promotions} products={products} categories={categories} />;
}
```

- [ ] **Step 3: Verify end to end**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
As admin at `/admin/promotions`:
- The three seeded promotions show with **Active** badges and "Always" windows.
- Create a promotion "Weekend 10%" targeting the Coffee category, active, no dates → `/menu` coffee drinks show **10% Off**.
- Edit it: set a future `starts_at` → its badge flips to **Scheduled** and the storefront stops showing it; clear the date → **Active** again.
- Toggle a promotion Off → its discount disappears from the storefront after revalidation.
- Set `ends_at` in the past → badge shows **Expired** and it no longer applies.
- Delete a test promotion → it's gone from the list and the storefront.

- [ ] **Step 4: Commit**

```bash
git add components/admin/promotions-manager.tsx "app/(admin)/admin/promotions/page.tsx"
git commit -m "feat(cms): promotions admin module (CRUD, scheduling, targeting, status)"
```

---

## Task 10: Final RLS + parity verification

**Files:** none (verification only).

- [ ] **Step 1: Verify RLS via Supabase MCP**

Call `get_advisors` with `type: "security"`. Expected: no "RLS disabled" findings for `promotions`, `promotion_products`, `promotion_categories`. Address any that appear.

- [ ] **Step 2: Verify write policies are admin-only**

Call `execute_sql`:

```sql
select tablename, policyname, cmd from pg_policies
where schemaname = 'public'
  and tablename in ('promotions','promotion_products','promotion_categories')
order by tablename, cmd;
```

Expected: SELECT policies for read (anon/auth or read-all on link tables) and exactly one `ALL` admin write policy per table; no INSERT/UPDATE/DELETE policy open to non-admins.

- [ ] **Step 3: Full storefront + CMS smoke test**

Run `npm run build` → succeeds. Run `npm run dev`:
- Storefront `/home`, `/menu`, `/menu/[slug]`: discount badges/prices correct; "biggest percent wins" when a product matches two active promotions; add-to-cart carries the discounted price.
- As `customer`/`staff`: `/admin` redirects to `/`.
- As `admin`: `/admin/promotions` CRUD + scheduling + on/off all reflect on the storefront after navigation.

- [ ] **Step 4: Final typecheck + lint**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.

- [ ] **Step 5: Commit any cleanup**

```bash
git add -A
git commit -m "test(cms): verify Phase 2B promotions RLS + storefront parity" --allow-empty
```

---

## Self-review notes (addressed in this plan)

- **Spec coverage:** schema & RLS (Tasks 1, 10), seed (Task 2), pure pricing + active-promotions store + `Product.discount` (Task 4), menu-store attach + consumer cutover + parity (Task 5), delete `data/discounts.ts` (Task 6), admin reads/types (Task 7), actions (Task 8), admin UI with list + editor + status badge + scheduling + targeting (Task 9). Scheduling window and on/off toggle per the design (Approach B).
- **Client/server boundary:** the active discount is resolved **server-side** in the menu store and attached to `Product`, so the client pricing helpers stay synchronous — consumers change only an import path. `listActivePromotions` uses `new Date()` and must run on dynamic routes (menu pages already set `dynamic = "force-dynamic"`).
- **Phase-1 latent fix:** `data/discounts.ts` matched product targets by slug against `product.id` (a UUID since Phase 1), so the two product-targeted discounts had silently stopped applying. The DB links by real `product_id`, restoring Drink-of-the-Day and Flash-Deal — called out in Task 5's parity step so it isn't mistaken for a regression.
- **`current_user_role()` is anon-unsafe** → `promotions` SELECT policies split by role; link tables are read-all (Task 1).
- **Type consistency:** `ActionResult`, `AdminPromotion`/`PromotionFormData`, and the storefront `Discount`/`ProductPricing` shapes are defined once and reused; `promotionStatus` + `PromotionStatus` are shared between the resolver module and the admin list.
- **No dependency on the Rewards plan** — this plan is independently landable.
```
