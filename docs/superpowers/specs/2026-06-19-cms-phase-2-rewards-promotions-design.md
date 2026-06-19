# NAISE COFFEE — Admin CMS Phase 2: Rewards + Promotions Design

**Date:** 2026-06-19
**Status:** Approved (design); ready for implementation planning
**Builds on:** Phase 1 — Foundation + Menu (complete, merged via PR #16)

---

## Context

NAISE COFFEE's admin CMS is being built phase by phase (see
`2026-06-19-cms-design.md`):

- **Phase 1 — Foundation + Menu** ✅ complete. Admin shell at `/admin`, mobile
  drawer nav, admin gating, the full Menu module, and the menu migrated to
  Postgres (`data/menu.ts` deleted).
- **Phase 2 — Rewards + Promotions** ← this spec.
- Phase 3 — Dashboard + Reports + Customers + Settings.

### What already exists in the DB (from the rewards-system work)

- `reward_accounts`, `bean_transactions`, `streak_checkins` — per-member Beans
  balance, append-only ledger, and daily streak check-ins. All writes go through
  two `SECURITY DEFINER` functions:
  - `apply_order_rewards(p_token uuid)` — settles an order: redeems reward lines,
    earns Beans on the paid total, records the streak check-in, grants milestone
    bonuses. Idempotent per order; runs an authoritative affordability check.
  - `reverse_order_rewards(p_token uuid)` — claws back a cancelled order's rewards
    with offsetting ledger rows.
- `lib/rewards/store.ts` wraps both RPCs for the checkout/cancel flows.

### What is still hardcoded (not editable without a code deploy)

- `data/rewards.ts`:
  - `rewardTiers` — loyalty tiers (`Fresh` / `Bold` / `Naise Club`), display-only.
  - `beansPerRinggit = 10` — the earn rate.
  - `rewardsCatalog` — redeemable free-drink list, each pegged to a `productSlug`.
  - `streakMilestones` — display copy for the 3/7/30-day stamp card.
  - `referralReward` — `{ beans: 200, voucher: "RM5 Voucher" }`, **display only**.
  - `getTierProgress(beans, tiers)` — pure tier-standing helper.
  - `RECENT_ACTIVITY_LIMIT`, `FREE_DRINK_FALLBACK` — display constants.
- `data/discounts.ts`:
  - `discounts` — three always-on percent-off promotions targeting `productIds`
    and/or `categories`.
  - `getProductDiscount`, `applyDiscount`, `getProductPricing` — discount
    resolution + pure pricing math.

### The central coupling

`apply_order_rewards` **hardcodes** the earn rate and the milestone grants as SQL
constants, with a comment that they MUST match `data/rewards.ts`:

- `v_earn_rate constant integer := 10;`
- three `IF` blocks: streak position 3 → +50, position 7 → +100, every 30 days →
  +1000 (weekly cadence via `((v_streak - 1) % 7) + 1`, monthly via
  `v_streak % 30 = 0`).

So the earn rate and milestones live in **two places today** (SQL + TS) and can
drift. Phase 2 resolves this.

### Referral state

The referral program is **not built**: the "Share Referral" CTA opens a
"Coming soon" modal (`components/rewards-referral-modal.tsx`), and
`checkout/actions.ts` has no referral logic. `referralReward` is display copy
only.

---

## Decisions

1. **Loyalty config becomes the single source of truth (hybrid).** Migrate the
   earn rate and streak milestones to config tables that `apply_order_rewards`
   **reads**, so editing them in the CMS changes real earning on the next order.
   The change to the `SECURITY DEFINER` function is **surgical**: only the two
   hardcoded constants are swapped for table reads. The affordability check,
   idempotency guard, redeem rows, earn-on-total, and `reverse_order_rewards`
   logic are **untouched**. This kills the SQL-vs-TS drift risk.
