-- Lock down pre-existing SECURITY DEFINER functions exposed via PostgREST.
--
-- Every public function is reachable at /rest/v1/rpc/<name>; SECURITY DEFINER
-- ones run with the owner's rights, so they should not be callable by roles that
-- don't need them. Supabase grants EXECUTE to anon + authenticated explicitly via
-- default privileges, so each role must be revoked by name.

-- Trigger functions: only ever fire from their triggers (which run regardless of
-- EXECUTE grants). Calling them directly via RPC errors anyway. Revoke from all.
revoke execute on function public.handle_new_user()     from anon, authenticated, public;
revoke execute on function public.profiles_guard_role() from anon, authenticated, public;

-- current_user_role() is called inside RLS policies, which are evaluated with the
-- querying user's privileges — so `authenticated` MUST keep EXECUTE or every
-- staff-gated read breaks. The policies are all `to authenticated`, so anon never
-- evaluates them: revoke anon only.
revoke execute on function public.current_user_role()   from anon;
