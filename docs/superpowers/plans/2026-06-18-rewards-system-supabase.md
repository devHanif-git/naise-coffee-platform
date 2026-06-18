# Rewards System → Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move per-user rewards state (Beans balance + ledger, loyalty tier, daily streak, activity history) from the local/mock client stores to Supabase, server-authoritative, linked to the user profile — every member starts at 0 Beans.

**Architecture:** Two `SECURITY DEFINER` Postgres functions (`apply_order_rewards`, `reverse_order_rewards`) do all rewards bookkeeping atomically and idempotently. They are invoked from the existing order server actions: `placeOrder` (earn + redeem + check-in + bonus, members only) and `cancelOrderAction` (reversal). Clients only *read* rewards state — RLS grants select-own-or-staff and no client insert/update — closing the current localStorage tamper hole. The client `BeansProvider` and `useStreak` hook become thin Supabase-backed readers with realtime on the member's own `reward_accounts` row.

**Tech Stack:** Next.js 16 (App Router, RSC + server actions), TypeScript (strict), Supabase (Postgres, RLS, realtime, `@supabase/ssr`), Tailwind. Spec: `docs/superpowers/specs/2026-06-18-rewards-system-supabase-design.md`.

## Global Constraints

- **Money/Beans:** integers only. Money is sen (1 MYR = 100 sen). Beans are whole numbers.
- **No `any`; strict TypeScript.** Use generated Supabase types from `types/database.ts`.
- **Earn rate:** 10 Beans per RM1 spent (`beansPerRinggit` in `data/rewards.ts`). The SQL earn rate must match this exact value.
- **Streak milestones (must match SQL exactly):** week-position 3 → 50 Beans ("3-Day Streak Bonus"); week-position 7 → 100 Beans ("7-Day Streak Bonus"); every 30 days → 1000 Beans ("30-Day Streak Bonus"). Week-position = `((streak_days - 1) % 7) + 1`.
- **Streak timezone:** `Asia/Kuala_Lumpur` for all calendar-day computations.
- **Tiers:** `Fresh` (0) / `Bold` (1000) / `Naise Club` (3000), from `rewardTiers` in `data/rewards.ts`. Tier is derived from **lifetime Beans earned**, never the spendable balance.
- **Members only:** guests (no `auth.uid()`) never earn or redeem. Rewards functions self-guard and no-op for guest orders.
- **Secrets:** never import the service-role admin client into a client component. Rewards writes happen via the SECURITY DEFINER functions, not the admin client.
- **No new dependencies.** No unit-test harness exists (`package.json` scripts: `dev`, `build`, `start`, `lint`). Verification per task = `npx tsc --noEmit` + `npm run lint` + targeted Supabase SQL checks + the scripted manual end-to-end checks given in each task. Adding a test runner is out of scope.
- **Migrations:** every schema change ships as a file in `supabase/migrations/` AND is applied via the Supabase MCP (`apply_migration`), matching the repo convention ("Created via Supabase MCP and captured here as the versioned migration"). Regenerate `types/database.ts` after schema changes.

---

### Task 1: Rewards schema migration

Creates the enum, three rewards tables, the redemption columns on `order_items`, the balance/lifetime cache trigger, RLS (select-own-or-staff, no client writes), and realtime on `reward_accounts`. Reuses the existing `public.set_updated_at()` and `public.current_user_role()` helpers from the auth/profiles migration.

**Files:**
- Create: `supabase/migrations/20260618080000_rewards_schema.sql`
- Modify (regenerate): `types/database.ts`

**Interfaces:**
- Consumes: existing `public.set_updated_at()`, `public.current_user_role()`, `public.orders`, `auth.users`.
- Produces: tables `public.reward_accounts`, `public.bean_transactions`, `public.streak_checkins`; enum `public.bean_txn_category`; columns `public.order_items.is_reward boolean`, `public.order_items.reward_cost integer`; trigger `bean_transactions_apply` maintaining `reward_accounts.balance` and `reward_accounts.lifetime_earned`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260618080000_rewards_schema.sql`:

```sql
-- Rewards: per-user Beans ledger, cached balances, and daily streak check-ins.
-- Server-authoritative — clients may only SELECT (own rows or staff). All writes
-- go through SECURITY DEFINER functions (see 20260618081000_rewards_functions.sql).
-- Beans are whole integers. Created via Supabase MCP and captured here.

-- Ledger entry kinds. Reversals reuse the original category with a negated
-- amount and is_reversal=true, so lifetime_earned (sum of earning categories)
-- nets correctly on cancel.
create type public.bean_txn_category as enum
  ('earn', 'redeem', 'streak_bonus', 'referral', 'adjustment');

-- 1:1 cached aggregates per member. Source of truth is the ledger + check-ins;
-- this exists for cheap reads and CMS display, and is always recomputable.
create table public.reward_accounts (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  balance         integer not null default 0,
  lifetime_earned integer not null default 0,
  current_streak  integer not null default 0,
  longest_streak  integer not null default 0,
  last_check_in   date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.reward_accounts is 'One row per member. Cached Beans balance, lifetime-earned (drives tier), and streak. Source of truth is bean_transactions + streak_checkins.';

-- Append-only Beans ledger.
create table public.bean_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  order_id    uuid references public.orders (id) on delete set null,
  category    public.bean_txn_category not null,
  amount      integer not null,
  label       text not null,
  is_reversal boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on table public.bean_transactions is 'Append-only Beans ledger. amount signed (+earn/+bonus, -redeem); reversal rows negate the original under the same category with is_reversal=true.';

create index bean_transactions_user_created_idx
  on public.bean_transactions (user_id, created_at desc);
create index bean_transactions_order_id_idx
  on public.bean_transactions (order_id);

-- One row per member per calendar day (Asia/Kuala_Lumpur).
create table public.streak_checkins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  check_in_date date not null,
  created_at    timestamptz not null default now(),
  unique (user_id, check_in_date)
);

create index streak_checkins_user_date_idx
  on public.streak_checkins (user_id, check_in_date desc);

-- Redemption persistence on order lines: a redeemed reward line is free
-- (unit_price 0) but costs Beans, settled server-side at placement.
alter table public.order_items
  add column is_reward boolean not null default false,
  add column reward_cost integer not null default 0;

-- updated_at maintenance (reuses the existing trigger function).
create trigger reward_accounts_set_updated_at
  before update on public.reward_accounts
  for each row execute function public.set_updated_at();

-- Maintain the cached balance + lifetime_earned on every ledger insert.
-- lifetime_earned counts only earning categories (and their reversals).
create or replace function public.apply_bean_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.reward_accounts (user_id, balance, lifetime_earned)
  values (
    new.user_id,
    new.amount,
    case when new.category in ('earn', 'streak_bonus', 'referral')
         then new.amount else 0 end
  )
  on conflict (user_id) do update set
    balance = public.reward_accounts.balance + new.amount,
    lifetime_earned = public.reward_accounts.lifetime_earned
      + case when new.category in ('earn', 'streak_bonus', 'referral')
             then new.amount else 0 end,
    updated_at = now();
  return new;
