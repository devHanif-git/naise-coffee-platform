-- Staff-facing wildcard member search for the manage "attach member" flow.
-- Mirrors attach_order_member's role gate + lookup surface (profiles name/phone
-- + auth.users email), but returns a ranked candidate list instead of binding.
-- SECURITY DEFINER so it can read auth.users; staff role enforced inside.
create or replace function public.search_members(p_query text)
returns table (id uuid, display_name text, phone text, email text)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_q    text := btrim(p_query);
begin
  if v_role not in ('admin','manager','staff') then
    return; -- unauthorized: empty result
  end if;
  if length(v_q) < 2 then
    return; -- require at least 2 chars to avoid dumping the whole member base
  end if;

  return query
  select p.id,
         coalesce(p.display_name, 'Member') as display_name,
         p.phone,
         u.email::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'customer'
    and (
      p.display_name ilike '%' || v_q || '%'
      or p.phone ilike '%' || v_q || '%'
      or u.email ilike '%' || v_q || '%'
    )
  order by
    -- Prefer prefix matches on the name, then alphabetical.
    (p.display_name ilike v_q || '%') desc,
    p.display_name asc
  limit 10;
end;
$function$;

revoke all on function public.search_members(text) from public, anon;
grant execute on function public.search_members(text) to authenticated;
