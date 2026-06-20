-- Make the merchant DuitNow QR CMS-managed. Two parts:
--   1) a public, admin-write `payments` Storage bucket for the QR image
--      (a copy of the `products` bucket policy set), and
--   2) a `duitnow_qr_url` column on the single-row payment_settings table.
-- When the column is null the storefront falls back to the bundled QR asset.
-- payment_settings RLS already governs the row, so no table policy change.

-- 1) Storage bucket for payment images (currently just the DuitNow QR). Public
-- (the QR renders at checkout without auth), capped at 5 MB, images only.
-- Path convention: "<uuid>.<ext>". Only admins may write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payments', 'payments', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "payments_read_public" on storage.objects for select
  using (bucket_id = 'payments');

create policy "payments_insert_admin" on storage.objects for insert to authenticated
  with check (bucket_id = 'payments' and public.current_user_role() = 'admin');

create policy "payments_update_admin" on storage.objects for update to authenticated
  using (bucket_id = 'payments' and public.current_user_role() = 'admin');

create policy "payments_delete_admin" on storage.objects for delete to authenticated
  using (bucket_id = 'payments' and public.current_user_role() = 'admin');

-- 2) The QR image URL on the single payment_settings row. Nullable; null means
-- "use the bundled fallback". No backfill.
alter table public.payment_settings
  add column duitnow_qr_url text;

comment on column public.payment_settings.duitnow_qr_url is
  'Public URL of the merchant DuitNow QR in the payments bucket. Null = use the bundled fallback asset.';
