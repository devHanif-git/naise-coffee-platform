# CMS Phase 2A — Rewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the NAISE COFFEE loyalty config (earn rate, tiers, streak milestones, redeemable reward catalog, referral value) out of the hardcoded `data/rewards.ts` into Postgres, make `apply_order_rewards` read the earn rate + milestones from the DB (one source of truth), point the storefront at the DB with zero visible change, then build the admin **Rewards** module at `/admin/rewards`.

**Architecture:** Read-path first, exactly like Phase 1 (menu). Build the schema + seed, surgically update the `SECURITY DEFINER` `apply_order_rewards` so the two hardcoded constants (earn rate, milestone grants) become table reads — affordability/idempotency/reversal logic untouched. Then flip the storefront to new DB-backed reads (`lib/rewards/config-store.ts`) and verify parity (UI **and** earning), delete `data/rewards.ts`, and layer the admin module on top. The storefront keeps the existing `Reward`/`RewardTier`/`StreakMilestone` TypeScript shapes so UI components barely change; the store maps DB rows into those shapes. Writes go through Server Actions gated to the `admin` role and backed by RLS.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), TypeScript (strict, no `any`), Tailwind, shadcn/ui, Supabase (Postgres + RLS). Migrations applied via the Supabase MCP tools (the pattern this repo uses).

**Scope note:** This is the first of two Phase-2 plans. Promotions are a separate plan (`2026-06-19-cms-phase-2b-promotions.md`) and are **out of scope** here. This plan touches **only** rewards/loyalty config and leaves `data/discounts.ts` and the menu untouched.

## Global Constraints

