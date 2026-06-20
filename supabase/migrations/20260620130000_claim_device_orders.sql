-- Re-own (claim) a device's unclaimed guest orders to the caller's account.
-- Called right after a real session is established (OAuth callback, and the
-- phone/OTP completion path when it goes live) so orders placed as a guest on
-- this browser attach to the new account.
--
-- SECURITY DEFINER because the orders UPDATE policy is staff-only; this bypasses
-- it but is safe: it derives the owner from auth.uid() internally (the client
-- only supplies the device id) and only ever touches rows with user_id IS NULL,
-- so a caller can never claim another member's orders. Idempotent — after the
-- first run nothing on the device is unclaimed, so repeat calls match 0 rows.
-- Granted to authenticated only. Mirrors the admin-RPC pattern
-- (20260620110000_admin_phase3_rpcs.sql).
create or replace function public.claim_device_orders(p_owner_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if coalesce(btrim(p_owner_id), '') = '' then
    return 0;
  end if;

  update public.orders
     set user_id = v_user,
         updated_at = now()
   where owner_id = p_owner_id
     and user_id is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.claim_device_orders(text) from public, anon;
grant execute on function public.claim_device_orders(text) to authenticated;
