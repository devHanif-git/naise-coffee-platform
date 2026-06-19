-- Product images. Public bucket (catalog images render without auth), capped at
-- 5 MB, images only. Only admins may write. Path convention: "<uuid>.<ext>".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('products', 'products', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "products_read_public" on storage.objects for select
  using (bucket_id = 'products');

create policy "products_insert_admin" on storage.objects for insert to authenticated
  with check (bucket_id = 'products' and public.current_user_role() = 'admin');

create policy "products_update_admin" on storage.objects for update to authenticated
  using (bucket_id = 'products' and public.current_user_role() = 'admin');

create policy "products_delete_admin" on storage.objects for delete to authenticated
  using (bucket_id = 'products' and public.current_user_role() = 'admin');
