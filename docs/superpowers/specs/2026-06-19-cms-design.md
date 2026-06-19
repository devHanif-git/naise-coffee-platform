# NAISE COFFEE — Admin CMS Design

**Date:** 2026-06-19
**Status:** Approved (design); Phase 1 ready for implementation planning

---

## Context

NAISE COFFEE is a WhatsApp-based coffee ordering app with three surfaces: a
customer storefront, an admin/manager CMS, and a system layer. This document
designs the **admin CMS**.

### What already exists (database-backed, RLS, realtime)

- `profiles` with a real `role` column (`admin | manager | staff | customer`).
- `orders` + `order_items` — full ordering system with realtime, Telegram
  notifications, and a working **staff order board at `/manage`**
  (`/manage/[token]` per-order view). `order_items` snapshot `name`,
  `size_name`, `addon_names`, `unit_price`, `line_total` and have **no FK to
  products** — so editing/archiving menu items can never corrupt order history.
- `reward_accounts`, `bean_transactions`, `streak_checkins` — Beans balances and
  ledger are in the DB.

### What is still hardcoded (not editable without a code deploy)

- `data/menu.ts` — categories, products, sizes, add-ons, best-seller/new/featured
  flags.
- `data/discounts.ts` — promotions/discounts.
- `data/rewards.ts` — redeemable reward catalog, loyalty tiers, beans-per-ringgit
  rate, streak milestones.

**Key reframing:** the flagship "Menu management" module has no database behind
it yet. Most of the CMS is net-new, and part of it is data migration before any
UI. Only the orders board and Beans balances are already manageable.

### Enums in the DB today

`user_role`, `order_status`, `item_status`, `bean_txn_category`. There is **no**
`category_type` enum in Postgres — `CategoryType` exists only in TypeScript. So
categories can be born as a new table with nothing to retire.

---

## Decisions

1. **Roles:** Two active roles — `admin` (you: full CMS) and `staff` (your
   friend: orders board only, no menu/pricing/rewards/reports). `manager` stays
   defined but unused. No schema change needed.
2. **Module list (8):** Dashboard, Orders board (exists), Menu, Promotions,
   Rewards, Customers, Reports, Settings (store open/closed + feature on/off
   switches). Loyalty config nests in Rewards; redemptions log nests in Reports.
   Out of scope for now: manager role, push notifications, deep analytics.
3. **Build phase by phase** — the full CMS is too large for one plan.
   - **Phase 1 — Foundation + Menu** (this spec)
   - Phase 2 — Rewards + Promotions
   - Phase 3 — Dashboard + Reports + Customers + Settings
4. **CMS path:** `/admin` (avoids colliding with the `/manage/[token]` catch-all
   order links, which stay put).
5. **Navigation:** Hamburger drawer (shadcn `Sheet`) listing all 8 modules,
   styled to match the customer app.
6. **Add-ons model:** Hybrid — category default add-on set + per-item overrides
   (drop a default, or add an item-only extra).
7. **Categories:** A full editable table with CRUD (add/rename/reorder/archive),
   not a fixed set.
8. **Images:** Real upload to a Supabase Storage `products` bucket (not URL
   paste).
9. **Cutover:** Seed the DB from current `data/menu.ts`, point the storefront at
   the DB, verify parity, then delete `data/menu.ts`.
10. **Sequencing within Phase 1:** Read-path first — schema + seed → flip
    storefront to DB and verify identical → then build the admin shell + menu
    editor. Proves the riskiest step (storefront parity) before any write UI
    exists; storefront stays live throughout.

---

## Phase 1 scope

CMS shell + mobile drawer nav + admin gating · migrate menu to Postgres · Menu
module (categories, items, sizes, add-ons, images, availability toggle,
best-seller/new/featured flags, archive) · repoint the storefront at the DB.

Out of Phase 1: promotions, rewards config, dashboard metrics, reports,
customers, settings (these render "Coming soon" stubs in the drawer so the shell
is complete).

---

## Section A — Database schema & RLS

Six new tables. Money as integer **sen** (1 MYR = 100 sen). All have
`created_at`/`updated_at` and RLS enabled.