end;
$$;

create trigger bean_transactions_apply
  after insert on public.bean_transactions
  for each row execute function public.apply_bean_transaction();

-- RLS: read own rows, or any row for staff/manager/admin. No client writes.
alter table public.reward_accounts enable row level security;
alter table public.bean_transactions enable row level security;
alter table public.streak_checkins enable row level security;

create policy "reward_accounts_select_own_or_staff"
  on public.reward_accounts for select to authenticated
  using (
    (select auth.uid()) = user_id
    or public.current_user_role() in ('admin', 'manager', 'staff')
  );

create policy "bean_transactions_select_own_or_staff"
  on public.bean_transactions for select to authenticated
  using (
    (select auth.uid()) = user_id
    or public.current_user_role() in ('admin', 'manager', 'staff')
  );

create policy "streak_checkins_select_own_or_staff"
  on public.streak_checkins for select to authenticated
  using (
    (select auth.uid()) = user_id
    or public.current_user_role() in ('admin', 'manager', 'staff')
  );

-- Realtime: live balance/tier on the member's own account row (RLS-gated).
alter publication supabase_realtime add table public.reward_accounts;
alter table public.reward_accounts replica identity full;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use the Supabase MCP `apply_migration` tool with name `rewards_schema` and the SQL body above.
Expected: success, no error.

- [ ] **Step 3: Verify the schema landed**

Use the Supabase MCP `list_tables` (schemas: `["public"]`, verbose: true). Confirm `reward_accounts`, `bean_transactions`, `streak_checkins` exist, and that `order_items` now has `is_reward` and `reward_cost`.
Then run, via MCP `execute_sql`:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('reward_accounts','bean_transactions','streak_checkins');
```
Expected: all three rows show `rowsecurity = true`.

- [ ] **Step 4: Verify no new security advisories**

Use the Supabase MCP `get_advisors` (type: `security`).
Expected: no new "RLS disabled" or "policy" errors referencing the three new tables. (Pre-existing advisories unrelated to these tables are fine.)

- [ ] **Step 5: Regenerate database types**

Use the Supabase MCP `generate_typescript_types`, and write the full output to `types/database.ts` (overwrite the file).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (the new tables appear in `Database`; nothing references them yet, so no errors).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260618080000_rewards_schema.sql types/database.ts
git commit -m "feat(rewards): schema — ledger, accounts, streak check-ins, RLS, realtime"
```

---

### Task 2: Rewards functions migration

Adds the two atomic, idempotent SECURITY DEFINER functions and their grants. `apply_order_rewards` earns Beans, settles redemptions (validated against the live balance), records the streak check-in, and grants milestone bonuses — returning a JSON summary for the UI. `reverse_order_rewards` offsets a cancelled order's Beans and removes the check-in if it was the member's sole order that day.

**Files:**
- Create: `supabase/migrations/20260618081000_rewards_functions.sql`

