-- Category-level recipe base. Every drink in the category inherits these
-- ingredient/prep entries for cost AND staff prep (see lib/menu/recipe.ts
-- mergeRecipe). Same tagged-object shape as products.recipe. Additive: existing
-- rows default to null (no base). RLS unchanged — categories already carry a
-- public read policy; the recipe column is only ever selected server-side for
-- admin/cost paths and is not mapped into the storefront Category type.
alter table public.categories
  add column if not exists recipe jsonb default null;
