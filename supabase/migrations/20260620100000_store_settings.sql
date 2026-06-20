-- Store-level settings: a single-row table (boolean PK) for the open/closed
-- switch + feature toggles. World-readable (storefront + CMS read it); admin
-- writes. Mirrors loyalty_settings. Reuses public.set_updated_at() and
-- public.current_user_role() (anon CANNOT execute current_user_role(), so the
-- anon SELECT policy never calls it).

create table public.store_settings (
  id               boolean primary key default true check (id),
  is_open          boolean not null default true,
  closed_message   text not null default 'We''re currently closed. Please check back soon.',
  rewards_enabled  boolean not null default true,
  referral_enabled boolean not null default true,
  streak_enabled   boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.store_settings is 'Single-row store settings: open/closed + feature toggles. World-readable; admin-write.';

create trigger store_settings_set_updated_at before update on public.store_settings
  for each row execute function public.set_updated_at();

alter table public.store_settings enable row level security;

create policy "store_settings_read_all" on public.store_settings for select
  to anon, authenticated using (true);
create policy "store_settings_write_admin" on public.store_settings for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

-- Seed the single row with defaults.
insert into public.store_settings (id) values (true) on conflict (id) do nothing;
