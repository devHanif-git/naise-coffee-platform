-- One-time seed mirroring data/menu.ts exactly. Guarded: runs only if there are
-- no products yet. Large variants are Regular + RM2. Americano is flat-priced.
do $$
begin
  if exists (select 1 from public.products) then
    return;
  end if;

  insert into public.categories (slug, name, sort_order, max_addons) values
    ('coffee', 'Coffee', 0, 3),
    ('non_coffee', 'Non Coffee', 1, 3),
    ('matcha', 'Matcha', 2, 3);

  insert into public.addons (name, price) values
    ('Extra Shot', 200),
    ('Oat Milk', 250),
    ('Vanilla Syrup', 150),
    ('Caramel Syrup', 150),
    ('Pearls', 150),
    ('Extra Syrup', 150),
    ('Extra Matcha', 300);

  insert into public.products
    (category_id, slug, name, description, base_price, is_best_seller, is_new, sort_order)
  select c.id, v.slug, v.name, v.description, v.base_price, v.is_best_seller, v.is_new, v.sort_order
  from (values
    ('coffee','naise-signature-latte','Naise Signature Latte','Smooth. Bold. Naise.', null::int, true,  false, 0),
    ('coffee','spanish-latte','Spanish Latte','Sweet & creamy.',                       null::int, false, false, 1),
    ('coffee','americano','Americano','Bold and classic.',                              990,       false, false, 2),
    ('coffee','caramel-macchiato','Caramel Macchiato','Rich. Sweet. Balanced.',          null::int, true,  false, 3),
    ('coffee','vanilla-latte','Vanilla Latte','Smooth vanilla vibe.',                    null::int, true,  false, 4),
    ('coffee','mocha','Mocha','Chocolate meets coffee.',                                 null::int, false, false, 5),
    ('non_coffee','iced-chocolate','Iced Chocolate','Rich and velvety.',                 null::int, false, false, 0),
    ('non_coffee','brown-sugar-milk','Brown Sugar Milk','Sweet and comforting.',         null::int, false, true,  1),
    ('matcha','matcha-latte','Matcha Latte','Earthy and smooth.',                        null::int, false, false, 0),
    ('matcha','strawberry-matcha','Strawberry Matcha','Fruity meets earthy.',            null::int, false, true,  1)
  ) as v(cat_slug, slug, name, description, base_price, is_best_seller, is_new, sort_order)
  join public.categories c on c.slug = v.cat_slug;

  insert into public.product_variants (product_id, name, price, sort_order)
  select p.id, x.name, x.price, x.sort_order
  from (values
    ('naise-signature-latte','Regular',1290,0),('naise-signature-latte','Large',1490,1),
    ('spanish-latte','Regular',1390,0),('spanish-latte','Large',1590,1),
    ('caramel-macchiato','Regular',1390,0),('caramel-macchiato','Large',1590,1),
    ('vanilla-latte','Regular',1290,0),('vanilla-latte','Large',1490,1),
    ('mocha','Regular',1390,0),('mocha','Large',1590,1),
    ('iced-chocolate','Regular',1190,0),('iced-chocolate','Large',1390,1),
    ('brown-sugar-milk','Regular',1290,0),('brown-sugar-milk','Large',1490,1),
    ('matcha-latte','Regular',1490,0),('matcha-latte','Large',1690,1),
    ('strawberry-matcha','Regular',1690,0),('strawberry-matcha','Large',1890,1)
  ) as x(slug, name, price, sort_order)
  join public.products p on p.slug = x.slug;

  insert into public.category_addons (category_id, addon_id, sort_order)
  select c.id, a.id, x.sort_order
  from (values
    ('coffee','Extra Shot',0),('coffee','Oat Milk',1),('coffee','Vanilla Syrup',2),('coffee','Caramel Syrup',3),
    ('non_coffee','Pearls',0),('non_coffee','Extra Syrup',1),
    ('matcha','Oat Milk',0),('matcha','Extra Matcha',1)
  ) as x(cat_slug, addon_name, sort_order)
  join public.categories c on c.slug = x.cat_slug
  join public.addons a on a.name = x.addon_name;
end $$;