**Interfaces:**
- Consumes: tables and trigger from Task 1; `public.orders`, `public.order_items`.
- Produces: `public.apply_order_rewards(p_token uuid) returns jsonb` (JSON: `{ earned, redeemed_cost, streak_days, bonuses: [{label, beans}] }`; `null` for guest/unknown/already-applied; raises `INSUFFICIENT_BEANS` when balance can't cover redemptions); `public.reverse_order_rewards(p_token uuid) returns void`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260618081000_rewards_functions.sql`:

```sql
-- Rewards mutations: the ONLY way Beans/streak change. SECURITY DEFINER so they
-- write the RLS-locked rewards tables; granted to authenticated (members call
-- apply at placement, staff call reverse at cancel). Both resolve the member
-- from the order row, self-guard for guests, and are idempotent per order.
-- Earn rate (10) and milestone rule MUST match data/rewards.ts (beansPerRinggit
-- and the getStreakAwards rule). See the plan's Global Constraints.

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
  v_pos       integer;
  v_bonuses   jsonb := '[]'::jsonb;
  v_earn_rate constant integer := 10; -- mirror beansPerRinggit in data/rewards.ts
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

  -- Current streak = length of the consecutive island ending today. Subtracting
  -- a dense row-number from each date gives a constant key per run of
  -- consecutive days; the island containing today shares today's key.
  with islands as (
    select check_in_date,
           check_in_date - (row_number() over (order by check_in_date))::int as grp
    from public.streak_checkins
    where user_id = v_user
  )
  select count(*) into v_streak
  from islands
  where grp = (select grp from islands where check_in_date = v_today);

  -- Milestone bonuses (mirror getStreakAwards in data/rewards.ts).
  v_pos := ((v_streak - 1) % 7) + 1;
  if v_pos = 3 then
    insert into public.bean_transactions (user_id, order_id, category, amount, label)
    values (v_user, v_order.id, 'streak_bonus', 50, '3-Day Streak Bonus');
    v_bonuses := v_bonuses || jsonb_build_object('label', '3-Day Streak Bonus', 'beans', 50);
  end if;
  if v_pos = 7 then
    insert into public.bean_transactions (user_id, order_id, category, amount, label)
    values (v_user, v_order.id, 'streak_bonus', 100, '7-Day Streak Bonus');
    v_bonuses := v_bonuses || jsonb_build_object('label', '7-Day Streak Bonus', 'beans', 100);
  end if;
  if v_streak % 30 = 0 then
    insert into public.bean_transactions (user_id, order_id, category, amount, label)
    values (v_user, v_order.id, 'streak_bonus', 1000, '30-Day Streak Bonus');
    v_bonuses := v_bonuses || jsonb_build_object('label', '30-Day Streak Bonus', 'beans', 1000);
  end if;

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

create or replace function public.reverse_order_rewards(p_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  public.orders%rowtype;
  v_user   uuid;
  v_date   date;
  v_streak integer := 0;
begin
  select * into v_order from public.orders where token = p_token;
  if not found then return; end if;

  v_user := v_order.user_id;
  if v_user is null then return; end if;

  -- Already reversed, or nothing to reverse.
  if exists (
    select 1 from public.bean_transactions
    where order_id = v_order.id and is_reversal = true
  ) then
    return;
  end if;
  if not exists (
    select 1 from public.bean_transactions
    where order_id = v_order.id and is_reversal = false
  ) then
    return;
  end if;

  -- Offsetting rows: same category, negated amount, marked reversal.
  insert into public.bean_transactions (user_id, order_id, category, amount, label, is_reversal)
  select user_id, order_id, category, -amount, label || ' (reversed)', true
  from public.bean_transactions
  where order_id = v_order.id and is_reversal = false;

  -- Remove the order-day's check-in only if it was the member's sole
  -- non-cancelled order that day.
  v_date := (v_order.created_at at time zone 'Asia/Kuala_Lumpur')::date;
  if not exists (
    select 1 from public.orders o
    where o.user_id = v_user
      and o.id <> v_order.id
      and o.status <> 'cancelled'
      and (o.created_at at time zone 'Asia/Kuala_Lumpur')::date = v_date
  ) then
    delete from public.streak_checkins
    where user_id = v_user and check_in_date = v_date;
  end if;

  -- Recompute cached streak from the most recent remaining island.
  with islands as (
    select check_in_date,
           check_in_date - (row_number() over (order by check_in_date))::int as grp
    from public.streak_checkins
    where user_id = v_user
  )
  select coalesce(count(*), 0) into v_streak
  from islands
  where grp = (select grp from islands order by check_in_date desc limit 1);

  update public.reward_accounts
  set current_streak = coalesce(v_streak, 0),
      last_check_in = (select max(check_in_date) from public.streak_checkins where user_id = v_user),
      updated_at = now()
  where user_id = v_user;
end;
$$;

-- Least privilege: members/staff (authenticated) may call; not anon/public.
revoke execute on function public.apply_order_rewards(uuid) from public;
grant execute on function public.apply_order_rewards(uuid) to authenticated;
revoke execute on function public.reverse_order_rewards(uuid) from public;
grant execute on function public.reverse_order_rewards(uuid) to authenticated;
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Use `apply_migration` with name `rewards_functions` and the SQL above.
Expected: success.

- [ ] **Step 3: SQL smoke test — earn + streak + idempotency**

Run via MCP `execute_sql`. This uses the most recent real member order, applies rewards twice (second call must no-op), then prints the result.

```sql
do $$
declare
  v_token uuid;
  v_first jsonb;
  v_second jsonb;
begin
  select token into v_token from public.orders
  where user_id is not null and status <> 'cancelled'
  order by created_at desc limit 1;
  if v_token is null then
    raise notice 'No member order to test with — place one as a signed-in user first.';
    return;
  end if;
  v_first := public.apply_order_rewards(v_token);
  v_second := public.apply_order_rewards(v_token); -- must be null (idempotent)
  raise notice 'first=% second=%', v_first, v_second;
end $$;
```
Expected: `first` is a JSON object with `earned` > 0 (assuming total ≥ RM1) and a `streak_days`; `second` is `null`. Then verify the cache:

```sql
select ra.balance, ra.lifetime_earned, ra.current_streak,
       (select count(*) from public.bean_transactions bt where bt.user_id = ra.user_id) as txns
from public.reward_accounts ra
order by ra.updated_at desc limit 1;
```
Expected: `balance` and `lifetime_earned` equal the earned amount (for a fresh member), `current_streak ≥ 1`, `txns ≥ 1`.

- [ ] **Step 4: SQL smoke test — reversal**

```sql
do $$
declare v_token uuid;
begin
  select token into v_token from public.orders
  where user_id is not null
  order by created_at desc limit 1;
  perform public.reverse_order_rewards(v_token);
  perform public.reverse_order_rewards(v_token); -- second call must no-op
end $$;

select coalesce(sum(amount), 0) as net_for_latest_order
from public.bean_transactions
where order_id = (select id from public.orders
                  where user_id is not null order by created_at desc limit 1);
```
Expected: `net_for_latest_order = 0` (every original row offset exactly once).

- [ ] **Step 5: Clean up the smoke-test data**

The smoke test wrote real ledger rows against a real order. Remove them so the order's rewards can be re-applied by the app during manual testing:

```sql
delete from public.bean_transactions
where order_id = (select id from public.orders
                  where user_id is not null order by created_at desc limit 1);
-- Recompute that member's cache from scratch.
update public.reward_accounts ra set
  balance = coalesce((select sum(amount) from public.bean_transactions bt where bt.user_id = ra.user_id), 0),
  lifetime_earned = coalesce((select sum(amount) from public.bean_transactions bt
    where bt.user_id = ra.user_id and bt.category in ('earn','streak_bonus','referral')), 0);
```
Expected: success. (Leaving `streak_checkins` is harmless; the app's first real order that day is conflict-safe.)

- [ ] **Step 6: Regenerate database types (now including the functions)**

The functions must appear in `types/database.ts` so `db.rpc("apply_order_rewards", …)` typechecks in Task 3. Use the Supabase MCP `generate_typescript_types` again and overwrite `types/database.ts` with the full output. Then run `npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260618081000_rewards_functions.sql types/database.ts
git commit -m "feat(rewards): apply_order_rewards + reverse_order_rewards functions"
```

---

### Task 3: Persist redemption + wire rewards into the order actions

Thread `is_reward`/`reward_cost` from the cart through to `order_items`, add a small rewards data-layer (`lib/rewards/store.ts`) wrapping the RPCs, call `apply_order_rewards` in `placeOrder` (member only, with rollback on failure), and call `reverse_order_rewards` in `cancelOrderAction`.

**Files:**
- Modify: `types/order.ts` (add optional `isReward`/`rewardCost` to `OrderLine`)
- Modify: `types/reward.ts` (add `OrderRewardsResult`)
- Modify: `lib/orders/store.ts:55-65` (insert reward columns)
- Create: `lib/rewards/store.ts`
- Modify: `app/(customer)/checkout/actions.ts` (item type + apply rewards + return payload)
- Modify: `app/(admin)/manage/actions.ts:99-111` (reverse on cancel)

**Interfaces:**
- Consumes: `public.apply_order_rewards`/`public.reverse_order_rewards` (Task 2); `createClient` from `@/lib/supabase/server`; `cancelOrder`, `createOrder` from `@/lib/orders/store`.
- Produces:
  - `type OrderRewardsResult = { earned: number; redeemedCost: number; streakDays: number; bonuses: { label: string; beans: number }[] }`
  - `applyOrderRewards(token: string): Promise<{ ok: true; rewards: OrderRewardsResult } | { ok: false; insufficient: boolean }>`
  - `reverseOrderRewards(token: string): Promise<void>`
  - `PlaceOrderItem` gains `isReward?: boolean; rewardCost?: number`
  - `PlaceOrderResult` ok variant gains `rewards?: OrderRewardsResult`

- [ ] **Step 1: Add reward fields to `OrderLine`**

In `types/order.ts`, inside the `OrderLine` type (after `status: ItemStatus;`, before the closing `}`), add:

```ts
  // Set when this line was added by redeeming a Beans reward. The base drink is
  // free; `rewardCost` is the Bean price, settled server-side at placement.
  isReward?: boolean;
  rewardCost?: number;
```

- [ ] **Step 2: Add `OrderRewardsResult` and `StreakAward` to `types/reward.ts`**

Append to `types/reward.ts` (both are added here so Task 4 can import `StreakAward` from this module; Task 7 later removes the now-duplicate `StreakAward` still living in `data/rewards.ts`):

```ts
// The rewards outcome of placing an order, returned by apply_order_rewards and
// surfaced on the checkout confirmation. `bonuses` are streak-milestone awards
// granted by this order.
export type OrderRewardsResult = {
  earned: number;
  redeemedCost: number;
  streakDays: number;
  bonuses: { label: string; beans: number }[];
};

// A Bean bonus granted for hitting a streak checkpoint (e.g. a 3-day bonus).
// Matches the shape of OrderRewardsResult.bonuses entries; shown on the checkout
// confirmation.
export type StreakAward = { label: string; beans: number };
```

- [ ] **Step 3: Persist reward columns in `createOrder`**

In `lib/orders/store.ts`, in the `itemsPayload` map (around lines 55-65), add the two columns. Replace:

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
  }));
```

