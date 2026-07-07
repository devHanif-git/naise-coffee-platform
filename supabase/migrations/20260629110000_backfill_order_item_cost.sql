-- OPTIONAL one-time backfill. Stamps current goods cost onto historical
-- order_items placed before cost tracking shipped (unit_cost is null) so past
-- profit figures aren't skewed to 100% margin. Uses the CURRENT recipe/cost
-- list as the best available estimate — historical cost wasn't recorded, so
-- this is an approximation, not a true at-sale snapshot. Only touches linked
-- (product_id not null) lines with a null unit_cost; custom/unlinked lines and
-- any line already carrying a cost are left untouched. Safe to run once.

with always_included as (
  -- Flat base cost added to every drink (e.g. packaging), in sen.
  select coalesce(sum(price), 0) as base
  from public.cost_items
  where is_always_included and not is_archived
),
product_cost as (
  -- Per-product cost = base + sum of its optional recipe items' prices.
  -- Always-included items are excluded here so they aren't double counted.
  select
    p.id as product_id,
    (select base from always_included)
      + coalesce(sum(ci.price) filter (where not ci.is_always_included), 0) as cost
  from public.products p
  left join public.product_recipe_items pri on pri.product_id = p.id
  left join public.cost_items ci on ci.id = pri.cost_item_id and not ci.is_archived
  group by p.id
)
update public.order_items oi
set unit_cost = pc.cost
from product_cost pc
where oi.product_id = pc.product_id
  and oi.unit_cost is null;