- **Beans are whole integers; money is integer sen** (1 MYR = 100 sen). Never floats. (`AGENTS.md`, `lib/format.ts`.)
- **No `any`; strict TypeScript.** (`AGENTS.md`.)
- **No new libraries.** shadcn primitives needed here (`switch`, `label`, `textarea`, `select`, `alert-dialog`) were already added in Phase 1 — no `shadcn add` needed. Do not install anything else without asking.
- **Images via `next/image`** (the repo's `SmartImage` wraps it). `next.config.ts` already whitelists the Supabase host; reward image overrides reuse Phase 1's public `products` Storage bucket.
- **Server-only Supabase**: `createAdminClient()` (service role) must never be imported into a client component. Cookie-scoped reads use `createClient()` from `lib/supabase/server.ts`. The browser client (`lib/supabase/client.ts`) is for client components.
- **No test harness exists** in this repo. Verify each task with `npx tsc --noEmit`, `npm run lint`, Supabase SQL/RLS checks via MCP, and manual storefront parity. Do **not** add a test runner.
- **Migrations**: write the SQL file into `supabase/migrations/` with a timestamp later than `20260619100300` (the last Phase-1 migration), AND apply it through the Supabase MCP `apply_migration` tool. File = source of truth in git.
- **Helpers that already exist**: `public.set_updated_at()` (updated_at trigger) and `public.current_user_role()` (returns the caller's role; **execute granted to `authenticated` only, NOT `anon`** — so anon RLS policies must never call it). `isAdmin()` in `lib/auth/session.ts`. `ImageUpload` component + `uploadProductImage` action from Phase 1.
- **The earn rate + streak milestone grants are the single source of truth in the DB.** `apply_order_rewards` reads them. The change to that function is surgical: only the two hardcoded constants become reads; everything else is byte-for-byte unchanged.
- **Archive/disable, never hard-delete catalog/tiers in the UI.** `order_items` snapshot `name`/`reward_cost` and have no FK to `reward_catalog`, so editing/archiving rewards is always safe for history. Streak milestones may be hard-deleted (pure config; bonuses are snapshotted into `bean_transactions` by label).

---

## File Structure

**Created:**
- `supabase/migrations/20260619110000_rewards_config_schema.sql` — 4 tables, indexes, triggers, RLS.
- `supabase/migrations/20260619110100_rewards_config_seed.sql` — seed from current `data/rewards.ts`.
- `supabase/migrations/20260619110200_apply_order_rewards_config.sql` — `create or replace` `apply_order_rewards` reading rate + milestones from the new tables.
- `lib/rewards/tiers.ts` — pure, client-safe `getTierProgress` + `TierProgress` (relocated from `data/rewards.ts`).
- `lib/rewards/constants.ts` — `RECENT_ACTIVITY_LIMIT`, `FREE_DRINK_FALLBACK` (relocated).
- `lib/rewards/config-store.ts` — server-only public reads (`getLoyaltySettings`, `listTiers`, `listStreakMilestones`, `listRewardCatalog`).
- `lib/rewards/types.ts` — admin-facing view types.
- `lib/rewards/admin.ts` — server-only admin reads (incl. archived/inactive).
- `app/(admin)/admin/rewards/actions.ts` — loyalty/tier/milestone/catalog Server Actions.
- `components/admin/loyalty-settings-form.tsx`, `components/admin/tiers-manager.tsx`, `components/admin/streak-milestones-manager.tsx`, `components/admin/reward-catalog-manager.tsx` — CMS UI.

**Modified:**
- `lib/rewards/store.ts` — unchanged (existing RPC wrapper; listed for context only).
- `types/database.ts` — regenerated after the schema migration.
- `app/(customer)/rewards/page.tsx`, `app/(customer)/rewards/catalog/page.tsx`, `app/(customer)/profile/page.tsx`, `app/(customer)/menu/[slug]/page.tsx`, `app/(customer)/layout.tsx` — fetch config server-side, pass as props.
- `components/rewards-screen.tsx`, `components/rewards-info-modal.tsx`, `components/rewards-catalog.tsx`, `components/profile-screen.tsx`, `components/product-customizer.tsx`, `store/beans.tsx` — consume props instead of importing `data/rewards`.
- `app/(admin)/admin/rewards/page.tsx` — replace the "Coming soon" stub with the live module.

**Deleted (end of read-path stage):**
- `data/rewards.ts`.

**Untouched (Promotions plan owns these):** `data/discounts.ts`, `lib/menu/*`, all menu/discount consumers except where they also read rewards (`product-customizer`, `menu/[slug]/page`).

---

# STAGE A — Read-path first (schema → seed → function → cutover)

## Task 1: Rewards config schema migration (4 tables, indexes, triggers, RLS)

**Files:**
- Create: `supabase/migrations/20260619110000_rewards_config_schema.sql`

**Interfaces:**
- Produces: tables `public.loyalty_settings`, `public.reward_tiers`, `public.streak_milestones`, `public.reward_catalog`. Column names are consumed by every later task and by the function migration.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260619110000_rewards_config_schema.sql`:

```sql
-- Loyalty + rewards config: editable in the CMS, read by the storefront and by
-- apply_order_rewards. Beans are whole integers. Replaces hardcoded data/rewards.ts.
-- RLS: public read of active/non-archived rows; admin-only writes. Reuses
-- public.set_updated_at() and public.current_user_role() (anon CANNOT execute
-- current_user_role(), so anon SELECT policies never call it).

-- 1. Singleton loyalty settings (one row, enforced by a fixed boolean PK) -------
create table public.loyalty_settings (
  id                     boolean primary key default true check (id),
  beans_per_ringgit      integer not null default 10 check (beans_per_ringgit >= 1),
  referral_beans         integer not null default 200 check (referral_beans >= 0),
  referral_voucher_label text not null default 'RM5 Voucher',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- 2. Loyalty tiers (display-only; drives the tier-progress UI) ------------------
create table public.reward_tiers (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  threshold   integer not null check (threshold >= 0),
  perk        text not null,
  sort_order  int not null default 0,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 3. Streak milestones (read by apply_order_rewards). `label` is the ledger
-- label written to bean_transactions; `display_label` is the stamp-card text.
create table public.streak_milestones (
  id                uuid primary key default gen_random_uuid(),
  label             text not null,
  display_label     text not null,
  beans             integer not null check (beans >= 1),
  trigger_day       integer not null check (trigger_day >= 1),
  repeat_every_days integer check (repeat_every_days is null or repeat_every_days >= 1),
  sort_order        int not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 4. Redeemable reward catalog (FK to the live menu product it grants free) -----
create table public.reward_catalog (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  cost        integer not null check (cost >= 1),
  product_id  uuid not null references public.products (id) on delete restrict,
  image_url   text,
  is_active   boolean not null default true,
  is_archived boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Indexes ----------------------------------------------------------------------
create index reward_catalog_product_id_idx on public.reward_catalog (product_id);
create index reward_catalog_active_idx on public.reward_catalog (sort_order)
  where is_active and not is_archived;
create index streak_milestones_active_idx on public.streak_milestones (trigger_day)
  where is_active;

-- updated_at triggers ----------------------------------------------------------
create trigger loyalty_settings_set_updated_at before update on public.loyalty_settings
  for each row execute function public.set_updated_at();
create trigger reward_tiers_set_updated_at before update on public.reward_tiers
  for each row execute function public.set_updated_at();
create trigger streak_milestones_set_updated_at before update on public.streak_milestones
  for each row execute function public.set_updated_at();
create trigger reward_catalog_set_updated_at before update on public.reward_catalog
  for each row execute function public.set_updated_at();

-- RLS --------------------------------------------------------------------------
alter table public.loyalty_settings enable row level security;
alter table public.reward_tiers enable row level security;
alter table public.streak_milestones enable row level security;
alter table public.reward_catalog enable row level security;

-- loyalty_settings: world-readable single row; admin writes.
create policy "loyalty_settings_read_all" on public.loyalty_settings for select
  to anon, authenticated using (true);
create policy "loyalty_settings_write_admin" on public.loyalty_settings for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

-- reward_tiers: public read non-archived; admin read all + write.
create policy "reward_tiers_read_anon" on public.reward_tiers for select to anon
  using (not is_archived);
create policy "reward_tiers_read_auth" on public.reward_tiers for select to authenticated
  using (not is_archived or public.current_user_role() = 'admin');
create policy "reward_tiers_write_admin" on public.reward_tiers for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

-- streak_milestones: public read active; admin read all + write.
create policy "streak_milestones_read_anon" on public.streak_milestones for select to anon
  using (is_active);
create policy "streak_milestones_read_auth" on public.streak_milestones for select to authenticated
  using (is_active or public.current_user_role() = 'admin');
create policy "streak_milestones_write_admin" on public.streak_milestones for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

-- reward_catalog: public read active+non-archived; admin read all + write.
create policy "reward_catalog_read_anon" on public.reward_catalog for select to anon
  using (is_active and not is_archived);
create policy "reward_catalog_read_auth" on public.reward_catalog for select to authenticated
  using ((is_active and not is_archived) or public.current_user_role() = 'admin');
create policy "reward_catalog_write_admin" on public.reward_catalog for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Call `apply_migration` with `name: "rewards_config_schema"` and `query` set to the full SQL above.

- [ ] **Step 3: Verify tables + RLS exist**

Call `execute_sql`:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
  and tablename in ('loyalty_settings','reward_tiers','streak_milestones','reward_catalog')
order by tablename;
```

Expected: 4 rows, all `rowsecurity = true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619110000_rewards_config_schema.sql
git commit -m "feat(cms): rewards/loyalty config schema + RLS"
```

---

## Task 2: Seed migration from current `data/rewards.ts`

**Files:**
- Create: `supabase/migrations/20260619110100_rewards_config_seed.sql`

**Interfaces:**
- Consumes: tables from Task 1; `public.products` (seeded in Phase 1) for the reward→product FK.
- Produces: 1 loyalty-settings row, 3 tiers, 3 streak milestones, 4 reward-catalog rows — byte-identical to today's `data/rewards.ts`.

- [ ] **Step 1: Write the seed SQL**

Create `supabase/migrations/20260619110100_rewards_config_seed.sql`. Each block is guarded so it runs once:

```sql
-- One-time seed mirroring data/rewards.ts. Streak milestones reproduce the SQL
-- constants previously hardcoded in apply_order_rewards: day 3 (+50) and day 7
-- (+100) repeating weekly, day 30 (+1000) repeating monthly.
do $$
begin
  insert into public.loyalty_settings (id, beans_per_ringgit, referral_beans, referral_voucher_label)
  values (true, 10, 200, 'RM5 Voucher')
  on conflict (id) do nothing;

  if not exists (select 1 from public.reward_tiers) then
    insert into public.reward_tiers (slug, name, threshold, perk, sort_order) values
      ('fresh', 'Fresh', 0, 'Earn 10 Beans for every RM1 spent.', 0),
      ('bold', 'Bold', 1000, 'A free birthday drink and member-only offers.', 1),
      ('naise-club', 'Naise Club', 3000, 'Free upsizes and early access to new drinks.', 2);
  end if;

  if not exists (select 1 from public.streak_milestones) then
    insert into public.streak_milestones
      (label, display_label, beans, trigger_day, repeat_every_days, sort_order) values
      ('3-Day Streak Bonus', '50 Beans', 50, 3, 7, 0),
      ('7-Day Streak Bonus', '100 Beans', 100, 7, 7, 1),
      ('30-Day Streak Bonus', 'Free Drink', 1000, 30, 30, 2);
  end if;

  if not exists (select 1 from public.reward_catalog) then
    insert into public.reward_catalog (slug, name, cost, product_id, sort_order)
    select v.slug, v.name, v.cost, p.id, v.sort_order
    from (values
      ('free-americano', 'Free Americano', 1000, 'americano', 0),
      ('free-latte', 'Free Latte', 1300, 'naise-signature-latte', 1),
      ('free-matcha', 'Free Matcha', 1500, 'matcha-latte', 2),
      ('free-spanish-latte', 'Free Spanish Latte', 1400, 'spanish-latte', 3)
    ) as v(slug, name, cost, product_slug, sort_order)
    join public.products p on p.slug = v.product_slug;
  end if;
end $$;
```

- [ ] **Step 2: Apply via Supabase MCP**

Call `apply_migration` with `name: "rewards_config_seed"` and the SQL above.

- [ ] **Step 3: Verify row counts + the reward→product links**

Call `execute_sql`:

```sql
select
  (select count(*) from public.loyalty_settings) as settings,
  (select count(*) from public.reward_tiers) as tiers,
  (select count(*) from public.streak_milestones) as milestones,
  (select count(*) from public.reward_catalog) as rewards,
  (select count(*) from public.reward_catalog rc join public.products p on p.id = rc.product_id) as rewards_linked;
```

Expected: `settings=1, tiers=3, milestones=3, rewards=4, rewards_linked=4` (every reward resolves to a product).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619110100_rewards_config_seed.sql
git commit -m "feat(cms): seed rewards/loyalty config from data/rewards.ts"
```

---

## Task 3: Make `apply_order_rewards` read the earn rate + milestones from the DB

**Files:**
- Create: `supabase/migrations/20260619110200_apply_order_rewards_config.sql`

**Interfaces:**
- Consumes: `public.loyalty_settings.beans_per_ringgit`, `public.streak_milestones`.
- Produces: an updated `apply_order_rewards(p_token uuid)` with identical return shape and identical behaviour for the seeded config. `reverse_order_rewards` is unchanged.

**Surgical change:** only two edits vs. the current function — (a) `v_earn_rate` is read from `loyalty_settings` instead of being a constant `10`; (b) the three hardcoded milestone `IF` blocks become a loop over `streak_milestones`. The affordability check, idempotency guard, redeem rows, earn-on-total, check-in, streak recomputation, cached-column update, and return shape are byte-for-byte unchanged.

- [ ] **Step 1: Write the function migration**

Create `supabase/migrations/20260619110200_apply_order_rewards_config.sql`:

```sql
-- Make apply_order_rewards loyalty-config-driven: read the earn rate from
-- loyalty_settings and the milestone grants from streak_milestones, instead of
-- the previously hardcoded constants. SECURITY DEFINER (runs as owner) so it
-- reads the config tables regardless of their RLS. Everything else is unchanged.
create or replace function public.apply_order_rewards(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order     public.orders%rowtype;
  v_user      uuid;
  v_today     date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_balance   integer;
  v_redeemed  integer := 0;
  v_earned    integer := 0;
  v_streak    integer := 0;
  v_bonuses   jsonb := '[]'::jsonb;
  v_earn_rate integer;
  v_ms        public.streak_milestones%rowtype;
begin
  select * into v_order from public.orders where token = p_token;
  if not found then return null; end if;

  v_user := v_order.user_id;
  if v_user is null then return null; end if; -- guest order: no rewards

  -- Idempotency: bail if this order already has (non-reversal) rewards rows.
  if exists (
    select 1 from public.bean_transactions
    where order_id = v_order.id and is_reversal = false
  ) then
    return null;
  end if;

  -- Earn rate from config (fallback 10 if the settings row is somehow missing).
  select beans_per_ringgit into v_earn_rate from public.loyalty_settings limit 1;
  v_earn_rate := coalesce(v_earn_rate, 10);

  -- Ensure the member has an account row (starts at 0).
  insert into public.reward_accounts (user_id)
  values (v_user)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.reward_accounts where user_id = v_user;

  -- Total Bean cost of rewards redeemed on this order.
  select coalesce(sum(reward_cost), 0) into v_redeemed
  from public.order_items
  where order_id = v_order.id and is_reward = true;

  -- Authoritative affordability check (pre-earn balance).
  if v_redeemed > v_balance then
    raise exception 'INSUFFICIENT_BEANS: balance % < reward cost %',
      v_balance, v_redeemed;
  end if;

  -- Redeem rows (negative), one per reward line.
  insert into public.bean_transactions (user_id, order_id, category, amount, label)
  select v_user, v_order.id, 'redeem', -oi.reward_cost, 'Redeemed ' || oi.name
  from public.order_items oi
  where oi.order_id = v_order.id and oi.is_reward = true and oi.reward_cost > 0;

  -- Earn on the paid total (sen -> RM floored, * rate).
  v_earned := floor(v_order.total / 100.0)::int * v_earn_rate;
  if v_earned > 0 then
    insert into public.bean_transactions (user_id, order_id, category, amount, label)
    values (v_user, v_order.id, 'earn', v_earned, 'Order earnings');
  end if;

  -- Record today's check-in (idempotent per day).
  insert into public.streak_checkins (user_id, check_in_date)
  values (v_user, v_today)
  on conflict (user_id, check_in_date) do nothing;

  -- Current streak = length of the consecutive island ending today.
  with islands as (
    select check_in_date,
           check_in_date - (row_number() over (order by check_in_date))::int as grp
    from public.streak_checkins
    where user_id = v_user
  )
  select count(*) into v_streak
  from islands
  where grp = (select grp from islands where check_in_date = v_today);

  -- Milestone bonuses, data-driven from streak_milestones. A milestone fires when
  -- the streak has reached trigger_day and (for repeating ones) lands on the
  -- repeat cadence; one-time milestones (repeat_every_days null) fire only at
  -- exactly trigger_day.
  for v_ms in
    select * from public.streak_milestones where is_active = true
  loop
    if v_streak >= v_ms.trigger_day and (
         (v_ms.repeat_every_days is null and v_streak = v_ms.trigger_day)
         or (v_ms.repeat_every_days is not null
             and (v_streak - v_ms.trigger_day) % v_ms.repeat_every_days = 0)
       )
    then
      insert into public.bean_transactions (user_id, order_id, category, amount, label)
      values (v_user, v_order.id, 'streak_bonus', v_ms.beans, v_ms.label);
      v_bonuses := v_bonuses || jsonb_build_object('label', v_ms.label, 'beans', v_ms.beans);
    end if;
  end loop;

  -- Cached streak columns (balance/lifetime are maintained by the txn trigger).
  update public.reward_accounts
  set current_streak = v_streak,
      longest_streak = greatest(longest_streak, v_streak),
      last_check_in = v_today,
      updated_at = now()
  where user_id = v_user;

  return jsonb_build_object(
    'earned', v_earned,
    'redeemed_cost', v_redeemed,
    'streak_days', v_streak,
    'bonuses', v_bonuses
  );
end;
$$;

-- create or replace preserves privileges, but re-issue least-privilege grants to
-- be explicit (members/staff call apply at placement; not anon/public).
revoke execute on function public.apply_order_rewards(uuid) from public;
grant execute on function public.apply_order_rewards(uuid) to authenticated;
```

- [ ] **Step 2: Apply via Supabase MCP**

Call `apply_migration` with `name: "apply_order_rewards_config"` and the SQL above.

- [ ] **Step 3: Verify the milestone rule reproduces the old behaviour**

Call `execute_sql` to confirm the seeded rules fire on exactly the historical days (3,7,10,14,17,21,... and 30,60,90):

```sql
with days as (select generate_series(1, 35) as streak),
fires as (
  select d.streak, m.beans
  from days d
  join public.streak_milestones m on m.is_active
   and d.streak >= m.trigger_day
   and (m.repeat_every_days is null and d.streak = m.trigger_day
        or m.repeat_every_days is not null and (d.streak - m.trigger_day) % m.repeat_every_days = 0)
)
select streak, sum(beans) as bonus from fires group by streak order by streak;
```

Expected rows (streak | bonus): `3|50, 7|100, 10|50, 14|100, 17|50, 21|100, 24|50, 28|100, 30|1000, 31|50` — i.e. +50 at 3,10,17,24,31; +100 at 7,14,21,28; +1000 at 30. This matches the old `((v_streak-1)%7)+1 in (3,7)` and `v_streak % 30 = 0` logic.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260619110200_apply_order_rewards_config.sql
git commit -m "feat(cms): apply_order_rewards reads earn rate + milestones from config tables"
```

---

## Task 4: Regenerate database types

**Files:**
- Modify: `types/database.ts`

**Interfaces:**
- Produces: `Database["public"]["Tables"]["loyalty_settings"|"reward_tiers"|"streak_milestones"|"reward_catalog"]` row types used by the stores/admin/actions.

- [ ] **Step 1: Generate types via Supabase MCP**

Call the `generate_typescript_types` tool. It returns the full TypeScript source for the DB.

- [ ] **Step 2: Write the result into `types/database.ts`**

Overwrite `types/database.ts` with the returned content verbatim.

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: PASS. The four new tables now appear in the `Database` type.

- [ ] **Step 4: Commit**

```bash
git add types/database.ts
git commit -m "chore(cms): regenerate Supabase types for rewards config tables"
```

---

## Task 5: Relocate pure helpers + add the DB read store (additive, no consumer edits)

This is additive — it creates the new modules without touching any consumer, so the build stays green and the storefront keeps reading `data/rewards.ts`.

**Files:**
- Create: `lib/rewards/tiers.ts`, `lib/rewards/constants.ts`, `lib/rewards/config-store.ts`

**Interfaces:**
- Produces (pure, client-safe): `getTierProgress(beans: number, tiers: RewardTier[]): TierProgress` from `@/lib/rewards/tiers`; `RECENT_ACTIVITY_LIMIT`, `FREE_DRINK_FALLBACK` from `@/lib/rewards/constants`.
- Produces (server-only, from `@/lib/rewards/config-store`): `getLoyaltySettings(): Promise<LoyaltySettings>`, `listTiers(): Promise<RewardTier[]>`, `listStreakMilestones(): Promise<StreakMilestone[]>`, `listRewardCatalog(): Promise<Reward[]>`, and the `LoyaltySettings` type.

- [ ] **Step 1: Create the pure tier helper**

Create `lib/rewards/tiers.ts`:

```ts
import type { RewardTier } from "@/types/reward";

// Resolved tier standing for a Bean balance. `next` is undefined at the top tier
// (nothing left to unlock); `progressPct` then sits at 100. Pure + client-safe.
export type TierProgress = {
  current: RewardTier;
  next?: RewardTier;
  toNext: number;
  progressPct: number;
  isMaxTier: boolean;
};

// Tiers ascending by threshold; current is the highest one unlocked. `tiers` is
// required (no static default) now that tiers live in the DB.
export function getTierProgress(beans: number, tiers: RewardTier[]): TierProgress {
  if (tiers.length === 0) {
    throw new Error("getTierProgress requires at least one tier");
  }
  const ordered = [...tiers].sort((a, b) => a.threshold - b.threshold);
  let currentIndex = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (beans >= ordered[i].threshold) currentIndex = i;
  }
  const current = ordered[currentIndex];
  const next = ordered[currentIndex + 1];
  if (!next) {
    return { current, toNext: 0, progressPct: 100, isMaxTier: true };
  }
  const span = next.threshold - current.threshold;
  const earned = beans - current.threshold;
  const progressPct =
    span > 0 ? Math.min(100, Math.max(0, Math.round((earned / span) * 100))) : 0;
  return {
    current,
    next,
    toNext: Math.max(0, next.threshold - beans),
    progressPct,
    isMaxTier: false,
  };
}
```

- [ ] **Step 2: Create the relocated constants**

Create `lib/rewards/constants.ts`:

```ts
// Recent-activity preview cap on the Rewards screen; the full feed lives at
// /rewards/activity. Kept here so it survives the deletion of data/rewards.ts.
export const RECENT_ACTIVITY_LIMIT = 3;

// Fallback "free drink" Bean target used by the Rewards hero when the catalog is
// empty.
export const FREE_DRINK_FALLBACK = 1000;
```

- [ ] **Step 3: Create the server read store**

Create `lib/rewards/config-store.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { images } from "@/constants/images";
import type { Reward, RewardTier, StreakMilestone } from "@/types/reward";

export type LoyaltySettings = {
  beansPerRinggit: number;
  referralBeans: number;
  referralVoucherLabel: string;
};

// The single config row, with safe defaults if it's somehow missing.
export async function getLoyaltySettings(): Promise<LoyaltySettings> {
  const db = await createClient();
  const { data } = await db.from("loyalty_settings").select("*").limit(1).maybeSingle();
  return {
    beansPerRinggit: data?.beans_per_ringgit ?? 10,
    referralBeans: data?.referral_beans ?? 200,
    referralVoucherLabel: data?.referral_voucher_label ?? "RM5 Voucher",
  };
}

// Public, non-archived tiers ascending by threshold. RLS hides archived rows
// from non-admins; the filter here is belt-and-suspenders.
export async function listTiers(): Promise<RewardTier[]> {
  const db = await createClient();
  const { data } = await db.from("reward_tiers").select("*").order("threshold");
  return (data ?? [])
    .filter((t) => !t.is_archived)
    .map((t) => ({ id: t.slug, name: t.name, threshold: t.threshold, perk: t.perk }));
}

// Active milestones for the stamp card. `reward` is the card display text; the
// ledger label lives in `label` and is only used by apply_order_rewards.
export async function listStreakMilestones(): Promise<StreakMilestone[]> {
  const db = await createClient();
  const { data } = await db.from("streak_milestones").select("*").order("trigger_day");
  return (data ?? [])
    .filter((m) => m.is_active)
    .map((m) => ({ days: m.trigger_day, reward: m.display_label, beans: m.beans }));
}

// Active, non-archived redeemable rewards, joined to their product for the slug
// (redeem link) and an image fallback. Rewards whose product is hidden/archived
// are dropped. Mirrors data/rewards.ts shapes: id = catalog slug.
export async function listRewardCatalog(): Promise<Reward[]> {
  const db = await createClient();
  const { data: rows } = await db.from("reward_catalog").select("*").order("sort_order");
  const active = (rows ?? []).filter((r) => r.is_active && !r.is_archived);
  if (active.length === 0) return [];
  const { data: prods } = await db
    .from("products")
    .select("id, slug, image_url")
    .in("id", active.map((r) => r.product_id));
  const byId = new Map((prods ?? []).map((p) => [p.id, p]));
  return active.flatMap((r) => {
    const p = byId.get(r.product_id);
    if (!p) return [];
    return [
      {
        id: r.slug,
        name: r.name,
        cost: r.cost,
        image: r.image_url ?? p.image_url ?? images.coffeeWithLogo,
        productSlug: p.slug,
      },
    ];
  });
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS. (Nothing imports the new modules yet — this is additive.)

- [ ] **Step 5: Commit**

```bash
git add lib/rewards/tiers.ts lib/rewards/constants.ts lib/rewards/config-store.ts
git commit -m "feat(rewards): DB-backed config read store + relocated pure helpers"
```

---

## Task 6: Cut the Rewards screens over to the DB + verify parity

Repoints the main Rewards screen and the catalog page. After this task, the Rewards page reads from Postgres; profile/beans/customizer still read `data/rewards.ts` (deleted later), so the build stays green.

**Files:**
- Modify: `app/(customer)/rewards/page.tsx`, `components/rewards-screen.tsx`, `components/rewards-info-modal.tsx`, `app/(customer)/rewards/catalog/page.tsx`, `components/rewards-catalog.tsx`

**Interfaces:**
- `RewardsScreen` props: `{ tiers: RewardTier[]; catalog: Reward[]; milestones: StreakMilestone[]; beansPerRinggit: number; referral: { beans: number; voucher: string } }`.
- `RewardsInfoModal` props: `{ beansPerRinggit: number; onClose: () => void }`.
- `RewardsCatalog` props: `{ rewards: Reward[] }`.

- [ ] **Step 1: Make the Rewards page fetch config and pass props**

Replace `app/(customer)/rewards/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { RewardsScreen } from "@/components/rewards-screen";
import {
  getLoyaltySettings,
  listTiers,
  listStreakMilestones,
  listRewardCatalog,
} from "@/lib/rewards/config-store";

export const metadata: Metadata = {
  title: "Rewards",
  description:
    "Earn Beans on every Naise Coffee order and redeem them for free drinks.",
};

export const dynamic = "force-dynamic";

export default async function RewardsPage() {
  const [settings, tiers, milestones, catalog] = await Promise.all([
    getLoyaltySettings(),
    listTiers(),
    listStreakMilestones(),
    listRewardCatalog(),
  ]);
  return (
    <RewardsScreen
      tiers={tiers}
      catalog={catalog}
      milestones={milestones}
      beansPerRinggit={settings.beansPerRinggit}
      referral={{ beans: settings.referralBeans, voucher: settings.referralVoucherLabel }}
    />
  );
}
```

- [ ] **Step 2: Repoint `RewardsScreen` to props**

In `components/rewards-screen.tsx`:

Replace the `data/rewards` import block (lines 17-25) with:

```tsx
import { getTierProgress } from "@/lib/rewards/tiers";
import { RECENT_ACTIVITY_LIMIT, FREE_DRINK_FALLBACK } from "@/lib/rewards/constants";
import type { Reward, RewardTier, StreakMilestone } from "@/types/reward";
```

Change the component signature from `export function RewardsScreen() {` to:

```tsx
export function RewardsScreen({
  tiers,
  catalog,
  milestones,
  beansPerRinggit,
  referral,
}: {
  tiers: RewardTier[];
  catalog: Reward[];
  milestones: StreakMilestone[];
  beansPerRinggit: number;
  referral: { beans: number; voucher: string };
}) {
```

Then update the references inside the component body:
- `rewardsCatalog.length` → `catalog.length`; `rewardsCatalog.map((r) => r.cost)` → `catalog.map((r) => r.cost)`; `rewardsCatalog.map((reward) => ...)` → `catalog.map((reward) => ...)`.
- `getTierProgress(lifetimeEarned)` → `getTierProgress(lifetimeEarned, tiers)`.
- `streakMilestones.map((m, i) => ...)` → `milestones.map((m, i) => ...)`.
- `referralReward.beans` → `referral.beans`; `referralReward.voucher` → `referral.voucher`.
- `<RewardsTiersModal tiers={rewardTiers} ...>` → `tiers={tiers}`.
- `<RewardsInfoModal onClose={() => setInfoOpen(false)} />` → `<RewardsInfoModal beansPerRinggit={beansPerRinggit} onClose={() => setInfoOpen(false)} />`.

(`RECENT_ACTIVITY_LIMIT` and `FREE_DRINK_FALLBACK` are now imported from `@/lib/rewards/constants`; their usages stay as-is.)

- [ ] **Step 3: Repoint `RewardsInfoModal` to a prop**

Replace `components/rewards-info-modal.tsx` lines 1-26 (the import + module-level `steps`) and the component signature so `beansPerRinggit` is a prop and `steps` is built inside:

```tsx
"use client";

import { useEffect } from "react";
import { X, Coffee, Gift, Sparkles } from "lucide-react";

export function RewardsInfoModal({
  beansPerRinggit,
  onClose,
}: {
  beansPerRinggit: number;
  onClose: () => void;
}) {
  const steps = [
    {
      icon: Coffee,
      title: "Earn Beans",
      body: `Earn ${beansPerRinggit} Beans for every RM1 you spend on Naise drinks.`,
    },
    {
      icon: Gift,
      title: "Redeem Rewards",
      body: "Spend your Beans on free drinks and other rewards.",
    },
    {
      icon: Sparkles,
      title: "Climb the Tiers",
      body: "Keep a daily streak and level up your tier for bonus Beans.",
    },
  ];
```

(Delete the old top-level `const steps = [...]`; the rest of the component body — the `useEffect` and JSX — is unchanged.)

- [ ] **Step 4: Make the catalog page fetch + pass rewards**

Replace `app/(customer)/rewards/catalog/page.tsx` so it fetches the catalog and passes it down. Add at the top:

```tsx
import { listRewardCatalog } from "@/lib/rewards/config-store";
```

Add `export const dynamic = "force-dynamic";` after the `metadata` export, change the component to `async`, fetch the catalog, and pass it:

```tsx
export default async function RewardsCatalogPage() {
  const rewards = await listRewardCatalog();
  return (
    <div className="flex flex-col">
      {/* ...unchanged header... */}
      <RewardsCatalog rewards={rewards} />
    </div>
  );
}
```

(Keep the existing `<header>` JSX exactly; only the wrapper became async and `RewardsCatalog` now takes a prop.)

- [ ] **Step 5: Repoint `RewardsCatalog` to a prop**

In `components/rewards-catalog.tsx`:
- Remove `import { rewardsCatalog } from "@/data/rewards";`.
- Add `import type { Reward } from "@/types/reward";`.
- Change `export function RewardsCatalog() {` to `export function RewardsCatalog({ rewards }: { rewards: Reward[] }) {`.
- Delete the line `const rewards = rewardsCatalog;` (the prop now provides `rewards`).

- [ ] **Step 6: Verify parity**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
Run `npm run dev` as a signed-in member and confirm `/rewards` and `/rewards/catalog` render **identically** to before:
- Hero balance, "free drink" progress, streak count + weekly stamp card.
- Milestone strip shows `3 Days / 50 Beans`, `7 Days / 100 Beans`, `30 Days / Free Drink`.
- Tier name + progress bar match the member's lifetime beans.
- Available Rewards carousel shows the 4 rewards with correct Bean costs and Redeem/locked states; the "?" modal shows "Earn 10 Beans for every RM1".
- Invite card shows "200 Beans" / "RM5 Voucher".

- [ ] **Step 7: Commit**

```bash
git add "app/(customer)/rewards/page.tsx" "app/(customer)/rewards/catalog/page.tsx" components/rewards-screen.tsx components/rewards-info-modal.tsx components/rewards-catalog.tsx
git commit -m "feat(rewards): storefront Rewards screens read config from the database"
```

---

## Task 7: Cut the shared consumers over (profile, beans store, customizer) + verify

Repoints the last three `data/rewards.ts` consumers: the profile tier badge, the global Beans provider's earn rate, and the product customizer's reward lookup.

**Files:**
- Modify: `app/(customer)/profile/page.tsx`, `components/profile-screen.tsx`, `app/(customer)/layout.tsx`, `store/beans.tsx`, `app/(customer)/menu/[slug]/page.tsx`, `components/product-customizer.tsx`

**Interfaces:**
- `ProfileScreen` props gain `tiers: RewardTier[]`.
- `BeansProvider` props gain `earnRate: number`.
- `ProductCustomizer` props gain `catalog: Reward[]`.

- [ ] **Step 1: Profile page fetches tiers**

In `app/(customer)/profile/page.tsx`:
- Add `import { listTiers } from "@/lib/rewards/config-store";`.
- In `ProfilePage`, fetch tiers alongside the orders and pass them down:

```tsx
  const [recentOrders, tiers] = await Promise.all([
    listOrdersFor(ownerId, user?.id ?? null).then((o) => o.slice(0, RECENT_ORDERS_LIMIT)),
    listTiers(),
  ]);

  return (
    <>
      <ProfileScreen recentOrders={recentOrders} tiers={tiers} />
      <ProfileOrdersLive tokens={recentOrders.map((order) => order.token)} />
    </>
  );
```

- [ ] **Step 2: Repoint `ProfileScreen`**

In `components/profile-screen.tsx`:
- Remove `import { getTierProgress } from "@/data/rewards";`.
- Add `import { getTierProgress } from "@/lib/rewards/tiers";` and `import type { RewardTier } from "@/types/reward";`.
- Change the signature to accept `tiers`:

```tsx
export function ProfileScreen({
  recentOrders,
  tiers,
}: {
  recentOrders: Order[];
  tiers: RewardTier[];
}) {
```

- Change `const tier = getTierProgress(lifetimeEarned);` to `const tier = getTierProgress(lifetimeEarned, tiers);`.

- [ ] **Step 3: Customer layout fetches the earn rate**

Replace `app/(customer)/layout.tsx` so it fetches the loyalty settings and feeds the earn rate to `BeansProvider`:

```tsx
import { TabBar } from "@/components/tab-bar";
import { AuthProvider } from "@/store/auth";
import { CartProvider } from "@/store/cart";
import { BeansProvider } from "@/store/beans";
import { ProfileProvider } from "@/store/profile";
import { WelcomeModal } from "@/components/welcome-modal";
import { getLoyaltySettings } from "@/lib/rewards/config-store";

export default async function CustomerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { beansPerRinggit } = await getLoyaltySettings();
  return (
    <AuthProvider>
      <ProfileProvider>
        <BeansProvider earnRate={beansPerRinggit}>
          <CartProvider>
            <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background pb-[calc(4rem+env(safe-area-inset-bottom))]">
              {children}
              <TabBar />
            </div>
            <WelcomeModal />
          </CartProvider>
        </BeansProvider>
      </ProfileProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 4: Repoint the Beans store**

In `store/beans.tsx`:
- Remove `import { beansPerRinggit } from "@/data/rewards";`.
- Change `export function BeansProvider({ children }: { children: React.ReactNode }) {` to:

```tsx
export function BeansProvider({
  children,
  earnRate,
}: {
  children: React.ReactNode;
  earnRate: number;
}) {
```

- In the `useMemo` value, change `earnRate: beansPerRinggit,` to `earnRate,` and add `earnRate` to the dependency array (change `[hydrated, balance, lifetimeEarned, activity, canAfford]` to `[hydrated, balance, lifetimeEarned, activity, earnRate, canAfford]`).

- [ ] **Step 5: Product page passes the reward catalog to the customizer**

In `app/(customer)/menu/[slug]/page.tsx`:
- Add `import { listRewardCatalog } from "@/lib/rewards/config-store";`.
- In `ProductPage`, fetch the catalog alongside the product:

```tsx
  const { slug } = await props.params;
  const [product, catalog] = await Promise.all([
    getProductBySlug(slug),
    listRewardCatalog(),
  ]);
```

- Pass it to the customizer: change `<ProductCustomizer product={product} />` to `<ProductCustomizer product={product} catalog={catalog} />`.

- [ ] **Step 6: Repoint `ProductCustomizer`**

In `components/product-customizer.tsx`:
- Remove `import { rewardsCatalog } from "@/data/rewards";`.
- Add `import type { Reward } from "@/types/reward";` (next to the existing `Product` type import).
- Change the signature `export function ProductCustomizer({ product }: { product: Product }) {` to:

```tsx
export function ProductCustomizer({
  product,
  catalog,
}: {
  product: Product;
  catalog: Reward[];
}) {
```

- Change `const reward = rewardId ? rewardsCatalog.find((r) => r.id === rewardId) : undefined;` to use `catalog`:

```tsx
  const reward = rewardId
    ? catalog.find((r) => r.id === rewardId)
    : undefined;
```

- [ ] **Step 7: Verify parity**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
Run `npm run dev`:
- `/profile` (member): the Beans/tier card shows the correct tier name (matches `/rewards`).
- `/checkout`: the "you'll earn N Beans" preview uses rate 10 (unchanged).
- Redeem flow: from `/rewards`, tap Redeem on Free Latte → lands on `/menu/naise-signature-latte?reward=free-latte`, shows "Redeem Reward / Free Drink · 1,300 Beans"; redeeming places the order and the ledger shows the correct earn/redeem/streak rows.

- [ ] **Step 8: Commit**

```bash
git add "app/(customer)/profile/page.tsx" "app/(customer)/layout.tsx" "app/(customer)/menu/[slug]/page.tsx" components/profile-screen.tsx store/beans.tsx components/product-customizer.tsx
git commit -m "feat(rewards): repoint profile, beans store, and customizer at DB config"
```

---

## Task 8: Delete `data/rewards.ts`

**Files:**
- Delete: `data/rewards.ts`

- [ ] **Step 1: Confirm nothing imports `data/rewards` anymore**

Run: `grep -rn "data/rewards" app components lib hooks store data` (exclude node_modules).
Expected: no results.

- [ ] **Step 2: Delete the file**

```bash
git rm data/rewards.ts
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS. `npm run build` → succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(rewards): remove hardcoded data/rewards.ts; config now lives in Postgres"
```

---

# STAGE B — Admin Rewards module (`/admin/rewards`)

## Task 9: Admin reads + admin view types

**Files:**
- Create: `lib/rewards/types.ts`, `lib/rewards/admin.ts`

**Interfaces:**
- Produces (from `@/lib/rewards/types`): `AdminLoyaltySettings`, `AdminTier`, `AdminMilestone`, `AdminRewardItem`.
- Produces (server-only, from `@/lib/rewards/admin`): `getAdminLoyaltySettings()`, `listAdminTiers()`, `listAdminMilestones()`, `listAdminRewardCatalog()` — all include archived/inactive rows.

- [ ] **Step 1: Define admin view types**

Create `lib/rewards/types.ts`:

```ts
// CMS-facing shapes. Distinct from the storefront Reward/RewardTier/StreakMilestone
// (which hide archived/inactive rows and reshape for display): admin views need
// raw ids, flags, and the ledger label.
export type AdminLoyaltySettings = {
  beansPerRinggit: number;
  referralBeans: number;
  referralVoucherLabel: string;
};

export type AdminTier = {
  id: string;
  slug: string;
  name: string;
  threshold: number;
  perk: string;
  sortOrder: number;
  isArchived: boolean;
};

export type AdminMilestone = {
  id: string;
  label: string; // ledger label, e.g. "3-Day Streak Bonus"
  displayLabel: string; // stamp-card text, e.g. "50 Beans"
  beans: number;
  triggerDay: number;
  repeatEveryDays: number | null;
  sortOrder: number;
  isActive: boolean;
};

export type AdminRewardItem = {
  id: string;
  slug: string;
  name: string;
  cost: number;
  productId: string;
  productName: string; // resolved for display in the list
  imageUrl: string | null;
  isActive: boolean;
  isArchived: boolean;
  sortOrder: number;
};
```

- [ ] **Step 2: Implement admin reads**

Create `lib/rewards/admin.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type {
  AdminLoyaltySettings,
  AdminMilestone,
  AdminRewardItem,
  AdminTier,
} from "@/lib/rewards/types";

// All reads run under the caller's RLS; the admin SELECT policies return archived
// /inactive rows too. Callers gate with isAdmin before rendering.

export async function getAdminLoyaltySettings(): Promise<AdminLoyaltySettings> {
  const db = await createClient();
  const { data } = await db.from("loyalty_settings").select("*").limit(1).maybeSingle();
  return {
    beansPerRinggit: data?.beans_per_ringgit ?? 10,
    referralBeans: data?.referral_beans ?? 200,
    referralVoucherLabel: data?.referral_voucher_label ?? "RM5 Voucher",
  };
}

export async function listAdminTiers(): Promise<AdminTier[]> {
  const db = await createClient();
  const { data } = await db.from("reward_tiers").select("*").order("threshold");
  return (data ?? []).map((t) => ({
    id: t.id, slug: t.slug, name: t.name, threshold: t.threshold, perk: t.perk,
    sortOrder: t.sort_order, isArchived: t.is_archived,
  }));
}

export async function listAdminMilestones(): Promise<AdminMilestone[]> {
  const db = await createClient();
  const { data } = await db.from("streak_milestones").select("*").order("sort_order").order("trigger_day");
  return (data ?? []).map((m) => ({
    id: m.id, label: m.label, displayLabel: m.display_label, beans: m.beans,
    triggerDay: m.trigger_day, repeatEveryDays: m.repeat_every_days,
    sortOrder: m.sort_order, isActive: m.is_active,
  }));
}

export async function listAdminRewardCatalog(): Promise<AdminRewardItem[]> {
  const db = await createClient();
  const [rewards, products] = await Promise.all([
    db.from("reward_catalog").select("*").order("sort_order"),
    db.from("products").select("id, name"),
  ]);
  const name = new Map((products.data ?? []).map((p) => [p.id, p.name]));
  return (rewards.data ?? []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, cost: r.cost, productId: r.product_id,
    productName: name.get(r.product_id) ?? "(unknown product)",
    imageUrl: r.image_url, isActive: r.is_active, isArchived: r.is_archived,
    sortOrder: r.sort_order,
  }));
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit` → PASS.

```bash
git add lib/rewards/types.ts lib/rewards/admin.ts
git commit -m "feat(cms): admin rewards reads + view types"
```

---

## Task 10: Rewards admin Server Actions

**Files:**
- Create: `app/(admin)/admin/rewards/actions.ts`

**Interfaces:**
- Consumes: `isAdmin()`; `uploadProductImage` is reused from `@/app/(admin)/admin/menu/actions` by the UI (Task 11), not here.
- Produces Server Actions, each returning `{ ok: true } | { ok: false; error: string }` (or `{ ok: true; id }` where noted): `updateLoyaltySettings`, `saveTier`, `setTierArchived`, `saveMilestone`, `setMilestoneActive`, `deleteMilestone`, `saveRewardItem`, `setRewardActive`, `setRewardArchived`.

- [ ] **Step 1: Write the actions**

Create `app/(admin)/admin/rewards/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Revalidate the CMS page and every storefront surface that reads rewards config.
function revalidateAll() {
  revalidatePath("/admin/rewards");
  revalidatePath("/rewards");
  revalidatePath("/rewards/catalog");
  revalidatePath("/profile");
  revalidatePath("/menu/[slug]", "page");
}

export async function updateLoyaltySettings(input: {
  beansPerRinggit: number;
  referralBeans: number;
  referralVoucherLabel: string;
}): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  if (input.beansPerRinggit < 1) return { ok: false, error: "Beans per RM must be at least 1." };
  if (input.referralBeans < 0) return { ok: false, error: "Referral beans must be 0 or more." };
  if (!input.referralVoucherLabel.trim()) return { ok: false, error: "Voucher label is required." };
  const db = await createClient();
  const { error } = await db
    .from("loyalty_settings")
    .update({
      beans_per_ringgit: input.beansPerRinggit,
      referral_beans: input.referralBeans,
      referral_voucher_label: input.referralVoucherLabel.trim(),
    })
    .eq("id", true);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function saveTier(input: {
  id?: string;
  name: string;
  threshold: number;
  perk: string;
}): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (input.threshold < 0) return { ok: false, error: "Threshold must be 0 or more." };
  const db = await createClient();
  if (input.id) {
    const { error } = await db
      .from("reward_tiers")
      .update({ name, threshold: input.threshold, perk: input.perk.trim() })
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from("reward_tiers").insert({
      slug: slugify(name), name, threshold: input.threshold, perk: input.perk.trim(),
      sort_order: input.threshold,
    });
    if (error) return { ok: false, error: error.code === "23505" ? "That tier already exists." : error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function setTierArchived(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("reward_tiers").update({ is_archived: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function saveMilestone(input: {
  id?: string;
  label: string;
  displayLabel: string;
  beans: number;
  triggerDay: number;
  repeatEveryDays: number | null;
}): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  if (!input.label.trim()) return { ok: false, error: "Ledger label is required." };
  if (!input.displayLabel.trim()) return { ok: false, error: "Card label is required." };
  if (input.beans < 1) return { ok: false, error: "Beans must be at least 1." };
  if (input.triggerDay < 1) return { ok: false, error: "Trigger day must be at least 1." };
  if (input.repeatEveryDays !== null && input.repeatEveryDays < 1) {
    return { ok: false, error: "Repeat must be empty or at least 1." };
  }
  const db = await createClient();
  const payload = {
    label: input.label.trim(),
    display_label: input.displayLabel.trim(),
    beans: input.beans,
    trigger_day: input.triggerDay,
    repeat_every_days: input.repeatEveryDays,
  };
  if (input.id) {
    const { error } = await db.from("streak_milestones").update(payload).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from("streak_milestones").insert({ ...payload, sort_order: input.triggerDay });
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function setMilestoneActive(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("streak_milestones").update({ is_active: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// Milestones carry no FK from history (bonuses snapshot the label into
// bean_transactions), so a hard delete is safe.
export async function deleteMilestone(id: string): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("streak_milestones").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function saveRewardItem(input: {
  id?: string;
  name: string;
  cost: number;
  productId: string;
  imageUrl: string | null;
}): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (input.cost < 1) return { ok: false, error: "Cost must be at least 1 Bean." };
  if (!input.productId) return { ok: false, error: "Pick the free drink this reward grants." };
  const db = await createClient();
  const payload = {
    name, cost: input.cost, product_id: input.productId, image_url: input.imageUrl,
  };
  if (input.id) {
    const { error } = await db.from("reward_catalog").update(payload).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from("reward_catalog").insert({ ...payload, slug: slugify(name) });
    if (error) return { ok: false, error: error.code === "23505" ? "That reward slug is already used." : error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function setRewardActive(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("reward_catalog").update({ is_active: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function setRewardArchived(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("reward_catalog").update({ is_archived: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}
```

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit` → PASS.

```bash
git add "app/(admin)/admin/rewards/actions.ts"
git commit -m "feat(cms): rewards admin server actions"
```

---

## Task 11: Rewards admin UI (loyalty settings, tiers, milestones, catalog)

**Files:**
- Create: `components/admin/loyalty-settings-form.tsx`, `components/admin/tiers-manager.tsx`, `components/admin/streak-milestones-manager.tsx`, `components/admin/reward-catalog-manager.tsx`
- Modify (replace the stub): `app/(admin)/admin/rewards/page.tsx`

**Interfaces:**
- Consumes: admin reads (Task 9), actions (Task 10), `listAdminProducts` from `@/lib/menu/admin` (Phase 1) for the reward product picker, and `ImageUpload` + `uploadProductImage` from Phase 1 for the reward image override.

- [ ] **Step 1: Loyalty settings form**

Create `components/admin/loyalty-settings-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminLoyaltySettings } from "@/lib/rewards/types";
import { updateLoyaltySettings } from "@/app/(admin)/admin/rewards/actions";

export function LoyaltySettingsForm({ initial }: { initial: AdminLoyaltySettings }) {
  const [beansPerRinggit, setBeans] = useState(String(initial.beansPerRinggit));
  const [referralBeans, setReferralBeans] = useState(String(initial.referralBeans));
  const [voucher, setVoucher] = useState(initial.referralVoucherLabel);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updateLoyaltySettings({
        beansPerRinggit: Number(beansPerRinggit),
        referralBeans: Number(referralBeans),
        referralVoucherLabel: voucher,
      });
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <h2 className="font-heading text-base font-bold tracking-tight">Loyalty settings</h2>
      <div className="flex flex-col gap-1.5">
        <Label>Beans per RM1</Label>
        <Input inputMode="numeric" value={beansPerRinggit} onChange={(e) => setBeans(e.target.value)} className="w-28" />
        <p className="text-xs text-muted-foreground">Applies to future orders only — the Beans ledger is immutable.</p>
      </div>
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Referral beans</Label>
          <Input inputMode="numeric" value={referralBeans} onChange={(e) => setReferralBeans(e.target.value)} />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label>Voucher label</Label>
          <Input value={voucher} onChange={(e) => setVoucher(e.target.value)} placeholder="RM5 Voucher" />
        </div>
      </div>
      {msg && <p className={msg.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>{msg.text}</p>}
      <button onClick={save} disabled={pending} className="self-start rounded-2xl bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? "Saving…" : "Save settings"}
      </button>
    </section>
  );
}
```

- [ ] **Step 2: Tiers manager**

Create `components/admin/tiers-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AdminTier } from "@/lib/rewards/types";
import { saveTier, setTierArchived } from "@/app/(admin)/admin/rewards/actions";

export function TiersManager({ initial }: { initial: AdminTier[] }) {
  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState("");
  const [perk, setPerk] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function reload() { startTransition(() => window.location.reload()); }
  function add() {
    setError(null);
    startTransition(async () => {
      const res = await saveTier({ name, threshold: Number(threshold || "0"), perk });
      if (res.ok) { setName(""); setThreshold(""); setPerk(""); reload(); } else setError(res.error);
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <h2 className="font-heading text-base font-bold tracking-tight">Tiers</h2>
      <div className="flex flex-col gap-2">
        {initial.map((t) => <TierRow key={t.id} tier={t} onChanged={reload} />)}
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <Label>New tier</Label>
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1" />
          <Input inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Beans" className="w-24" />
        </div>
        <Input value={perk} onChange={(e) => setPerk(e.target.value)} placeholder="Perk description" />
        <button onClick={add} className="self-start rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white">Add tier</button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </section>
  );
}

function TierRow({ tier, onChanged }: { tier: AdminTier; onChanged: () => void }) {
  const [name, setName] = useState(tier.name);
  const [threshold, setThreshold] = useState(String(tier.threshold));
  const [perk, setPerk] = useState(tier.perk);
  const [, startTransition] = useTransition();

  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border border-border p-3", tier.isArchived && "opacity-50")}>
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
        <Input inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-24" />
      </div>
      <Input value={perk} onChange={(e) => setPerk(e.target.value)} />
      <div className="flex gap-2">
        <button onClick={() => startTransition(async () => { await setTierArchived(tier.id, !tier.isArchived); onChanged(); })}
          className="rounded-xl border border-border px-3 py-1.5 text-xs font-semibold">{tier.isArchived ? "Restore" : "Archive"}</button>
        <button onClick={() => startTransition(async () => { await saveTier({ id: tier.id, name, threshold: Number(threshold || "0"), perk }); onChanged(); })}
          className="flex-1 rounded-xl bg-black py-1.5 text-xs font-semibold text-white">Save</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Streak milestones manager**

Create `components/admin/streak-milestones-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { AdminMilestone } from "@/lib/rewards/types";
import { saveMilestone, setMilestoneActive, deleteMilestone } from "@/app/(admin)/admin/rewards/actions";

export function StreakMilestonesManager({ initial }: { initial: AdminMilestone[] }) {
  const [label, setLabel] = useState("");
  const [displayLabel, setDisplayLabel] = useState("");
  const [beans, setBeans] = useState("");
  const [triggerDay, setTriggerDay] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function reload() { startTransition(() => window.location.reload()); }
  function add() {
    setError(null);
    startTransition(async () => {
      const res = await saveMilestone({
        label, displayLabel, beans: Number(beans || "0"),
        triggerDay: Number(triggerDay || "0"),
        repeatEveryDays: repeat.trim() === "" ? null : Number(repeat),
      });
      if (res.ok) { setLabel(""); setDisplayLabel(""); setBeans(""); setTriggerDay(""); setRepeat(""); reload(); }
      else setError(res.error);
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <h2 className="font-heading text-base font-bold tracking-tight">Streak milestones</h2>
      <p className="text-xs text-muted-foreground">
        Fires when the streak reaches the trigger day. Set a repeat (e.g. 7) for a weekly/monthly
        bonus; leave it empty for a one-time award at exactly the trigger day.
      </p>
      <div className="flex flex-col gap-2">
        {initial.map((m) => <MilestoneRow key={m.id} milestone={m} onChanged={reload} />)}
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <Label>New milestone</Label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ledger label (e.g. 3-Day Streak Bonus)" />
        <Input value={displayLabel} onChange={(e) => setDisplayLabel(e.target.value)} placeholder="Card label (e.g. 50 Beans)" />
        <div className="flex gap-2">
          <Input inputMode="numeric" value={beans} onChange={(e) => setBeans(e.target.value)} placeholder="Beans" className="flex-1" />
          <Input inputMode="numeric" value={triggerDay} onChange={(e) => setTriggerDay(e.target.value)} placeholder="Day" className="w-20" />
          <Input inputMode="numeric" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="Repeat" className="w-20" />
        </div>
        <button onClick={add} className="self-start rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white">Add milestone</button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </section>
  );
}

function MilestoneRow({ milestone, onChanged }: { milestone: AdminMilestone; onChanged: () => void }) {
  const [label, setLabel] = useState(milestone.label);
  const [displayLabel, setDisplayLabel] = useState(milestone.displayLabel);
  const [beans, setBeans] = useState(String(milestone.beans));
  const [triggerDay, setTriggerDay] = useState(String(milestone.triggerDay));
  const [repeat, setRepeat] = useState(milestone.repeatEveryDays == null ? "" : String(milestone.repeatEveryDays));
  const [, startTransition] = useTransition();

  return (
    <div className={cn("flex flex-col gap-2 rounded-xl border border-border p-3", !milestone.isActive && "opacity-50")}>
      <Input value={label} onChange={(e) => setLabel(e.target.value)} />
      <Input value={displayLabel} onChange={(e) => setDisplayLabel(e.target.value)} />
      <div className="flex items-center gap-2">
        <Input inputMode="numeric" value={beans} onChange={(e) => setBeans(e.target.value)} className="flex-1" />
        <Input inputMode="numeric" value={triggerDay} onChange={(e) => setTriggerDay(e.target.value)} className="w-16" />
        <Input inputMode="numeric" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="—" className="w-16" />
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Active
          <Switch checked={milestone.isActive} onCheckedChange={(v) => startTransition(async () => { await setMilestoneActive(milestone.id, v); onChanged(); })} />
        </label>
        <button onClick={() => startTransition(async () => { await deleteMilestone(milestone.id); onChanged(); })} aria-label="Delete milestone" className="text-muted-foreground">
          <Trash2 className="size-4" />
        </button>
        <button onClick={() => startTransition(async () => {
          await saveMilestone({ id: milestone.id, label, displayLabel, beans: Number(beans || "0"), triggerDay: Number(triggerDay || "0"), repeatEveryDays: repeat.trim() === "" ? null : Number(repeat) });
          onChanged();
        })} className="ml-auto rounded-xl bg-black px-3 py-1.5 text-xs font-semibold text-white">Save</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Reward catalog manager**

Create `components/admin/reward-catalog-manager.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ImageUpload } from "@/components/admin/image-upload";
import type { AdminRewardItem } from "@/lib/rewards/types";
import type { AdminProduct } from "@/lib/menu/types";
import { saveRewardItem, setRewardActive, setRewardArchived } from "@/app/(admin)/admin/rewards/actions";

export function RewardCatalogManager({
  initial, products,
}: { initial: AdminRewardItem[]; products: AdminProduct[] }) {
  const [, startTransition] = useTransition();
  function reload() { startTransition(() => window.location.reload()); }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <h2 className="font-heading text-base font-bold tracking-tight">Reward catalog</h2>
      <div className="flex flex-col gap-2">
        {initial.map((r) => <RewardRow key={r.id} reward={r} products={products} onChanged={reload} />)}
      </div>
      <div className="border-t border-border pt-3">
        <RewardEditor products={products} onChanged={reload} />
      </div>
    </section>
  );
}

function RewardEditor({
  reward, products, onChanged,
}: { reward?: AdminRewardItem; products: AdminProduct[]; onChanged: () => void }) {
  const [name, setName] = useState(reward?.name ?? "");
  const [cost, setCost] = useState(reward ? String(reward.cost) : "");
  const [productId, setProductId] = useState(reward?.productId ?? products[0]?.id ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(reward?.imageUrl ?? null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveRewardItem({ id: reward?.id, name, cost: Number(cost || "0"), productId, imageUrl });
      if (res.ok) { if (!reward) { setName(""); setCost(""); setImageUrl(null); } onChanged(); }
      else setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>{reward ? "Edit reward" : "New reward"}</Label>
      <ImageUpload value={imageUrl} onChange={setImageUrl} />
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="flex-1" />
        <Input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Beans" className="w-24" />
      </div>
      <select value={productId} onChange={(e) => setProductId(e.target.value)} className="h-10 rounded-md border border-border bg-white px-3 text-sm">
        {products.filter((p) => !p.isArchived).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button onClick={save} className="self-start rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white">{reward ? "Save" : "Add reward"}</button>
    </div>
  );
}

function RewardRow({
  reward, products, onChanged,
}: { reward: AdminRewardItem; products: AdminProduct[]; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <div className={cn("rounded-xl border border-border p-3", reward.isArchived && "opacity-50")}>
      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-semibold">{reward.name}</span>
          <span className="text-xs text-muted-foreground">{reward.cost.toLocaleString()} Beans · {reward.productName}</span>
        </div>
        <label className="flex flex-col items-center gap-1 text-[0.625rem] font-medium text-muted-foreground">
          Active
          <Switch checked={reward.isActive} onCheckedChange={(v) => startTransition(async () => { await setRewardActive(reward.id, v); onChanged(); })} />
        </label>
        <button onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-muted-foreground underline">{open ? "Close" : "Edit"}</button>
      </div>
      <div className="mt-2 flex justify-end">
        <button onClick={() => startTransition(async () => { await setRewardArchived(reward.id, !reward.isArchived); onChanged(); })}
          className="text-[0.625rem] font-semibold text-muted-foreground underline">{reward.isArchived ? "Restore" : "Archive"}</button>
      </div>
      {open && <div className="mt-3 border-t border-border pt-3"><RewardEditor reward={reward} products={products} onChanged={onChanged} /></div>}
    </div>
  );
}
```

- [ ] **Step 5: Replace the Rewards stub page**

Replace `app/(admin)/admin/rewards/page.tsx` with:

```tsx
import { getAdminLoyaltySettings, listAdminTiers, listAdminMilestones, listAdminRewardCatalog } from "@/lib/rewards/admin";
import { listAdminProducts } from "@/lib/menu/admin";
import { LoyaltySettingsForm } from "@/components/admin/loyalty-settings-form";
import { TiersManager } from "@/components/admin/tiers-manager";
import { StreakMilestonesManager } from "@/components/admin/streak-milestones-manager";
import { RewardCatalogManager } from "@/components/admin/reward-catalog-manager";

export const dynamic = "force-dynamic";

export default async function RewardsAdminPage() {
  const [settings, tiers, milestones, rewards, products] = await Promise.all([
    getAdminLoyaltySettings(), listAdminTiers(), listAdminMilestones(),
    listAdminRewardCatalog(), listAdminProducts(),
  ]);
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Rewards</h1>
      <LoyaltySettingsForm initial={settings} />
      <TiersManager initial={tiers} />
      <StreakMilestonesManager initial={milestones} />
      <RewardCatalogManager initial={rewards} products={products} />
    </div>
  );
}
```

- [ ] **Step 6: Verify end to end**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
As admin at `/admin/rewards`:
- Change Beans per RM1 to 12, save → place a member order → the earn equals `floor(total/100)*12` (confirm in the activity feed / `bean_transactions`). Set it back to 10.
- Add a tier "VIP" at 5000 → `/rewards` tiers modal shows it.
- Edit the 7-day milestone card label → `/rewards` stamp card reflects it.
- Add a reward (upload an image, pick a product, set cost) → it appears in `/rewards` and `/rewards/catalog`; toggling Active hides it on the storefront after revalidation; Archive removes it from the customer list.

- [ ] **Step 7: Commit**

```bash
git add components/admin/loyalty-settings-form.tsx components/admin/tiers-manager.tsx components/admin/streak-milestones-manager.tsx components/admin/reward-catalog-manager.tsx "app/(admin)/admin/rewards/page.tsx"
git commit -m "feat(cms): rewards admin module (loyalty settings, tiers, milestones, catalog)"
```

---

## Task 12: Final RLS + parity verification

**Files:** none (verification only).

- [ ] **Step 1: Verify RLS via Supabase MCP**

Call `get_advisors` with `type: "security"`. Expected: no "RLS disabled" findings for `loyalty_settings`, `reward_tiers`, `streak_milestones`, `reward_catalog`. Address any that appear.

- [ ] **Step 2: Verify write policies are admin-only**

Call `execute_sql`:

```sql
select tablename, policyname, cmd from pg_policies
where schemaname = 'public'
  and tablename in ('loyalty_settings','reward_tiers','streak_milestones','reward_catalog')
order by tablename, cmd;
```

Expected: each table has SELECT policies (anon/auth read) and exactly one `ALL` admin write policy; no INSERT/UPDATE/DELETE policy open to non-admins.

- [ ] **Step 3: Function parity smoke test**

As a member, walk a streak across a few days (or set `streak_checkins` rows via `execute_sql` in a test) and place orders; confirm the earn equals `floor(total/100) * beans_per_ringgit` and the milestone bonuses fire on days 3/7/30 exactly as before the change. Cancel a rewarded order → `reverse_order_rewards` claws back earn + redeem + bonus rows (unchanged behaviour).

- [ ] **Step 4: Final typecheck + lint + build**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS. `npm run build` → succeeds.

- [ ] **Step 5: Commit any cleanup**

```bash
git add -A
git commit -m "test(cms): verify Phase 2A rewards RLS + storefront/earning parity" --allow-empty
```

---

## Self-review notes (addressed in this plan)

- **Spec coverage:** schema & RLS (Tasks 1, 12), seed (Task 2), surgical `apply_order_rewards` change (Task 3), read store + relocated pure helpers (Task 5), storefront cutover + parity in two green steps (Tasks 6-7), delete `data/rewards.ts` (Task 8), admin reads/types (Task 9), actions (Task 10), admin UI for loyalty settings / tiers / milestones / catalog (Task 11). Referral stays config-only (loyalty settings form; no program built) per the design.
- **Refinement over the spec:** `streak_milestones` gained a `display_label` column (ledger `label` vs. stamp-card text differ today — "3-Day Streak Bonus" vs "50 Beans"/"Free Drink"). Both are needed for exact parity; the spec listed only `label`.
- **Client/server boundary:** every DB read happens in a Server Component (page/layout) and flows down as props; the one client store (`store/beans`) gets `earnRate` as a prop from the server layout. `getTierProgress` + constants live in client-safe pure modules (`lib/rewards/tiers.ts`, `lib/rewards/constants.ts`), not the server-only `config-store.ts`.
- **`current_user_role()` is anon-unsafe** → SELECT policies split by role (Task 1).
- **Type consistency:** `ActionResult` shape, the `Admin*` view types, and the storefront `Reward`/`RewardTier`/`StreakMilestone` shapes are defined once and reused; action names (`updateLoyaltySettings`, `saveTier`, `saveMilestone`, `saveRewardItem`, `set*`) match between actions and components.
- **No new dependency on Promotions** — `data/discounts.ts` and the menu/discount layer are untouched here; the Promotions plan handles them.