with:

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
  }));
```

- [ ] **Step 4: Create the rewards data layer**

Create `lib/rewards/store.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { OrderRewardsResult } from "@/types/reward";

// Shape returned by the apply_order_rewards SQL function (snake_case JSON).
type ApplyRewardsRow = {
  earned: number;
  redeemed_cost: number;
  streak_days: number;
  bonuses: { label: string; beans: number }[];
};

export type ApplyRewardsResult =
  | { ok: true; rewards: OrderRewardsResult }
  | { ok: false; insufficient: boolean };

// Settle an order's rewards: earn Beans, deduct redeemed reward costs, record the
// streak check-in, grant milestone bonuses. Members only — the SQL function
// no-ops for guest orders (returns null) and is idempotent per order. Called by
// placeOrder under the member's cookie-scoped session.
export async function applyOrderRewards(
  token: string,
): Promise<ApplyRewardsResult> {
  const db = await createClient();
  const { data, error } = await db.rpc("apply_order_rewards", {
    p_token: token,
  });
  if (error) {
    return { ok: false, insufficient: error.message.includes("INSUFFICIENT_BEANS") };
  }
  if (!data) {
    // Guest/unknown/already-applied: treat as a no-op success with zero rewards.
    return {
      ok: true,
      rewards: { earned: 0, redeemedCost: 0, streakDays: 0, bonuses: [] },
    };
  }
  const row = data as ApplyRewardsRow;
  return {
    ok: true,
    rewards: {
      earned: row.earned,
      redeemedCost: row.redeemed_cost,
      streakDays: row.streak_days,
      bonuses: row.bonuses ?? [],
    },
  };
}

// Reverse a cancelled order's rewards (offsetting ledger rows; remove the day's
// check-in if it was the sole order that day). Self-guards for guests and
// double-cancels. Called by the staff cancel action.
export async function reverseOrderRewards(token: string): Promise<void> {
  const db = await createClient();
  await db.rpc("reverse_order_rewards", { p_token: token });
}
```

- [ ] **Step 5: Wire rewards into `placeOrder`**

In `app/(customer)/checkout/actions.ts`:

(a) Add the import near the other store import:

```ts
import { applyOrderRewards } from "@/lib/rewards/store";
import type { OrderRewardsResult } from "@/types/reward";
```

(b) Extend `PlaceOrderItem`:

```ts
type PlaceOrderItem = {
  name: string;
  quantity: number;
  sizeName?: string;
  addonNames: string[];
  unitPrice: number;
  isReward?: boolean;
  rewardCost?: number;
};
```

(c) Extend the success result type:

```ts
export type PlaceOrderResult =
  | { ok: true; orderNumber: string; rewards?: OrderRewardsResult }
  | { ok: false; error: string };
```

(d) Carry the reward fields into `lines` (replace the `lines` map):

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
  }));
```

(e) Apply rewards after the order is created and BEFORE the Telegram notice. Insert this block immediately after the `createOrder` try/catch (after the closing `}` of the catch, before the `const baseUrl = ...` line):

```ts
  // Settle rewards for members (earn + redeem + streak). Guests earn nothing.
  // If it fails (e.g. a redemption the live balance can't cover after a race),
  // roll the order back so we never keep an unsettled free-drink order, and
  // bail before notifying the store.
  let rewards: OrderRewardsResult | undefined;
  if (userId) {
    const applied = await applyOrderRewards(order.token);
    if (!applied.ok) {
      await cancelOrder(order.token);
      return {
        ok: false,
        error: applied.insufficient
          ? "You don't have enough Beans to redeem the reward in your cart. Remove it and try again."
          : "Couldn't apply your rewards. Please try again.",
      };
    }
    rewards = applied.rewards;
  }
```

(f) Add the `cancelOrder` import to the existing store import line:

```ts
import { cancelOrder, createOrder } from "@/lib/orders/store";
```

(g) Return the rewards on success (replace the final `return { ok: true, orderNumber: order.orderNumber };`):

```ts
  return { ok: true, orderNumber: order.orderNumber, rewards };
```

- [ ] **Step 6: Reverse rewards on cancel**

In `app/(admin)/manage/actions.ts`:

(a) Add the import:

```ts
import { reverseOrderRewards } from "@/lib/rewards/store";
```

(b) In `cancelOrderAction`, after the `if (!updated) return ...` line and before `revalidatePath`, add:

```ts
  await reverseOrderRewards(token);
```

So the block reads:

```ts
  const updated = await cancelOrder(token);
  if (!updated) return { ok: false, error: "Order not found." };

  await reverseOrderRewards(token);

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: updated.status };
```

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. (`db.rpc("apply_order_rewards", ...)` typechecks because `types/database.ts` was regenerated in Task 1 and now includes the functions.)

- [ ] **Step 8: Commit**

```bash
git add types/order.ts types/reward.ts lib/orders/store.ts lib/rewards/store.ts app/\(customer\)/checkout/actions.ts app/\(admin\)/manage/actions.ts
git commit -m "feat(rewards): settle Beans server-side on order placement and cancel"
```

---

### Task 4: Checkout — send redemption, consume server payload, drop client ledger writes

The checkout screen stops mutating the client Beans/streak stores. It sends each line's `isReward`/`rewardCost`, and shows the streak bonus from the server's `rewards` payload. The advisory `canAfford` pre-check stays for UX.

**Files:**
- Modify: `components/checkout-screen.tsx`

**Interfaces:**
- Consumes: `PlaceOrderResult.rewards` (Task 3); `StreakAward` from `@/types/reward` (added in Task 3); `useBeans().canAfford`/`earnRate`.

- [ ] **Step 1: Remove the client-side earn/streak imports and calls**

In `components/checkout-screen.tsx`:

(a) Replace the streak/beans/award imports:

```ts
import { useStreak } from "@/hooks/use-streak";
import { useBeans } from "@/store/beans";
import { getStreakAwards, type StreakAward } from "@/data/rewards";
```

with:

```ts
import { useBeans } from "@/store/beans";
import type { StreakAward } from "@/types/reward";
```

(b) Replace the hook destructuring lines:

```ts
  const { checkIn } = useStreak();
  const { canAfford, spendAndEarn, creditBeans, earnRate } = useBeans();
```

with:

```ts
  const { canAfford, earnRate } = useBeans();
```

- [ ] **Step 2: Send reward fields and consume the server rewards payload**

In the `placeOrder` function, replace the `placeOrderAction({ items: ... })` items map so each item carries the reward fields:

```ts
        items: items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          sizeName: item.sizeName,
          addonNames: item.addonNames,
          unitPrice: item.unitPrice,
          isReward: item.isReward,
          rewardCost: item.rewardCost,
        })),
```

Then replace the post-success block that currently mutates the stores:

