-- Unify recipe (ingredient ticks) and prep steps into one ordered list on the
-- product, and give each cost item a reusable prep-step template. Additive:
-- product_recipe_items and products.recipe_steps are left in place (a later
-- migration drops them once this is verified in production).

-- 1. Prep-step template on each cost item. {g} is replaced with the grams
--    entered on the step; author once, reused by every drink.
alter table public.cost_items
  add column if not exists prep_template text;

-- 2. One ordered recipe list per product. Entries are tagged objects; order is
--    array position. Cost is derived from the "ingredient" entries.
alter table public.products
  add column if not exists recipe jsonb default null;

-- 3. Backfill: ingredient entries first (existing recipe items, in their
--    sort_order), then existing free-text prep steps appended after.
update public.products p
set recipe = coalesce(ing.arr, '[]'::jsonb) || coalesce(free.arr, '[]'::jsonb)
from
  (select product_id,
          jsonb_agg(
            jsonb_build_object(
              'kind', 'ingredient',
              'costItemId', cost_item_id,
              'grams', amount_grams,
              'text', null,
              'custom', false
            ) order by sort_order
          ) as arr
   from public.product_recipe_items
   group by product_id) ing
  full outer join
  (select p2.id as product_id,
          jsonb_agg(
            jsonb_build_object('kind', 'free', 'text', step)
            order by ord
          ) as arr
   from public.products p2,
        lateral unnest(p2.recipe_steps) with ordinality as s(step, ord)
   where p2.recipe_steps is not null
   group by p2.id) free
  on ing.product_id = free.product_id
where p.id = coalesce(ing.product_id, free.product_id)
  and (ing.arr is not null or free.arr is not null);

-- Normalise empty results to null so "no recipe" stays null, not '[]'.
update public.products set recipe = null where recipe = '[]'::jsonb;

-- 4. Seed prep templates for the known cost items (grams shown via {g}).
--    Packaging-type and no-portion items get no template (steps start blank).
update public.cost_items set prep_template = 'Steam {g}g milk'                         where name = 'Milk';
update public.cost_items set prep_template = 'Grind {g}g coffee, pull 2 shots espresso' where name = 'Coffee';
update public.cost_items set prep_template = 'Whisk {g}g matcha with 40ml water'        where name = 'Matcha';
update public.cost_items set prep_template = 'Add {g}g sauce'                           where name = 'Sauce';
update public.cost_items set prep_template = 'Pump {g}g syrup'                          where name = 'Syrup';
update public.cost_items set prep_template = 'Add {g}g yogurt'                          where name = 'Yogurt';
update public.cost_items set prep_template = 'Add {g}g chocolate'                       where name = 'Chocolate';
update public.cost_items set prep_template = 'Add {g}g taro'                            where name = 'Taro';
update public.cost_items set prep_template = 'Add {g}g fruit crush'                     where name = 'Fruit Crush';
update public.cost_items set prep_template = 'Add {g}g condensed milk'                  where name = 'Condensed milk';
update public.cost_items set prep_template = 'Add {g}g Joss'                            where name = 'Extra Joss';
update public.cost_items set prep_template = 'Top with {g}g whipped cream'              where name = 'Whipp cream';
update public.cost_items set prep_template = 'Add {g}g cheese'                          where name = 'Cheese';
update public.cost_items set prep_template = 'Steam {g}g Oatside'                       where name = 'Oatside';
