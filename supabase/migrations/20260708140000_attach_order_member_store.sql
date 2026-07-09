-- Kiosk variant of attach_order_member. The /store kiosk authenticates via a
-- 6-digit store passcode (a signed store-mode cookie on top of a guest/anon
-- Supabase session — see lib/auth/store-mode.ts), NOT a staff account, so it
-- cannot pass the staff-role gate in attach_order_member. This function drops
-- the role check and is granted to the SERVICE ROLE ONLY: the sole caller is the
-- kiosk server action, which first enforces inStoreMode() + store_account
-- enabled and then invokes this via the service-role client (the same security
-- boundary placeStoreOrder already uses for privileged kiosk writes). Otherwise
-- identical to attach_order_member: resolve member by uuid/phone/email, set
-- orders.user_id, retroactively grant the stamp if already completed, and return
-- ONLY minimal identity (never raw email/phone).
create or replace function public.attach_order_member_store(p_token uuid, p_identifier text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order  public.orders%rowtype;
  v_uid    uuid;
  v_ident  text := btrim(p_identifier);
  v_prof   public.profiles%rowtype;
begin
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

-- Service-role only: revoke from everyone else so no client session (guest,
-- authenticated, or the store's anon session) can call it directly. The kiosk
-- server action reaches it through the service-role client after gating.
revoke execute on function public.attach_order_member_store(uuid, text) from public, anon, authenticated;