### 1. `categories`
| column | type | notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `slug` | text | unique, not null |
| `name` | text | display label, not null |
| `sort_order` | int | not null default 0 |
| `max_addons` | int | not null default 3 — default cap for items in this category |
| `is_archived` | boolean | not null default false |
| `created_at`/`updated_at` | timestamptz | |

### 2. `products`
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `category_id` | uuid | → `categories(id)` `on delete restrict` |
| `slug` | text | unique, not null |
| `name` | text | not null |
| `description` | text | not null default '' |
| `image_url` | text | Supabase Storage URL, nullable |
| `base_price` | integer | sen, nullable — used only when the product has no variants |
| `max_addons` | int | nullable — overrides `categories.max_addons` when set |
| `is_best_seller` | boolean | not null default false |
| `is_new` | boolean | not null default false |
| `is_featured` | boolean | not null default false |
| `is_available` | boolean | not null default true — the inventory toggle |
| `is_archived` | boolean | not null default false |
| `sort_order` | int | not null default 0 |
| `created_at`/`updated_at` | timestamptz | |

### 3. `product_variants` (sizes)
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `product_id` | uuid | → `products(id)` `on delete cascade` |
| `name` | text | "Regular" / "Large" |
| `price` | integer | sen, not null |
| `sort_order` | int | not null default 0 |

A product **with** variants ignores `base_price`; a product **without** variants
uses `base_price`. Validation enforces exactly one of the two is present.

### 4. `addons` (one shared pool)
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `name` | text | not null |
| `price` | integer | sen, not null |
| `is_archived` | boolean | not null default false |

A single pool dedups add-ons shared across categories (e.g. "Oat Milk" used by
Coffee and Matcha).

### 5. `category_addons` (default set per category — hybrid part 1)
| column | type | notes |
|---|---|---|
| `category_id` | uuid | → `categories(id)` `on delete cascade` |
| `addon_id` | uuid | → `addons(id)` `on delete cascade` |
| `sort_order` | int | default 0 |
| PK | | composite `(category_id, addon_id)` |

### 6. `product_addons` (per-item overrides — hybrid part 2)
| column | type | notes |
|---|---|---|
| `product_id` | uuid | → `products(id)` `on delete cascade` |
| `addon_id` | uuid | → `addons(id)` `on delete cascade` |
| `mode` | text | check in (`'add'`, `'remove'`), not null |
| `sort_order` | int | default 0 |
| PK | | composite `(product_id, addon_id)` |

**Effective add-ons for an item** = *(category defaults − rows marked `remove`)
∪ rows marked `add`*.

### RLS

- **Public read** (anon + signed-in) on all six tables, filtered to
  `is_archived = false`. Unavailable products still return (storefront shows them
  greyed "Sold out"); archived rows are hidden from the public.
- **Write** (insert/update/delete) restricted to `admin`, via a role check
  against `profiles`, following the same pattern as the rewards/orders
  migrations.
- Admin reads see archived rows too (for the Archive filter).

### Indexes

`products(category_id)`, `products(slug)`, `product_variants(product_id)`,
`category_addons(category_id)`, `product_addons(product_id)`, and partial indexes
supporting the storefront's `is_featured` / `is_best_seller` reads.

---

## Section B — Seed & storefront cutover

### Seed (one-time)

- From current `data/menu.ts`: insert the 3 categories, every product, its
  variants (Regular / Large +RM2), the shared add-on pool, and the
  `category_addons` links — so the live DB menu is byte-for-byte today's menu.
- Current data has no per-item overrides, so `product_addons` starts empty (the
  capability exists, unused until needed).
- Product images today point at a static asset (`images.coffeeWithLogo`). Seed
  sets `image_url = null`; the storefront falls back to that same placeholder, so
  nothing visibly changes. Real uploads replace them later, per item.

### Cutover (the de-risking verify step)

1. Add `lib/menu/store.ts` — typed reads (`listCategories`, `listProducts`,
   `getProductBySlug`, `getFeatured`/`getBestSellers`) returning the **same
   `Product`/`Category` shapes** components already consume, so UI changes are
   minimal.
2. Repoint storefront reads (`menu-browser`, `menu/[slug]`, home best-seller
   carousel, `category-tabs`) from `data/menu.ts` to `lib/menu/store.ts`.
3. **Verify parity:** menu list, product detail, customizer add-ons,
   best-seller/featured sections, prices, and badges render identically.
