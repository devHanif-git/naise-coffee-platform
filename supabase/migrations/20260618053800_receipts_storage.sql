-- Private bucket for DuitNow QR payment receipts (sensitive payment screenshots).
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Anyone (incl. guests) may upload a receipt object. Path is unguessable
-- (owner_id/token). Reads are NOT public — staff read via service role / signed
-- URLs generated server-side, so no select policy is granted to anon here.
create policy "receipts_insert_any"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'receipts');

-- Staff may read receipts directly (e.g. for moderation tooling).
create policy "receipts_select_staff"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and public.current_user_role() in ('admin', 'manager', 'staff')
  );