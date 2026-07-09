-- Stamp mutations: the ONLY way stamps/vouchers change. SECURITY DEFINER, granted
-- to authenticated. Idempotent per order via the unique index. Mirrors
-- apply_order_rewards. A "paid line" is is_reward=false AND voided_at IS NULL AND
-- line_total > 0 — a fully-free order (only a redeemed drink) earns no stamp.

create or replace function public.grant_order_stamp(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order   public.orders%rowtype;
  v_cfg     public.stamp_settings%rowtype;
  v_count   integer;
  v_cycle   integer;
  v_issued  jsonb := '[]'::jsonb;
begin
  select * into v_cfg from public.stamp_settings where id = true;
  if not found or not v_cfg.is_enabled then return null; end if;

  select * into v_order from public.orders where token = p_token;
  if not found or v_order.user_id is null then return null; end if;

  -- Idempotency: bail if this order already earned a (non-reversal) stamp.
  if exists (
    select 1 from public.stamp_transactions
    where order_id = v_order.id and is_reversal = false
  ) then return null; end if;

  -- Qualifying check: at least one paid, non-voided, non-reward line.
  if not exists (
    select 1 from public.order_items oi
    where oi.order_id = v_order.id
      and oi.is_reward = false
      and oi.voided_at is null
      and oi.line_total > 0
  ) then return null; end if;

  -- Ensure a card row exists, then insert the +1 (trigger updates the cache).
  insert into public.stamp_cards (user_id) values (v_order.user_id)
    on conflict (user_id) do nothing;
  insert into public.stamp_transactions (user_id, order_id, amount)
    values (v_order.user_id, v_order.id, 1);

  select current_count, cycle into v_count, v_cycle
    from public.stamp_cards where user_id = v_order.user_id;

  -- Milestone: small reward at milestone_small.
  if v_count = v_cfg.milestone_small then
    insert into public.vouchers (user_id, type, discount_amount, min_spend, expires_at, source_order_id)
    values (v_order.user_id, 'rm_off', v_cfg.rm_off_amount, v_cfg.rm_off_min_spend,
            now() + make_interval(days => v_cfg.voucher_expiry_days), v_order.id);
    v_issued := v_issued || jsonb_build_object('type', 'rm_off');
  end if;

  -- Milestone: full card at card_size -> free drink, then reset + bump cycle.
  if v_count >= v_cfg.card_size then
    insert into public.vouchers (user_id, type, free_drink_max_value, expires_at, source_order_id)
    values (v_order.user_id, 'free_drink', v_cfg.free_drink_max_value,
            now() + make_interval(days => v_cfg.voucher_expiry_days), v_order.id);
    v_issued := v_issued || jsonb_build_object('type', 'free_drink');
    update public.stamp_cards
      set current_count = 0, cycle = cycle + 1, updated_at = now()
      where user_id = v_order.user_id;
    v_count := 0; v_cycle := v_cycle + 1;
  end if;

  return jsonb_build_object('stamped', true, 'count', v_count, 'cycle', v_cycle, 'vouchers_issued', v_issued);
end;
$$;

-- Reverse a cancelled order's stamp: offsetting -1 row, recompute the cache from
-- the ledger (handles reset boundaries), and expire any still-active voucher this
-- order issued. A redeemed voucher is left intact (can't claw back a used one).
create or replace function public.reverse_order_stamp(p_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_cfg   public.stamp_settings%rowtype;
  v_net   integer;
begin
  select * into v_order from public.orders where token = p_token;
  if not found or v_order.user_id is null then return; end if;

  -- Nothing to reverse, or already reversed.
  if not exists (select 1 from public.stamp_transactions
                 where order_id = v_order.id and is_reversal = false) then return; end if;
  if exists (select 1 from public.stamp_transactions
             where order_id = v_order.id and is_reversal = true) then return; end if;

  insert into public.stamp_transactions (user_id, order_id, amount, is_reversal)
    values (v_order.user_id, v_order.id, -1, true);

  -- Recompute the cache from the full ledger so a reset boundary stays correct.
  select * into v_cfg from public.stamp_settings where id = true;
  select coalesce(sum(amount), 0) into v_net
    from public.stamp_transactions where user_id = v_order.user_id;
  update public.stamp_cards set
    total_stamps  = greatest(v_net, 0),
    cycle         = floor(greatest(v_net, 0) / v_cfg.card_size)::int,
    current_count = greatest(v_net, 0) - floor(greatest(v_net, 0) / v_cfg.card_size)::int * v_cfg.card_size,
    updated_at    = now()
  where user_id = v_order.user_id;

  -- Expire (revoke) only still-active vouchers this order issued.
  update public.vouchers set status = 'expired', updated_at = now()
    where source_order_id = v_order.id and status = 'active';
end;
$$;

revoke execute on function public.grant_order_stamp(uuid) from public;
grant execute on function public.grant_order_stamp(uuid) to authenticated;
revoke execute on function public.reverse_order_stamp(uuid) from public;
grant execute on function public.reverse_order_stamp(uuid) to authenticated;
