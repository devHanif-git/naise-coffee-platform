-- Loyalty stamp card + voucher tables. Server-authoritative: clients SELECT only
-- (own rows or staff); all writes go through SECURITY DEFINER functions (see the
-- stamp_functions migration). Money is integer sen. Mirrors the rewards schema.

create type public.voucher_type as enum ('rm_off', 'free_drink');
create type public.voucher_status as enum ('active', 'redeemed', 'expired');

-- Singleton config (one row, fixed boolean PK — same trick as loyalty_settings).
create table public.stamp_settings (
  id                   boolean primary key default true check (id),
  is_enabled           boolean not null default true,
  card_size            integer not null default 8   check (card_size between 2 and 20),
  milestone_small      integer not null default 4   check (milestone_small >= 1),
  rm_off_amount        integer not null default 500 check (rm_off_amount >= 0),
  rm_off_min_spend     integer not null default 1100 check (rm_off_min_spend >= 0),
  free_drink_max_value integer not null default 1200 check (free_drink_max_value >= 0),
  voucher_expiry_days  integer not null default 30  check (voucher_expiry_days >= 1),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
insert into public.stamp_settings (id) values (true);

-- Cached per-member state. Source of truth is stamp_transactions; recomputable.
create table public.stamp_cards (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  current_count integer not null default 0,
  cycle         integer not null default 0,
  total_stamps  integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Append-only ledger. One stamp per order (per receipt); +1 earn, -1 reversal.
create table public.stamp_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  order_id    uuid not null references public.orders (id),
  amount      integer not null,
  is_reversal boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index stamp_transactions_order_once
  on public.stamp_transactions (order_id) where is_reversal = false;
create index stamp_transactions_user_created_idx
  on public.stamp_transactions (user_id, created_at desc);

-- Vouchers issued at milestones. Amount/min_spend snapshot at issue time.
create table public.vouchers (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  type                 public.voucher_type not null,
  status               public.voucher_status not null default 'active',
  discount_amount      integer not null default 0,
  min_spend            integer not null default 0,
  free_drink_max_value integer not null default 0,
  expires_at           timestamptz not null,
  source_order_id      uuid references public.orders (id),
  redeemed_order_id    uuid references public.orders (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index vouchers_user_status_idx on public.vouchers (user_id, status);
create index vouchers_source_order_idx on public.vouchers (source_order_id);

-- updated_at triggers (reuse existing fn).
create trigger stamp_settings_set_updated_at before update on public.stamp_settings
  for each row execute function public.set_updated_at();
create trigger stamp_cards_set_updated_at before update on public.stamp_cards
  for each row execute function public.set_updated_at();
create trigger vouchers_set_updated_at before update on public.vouchers
  for each row execute function public.set_updated_at();

-- Maintain the cached card on every ledger insert.
create or replace function public.apply_stamp_transaction()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.stamp_cards (user_id, current_count, total_stamps)
  values (new.user_id, new.amount, greatest(new.amount, 0))
  on conflict (user_id) do update set
    current_count = public.stamp_cards.current_count + new.amount,
    total_stamps  = public.stamp_cards.total_stamps + greatest(new.amount, 0),
    updated_at    = now();
  return new;
end;
$$;
create trigger stamp_transactions_apply
  after insert on public.stamp_transactions
  for each row execute function public.apply_stamp_transaction();
revoke execute on function public.apply_stamp_transaction() from anon, authenticated, public;

alter table public.stamp_settings enable row level security;
alter table public.stamp_cards enable row level security;
alter table public.stamp_transactions enable row level security;
alter table public.vouchers enable row level security;

-- stamp_settings: world-readable single row; admin writes.
create policy "stamp_settings_read_all" on public.stamp_settings for select
  to anon, authenticated using (true);
create policy "stamp_settings_write_admin" on public.stamp_settings for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

-- stamp_cards / stamp_transactions / vouchers: read own or staff; no client writes.
create policy "stamp_cards_select_own_or_staff" on public.stamp_cards for select to authenticated
  using ((select auth.uid()) = user_id or public.current_user_role() in ('admin','manager','staff'));
create policy "stamp_transactions_select_own_or_staff" on public.stamp_transactions for select to authenticated
  using ((select auth.uid()) = user_id or public.current_user_role() in ('admin','manager','staff'));
create policy "vouchers_select_own_or_staff" on public.vouchers for select to authenticated
  using ((select auth.uid()) = user_id or public.current_user_role() in ('admin','manager','staff'));

-- Realtime: live stamp card on the member's own row.
alter publication supabase_realtime add table public.stamp_cards;
alter table public.stamp_cards replica identity full;