4. Once verified, delete `data/menu.ts`. Leave `data/discounts.ts` and
   `data/rewards.ts` alone — Phase 2/3 handle them.

Net effect: the storefront looks unchanged, but the menu now lives in Postgres
and is ready to edit.

---

## Section C — Admin shell & Menu CMS screens

### Shell (`app/(admin)/admin/…`)

- Server-gated layout: checks `getSessionRole()`; non-`admin` → redirect to `/`.
  Staff keep the existing `/manage` board; Phase 1 doesn't move it.
- Hamburger drawer (shadcn `Sheet`), styled like the customer app, listing all 8
  modules. Phase 1: **Dashboard** (placeholder) and **Menu** are live; the other
  six render "Coming soon" stubs so the nav shape is visible.
- `robots: noindex` on all `/admin` pages.

### Menu module screens (mobile-first, scaling up)

1. **Menu list** — items grouped by category; each row shows thumbnail, name,
   price, and badges. Inline one-tap toggles for **Available** and the
   **Best-seller / New / Featured** flags (no full edit needed). Search box.
   Archived items behind a filter.
2. **Item editor** (create/edit; `Sheet` or full page) — name, slug (auto from
   name, editable), description, category picker, **image upload** to the
   `products` bucket with preview, a variants editor (add/remove size rows with
   prices) **or** a flat base price, `max_addons` override, the three flags,
   availability. **Add-ons section:** the category's default add-ons appear as
   checked chips; unchecking writes a `remove` override; an "add item-only
   add-on" picker writes `add` overrides.
3. **Categories screen** — list with reorder (drag or up/down), rename, set
   `max_addons`, manage that category's default add-on set, archive.
4. **Add-ons screen** — manage the shared add-on pool (name, price, archive).
5. **Archive** — archived items/categories soft-hidden; an "Archived" filter
   restores them.

Destructive actions (archive) confirm via shadcn `AlertDialog`. **No hard
deletes in the UI** — archive only, so history and links stay intact.

---

## Section D — Data layer, mutations, error handling, testing

### Data layer & mutations (mirrors the orders module)

- `lib/menu/store.ts` — all reads (storefront + CMS), typed against generated
  Supabase types in `types/database.ts` (regenerate after the migration).
- `app/(admin)/admin/menu/actions.ts` — **Server Actions** for every write:
  `createProduct`, `updateProduct`, `toggleAvailability`, `setFlags`,
  `archiveProduct`, category CRUD + reorder, add-on CRUD, and override writes.
  Each action re-checks `role === 'admin'` server-side, returns a typed
  `{ ok: true } | { ok: false; error }` like `OrderActionResult`, and calls
  `revalidatePath` on `/admin/menu` **and** affected storefront paths (`/menu`,
  `/menu/[slug]`, `/home`).
- Image upload via Server Action / route handler using the server Supabase client
  → `products` bucket; whitelist the Supabase host in `next.config`
  `images.remotePatterns`.

### Error handling

- Server-side validation: required name; price ≥ 0; unique slug; a product must
  have **either** variants **or** a base price (not neither, not both). Failures
  surface as inline form errors via the action result — no silent failures.
- Slug collision → append a short suffix or reject with a clear message.
- Upload failure → keep the form open, show the error, preserve entered data.

### Testing & verification

- **DB/RLS:** apply migration to a branch/local; confirm anon reads non-archived
  only, a `customer` cannot write, an `admin` can.
- **Parity:** storefront screens render identically pre/post cutover (Section B
  step 3).
- **CMS round-trip:** create → edit → toggle → archive an item; confirm the
  storefront reflects each change after revalidation.
- `npm run lint` + `tsc` clean before finishing (AGENTS.md rule).

---

## Future phases (not designed here)

- **Phase 2 — Rewards + Promotions:** migrate reward catalog + loyalty config
  (beans-per-RM, tiers, streak, referral) to DB; edit bean costs; Promotions
  CRUD (migrate `data/discounts.ts`).
- **Phase 3 — Dashboard + Reports + Customers + Settings:** dashboard metrics;
  reports (sales, revenue, redemption cost, top items); customer list with beans
  + role assignment; settings (store open/closed, feature on/off switches for
  rewards/referral/streak).
