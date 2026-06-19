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
