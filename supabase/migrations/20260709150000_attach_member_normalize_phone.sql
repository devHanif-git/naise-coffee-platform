-- Make the "attach member" phone lookup format-tolerant. Customers key in their
-- number however they remember it — 01161081803, 601161081803, or +601161081803
-- — and it should resolve to the same member regardless of how the number is
-- stored in profiles.phone. We canonicalise both sides to a digits-only
-- Malaysian form (leading 0 → 60, strip +/spaces/dashes) and match on that,
-- with the old exact match kept as a fast first pass.

-- Canonical Malaysian phone form: digits only, local leading 0 rewritten to the
-- 60 country code. Returns null for empty input. Not MY-specific beyond the
-- leading-0 rule; a number already starting with 60 or another country code is
-- left as its digits.
create or replace function public.normalize_my_phone(p_phone text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  with digits as (
    select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d
  )
  select case
    when d = '' then null
    when left(d, 1) = '0' then '60' || substring(d from 2)
    else d
  end
  from digits;
$function$;

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
  v_phone  text := public.normalize_my_phone(p_identifier);
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
  -- Phone: exact first, then canonicalised (so 011…, 6011…, +6011… all match).
  if v_uid is null then
    select id into v_uid from public.profiles where phone = v_ident limit 1;
  end if;
  if v_uid is null and v_phone is not null then
    select id into v_uid from public.profiles
      where public.normalize_my_phone(phone) = v_phone limit 1;
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
  v_phone  text := public.normalize_my_phone(p_identifier);
  v_prof   public.profiles%rowtype;
begin
  select * into v_order from public.orders where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;

  begin
    v_uid := v_ident::uuid;
    if not exists (select 1 from public.profiles where id = v_uid) then v_uid := null; end if;
  exception when invalid_text_representation then v_uid := null;
  end;
  if v_uid is null then
    select id into v_uid from public.profiles where phone = v_ident limit 1;
  end if;
  if v_uid is null and v_phone is not null then
    select id into v_uid from public.profiles
      where public.normalize_my_phone(phone) = v_phone limit 1;
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
