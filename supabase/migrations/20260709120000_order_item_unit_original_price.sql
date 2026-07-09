-- Store each order line's pre-promo unit price so the staff manage view can flag
-- promo drinks and break down the discount. Nullable: rows created before this
-- column existed stay valid and simply show no per-drink promo flag (we can't
-- accurately backfill their original prices, since promotions may have changed).
alter table public.order_items
  add column unit_original_price integer
  check (unit_original_price is null or unit_original_price >= 0);

comment on column public.order_items.unit_original_price is
  'Per-unit price before promo, in sen. NULL for orders placed before this column existed — those render totals-only, no per-drink promo flag.';
