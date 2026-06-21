-- Distinguishes in-store kiosk orders from online orders for reporting.
create type public.order_source as enum ('online', 'store');

alter table public.orders
  add column source public.order_source not null default 'online';

create index orders_source_idx on public.orders (source);

comment on column public.orders.source is
  'Channel the order came from: online storefront or in-store kiosk.';

-- Singleton state for the shared in-store ordering account. The passcode is the
-- auth user's password and is NEVER stored here. is_enabled is the authoritative
-- server-side kill switch checked on every kiosk request.
create table public.store_account (
  id             boolean primary key default true check (id),
  is_enabled     boolean not null default false,
  store_user_id  uuid references auth.users (id) on delete set null,
  last_rotated_at timestamptz,
  updated_at     timestamptz not null default now()
);

comment on table public.store_account is
  'Single-row config for the in-store kiosk account. Admin-write; admin+store-read.';

create trigger store_account_set_updated_at before update on public.store_account
  for each row execute function public.set_updated_at();

alter table public.store_account enable row level security;

-- The kiosk layout reads is_enabled as the store user; admin reads it in the CMS.
create policy "store_account_read_admin_or_store" on public.store_account
  for select to authenticated
  using (public.current_user_role() in ('admin', 'store'));

create policy "store_account_write_admin" on public.store_account
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

insert into public.store_account (id) values (true) on conflict (id) do nothing;