```ts
      // Order is in and the store has been notified. The Beans ledger and
      // streak only apply to members — a guest who chose to continue earns
      // nothing (that's exactly what the sign-in nudge was holding back).
      if (isAuthenticated) {
        // Settle the Beans ledger (deduct redeemed reward costs, earn Beans on
        // the paid total) and mark today's streak — placing an order is the
        // real-world trigger for both. If today's check-in landed on a streak
        // checkpoint (3rd day of the week, a completed week, or a 30-day mark),
        // credit those bonuses too and note them on the confirmation screen.
        spendAndEarn({ paidTotal: totalPrice, rewards: redeemedRewards });
        const checkInResult = checkIn();
        if (checkInResult.isNewCheckIn) {
          const awards = getStreakAwards(checkInResult.streakDays);
          for (const award of awards) creditBeans(award.beans, award.label);
          if (awards.length > 0) setStreakAwards(awards);
        }
      }
      setPlacedNumber(result.orderNumber);
      clear();
```

with:

```ts
      // Beans + streak are settled server-side at placement (members only).
      // Surface any streak-milestone bonuses the server granted.
      if (result.rewards && result.rewards.bonuses.length > 0) {
        setStreakAwards(result.rewards.bonuses);
      }
      setPlacedNumber(result.orderNumber);
      clear();
```

- [ ] **Step 3: Remove the now-unused `redeemedRewards`/`totalRewardCost` earn wiring (keep the affordability guard)**

The `redeemedRewards` array is no longer sent to the store, but `totalRewardCost` still powers the advisory `canAfford` guard. Replace:

```ts
  // Rewards being redeemed in this order, with their Bean costs. Reward lines
  // are always quantity 1; the cost is settled against the balance at checkout.
  const redeemedRewards = items
    .filter((item) => item.isReward)
    .map((item) => ({ name: item.name, cost: item.rewardCost ?? 0 }));
  const totalRewardCost = redeemedRewards.reduce((sum, r) => sum + r.cost, 0);
```

with:

```ts
  // Total Bean cost of rewards in the cart — drives the advisory affordability
  // check before placing. The authoritative check is server-side in
  // apply_order_rewards.
  const totalRewardCost = items
    .filter((item) => item.isReward)
    .reduce((sum, item) => sum + (item.rewardCost ?? 0), 0);
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. No remaining references to `spendAndEarn`, `creditBeans`, `checkIn`, or `getStreakAwards` in this file.

- [ ] **Step 5: Commit**

```bash
git add app/\(customer\)/checkout 2>/dev/null; git add components/checkout-screen.tsx
git commit -m "feat(rewards): checkout sends redemptions and shows server-granted bonuses"
```

---

### Task 5: BeansProvider → Supabase-backed reader + realtime

Replace the localStorage ledger with a Supabase reader: fetch the member's `reward_accounts` (balance + lifetime_earned) and recent `bean_transactions` on mount, expose `lifetimeEarned`, and refresh live via a realtime subscription on the member's own account row. Guests read zeros. The write methods (`spendAndEarn`, `creditBeans`) are removed; `canAfford` stays as an advisory read.

**Files:**
- Modify: `store/beans.tsx` (full rewrite)

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/client`; `beansPerRinggit` from `@/data/rewards`; `Tables<"reward_accounts">`/`Tables<"bean_transactions">` from `@/types/database`; `BeanActivity` from `@/types/reward`.
- Produces: `useBeans(): { hydrated: boolean; balance: number; lifetimeEarned: number; activity: BeanActivity[]; earnRate: number; canAfford: (cost: number) => boolean }`.

- [ ] **Step 1: Rewrite `store/beans.tsx`**

Replace the entire file with:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { BeanActivity } from "@/types/reward";
import { beansPerRinggit } from "@/data/rewards";
import { createClient } from "@/lib/supabase/client";

// How many recent ledger rows to load for the activity feed. The full feed lives
// at /rewards/activity; this is plenty for the previews and that page.
const ACTIVITY_LIMIT = 50;

type BeansContextValue = {
  // True once the member's rewards have loaded (or we've confirmed a guest).
  hydrated: boolean;
  balance: number;
  // Lifetime Beans earned (earn-only) — drives the loyalty tier.
  lifetimeEarned: number;
  activity: BeanActivity[];
  // Beans earned per RM1 spent — exposed so callers can preview the earn.
  earnRate: number;
  // Advisory: whether the current balance covers a Bean cost. The authoritative
  // check is server-side in apply_order_rewards.
  canAfford: (cost: number) => boolean;
};

const BeansContext = createContext<BeansContextValue | null>(null);

// Local-day label for a ledger row's created_at: "Today" / "Yesterday" / "12 Jun"
// in Kuala Lumpur time. Runs only after hydration (client-side), so no SSR drift.
function whenLabel(iso: string): string {
  const tz = "Asia/Kuala_Lumpur";
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const key = dayKey(new Date(iso));
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(yesterday)) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

