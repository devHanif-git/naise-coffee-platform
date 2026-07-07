-- Cost of goods: an internal price list of raw items (milk, matcha, packaging…)
-- and a per-product recipe that links a drink to the items it consumes. Drink
-- goods cost = sum of its recipe items' prices + every "always included" item.
-- Money in sen. Unlike the menu tables, cost data is INTERNAL business data:
-- RLS is admin-only on both tables (no public/customer read).
-- Reuses public.set_updated_at() and public.current_user_role().

-- Tables ----------------------------------------------------------------------
create table public.cost_items (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  -- Flat cost contributed to a drink when used, in sen. Grams entered on the
  -- recipe are staff guidance only and do not scale this price.
  price               integer not null check (price >= 0),
  -- Auto-added to every drink's cost without being ticked (e.g. packaging).
  is_always_included  boolean not null default false,
  is_archived         boolean not null default false,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.product_recipe_items (
  product_id    uuid not null references public.products (id) on delete cascade,
  cost_item_id  uuid not null references public.cost_items (id) on delete cascade,
  -- Quantity used, in grams. Staff guidance only; null when not specified.
  amount_grams  integer check (amount_grams is null or amount_grams >= 0),
  sort_order    int not null default 0,
  primary key (product_id, cost_item_id)
);

-- Per-line cost snapshot at sale time, in sen. Mirrors unit_price: editing a
-- cost item later changes future profit only, never rewrites past orders.
alter table public.order_items
  add column if not exists unit_cost integer check (unit_cost is null or unit_cost >= 0);

-- Indexes ---------------------------------------------------------------------
create index product_recipe_items_product_id_idx
  on public.product_recipe_items (product_id);
create index cost_items_always_included_idx
  on public.cost_items (is_always_included)
  where is_always_included and not is_archived;

-- updated_at trigger ----------------------------------------------------------
create trigger cost_items_set_updated_at before update on public.cost_items
  for each row execute function public.set_updated_at();

-- RLS -------------------------------------------------------------------------
alter table public.cost_items enable row level security;
alter table public.product_recipe_items enable row level security;

-- Admin only — cost is internal. FOR ALL covers read + write for admins; no
-- anon/customer policy means no one else can see it.
create policy "cost_items_admin" on public.cost_items for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
create policy "product_recipe_items_admin" on public.product_recipe_items for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Seed ------------------------------------------------------------------------
-- Initial cost list (RM -> sen). Packaging is the only always-included item.
insert into public.cost_items (name, price, is_always_included, sort_order) values
  ('Milk',                       85,  false, 0),
  ('Cup w lid w sticker w straw', 46,  true,  1),
  ('Coffee',                     151, false, 2),
  ('Matcha',                     155, false, 3),
  ('Sauce',                       97, false, 4),
  ('Syrup',                      106, false, 5),
  ('Yogurt',                     110, false, 6),
  ('Chocolate',                  152, false, 7),
  ('Taro',                       112, false, 8),
  ('Fruit Crush',                112, false, 9),
  ('Condensed milk',              18, false, 10),
  ('Extra Joss',                  52, false, 11),
  ('Whipp cream',                 59, false, 12),
  ('Cheese',                      59, false, 13),
  ('Oatside',                    149, false, 14);
