-- Make apply_order_rewards loyalty-config-driven: read the earn rate from
-- loyalty_settings and the milestone grants from streak_milestones, instead of
-- the previously hardcoded constants. SECURITY DEFINER (runs as owner) so it
-- reads the config tables regardless of their RLS. Everything else is unchanged.
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
  v_bonuses   jsonb := '[]'::jsonb;
  v_earn_rate integer;
  v_ms        public.streak_milestones%rowtype;
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

  -- Earn rate from config (fallback 10 if the settings row is somehow missing).
  select beans_per_ringgit into v_earn_rate from public.loyalty_settings limit 1;
  v_earn_rate := coalesce(v_earn_rate, 10);

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

  -- Current streak = length of the consecutive island ending today.
  with islands as (
    select check_in_date,
           check_in_date - (row_number() over (order by check_in_date))::int as grp
    from public.streak_checkins
    where user_id = v_user
  )
  select count(*) into v_streak
  from islands
  where grp = (select grp from islands where check_in_date = v_today);

  -- Milestone bonuses, data-driven from streak_milestones. A milestone fires when
  -- the streak has reached trigger_day and (for repeating ones) lands on the
  -- repeat cadence; one-time milestones (repeat_every_days null) fire only at
  -- exactly trigger_day.
  for v_ms in
    select * from public.streak_milestones where is_active = true
  loop
    if v_streak >= v_ms.trigger_day and (
         (v_ms.repeat_every_days is null and v_streak = v_ms.trigger_day)
         or (v_ms.repeat_every_days is not null
             and (v_streak - v_ms.trigger_day) % v_ms.repeat_every_days = 0)
       )
    then
      insert into public.bean_transactions (user_id, order_id, category, amount, label)
      values (v_user, v_order.id, 'streak_bonus', v_ms.beans, v_ms.label);
      v_bonuses := v_bonuses || jsonb_build_object('label', v_ms.label, 'beans', v_ms.beans);
    end if;
  end loop;

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

-- create or replace preserves privileges, but re-issue least-privilege grants to
-- be explicit (members/staff call apply at placement; not anon/public).
revoke execute on function public.apply_order_rewards(uuid) from public;
grant execute on function public.apply_order_rewards(uuid) to authenticated;
