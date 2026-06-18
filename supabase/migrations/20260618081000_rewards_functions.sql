-- Rewards mutations: the ONLY way Beans/streak change. SECURITY DEFINER so they
-- write the RLS-locked rewards tables; granted to authenticated (members call
-- apply at placement, staff call reverse at cancel). Both resolve the member
-- from the order row, self-guard for guests, and are idempotent per order.
-- Earn rate (10) and milestone rule MUST match data/rewards.ts (beansPerRinggit
-- and the getStreakAwards rule). See the plan's Global Constraints.

create or replace function public.apply_order_rewards(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order     public.orders%rowtype;
  v_user      uuid;
  v_today     date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_balance   integer;
  v_redeemed  integer := 0;
  v_earned    integer := 0;
  v_streak    integer := 0;
  v_pos       integer;
  v_bonuses   jsonb := '[]'::jsonb;
  v_earn_rate constant integer := 10; -- mirror beansPerRinggit in data/rewards.ts
begin
  select * into v_order from public.orders where token = p_token;
  if not found then return null; end if;

  v_user := v_order.user_id;
  if v_user is null then return null; end if; -- guest order: no rewards

  -- Idempotency: bail if this order already has (non-reversal) rewards rows.
  if exists (
    select 1 from public.bean_transactions
    where order_id = v_order.id and is_reversal = false
  ) then
    return null;
  end if;

  -- Ensure the member has an account row (starts at 0).
  insert into public.reward_accounts (user_id)
  values (v_user)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.reward_accounts where user_id = v_user;

  -- Total Bean cost of rewards redeemed on this order.
  select coalesce(sum(reward_cost), 0) into v_redeemed
  from public.order_items
  where order_id = v_order.id and is_reward = true;

  -- Authoritative affordability check (pre-earn balance).
  if v_redeemed > v_balance then
    raise exception 'INSUFFICIENT_BEANS: balance % < reward cost %',
      v_balance, v_redeemed;
  end if;

  -- Redeem rows (negative), one per reward line.
  insert into public.bean_transactions (user_id, order_id, category, amount, label)
  select v_user, v_order.id, 'redeem', -oi.reward_cost, 'Redeemed ' || oi.name
  from public.order_items oi
  where oi.order_id = v_order.id and oi.is_reward = true and oi.reward_cost > 0;

  -- Earn on the paid total (sen -> RM floored, * rate).
  v_earned := floor(v_order.total / 100.0)::int * v_earn_rate;
  if v_earned > 0 then
    insert into public.bean_transactions (user_id, order_id, category, amount, label)
    values (v_user, v_order.id, 'earn', v_earned, 'Order earnings');
  end if;

  -- Record today's check-in (idempotent per day).
  insert into public.streak_checkins (user_id, check_in_date)
  values (v_user, v_today)
  on conflict (user_id, check_in_date) do nothing;

  -- Current streak = length of the consecutive island ending today. Subtracting
  -- a dense row-number from each date gives a constant key per run of
  -- consecutive days; the island containing today shares today's key.
  with islands as (
    select check_in_date,
           check_in_date - (row_number() over (order by check_in_date))::int as grp
    from public.streak_checkins
    where user_id = v_user
  )
  select count(*) into v_streak
  from islands
  where grp = (select grp from islands where check_in_date = v_today);

  -- Milestone bonuses (mirror getStreakAwards in data/rewards.ts).
  v_pos := ((v_streak - 1) % 7) + 1;
  if v_pos = 3 then
    insert into public.bean_transactions (user_id, order_id, category, amount, label)
    values (v_user, v_order.id, 'streak_bonus', 50, '3-Day Streak Bonus');
    v_bonuses := v_bonuses || jsonb_build_object('label', '3-Day Streak Bonus', 'beans', 50);
  end if;
  if v_pos = 7 then
    insert into public.bean_transactions (user_id, order_id, category, amount, label)
    values (v_user, v_order.id, 'streak_bonus', 100, '7-Day Streak Bonus');
    v_bonuses := v_bonuses || jsonb_build_object('label', '7-Day Streak Bonus', 'beans', 100);
  end if;
  if v_streak % 30 = 0 then
    insert into public.bean_transactions (user_id, order_id, category, amount, label)
    values (v_user, v_order.id, 'streak_bonus', 1000, '30-Day Streak Bonus');
    v_bonuses := v_bonuses || jsonb_build_object('label', '30-Day Streak Bonus', 'beans', 1000);
  end if;

  -- Cached streak columns (balance/lifetime are maintained by the txn trigger).
  update public.reward_accounts
  set current_streak = v_streak,
      longest_streak = greatest(longest_streak, v_streak),
      last_check_in = v_today,
      updated_at = now()
  where user_id = v_user;

  return jsonb_build_object(
    'earned', v_earned,
    'redeemed_cost', v_redeemed,
    'streak_days', v_streak,
    'bonuses', v_bonuses
  );
end;
$$;

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

-- Least privilege: members/staff (authenticated) may call; not anon/public.
revoke execute on function public.apply_order_rewards(uuid) from public;
grant execute on function public.apply_order_rewards(uuid) to authenticated;
revoke execute on function public.reverse_order_rewards(uuid) from public;
grant execute on function public.reverse_order_rewards(uuid) to authenticated;

-- Harden the cache trigger fn (created in the schema migration): it runs from
-- the trigger regardless of EXECUTE grant, so no caller needs RPC access to it.
revoke execute on function public.apply_bean_transaction() from anon, authenticated, public;
