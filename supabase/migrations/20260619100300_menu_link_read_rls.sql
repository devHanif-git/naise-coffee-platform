-- Tighten read access on the variant/link tables. The original policies used
-- `using (true)`, which let anon/authenticated read rows that reference archived
-- products, categories, or add-ons — bypassing the non-archived read boundary
-- enforced on the base catalog tables. Replace them with archived-aware policies,
-- split by role so anon never calls public.current_user_role() (which it cannot
-- execute), matching the pattern used by the base-table read policies.

drop policy if exists "product_variants_read_all" on public.product_variants;
drop policy if exists "category_addons_read_all" on public.category_addons;
drop policy if exists "product_addons_read_all" on public.product_addons;

-- product_variants: visible only when the parent product is visible.
create policy "product_variants_read_anon" on public.product_variants for select to anon
  using (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id and not p.is_archived
    )
  );
create policy "product_variants_read_auth" on public.product_variants for select to authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id
        and (not p.is_archived or public.current_user_role() = 'admin')
    )
  );

-- category_addons: visible only when both the category and the add-on are visible.
create policy "category_addons_read_anon" on public.category_addons for select to anon
  using (
    exists (select 1 from public.categories c where c.id = category_addons.category_id and not c.is_archived)
    and exists (select 1 from public.addons a where a.id = category_addons.addon_id and not a.is_archived)
  );
create policy "category_addons_read_auth" on public.category_addons for select to authenticated
  using (
    (
      exists (select 1 from public.categories c where c.id = category_addons.category_id and not c.is_archived)
      and exists (select 1 from public.addons a where a.id = category_addons.addon_id and not a.is_archived)
    )
    or public.current_user_role() = 'admin'
  );

-- product_addons: visible only when both the product and the add-on are visible.
create policy "product_addons_read_anon" on public.product_addons for select to anon
  using (
    exists (select 1 from public.products p where p.id = product_addons.product_id and not p.is_archived)
    and exists (select 1 from public.addons a where a.id = product_addons.addon_id and not a.is_archived)
  );
create policy "product_addons_read_auth" on public.product_addons for select to authenticated
  using (
    (
      exists (select 1 from public.products p where p.id = product_addons.product_id and not p.is_archived)
      and exists (select 1 from public.addons a where a.id = product_addons.addon_id and not a.is_archived)
    )
    or public.current_user_role() = 'admin'
  );
