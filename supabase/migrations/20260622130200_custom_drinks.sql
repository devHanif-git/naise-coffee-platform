-- Quick-select presets for admin custom orders. Auto-populated when a custom
-- order is placed: each distinct drink name is remembered with its last price
-- and a usage counter so the picker can surface the most-used first. This is
-- also a small analytics signal ("which off-menu drinks recur?").
create table public.custom_drinks (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  last_price   integer not null,            -- sen
  times_used   integer not null default 0,
  last_used_at timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.custom_drinks is
  'Admin custom-drink presets (quick select). Money in sen.';

-- Case-insensitive uniqueness so "Iced Gula Melaka" and "iced gula melaka"
-- collapse into one preset. This expression index is also the ON CONFLICT target
-- used by record_custom_drinks below.
create unique index custom_drinks_name_lower_key
  on public.custom_drinks (lower(name));

-- Picker ordering: most-used, then most-recent.
create index custom_drinks_rank_idx
  on public.custom_drinks (times_used desc, last_used_at desc);

create trigger custom_drinks_set_updated_at
  before update on public.custom_drinks
  for each row execute function public.set_updated_at();

alter table public.custom_drinks enable row level security;

-- Admin-only across the board (matches the admin-only Custom Order screen).
create policy "custom_drinks_select_admin"
  on public.custom_drinks for select
  to authenticated
  using (public.current_user_role() = 'admin');

create policy "custom_drinks_write_admin"
  on public.custom_drinks for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Upsert a batch of custom drinks placed in one order. p_drinks is a JSON array
-- of { "name": text, "price": int(sen) }. SECURITY DEFINER so it can write the
-- usage counter regardless of caller RLS, but it gates on the admin role and is
-- granted to authenticated only. search_path pinned. Mirrors the phase-3 RPCs.
create or replace function public.record_custom_drinks(p_drinks jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d jsonb;
  v_name text;
  v_price integer;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'NOT_ADMIN';
  end if;

  for d in select * from jsonb_array_elements(coalesce(p_drinks, '[]'::jsonb))
  loop
    v_name := btrim(d->>'name');
    v_price := (d->>'price')::integer;
    if v_name is null or v_name = '' or v_price is null or v_price <= 0 then
      continue;
    end if;

    insert into public.custom_drinks (name, last_price, times_used, last_used_at, created_by)
    values (v_name, v_price, 1, now(), (select auth.uid()))
    on conflict (lower(name)) do update
      set last_price   = excluded.last_price,
          times_used   = public.custom_drinks.times_used + 1,
          last_used_at = now();
  end loop;
end;
$$;

revoke execute on function public.record_custom_drinks(jsonb) from public, anon;
grant execute on function public.record_custom_drinks(jsonb) to authenticated;