2. **Promotions get parity + active toggle + scheduling window.** DB promotions
   keep today's model (percent-off, target by product and/or category, biggest
   percent wins) plus an `is_active` switch and optional `starts_at`/`ends_at`.
   "Applies now" = active AND within window. No fixed-amount discounts, caps, or
   stacking (YAGNI).
3. **Referral stays config-only.** Store the editable referral reward value
   (beans + voucher label) so the modal/copy is data-driven, but **do not build
   the referral program** (no codes, attribution, or granting). A real referral
   program earns its own brainstorm/spec as a later phase.
4. **Tiers remain display-only.** Editable (name / threshold / perk) but
   unenforced, exactly as today — they drive the tier-progress UI, nothing else.
5. **Reward catalog links to live menu products.** Each redeemable reward has a
   FK to `products(id)` (`on delete restrict`), keeping the existing
   `is_reward`/`reward_cost` redemption flow wired to a real product.
6. **Same cutover discipline as Phase 1.** Schema + RLS → seed from the data
   files → repoint storefront reads and verify parity (UI **and** earning) →
   delete the data files → build the admin modules. Read-path first so the
   riskiest step (storefront/earn parity) is proven before any write UI exists.
7. **Build order within Phase 2.** Rewards first (schema, seed, function change,
   cutover, admin module), then Promotions (schema, seed, cutover, admin
   module) — two self-contained slices that each end storefront-green.

---

## Phase 2 scope

Migrate loyalty config + reward catalog + promotions to Postgres · make the earn
rate and streak milestones DB-driven (read by `apply_order_rewards`) · build the
**Rewards** admin module (loyalty settings, tiers, streak milestones, reward
catalog) and the **Promotions** admin module (CRUD with scheduling and
product/category targeting) · repoint the storefront at the DB and delete
`data/rewards.ts` + `data/discounts.ts`.

**Out of Phase 2:** the referral *program* (config value only); dashboard,
reports, customers, settings (Phase 3); any change to the Beans ledger / balance
/ streak-tracking mechanics beyond the two surgical reads in
`apply_order_rewards`.

---

## Section A — Database schema & RLS

Seven new tables. Beans and money are integers (beans are whole numbers; money in
**sen**). All tables enable RLS with **public read of active/non-archived rows +
admin-only write**, following the Phase 1 / rewards-migration pattern
(`current_user_role()` check against `profiles`). Tables that mutate get
`created_at`/`updated_at` with the existing `set_updated_at()` trigger.

### Rewards side

#### 1. `loyalty_settings` (singleton)
One row, enforced via a fixed boolean PK.

| column | type | notes |
|---|---|---|
| `id` | boolean pk | `default true`, `check (id)` — singleton guard |
| `beans_per_ringgit` | integer | not null default 10 — the earn rate read by `apply_order_rewards` |
| `referral_beans` | integer | not null default 200 — display config value |
| `referral_voucher_label` | text | not null default 'RM5 Voucher' — display config value |
| `created_at`/`updated_at` | timestamptz | |

#### 2. `reward_tiers`
| column | type | notes |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `slug` | text | unique, not null (stable id for UI keys; seeded from current `fresh`/`bold`/`naise-club`) |
| `name` | text | not null |
| `threshold` | integer | not null — lifetime Beans to unlock |
| `perk` | text | not null |
| `sort_order` | int | not null default 0 |
| `is_archived` | boolean | not null default false |
| `created_at`/`updated_at` | timestamptz | |

Display-only; drives `getTierProgress`. No enforcement.

#### 3. `streak_milestones`
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `label` | text | not null — e.g. "3-Day Streak Bonus" |
| `beans` | integer | not null — Bean grant |
| `trigger_day` | integer | not null — streak count that triggers the award |
| `repeat_every_days` | integer | nullable — repeat cadence; null = one-time at `trigger_day` |
| `sort_order` | int | not null default 0 |
| `is_active` | boolean | not null default true |
| `created_at`/`updated_at` | timestamptz | |

