-- Auth: profiles table, role enum, signup trigger, RLS.
-- One row per auth user (identity + role). Beans/orders live elsewhere.
-- Created via Supabase MCP and captured here as the versioned migration.

-- Role set mirrors types/auth.ts.
create type public.user_role as enum ('admin', 'manager', 'staff', 'customer');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         public.user_role not null default 'customer',
  display_name text,
  avatar_url   text,
  phone        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'One row per auth user. Identity + role. Beans/orders live elsewhere.';

-- updated_at maintenance trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row on signup. Definer so it can insert regardless of
-- RLS; pulls name/avatar from the Google identity payload. search_path pinned.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Reads ONLY the caller's own role. SECURITY DEFINER so reading it inside an
-- RLS policy does not re-trigger profiles RLS (which would recurse).
create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
stable
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

revoke execute on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

-- RLS.
alter table public.profiles enable row level security;

-- Read: own row, or any row for staff/manager/admin.
create policy "profiles_select_own_or_staff"
  on public.profiles for select
  to authenticated
  using (
    (select auth.uid()) = id
    or public.current_user_role() in ('admin', 'manager', 'staff')
  );

-- Insert: only your own row (the trigger normally handles this).
create policy "profiles_insert_self"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- Update: only your own row. Allows editing display_name/avatar/phone but NOT
-- role escalation — app code never writes role, and there is intentionally no
-- client-facing role-update policy. Both USING and WITH CHECK are required.
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
