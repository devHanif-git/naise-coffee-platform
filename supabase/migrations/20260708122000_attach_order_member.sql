-- Staff attach a member to an order by member-QR token (the user's uuid), phone,
-- or email. SECURITY DEFINER so it can read auth.users.email and set orders.user_id
-- under RLS. Returns ONLY minimal identity (never raw email/phone). If the order
-- is already completed, grants the stamp retroactively (idempotent via Task 2).
create or replace function public.attach_order_member(p_token uuid, p_identifier text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_order  public.orders%rowtype;
  v_uid    uuid;
  v_ident  text := btrim(p_identifier);
  v_prof   public.profiles%rowtype;
begin
  if v_role not in ('admin','manager','staff') then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select * into v_order from public.orders where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;

  -- Resolve member: try uuid (QR token), then phone, then email.
  begin
    v_uid := v_ident::uuid;
    if not exists (select 1 from public.profiles where id = v_uid) then v_uid := null; end if;
  exception when invalid_text_representation then v_uid := null;
  end;
  if v_uid is null then
    select id into v_uid from public.profiles where phone = v_ident limit 1;
  end if;
  if v_uid is null then
    select id into v_uid from auth.users where lower(email) = lower(v_ident) limit 1;
  end if;
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'member_not_found'); end if;

  -- Refuse if a different member is already attached.
  if v_order.user_id is not null and v_order.user_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'different_member_attached');
  end if;

  update public.orders set user_id = v_uid where id = v_order.id;

  -- Retroactive grant if the order is already completed.
  if v_order.status = 'completed' then
    perform public.grant_order_stamp(p_token);
  end if;

  select * into v_prof from public.profiles where id = v_uid;
  return jsonb_build_object(
    'ok', true,
    'display_name', coalesce(v_prof.display_name, 'Member'),
    'avatar_url', v_prof.avatar_url,
    'phone_masked', case when v_prof.phone is null then null
                    else '••••' || right(v_prof.phone, 3) end
  );
end;
$$;

revoke execute on function public.attach_order_member(uuid, text) from public;
grant execute on function public.attach_order_member(uuid, text) to authenticated;