**Award rule (reproduces today's behaviour exactly):** for an active milestone,
fire when
`v_streak >= trigger_day AND ((repeat_every_days IS NULL AND v_streak = trigger_day) OR (repeat_every_days IS NOT NULL AND (v_streak - trigger_day) % repeat_every_days = 0))`.

Seed values (faithful to the current SQL constants):
- `trigger_day 3, beans 50, repeat_every_days 7` ("3-Day Streak Bonus") — weekly.
- `trigger_day 7, beans 100, repeat_every_days 7` ("7-Day Streak Bonus") — weekly.
- `trigger_day 30, beans 1000, repeat_every_days 30` ("30-Day Streak Bonus") — monthly.

Verification of equivalence to the current code (`v_pos = ((v_streak-1) % 7)+1`,
award at `v_pos = 3`, `v_pos = 7`, and `v_streak % 30 = 0`):
- day-3 weekly: `(streak-3) % 7 = 0` → streak 3, 10, 17 … = current `v_pos = 3`. ✓
- day-7 weekly: `(streak-7) % 7 = 0` → streak 7, 14, 21 … = current `v_pos = 7`. ✓
- day-30 monthly: `(streak-30) % 30 = 0` → streak 30, 60, 90 … = current `v_streak % 30 = 0`. ✓

#### 4. `reward_catalog`
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `slug` | text | unique, not null (seeded from current reward ids) |
| `name` | text | not null |
| `cost` | integer | not null — Bean cost to redeem |
| `product_id` | uuid | → `products(id)` `on delete restrict` — the free drink granted |
| `image_url` | text | nullable — override; falls back to the product's image |
| `is_active` | boolean | not null default true |
| `is_archived` | boolean | not null default false |
| `sort_order` | int | not null default 0 |
| `created_at`/`updated_at` | timestamptz | |

The FK keeps the existing `order_items.is_reward` / `reward_cost` redemption flow
pointed at a real menu product; `on delete restrict` prevents deleting a product
out from under a live reward (consistent with the Phase 1 "archive, don't
delete" stance).

### Promotions side

#### 5. `promotions`
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `slug` | text | unique, not null (seeded from current discount ids) |
| `label` | text | not null |
| `percent_off` | integer | not null, `check (percent_off between 1 and 100)` |
| `is_active` | boolean | not null default true |
| `starts_at` | timestamptz | nullable — null = no lower bound |
| `ends_at` | timestamptz | nullable — null = no upper bound |
| `sort_order` | int | not null default 0 |
| `created_at`/`updated_at` | timestamptz | |

**"Applies now"** = `is_active = true AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())`.
When several apply to one product, the **biggest `percent_off` wins** (unchanged).

#### 6. `promotion_products` (link)
| column | type | notes |
|---|---|---|
| `promotion_id` | uuid | → `promotions(id)` `on delete cascade` |
| `product_id` | uuid | → `products(id)` `on delete cascade` |
| PK | | composite `(promotion_id, product_id)` |

#### 7. `promotion_categories` (link)
| column | type | notes |
|---|---|---|
| `promotion_id` | uuid | → `promotions(id)` `on delete cascade` |
| `category_id` | uuid | → `categories(id)` `on delete cascade` |
| PK | | composite `(promotion_id, category_id)` |

A promotion targets products and/or categories (at least one target required;
enforced in the action layer, since "at least one row across two tables" isn't a
simple table constraint). Mirrors Phase 1's `category_addons` / `product_addons`
convention.

### The surgical `apply_order_rewards` change (Decision 1)

A new migration `create or replace`s the function with exactly two edits:

1. Replace `v_earn_rate constant integer := 10;` with a read:
   `select beans_per_ringgit into v_earn_rate from public.loyalty_settings limit 1;`
   then `v_earn_rate := coalesce(v_earn_rate, 10);` (fallback if the row is
   missing, so earning never silently breaks).
2. Replace the three hardcoded milestone `IF` blocks with a loop over
   `public.streak_milestones where is_active = true`, applying the award rule
   above: insert a `streak_bonus` ledger row and append to `v_bonuses` for each
   firing milestone.

Everything else — order lookup, guest guard, idempotency check, account
upsert, affordability check, redeem rows, earn-on-total, check-in insert, streak
recomputation, cached-column update, return shape — is **byte-for-byte
unchanged**. `reverse_order_rewards` needs **no change**: it negates whatever
non-reversal ledger rows exist for the order, milestone bonuses included.

Because the function is `SECURITY DEFINER` (runs as owner), it reads the config
tables regardless of their RLS policies.

### RLS

- **Public read** (anon + signed-in): `loyalty_settings`; `reward_tiers`,
  `reward_catalog`, `streak_milestones` filtered to non-archived / `is_active`;
  `promotions` filtered to `is_active` (window filtering happens in the query,
  not RLS) plus their link rows. The storefront renders from these.
- **Admin write** (insert/update/delete) on all seven tables via
  `current_user_role() = 'admin'`.
- **Admin read** sees archived/inactive rows too (for the Archive/Off filters).

### Indexes

`reward_catalog(product_id)`, `promotion_products(product_id)`,
`promotion_categories(category_id)`, and partial indexes on
`promotions(is_active)` and `reward_catalog(is_active, is_archived)` supporting
the storefront's "active now" reads.

---

## Section B — CMS module screens

Mobile-first, scaling up; styled to match the Phase 1 menu UI. Archive over hard
delete; destructive actions confirm via shadcn `AlertDialog`; each write is a
Server Action returning `{ ok: true } | { ok: false; error }` with inline form
errors. The drawer's **Rewards** and **Promotions** entries flip from "Coming
soon" stubs to live links.

### Rewards module — `app/(admin)/admin/rewards/`

A single page composed of sections (tabs if it grows tall):

1. **Loyalty settings** — form: beans-per-RM, referral beans, referral voucher
   label. Helper note that beans-per-RM affects **future** orders only (the
   ledger is immutable).
2. **Tiers** — list with up/down reorder; inline edit of name / threshold /
   perk; add; archive (confirm).
3. **Streak milestones** — list of rules (trigger day, beans, label,
   one-time vs weekly/monthly repeat) with add / edit / remove and an active
   toggle. Plain-language helper text describing the repeat rule so it isn't
   cryptic.
4. **Reward catalog** — list with thumbnail, name, bean cost, linked product,
   active toggle. Editor: name, **product picker** (live menu products), bean
   cost, optional image override (reuse Phase 1's `products` storage bucket +
   upload), active, archive.

### Promotions module — `app/(admin)/admin/promotions/`

1. **Promotions list** — label, percent, on/off toggle, window (or "Always"),
   and a computed **status badge**: Active / Scheduled / Expired / Off, so the
   admin sees what is live right now.
2. **Promotion editor** (`Sheet` or page) — label, percent-off, optional
   `starts_at` / `ends_at`, active toggle, and target pickers: multi-select
   **products** and/or **categories** from live menu data.

---

## Section C — Data layer, cutover & testing

### Reads (storefront + CMS)

- `lib/rewards/config-store.ts` — typed reads against `types/database.ts`:
  `getLoyaltySettings`, `listTiers`, `listStreakMilestones`, `listRewardCatalog`,
  plus admin variants that include archived/inactive rows. The pure
  `getTierProgress` helper relocates here from `data/rewards.ts`.
- `lib/promotions/store.ts` — `listActivePromotions` and a DB-backed
  `getProductDiscount(product)`. The **pure** `applyDiscount` and
  `getProductPricing` math moves here **unchanged** (no data dependency).
- `lib/rewards/store.ts` (the existing RPC wrapper) stays as-is.
- Regenerate `types/database.ts` after the migration.

### Client/server read boundary

Today these configs are imported directly into **client** components
(`rewards-screen`, `product-customizer`, `rewards-catalog`, `rewards-info-modal`,
`profile-screen`, `store/beans`, `menu-card`, `best-seller-carousel`,
`menu/[slug]`). DB data can't be a static import. Pattern:

- **Fetch in the server component (page/layout) and pass down as props.** This is
  SEO-friendly and avoids client-side DB round-trips on public pages.
- For the genuinely client-side `store/beans` provider, **seed it from
  server-fetched data** via its provider props rather than a static import.

The implementation plan enumerates each consumer and its server entry point.

### Writes (Server Actions)

- `app/(admin)/admin/rewards/actions.ts` and
  `app/(admin)/admin/promotions/actions.ts` — one action per mutation
  (loyalty-settings update; tier CRUD + reorder; milestone CRUD + toggle;
  catalog CRUD + toggle + archive; promotion CRUD + toggle + target writes).
- Each action re-checks `role === 'admin'` server-side, returns the typed
  result, and calls `revalidatePath` on the admin page **and** affected
  storefront paths (`/rewards`, `/menu`, `/menu/[slug]`, `/home`).
- Image upload for reward overrides reuses the Phase 1 `products` bucket flow.

### Validation & error handling

- Loyalty settings: beans-per-RM ≥ 1; referral beans ≥ 0.
- Tier: name required; threshold ≥ 0.
- Milestone: label required; beans ≥ 1; trigger_day ≥ 1;
  `repeat_every_days` null or ≥ 1.
- Reward: name required; cost ≥ 1; a valid, non-archived `product_id`.
- Promotion: `percent_off` 1–100; if both dates set, `ends_at > starts_at`; at
  least one target (product or category).
- Failures surface as inline form errors via the action result — no silent
  failures; the form stays open with entered data preserved.

### Seed & cutover (read-path first, de-risk parity)

1. **Seed migration** populates the seven tables from `data/rewards.ts` +
   `data/discounts.ts`: `loyalty_settings` (rate 10, referral 200 / "RM5
   Voucher"); the 3 tiers; the 3 milestones (as above); the 4 reward-catalog
   rows linked to products **by slug**; the 3 promotions + their product/category
   targets.
2. **Function migration** updates `apply_order_rewards` to read the rate +
   milestones from the tables (Section A).
3. **Repoint** storefront consumers to the new stores and **verify parity**:
   rewards screen, tier progress, reward catalog, streak card, and menu discount
   badges/prices render identically; and placing/cancelling an order earns,
   redeems, and reverses the **same** Beans as before.
4. **Delete** `data/rewards.ts` and `data/discounts.ts` after relocating the pure
   helpers (`getTierProgress`, `applyDiscount`, `getProductPricing`).
   `RECENT_ACTIVITY_LIMIT` and `FREE_DRINK_FALLBACK` move to a small constant in
   the relevant store/component.
5. **Build** the Rewards and Promotions admin modules.

### Testing & verification

- **DB/RLS:** apply the migration to a branch/local; confirm anon reads only
  active/non-archived rows; a `customer` cannot write any of the seven tables; an
  `admin` can.
- **Function parity:** a streak walked day-by-day grants identical bonuses
  before vs after the function change; an order earns identical Beans; **plus** a
  test that editing `loyalty_settings.beans_per_ringgit` changes the next order's
  earn, and editing a milestone changes the next bonus.
- **Promotion windows:** a scheduled promo is excluded before `starts_at` and
  after `ends_at`, included within; biggest-percent-wins still holds.
- **CMS round-trip:** create → edit → toggle → archive a reward and a promotion;
  confirm the storefront reflects each change after revalidation.
- `npm run lint` + `tsc` clean before finishing (AGENTS.md rule).

---

## Future phases (not designed here)

- **Referral program** — codes, attribution on signup/first order, granting
  Beans to referrer + referee. Deserves its own spec.
- **Phase 3 — Dashboard + Reports + Customers + Settings.**
