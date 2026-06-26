-- Backfill order_items.product_id for legacy lines so analytics can resolve the
-- live product name. order_items.name is a snapshot taken at order time; reports
-- now prefer the current products.name via product_id, falling back to the
-- snapshot only for custom drinks and unlinkable legacy rows.

-- 1) Link non-custom legacy lines whose snapshot name still uniquely matches a
--    current product. Names that map to more than one product are left untouched
--    (ambiguous — no safe link).
update public.order_items oi
set product_id = p.id
from public.products p
where oi.product_id is null
  and oi.is_custom = false
  and oi.name = p.name
  and (select count(*) from public.products p2 where p2.name = p.name) = 1;

-- 2) Targeted relink for already-renamed items whose snapshot name no longer
--    matches any product. "Latte" was renamed to "Coffee Latte".
update public.order_items oi
set product_id = p.id
from public.products p
where oi.product_id is null
  and oi.is_custom = false
  and oi.name = 'Latte'
  and p.name = 'Coffee Latte';
