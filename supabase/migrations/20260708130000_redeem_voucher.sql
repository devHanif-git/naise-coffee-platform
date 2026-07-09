-- Redeem a voucher against an order. SECURITY DEFINER but self-guards to the
-- caller's own voucher. Validates status/expiry; the caller (placeOrder) has
-- already validated min_spend and computed the discounted total, but we re-check
-- here so the ledger can never mark a voucher redeemed without the guards. One
-- voucher per order enforced by redeemed_order_id uniqueness + status flip.
create or replace function public.redeem_voucher(p_voucher_id uuid, p_order_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_v     public.vouchers%rowtype;
  v_order public.orders%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  select * into v_order from public.orders where token = p_order_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;

  -- Lock the voucher row to close the double-redeem race.
  select * into v_v from public.vouchers where id = p_voucher_id for update;
  if not found or v_v.user_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'voucher_not_found');
  end if;
  if v_v.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'voucher_not_active');
  end if;
  if v_v.expires_at <= now() then
    update public.vouchers set status = 'expired', updated_at = now() where id = v_v.id;
    return jsonb_build_object('ok', false, 'error', 'voucher_expired');
  end if;

  update public.vouchers
    set status = 'redeemed', redeemed_order_id = v_order.id, updated_at = now()
    where id = v_v.id;

  return jsonb_build_object('ok', true,
    'type', v_v.type,
    'discount_amount', v_v.discount_amount,
    'min_spend', v_v.min_spend,
    'free_drink_max_value', v_v.free_drink_max_value);
end;
$$;

revoke execute on function public.redeem_voucher(uuid, uuid) from public;
grant execute on function public.redeem_voucher(uuid, uuid) to authenticated;

-- Flip past-date active vouchers to expired. Callable by a scheduled job or ad
-- hoc; returns how many rows changed.
create or replace function public.mark_expired_vouchers()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.vouchers set status = 'expired', updated_at = now()
    where status = 'active' and expires_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.mark_expired_vouchers() from public, anon;
grant execute on function public.mark_expired_vouchers() to authenticated;
