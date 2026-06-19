-- Corrective patch for admin_phase3_rpcs (20260620110000).
-- Two fixes:
--   1. IS DISTINCT FROM instead of <> so null current_user_role() triggers NOT_ADMIN.
--   2. REVOKE FROM anon (Supabase default-grants include anon; public revoke alone is not enough).

create or replace function public.admin_set_role(p_user uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'NOT_ADMIN';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'CANNOT_CHANGE_OWN_ROLE';
  end if;
  if p_role <> 'admin'
     and exists (select 1 from public.profiles where id = p_user and role = 'admin')
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'LAST_ADMIN';
  end if;
  update public.profiles set role = p_role, updated_at = now() where id = p_user;
  if not found then
    raise exception 'NO_SUCH_USER';
  end if;
end;
$$;

revoke execute on function public.admin_set_role(uuid, public.user_role) from public, anon;
grant execute on function public.admin_set_role(uuid, public.user_role) to authenticated;

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

  select balance into v_balance from public.reward_accounts where user_id = p_user;
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
