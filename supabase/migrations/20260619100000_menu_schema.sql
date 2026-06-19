-- Menu catalog: categories, products, variants, add-ons, and the hybrid add-on
-- link tables. Replaces the hardcoded data/menu.ts. Money in sen.
-- RLS: public read of non-archived rows; all writes restricted to admin.
-- Reuses public.set_updated_at() and public.current_user_role() from the
-- profiles migration. current_user_role() is NOT executable by anon, so the
-- anon SELECT policies below never call it.

-- Tables ----------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  sort_order  int not null default 0,
  max_addons  int not null default 3 check (max_addons >= 0),
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.addons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  price       integer not null check (price >= 0),
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.products (
  id             uuid primary key default gen_random_uuid(),
  category_id    uuid not null references public.categories (id) on delete restrict,
  slug           text not null unique,
  name           text not null,
  description    text not null default '',
  image_url      text,
  base_price     integer check (base_price is null or base_price >= 0),
  max_addons     int check (max_addons is null or max_addons >= 0),
  is_best_seller boolean not null default false,
  is_new         boolean not null default false,
  is_featured    boolean not null default false,
  is_available   boolean not null default true,
  is_archived    boolean not null default false,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.product_variants (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name       text not null,
  price      integer not null check (price >= 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.category_addons (
  category_id uuid not null references public.categories (id) on delete cascade,
  addon_id    uuid not null references public.addons (id) on delete cascade,
  sort_order  int not null default 0,
  primary key (category_id, addon_id)
);

create table public.product_addons (
  product_id uuid not null references public.products (id) on delete cascade,
  addon_id   uuid not null references public.addons (id) on delete cascade,
  mode       text not null check (mode in ('add', 'remove')),
  sort_order int not null default 0,
  primary key (product_id, addon_id)
);

-- Indexes ---------------------------------------------------------------------
create index products_category_id_idx on public.products (category_id);
create index products_best_seller_idx on public.products (is_best_seller)
  where is_best_seller and not is_archived;
create index products_featured_idx on public.products (is_featured)
  where is_featured and not is_archived;
create index product_variants_product_id_idx on public.product_variants (product_id);
create index category_addons_category_id_idx on public.category_addons (category_id);
create index product_addons_product_id_idx on public.product_addons (product_id);

-- updated_at triggers ---------------------------------------------------------
create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger addons_set_updated_at before update on public.addons
  for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger product_variants_set_updated_at before update on public.product_variants
  for each row execute function public.set_updated_at();

-- RLS -------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.addons enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.category_addons enable row level security;
alter table public.product_addons enable row level security;

-- Public read of non-archived rows. Split by role so anon never calls
-- current_user_role() (which it cannot execute).
create policy "categories_read_anon" on public.categories for select to anon
  using (not is_archived);
create policy "categories_read_auth" on public.categories for select to authenticated
  using (not is_archived or public.current_user_role() = 'admin');

create policy "addons_read_anon" on public.addons for select to anon
  using (not is_archived);
create policy "addons_read_auth" on public.addons for select to authenticated
  using (not is_archived or public.current_user_role() = 'admin');

create policy "products_read_anon" on public.products for select to anon
  using (not is_archived);
create policy "products_read_auth" on public.products for select to authenticated
  using (not is_archived or public.current_user_role() = 'admin');

-- Variants + link tables only reference catalog rows; readable by everyone.
create policy "product_variants_read_all" on public.product_variants for select
  to anon, authenticated using (true);
create policy "category_addons_read_all" on public.category_addons for select
  to anon, authenticated using (true);
create policy "product_addons_read_all" on public.product_addons for select
  to anon, authenticated using (true);

-- Writes: admin only, every table. (FOR ALL also grants admin full SELECT.)
create policy "categories_write_admin" on public.categories for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "addons_write_admin" on public.addons for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "products_write_admin" on public.products for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "product_variants_write_admin" on public.product_variants for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "category_addons_write_admin" on public.category_addons for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
create policy "product_addons_write_admin" on public.product_addons for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
