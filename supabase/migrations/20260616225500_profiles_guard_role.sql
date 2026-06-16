-- Security: pin profiles.role against client-side escalation.
--
-- The profiles_update_own RLS policy lets a user update their own row but does
-- not restrict WHICH columns change. Without this guard, a signed-in customer
-- using the public/anon key could run
--   update profiles set role = 'admin' where id = <self>
-- and grant themselves staff/admin access (the /manage gate reads profiles.role).
--
-- This BEFORE UPDATE trigger pins role to its previous value for any
-- authenticated, non-privileged caller. Service-role writes (dashboard / SQL
-- editor / server with the service key) have a null auth.uid() and pass
-- through, as do admins and managers — so legitimate role assignment still
-- works. Only self-service customer writes are constrained.

create or replace function public.profiles_guard_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and public.current_user_role() not in ('admin', 'manager')
  then
    -- Non-privileged self-update: role is immutable.
    new.role := old.role;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.profiles_guard_role();
