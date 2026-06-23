-- Add recipe steps column to products table (CMS source of truth)
alter table public.products
  add column if not exists recipe_steps text[] default null;

-- Link order items back to menu products for live recipe lookup
alter table public.order_items
  add column if not exists product_id uuid references public.products (id) on delete set null;

-- Index for the FK (used when looking up recipes from order items)
create index if not exists order_items_product_id_idx on public.order_items (product_id);
