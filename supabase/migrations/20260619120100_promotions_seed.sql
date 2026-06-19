-- One-time seed mirroring data/discounts.ts: Matcha Monday (20% off the matcha
-- category), Drink of the Day (15% off Vanilla Latte), Flash Deal (25% off Iced
-- Chocolate). Always-on (no window) and active, matching the current mock.
do $$
begin
  if exists (select 1 from public.promotions) then
    return;
  end if;

  insert into public.promotions (slug, label, percent_off, sort_order) values
    ('matcha-monday', 'Matcha Monday', 20, 0),
    ('drink-of-the-day', 'Drink of the Day', 15, 1),
    ('flash-deal', 'Flash Deal', 25, 2);

  -- Category targets.
  insert into public.promotion_categories (promotion_id, category_id)
  select pr.id, c.id
  from (values ('matcha-monday', 'matcha')) as v(promo_slug, cat_slug)
  join public.promotions pr on pr.slug = v.promo_slug
  join public.categories c on c.slug = v.cat_slug;

  -- Product targets.
  insert into public.promotion_products (promotion_id, product_id)
  select pr.id, p.id
  from (values
    ('drink-of-the-day', 'vanilla-latte'),
    ('flash-deal', 'iced-chocolate')
  ) as v(promo_slug, product_slug)
  join public.promotions pr on pr.slug = v.promo_slug
  join public.products p on p.slug = v.product_slug;
end $$;
