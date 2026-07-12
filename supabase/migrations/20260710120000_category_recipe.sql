-- Category-level recipe base. Every drink in the category inherits these
-- ingredient/prep entries for cost AND staff prep (see lib/menu/recipe.ts
-- mergeRecipe). Same tagged-object shape as products.recipe. Additive: existing
-- rows default to null (no base). RLS unchanged — categories already carry a
-- public read policy, so this column is readable via the anon key, but it holds
-- only cost-item ids + grams (no money) and is never mapped into the storefront
-- Category type. Money/cost is always derived server-side (see lib/menu/cost.ts).
alter table public.categories
  add column if not exists recipe jsonb default null;
