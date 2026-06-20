-- Phase 3 review hardening (from PR #18 review):
--   1. Lock the reward_accounts row in admin_adjust_beans before the balance
--      check so concurrent adjustments can't both pass validation and overdraw.
--   2. Restrict store_settings writes to INSERT/UPDATE (drop FOR ALL) so the
--      singleton row can't be DELETEd — a missing row would break the
--      open/closed + feature-toggle contract.

-- 1. Add SELECT ... FOR UPDATE row lock to admin_adjust_beans. Otherwise
-- identical to its definition in 20260620110000_admin_phase3_rpcs.sql.
create or replace function public.admin_adjust_beans(p_user uuid, p_amount integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'NOT_ADMIN';
  end if;
  if p_amount = 0 then
    raise exception 'ZERO_AMOUNT';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED';
  end if;

  insert into public.reward_accounts (user_id) values (p_user)
    on conflict (user_id) do nothing;

  -- Lock the row so concurrent adjustments serialize on the balance check.
  select balance into v_balance from public.reward_accounts
    where user_id = p_user for update;
  if v_balance + p_amount < 0 then
    raise exception 'NEGATIVE_BALANCE';
  end if;

  insert into public.bean_transactions (user_id, category, amount, label)
  values (p_user, 'adjustment', p_amount, 'Admin adjustment: ' || p_reason);

  select balance into v_balance from public.reward_accounts where user_id = p_user;
  return v_balance;
end;
$$;

revoke execute on function public.admin_adjust_beans(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_beans(uuid, integer, text) to authenticated;

-- 2. Restrict store_settings writes so the singleton can't be deleted. The
-- world-readable SELECT policy (store_settings_read_all) stays; we replace the
-- FOR ALL admin write policy with INSERT + UPDATE only (no DELETE policy → admin
-- DELETE is denied).
drop policy if exists "store_settings_write_admin" on public.store_settings;

create policy "store_settings_insert_admin" on public.store_settings for insert to authenticated
  with check (public.current_user_role() = 'admin');
create policy "store_settings_update_admin" on public.store_settings for update to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');
