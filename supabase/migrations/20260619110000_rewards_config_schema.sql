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
