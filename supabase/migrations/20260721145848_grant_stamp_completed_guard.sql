-- Security remediation (follow-up): stop members claiming a stamp early.
--
-- grant_order_stamp is granted to `authenticated` (the staff cookie session calls
-- it at completion, and the retroactive-attach paths call it too). But it never
-- checked the order's status, so a member could call the RPC directly on their
-- OWN still-pending order and collect its stamp — and any milestone voucher —
-- before the drink was ever made or the order confirmed. That's a genuine order
-- they placed, so it's a lesser issue than the Beans fabrication, but it still
-- lets a stamp be claimed for an order that may yet be cancelled.
--
-- Fix: refuse to stamp unless the order is completed. This matches every
-- legitimate caller — the staff complete flow marks the order completed BEFORE
-- granting, and both attach_order_member paths only grant when status is already
-- 'completed'. So no real path changes; only the direct-RPC-on-pending abuse is
-- blocked. DEPLOY-SAFE: old and new app code both complete before granting.
--
-- Only the status guard line is added; the rest is the deployed body verbatim.
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

  -- Only completed orders earn a stamp. Blocks a member calling this RPC directly
  -- on their own pending/awaiting order to claim the stamp before completion.
  if v_order.status <> 'completed' then return null; end if;

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

revoke execute on function public.grant_order_stamp(uuid) from public;
grant execute on function public.grant_order_stamp(uuid) to authenticated;
