-- Shift mutations: the ONLY way shifts/movements change. SECURITY DEFINER so the
-- close math reads completed-order totals consistently, but each re-checks the
-- staff role itself (definer bypasses RLS). Money in sen. Mirrors grant_order_stamp.

-- Open a shift with a starting float. Fails if one is already open (also guarded
-- by the partial unique index as a backstop).
create or replace function public.open_shift(p_opening_float integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if public.current_user_role() not in ('admin', 'manager', 'staff') then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  if exists (select 1 from public.shifts where status = 'open') then
    return jsonb_build_object('ok', false, 'error', 'shift_already_open');
  end if;
  insert into public.shifts (opening_float, opened_by)
    values (greatest(p_opening_float, 0), (select auth.uid()))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Record a non-sale drawer movement against the open shift.
create or replace function public.add_shift_movement(
  p_kind text, p_cash_delta integer, p_qr_delta integer, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_shift uuid;
  v_id    uuid;
begin
  if public.current_user_role() not in ('admin', 'manager', 'staff') then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  select id into v_shift from public.shifts where status = 'open';
  if v_shift is null then
    return jsonb_build_object('ok', false, 'error', 'no_open_shift');
  end if;
  insert into public.shift_movements (shift_id, kind, cash_delta, qr_delta, note, created_by)
    values (v_shift, p_kind::public.movement_kind, coalesce(p_cash_delta, 0),
            coalesce(p_qr_delta, 0), nullif(btrim(p_note), ''), (select auth.uid()))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Close the open shift: snapshot expected cash (float + completed cash sales +
-- movement cash deltas) and the counted-vs-expected difference.
create or replace function public.close_shift(
  p_counted_cash integer, p_closing_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_shift    public.shifts%rowtype;
  v_cash_sales integer;
  v_moves    integer;
  v_expected integer;
  v_diff     integer;
begin
  if public.current_user_role() not in ('admin', 'manager', 'staff') then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  select * into v_shift from public.shifts where status = 'open';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_open_shift');
  end if;

  -- Completed cash orders attributed to this shift. Payment method is normalized
  -- app-side on write, but tolerate legacy variants here too.
  select coalesce(sum(o.total), 0) into v_cash_sales
    from public.orders o
    where o.shift_id = v_shift.id
      and o.status = 'completed'
      and lower(o.payment_method) in ('cash');

  select coalesce(sum(m.cash_delta), 0) into v_moves
    from public.shift_movements m where m.shift_id = v_shift.id;

  v_expected := v_shift.opening_float + v_cash_sales + v_moves;
  v_diff := coalesce(p_counted_cash, 0) - v_expected;

  update public.shifts
    set status = 'closed',
        closed_by = (select auth.uid()),
        closed_at = now(),
        counted_cash = coalesce(p_counted_cash, 0),
        expected_cash = v_expected,
        cash_difference = v_diff,
        closing_note = nullif(btrim(p_closing_note), '')
    where id = v_shift.id;

  return jsonb_build_object('ok', true, 'id', v_shift.id,
    'expected_cash', v_expected, 'cash_difference', v_diff);
end;
$$;

revoke execute on function public.open_shift(integer) from public;
revoke execute on function public.add_shift_movement(text, integer, integer, text) from public;
revoke execute on function public.close_shift(integer, text) from public;
grant execute on function public.open_shift(integer) to authenticated;
grant execute on function public.add_shift_movement(text, integer, integer, text) to authenticated;
grant execute on function public.close_shift(integer, text) to authenticated;
