-- Harden reverse_order_rewards: it is granted to `authenticated` so the staff
-- cancel action (cookie session) can call it, but the function itself had no
-- caller-authorization check — any authenticated member could invoke the RPC
-- directly on another member's order token and claw back their Beans. Add a
-- staff-only guard at the top. current_user_role() reads the CALLER's role
-- (auth.uid() still reflects the request JWT inside a SECURITY DEFINER fn), so
-- the staff cancel path passes and non-staff/guests are rejected. apply_order_
-- rewards needs no such guard: it only ever grants what placement would, resolves
-- the member from the order, and is idempotent.

create or replace function public.reverse_order_rewards(p_token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  public.orders%rowtype;
  v_user   uuid;
  v_date   date;
  v_streak integer := 0;
begin
  -- Caller authorization: staff only. The intended caller is the staff cancel
  -- action; block direct RPC use by ordinary members/guests.
  if public.current_user_role() not in ('admin', 'manager', 'staff') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_order from public.orders where token = p_token;
  if not found then return; end if;

  v_user := v_order.user_id;
  if v_user is null then return; end if;

  -- Already reversed, or nothing to reverse.
  if exists (
    select 1 from public.bean_transactions
    where order_id = v_order.id and is_reversal = true
  ) then
    return;
  end if;
  if not exists (
    select 1 from public.bean_transactions
    where order_id = v_order.id and is_reversal = false
  ) then
    return;
  end if;

  -- Offsetting rows: same category, negated amount, marked reversal.
  insert into public.bean_transactions (user_id, order_id, category, amount, label, is_reversal)
  select user_id, order_id, category, -amount, label || ' (reversed)', true
  from public.bean_transactions
  where order_id = v_order.id and is_reversal = false;

  -- Remove the order-day's check-in only if it was the member's sole
  -- non-cancelled order that day.
  v_date := (v_order.created_at at time zone 'Asia/Kuala_Lumpur')::date;
  if not exists (
    select 1 from public.orders o
    where o.user_id = v_user
      and o.id <> v_order.id
      and o.status <> 'cancelled'
      and (o.created_at at time zone 'Asia/Kuala_Lumpur')::date = v_date
  ) then
    delete from public.streak_checkins
    where user_id = v_user and check_in_date = v_date;
  end if;

  -- Recompute cached streak from the most recent remaining island.
  with islands as (
    select check_in_date,
           check_in_date - (row_number() over (order by check_in_date))::int as grp
    from public.streak_checkins
    where user_id = v_user
  )
  select coalesce(count(*), 0) into v_streak
  from islands
  where grp = (select grp from islands order by check_in_date desc limit 1);

  update public.reward_accounts
  set current_streak = coalesce(v_streak, 0),
      last_check_in = (select max(check_in_date) from public.streak_checkins where user_id = v_user),
      updated_at = now()
  where user_id = v_user;
end;
$$;
