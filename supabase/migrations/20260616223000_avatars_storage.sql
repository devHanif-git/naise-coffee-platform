-- Avatar storage for customer profile photos.
-- Public bucket (avatars are shown without auth on the profile screen), capped
-- at 2 MB, images only. Each user owns a folder named after their auth uid;
-- the RLS policies below enforce that a user can only write/delete inside
-- their own folder, while anyone can read (public profile photos).

-- Bucket ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Policies -------------------------------------------------------------------
-- Path convention: "<auth.uid()>/<filename>". The first path segment must
-- equal the caller's uid for any write/update/delete.

-- Anyone can read avatars (public profile photos).
create policy "avatars_read_public"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- A user may upload only into their own uid-prefixed folder.
create policy "avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- A user may overwrite only their own files.
create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- A user may delete only their own files.
create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
