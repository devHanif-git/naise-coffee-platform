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
