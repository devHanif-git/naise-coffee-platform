-- Close a race in the attach-member RPCs. Both attach_order_member and
-- attach_order_member_store read the order, check user_id, then update by id
-- with no lock. Two concurrent attaches can both pass the "different member?"
-- check against a stale snapshot, and the later UPDATE silently overwrites the
-- first — instead of one of them returning 'different_member_attached'.
--
-- Fix: lock the order row with SELECT ... FOR UPDATE so the read/check/update is
-- atomic per transaction. A concurrent attach blocks until the first commits,
-- then reads the now-set user_id and hits the different_member_attached guard.
-- Only the locking select changes; all other behaviour is identical to
-- 20260709140000_attach_member_fills_contact_phone.sql.

create or replace function public.attach_order_member(p_token uuid, p_identifier text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
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

  -- Lock the order row so a concurrent attach can't slip past the member check
  -- below with a stale snapshot.
  select * into v_order from public.orders where token = p_token for update;
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

  select * into v_prof from public.profiles where id = v_uid;

  -- Bind the member and, only when the order has no contact number yet, seed it
  -- from the member's profile so the WhatsApp ready-notice can reach them.
  update public.orders
    set user_id = v_uid,
        contact_phone = coalesce(contact_phone, v_prof.phone)
  where id = v_order.id;

  -- Retroactive grant if the order is already completed.
  if v_order.status = 'completed' then
    perform public.grant_order_stamp(p_token);
  end if;

  return jsonb_build_object(
    'ok', true,
    'display_name', coalesce(v_prof.display_name, 'Member'),
    'avatar_url', v_prof.avatar_url,
    'phone_masked', case when v_prof.phone is null then null
                    else '••••' || right(v_prof.phone, 3) end
  );
end;
$function$;

create or replace function public.attach_order_member_store(p_token uuid, p_identifier text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_order  public.orders%rowtype;
  v_uid    uuid;
  v_ident  text := btrim(p_identifier);
  v_prof   public.profiles%rowtype;
begin
  -- Lock the order row (see attach_order_member above).
  select * into v_order from public.orders where token = p_token for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;

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

  if v_order.user_id is not null and v_order.user_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'different_member_attached');
  end if;

  select * into v_prof from public.profiles where id = v_uid;

  update public.orders
    set user_id = v_uid,
        contact_phone = coalesce(contact_phone, v_prof.phone)
  where id = v_order.id;

  if v_order.status = 'completed' then
    perform public.grant_order_stamp(p_token);
  end if;

  return jsonb_build_object(
    'ok', true,
    'display_name', coalesce(v_prof.display_name, 'Member'),
    'avatar_url', v_prof.avatar_url,
    'phone_masked', case when v_prof.phone is null then null
                    else '••••' || right(v_prof.phone, 3) end
  );
end;
$function$;
