-- Per-line "custom drink" flag. A custom drink is a one-off line an admin enters
-- with a hand-set price; it has no product_id (order_items never had one). This
-- flag lets reports rank custom drinks by name and tell them apart from menu
-- items. Backfills false for existing rows.
alter table public.order_items
  add column is_custom boolean not null default false;

comment on column public.order_items.is_custom is
  'True when this line is an admin-entered custom drink (no menu product).';