export function BeansProvider({ children }: { children: React.ReactNode }) {
  const [balance, setBalance] = useState(0);
  const [lifetimeEarned, setLifetimeEarned] = useState(0);
  const [activity, setActivity] = useState<BeanActivity[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    let cleanupChannel: (() => void) | null = null;
    const supabase = createClient();

    async function load(userId: string) {
      const [{ data: account }, { data: txns }] = await Promise.all([
        supabase
          .from("reward_accounts")
          .select("balance, lifetime_earned")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("bean_transactions")
          .select("id, amount, label, created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(ACTIVITY_LIMIT),
      ]);
      if (!active) return;
      setBalance(account?.balance ?? 0);
      setLifetimeEarned(account?.lifetime_earned ?? 0);
      setActivity(
        (txns ?? []).map((t) => ({
          id: t.id,
          amount: t.amount,
          label: t.label,
          when: whenLabel(t.created_at),
        })),
      );
    }

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (active) setHydrated(true);
        return;
      }
      await load(user.id);
      if (active) setHydrated(true);

      // Live updates: the member's own reward_accounts row changes whenever the
      // ledger is written (the txn trigger updates it). Refetch on any change.
      const channel = supabase
        .channel(`rewards:${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "reward_accounts",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            void load(user.id);
          },
        );
      void supabase.realtime.setAuth().then(() => channel.subscribe());
      cleanupChannel = () => {
        void supabase.removeChannel(channel);
      };
    })();

    return () => {
      active = false;
      cleanupChannel?.();
    };
  }, []);

  const canAfford = useCallback((cost: number) => balance >= cost, [balance]);

  const value = useMemo<BeansContextValue>(
    () => ({
      hydrated,
      balance,
      lifetimeEarned,
      activity,
      earnRate: beansPerRinggit,
      canAfford,
    }),
    [hydrated, balance, lifetimeEarned, activity, canAfford],
  );

  return <BeansContext.Provider value={value}>{children}</BeansContext.Provider>;
}

export function useBeans(): BeansContextValue {
  const ctx = useContext(BeansContext);
  if (!ctx) throw new Error("useBeans must be used within a BeansProvider");
  return ctx;
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. The new store keeps every member the surviving consumers use (`balance`, `activity`, `hydrated`, `canAfford`, `earnRate`) and adds `lifetimeEarned`. The only caller of the now-removed `spendAndEarn`/`creditBeans` was `checkout-screen.tsx`, already fixed in Task 4; `product-customizer.tsx` uses only `canAfford`. If there are errors here, they indicate a missed reference — fix it before committing.

- [ ] **Step 3: Commit**

```bash
git add store/beans.tsx
git commit -m "feat(rewards): BeansProvider reads balance/activity from Supabase with realtime"
```

---

### Task 6: useStreak → Supabase-backed reader (+ remove dev streak controls)

Replace the localStorage check-in set with a Supabase read of `streak_checkins`. The pure rules in `lib/streak.ts` are reused unchanged. The dev "skip a day" offset and `checkIn`/`devAdvanceDay`/`devReset` are removed (check-ins are now created server-side at order placement). Because `rewards-screen.tsx` is the only caller of `devAdvanceDay`/`devReset`, this task also removes that dev-controls block from `rewards-screen.tsx` so the project stays compilable at this commit.

**Files:**
- Modify: `hooks/use-streak.ts` (full rewrite)
- Modify: `components/rewards-screen.tsx` (remove dev-controls only)

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/client`; `buildWeek`, `computeStreakDays`, `hasCheckedInToday` from `@/lib/streak`; `StreakDay` from `@/types/reward`.
- Produces: `useStreak(): { hydrated: boolean; streakDays: number; week: StreakDay[]; checkedInToday: boolean }`.

- [ ] **Step 1: Rewrite `hooks/use-streak.ts`**

Replace the entire file with:

```ts
"use client";

import { useEffect, useMemo, useState } from "react";
import type { StreakDay } from "@/types/reward";
import {
  buildWeek,
  computeStreakDays,
  hasCheckedInToday,
} from "@/lib/streak";
import { createClient } from "@/lib/supabase/client";

// Streak read from Supabase. Check-ins are recorded server-side at order
// placement (apply_order_rewards); this hook only derives the display values via
// the pure rules in lib/streak.ts. Guests / signed-out see an empty streak.
type UseStreak = {
  hydrated: boolean;
  streakDays: number;
  week: StreakDay[];
  checkedInToday: boolean;
};

export function useStreak(): UseStreak {
  const [checkIns, setCheckIns] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (active) setHydrated(true);
        return;
      }
      const { data } = await supabase
        .from("streak_checkins")
        .select("check_in_date")
        .eq("user_id", user.id);
      if (active && data) {
        setCheckIns(new Set(data.map((r) => r.check_in_date)));
      }
      if (active) setHydrated(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  return useMemo<UseStreak>(() => {
    const today = new Date();
    return {
      hydrated,
      streakDays: computeStreakDays(checkIns, today),
      week: buildWeek(checkIns, today),
      checkedInToday: hasCheckedInToday(checkIns, today),
    };
  }, [checkIns, hydrated]);
}
```

> `check_in_date` comes back as `"YYYY-MM-DD"`, the same format `lib/streak.ts`'s `dateKey()` produces, so the pure rules work unchanged.

- [ ] **Step 2: Remove the dev-controls const in `rewards-screen.tsx`**

In `components/rewards-screen.tsx`, delete:

```ts
// Dev-only streak controls (advance day / reset) are gated to non-production so
// they never ship to customers.
const SHOW_STREAK_DEV_CONTROLS = process.env.NODE_ENV !== "production";
```

- [ ] **Step 3: Remove the dev-controls block in `rewards-screen.tsx`**

Delete this entire block from the weekly-stamp section:

```tsx
          {SHOW_STREAK_DEV_CONTROLS && (
            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={streak.devAdvanceDay}
                className="flex-1 rounded-full border border-dashed border-neutral-300 py-2 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Dev: Skip a day
              </button>
              <button
                type="button"
                onClick={streak.devReset}
                className="flex-1 rounded-full border border-dashed border-neutral-300 py-2 text-[0.625rem] font-semibold uppercase tracking-wide text-muted-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Dev: Reset streak
              </button>
            </div>
          )}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. `useStreak` now returns only `{ hydrated, streakDays, week, checkedInToday }`; `rewards-screen.tsx` still consumes those four (via its existing `streak.hydrated ? streak.streakDays : data.streakDays` fallback, untouched here) and no longer references the removed dev methods. No other file uses `useStreak`.

- [ ] **Step 5: Commit**

```bash
git add hooks/use-streak.ts components/rewards-screen.tsx
git commit -m "feat(rewards): useStreak reads check-ins from Supabase; drop dev offset + controls"
```

---

### Task 7: Config split + screen refactors (and remove the mock)

Split the per-user mock out of `data/rewards.ts`, leaving typed config (catalog, milestones, referral, fallback). Update the consumers to read per-user values from the now-Supabase-backed stores, derive tier from `lifetimeEarned` (including the tiers modal), and drop the mock fallbacks. (The dev streak controls were already removed in Task 6.) This is the task that retires the mock and leaves the app compiling and running end to end.

**Files:**
- Modify: `data/rewards.ts`
- Modify: `types/reward.ts` (remove `RewardsSummary`)
- Modify: `components/rewards-screen.tsx`
- Modify: `components/rewards-catalog.tsx`
- Modify: `components/rewards-activity.tsx`
- Modify: `components/profile-screen.tsx`
- Modify: `app/(customer)/rewards/page.tsx`

**Interfaces:**
- Consumes: `useBeans()` (Task 5: `balance`, `lifetimeEarned`, `activity`, `hydrated`), `useStreak()` (Task 6).
- Produces (new exports in `data/rewards.ts`): `rewardsCatalog: Reward[]`, `streakMilestones: StreakMilestone[]`, `referralReward: { beans: number; voucher: string }`, `FREE_DRINK_FALLBACK: number`. Keeps: `rewardTiers`, `beansPerRinggit`, `getTierProgress`, `TierProgress`, `RECENT_ACTIVITY_LIMIT`. Removes: `rewardsSummary`, `getStreakAwards` (its `StreakAward` type already lives in `types/reward.ts` as of Task 3).

- [ ] **Step 1: Remove `RewardsSummary` from `types/reward.ts`**

In `types/reward.ts`, delete the `RewardsSummary` type entirely (it is no longer used — per-user data now comes from the stores). `StreakAward` was already added in Task 3, so do not add it again here.

- [ ] **Step 2: Rewrite the data section of `data/rewards.ts`**

In `data/rewards.ts`: keep `rewardTiers`, `beansPerRinggit`, `TierProgress`, `getTierProgress`, and `RECENT_ACTIVITY_LIMIT` exactly as they are (do not move or delete `RECENT_ACTIVITY_LIMIT`). Make these three precise changes:

(a) Replace the top import:

```ts
import type { RewardsSummary, RewardTier } from "@/types/reward";
```

with:

```ts
import type { Reward, RewardTier, StreakMilestone } from "@/types/reward";
```

(b) Delete the `rewardsSummary` constant (the `export const rewardsSummary: RewardsSummary = { ... }` block), the `StreakAward` type (`export type StreakAward = ...`), and the `getStreakAwards` function (`export function getStreakAwards(...) { ... }`). Leave `RECENT_ACTIVITY_LIMIT` where it is. Then append the config split below to the end of the file:

```ts
// The redeemable free-drink catalog. Static config for now; the future CMS will
// manage these. Redemption cost is pegged to each drink's retail price (Beans ≈
// price in sen) for a uniform ~10% reward rate.
export const rewardsCatalog: Reward[] = [
  { id: "free-americano", name: "Free Americano", cost: 1000, image: images.coffeeWithLogo, productSlug: "americano" },
  { id: "free-latte", name: "Free Latte", cost: 1300, image: images.coffeeWithLogo, productSlug: "naise-signature-latte" },
  { id: "free-matcha", name: "Free Matcha", cost: 1500, image: images.coffeeWithLogo, productSlug: "matcha-latte" },
  { id: "free-spanish-latte", name: "Free Spanish Latte", cost: 1400, image: images.coffeeWithLogo, productSlug: "spanish-latte" },
];

// Streak stamp-card milestones (display). The Bean grants are applied
// server-side by apply_order_rewards — these numbers MUST match that function.
export const streakMilestones: StreakMilestone[] = [
  { days: 3, reward: "50 Beans", beans: 50 },
  { days: 7, reward: "100 Beans", beans: 100 },
  { days: 30, reward: "Free Drink", beans: 1000 },
];

// Referral invite-card values (display only; program not built yet).
export const referralReward = { beans: 200, voucher: "RM5 Voucher" };

// Fallback "free drink" target used by the hero when the catalog is empty.
export const FREE_DRINK_FALLBACK = 1000;
```

Keep the existing `RECENT_ACTIVITY_LIMIT` export (it already sits above this region) — leave it in place. Ensure `images` is still imported (it is, at the top).

- [ ] **Step 3: Refactor `components/rewards-screen.tsx`**

(a) Replace the import of config + remove the `RewardsSummary` type usage:

```ts
import type { RewardsSummary } from "@/types/reward";
import { rewardTiers, getTierProgress, RECENT_ACTIVITY_LIMIT } from "@/data/rewards";
```

with:

```ts
import {
  rewardTiers,
  getTierProgress,
  RECENT_ACTIVITY_LIMIT,
  rewardsCatalog,
  streakMilestones,
  referralReward,
  FREE_DRINK_FALLBACK,
} from "@/data/rewards";
```

(b) Change the component signature and the hydration-fallback block. Replace:

```tsx
export function RewardsScreen({ data }: { data: RewardsSummary }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [tiersOpen, setTiersOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const rewardsRef = useRef<HTMLElement>(null);
  const streak = useStreak();
  const beansStore = useBeans();

  // Until the persisted stores load from localStorage, render the server-
  // provided mock values so the first client render matches the server HTML (no
  // hydration mismatch). Once hydrated, the live, persisted values take over.
  const streakDays = streak.hydrated ? streak.streakDays : data.streakDays;
  const week = streak.hydrated ? streak.week : data.week;
  const beans = beansStore.hydrated ? beansStore.balance : data.beans;
  const activity = beansStore.hydrated ? beansStore.activity : data.activity;
```

with:

```tsx
export function RewardsScreen() {
  const [infoOpen, setInfoOpen] = useState(false);
  const [tiersOpen, setTiersOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const rewardsRef = useRef<HTMLElement>(null);
  const streak = useStreak();
  const beansStore = useBeans();

  // Per-user rewards come from the Supabase-backed stores. Before they hydrate
  // we render the zero state (matching the server HTML), then the live values
  // take over once loaded. `beans` is the spendable balance (hero + redeem
  // affordability); `lifetimeEarned` drives the loyalty tier (earn-only, so
  // redeeming never demotes).
  const streakDays = streak.streakDays;
  const week = streak.week;
  const beans = beansStore.balance;
  const lifetimeEarned = beansStore.lifetimeEarned;
  const activity = beansStore.activity;
```

(c) Update the derived values that referenced `data`. Replace:

```tsx
  const drinkCost =
    data.rewards.length > 0
      ? Math.min(...data.rewards.map((r) => r.cost))
      : data.nextDrinkAt;
```

with:

```tsx
  const drinkCost =
    rewardsCatalog.length > 0
      ? Math.min(...rewardsCatalog.map((r) => r.cost))
      : FREE_DRINK_FALLBACK;
```

(d) Tier from lifetime earned. Replace:

```tsx
  const tier = getTierProgress(beans);
```

with:

```tsx
  const tier = getTierProgress(lifetimeEarned);
```

(e) Replace the remaining `data.*` references in the JSX:
- `data.milestones.map(...)` → `streakMilestones.map(...)`
- `{data.rewards.map((reward) => {` → `{rewardsCatalog.map((reward) => {`
- `{data.referralBeans} Beans` → `{referralReward.beans} Beans`
- `<span className="font-semibold text-white">{data.referralVoucher}</span>` → `<span className="font-semibold text-white">{referralReward.voucher}</span>`

(f) Make the "Your Tier" summary card show lifetime-earned against the next threshold (not the spendable balance), so the numbers agree with the tier. Replace:

```tsx
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {tier.isMaxTier
                ? `${beans.toLocaleString()} Beans · Top tier`
                : `${beans.toLocaleString()} / ${tier.next!.threshold.toLocaleString()} Beans`}
            </p>
```

with:

```tsx
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {tier.isMaxTier
                ? `${lifetimeEarned.toLocaleString()} Beans · Top tier`
                : `${lifetimeEarned.toLocaleString()} / ${tier.next!.threshold.toLocaleString()} Beans`}
            </p>
```

(g) Make the tiers modal use lifetime-earned too, so its unlocked/current markers match the tier shown on the screen. Replace:

```tsx
        <RewardsTiersModal
          tiers={rewardTiers}
          beans={beans}
          onClose={() => setTiersOpen(false)}
        />
```

with:

```tsx
        <RewardsTiersModal
          tiers={rewardTiers}
          beans={lifetimeEarned}
          onClose={() => setTiersOpen(false)}
        />
```

> The dev-controls block was already removed in Task 6 — nothing to remove here.

- [ ] **Step 4: Refactor `app/(customer)/rewards/page.tsx`**

Replace the file with:

```tsx
import type { Metadata } from "next";
import { RewardsScreen } from "@/components/rewards-screen";

export const metadata: Metadata = {
  title: "Rewards",
  description:
    "Earn Beans on every Naise Coffee order and redeem them for free drinks.",
};

export default function RewardsPage() {
  return <RewardsScreen />;
}
```

- [ ] **Step 5: Refactor `components/rewards-catalog.tsx`**

(a) Replace the imports:

```ts
import { rewardsSummary } from "@/data/rewards";
import { useBeans } from "@/store/beans";
```

with:

```ts
import { rewardsCatalog } from "@/data/rewards";
import { useBeans } from "@/store/beans";
```

(b) Replace the balance/rewards derivation:

```ts
  const { balance, hydrated } = useBeans();
  const beans = hydrated ? balance : rewardsSummary.beans;
  const { rewards } = rewardsSummary;
```

with:

```ts
  const { balance } = useBeans();
  const beans = balance;
  const rewards = rewardsCatalog;
```

- [ ] **Step 6: Refactor `components/rewards-activity.tsx`**

(a) Replace the import:

```ts
import { rewardsSummary } from "@/data/rewards";
import { useBeans } from "@/store/beans";
```

with:

```ts
import { useBeans } from "@/store/beans";
```

(b) Replace the entries derivation:

```ts
  const { activity, hydrated } = useBeans();
  const entries = hydrated ? activity : rewardsSummary.activity;
```

with:

```ts
  const { activity } = useBeans();
  const entries = activity;
```

(c) Add an empty state. Replace the `<ul>...</ul>` block's opening so that when there are no entries the screen shows a friendly note. Wrap the existing list:

```tsx
      {entries.length === 0 ? (
        <div className="mt-2 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-10 text-center naise-rise">
          <p className="text-sm text-muted-foreground">No Bean activity yet.</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border naise-rise">
          {entries.map((item) => {
            const earned = item.amount > 0;
            return (
              <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full",
                    earned ? "bg-black text-white" : "bg-neutral-100 text-foreground",
                  )}
                >
                  {earned ? (
                    <Plus className="size-3.5" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <Minus className="size-3.5" strokeWidth={2.5} aria-hidden />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="text-sm font-bold tabular-nums">
                    {Math.abs(item.amount)}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {item.label}
                  </span>
                </div>
                <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                  {item.when}
                </span>
              </li>
            );
          })}
        </ul>
      )}
```

(This replaces the existing single `<ul>...</ul>`.)

- [ ] **Step 7: Refactor `components/profile-screen.tsx` tier basis**

Replace:

```tsx
  const { balance } = useBeans();
```

with:

```tsx
  const { balance, lifetimeEarned } = useBeans();
```

and replace:

```tsx
  const tier = getTierProgress(balance);
```

with:

```tsx
  const tier = getTierProgress(lifetimeEarned);
```

(The Beans card still shows `balance`; only the tier uses `lifetimeEarned`.)

- [ ] **Step 8: Full typecheck, lint, and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. No references remain to `rewardsSummary`, `getStreakAwards`, `RewardsSummary`, `spendAndEarn`, `creditBeans`, `checkIn`, `devAdvanceDay`, or `devReset` anywhere. Confirm with:

```bash
grep -rn "rewardsSummary\|getStreakAwards\|RewardsSummary\|spendAndEarn\|creditBeans\|devAdvanceDay\|devReset" app components store hooks data types lib
```
Expected: no matches.

- [ ] **Step 9: Commit**

```bash
git add data/rewards.ts types/reward.ts components/rewards-screen.tsx components/rewards-catalog.tsx components/rewards-activity.tsx components/profile-screen.tsx app/\(customer\)/rewards/page.tsx
git commit -m "feat(rewards): screens read live Supabase rewards; tier from lifetime-earned; remove mock"
```

---

### Task 8: End-to-end manual verification

No code changes — this task confirms the whole flow against the running app and the database. Run after Task 7.

**Files:** none.

- [ ] **Step 1: Start the app**

Run: `npm run dev`
Open the app and sign in as a member (Google OAuth). Note: this member should be fresh OR have had their test ledger cleared (Task 2 Step 5).

- [ ] **Step 2: New member starts at 0**

Visit `/rewards`. Expected: `0 Beans`, tier `Fresh`, `0 Days` streak, empty "Recent Activity". Visit `/profile`. Expected: Beans card shows `0` and `Fresh tier`.

- [ ] **Step 3: Earn on placement**

Add a drink (≥ RM1) to the cart and place the order (member, any non-DuitNow method to keep it simple). On the confirmation screen, if the streak hit a checkpoint you'll see the bonus box. Return to `/rewards`. Expected: balance = `floor(RM) × 10` (+ any bonus), one "Order earnings" row in activity, streak = 1, `Fresh` tier (unless past 1000). Confirm the balance updated **without a manual refresh** if the page was open (realtime).

- [ ] **Step 4: Verify the ledger in the DB**

Via Supabase MCP `execute_sql`:

```sql
select category, amount, label, is_reversal, created_at
from public.bean_transactions
order by created_at desc limit 10;
```
Expected: an `earn` row matching the order; `balance`/`lifetime_earned` in `reward_accounts` match the sum.

- [ ] **Step 5: Tier holds on redemption**

Using the DB, give the test member enough lifetime to redeem (simulating prior earning) so a reward is affordable, e.g.:

```sql
-- Replace <USER_ID> with the test member's auth uid.
insert into public.bean_transactions (user_id, category, amount, label)
values ('<USER_ID>', 'adjustment', 1500, 'Test top-up');
```
Reload `/rewards`: a reward (e.g. Free Americano, 1000) is now redeemable. Redeem it (adds the free drink to the cart), then place the order. Expected: balance drops by the reward cost, a "Redeemed …" row appears, but the **tier does not drop** (lifetime-earned unchanged by redemption). Remove the test top-up afterward if desired.

- [ ] **Step 6: Cancel reverses**

As staff (a manager/admin account), open `/manage`, find the test member's order, and cancel it. Then as the member reload `/rewards`. Expected: the earned Beans (and any bonus) from that order are clawed back; if a reward was redeemed on it, those Beans are refunded; activity shows the "(reversed)" rows. Verify net zero in the DB:

```sql
select coalesce(sum(amount), 0) as net
from public.bean_transactions
where order_id = (select id from public.orders order by created_at desc limit 1);
```
Expected: `0`.

- [ ] **Step 7: Guest earns nothing**

Sign out. Place an order as a guest. Expected: no rewards rows created (the function no-ops); `/rewards` still shows zeros for the guest. Confirm in the DB that the guest order's `user_id` is null and it has no `bean_transactions`.

- [ ] **Step 8: RLS sanity**

Via Supabase MCP `get_advisors` (type: `security`). Expected: no RLS-disabled / missing-policy errors for the rewards tables. Optionally confirm a member cannot read another member's rows (the select policy restricts to own rows or staff).

- [ ] **Step 9: Final commit (docs only, if anything was noted)**

If you adjusted anything during verification, commit it. Otherwise this task produces no commit.

---

## Notes carried from the spec's open items (resolved here)

- **Redemption representation:** chosen as nullable columns on `order_items` (`is_reward`, `reward_cost`) — not a separate table — to keep the change minimal and read directly inside `apply_order_rewards`.
- **Config sync:** the earn rate (`10`) and the milestone rule live in BOTH `data/rewards.ts` (display + constant) and the SQL function. Changing either means updating both until the CMS phase moves them to a shared source. This is called out in code comments in `apply_order_rewards` and `data/rewards.ts`.
- **Reversal double-guard:** `is_reversal` boolean on `bean_transactions`; `reverse_order_rewards` bails if any reversal row already exists for the order.
- **Realtime shape:** the `BeansProvider` subscribes to Postgres Changes on the member's own `reward_accounts` row and refetches on change (no `router.refresh()` needed since the provider owns the data).
- **Lazy account creation:** `apply_order_rewards` upserts the `reward_accounts` row (default 0) on first earn — no signup trigger needed.
```
