-- Lock the rewards RPCs to signed-in callers only.
--
-- Supabase grants EXECUTE on new functions to anon AND authenticated explicitly
-- (via ALTER DEFAULT PRIVILEGES), so the earlier `revoke ... from public` did
-- NOT remove anon — both functions stayed callable by anonymous users over
-- /rest/v1/rpc. Revoke anon explicitly.
--
-- authenticated keeps EXECUTE by design: members call apply_order_rewards via
-- their cookie session at placement, and the staff cancel action calls
-- reverse_order_rewards (which additionally self-guards to staff roles inside the
-- function body). The remaining "authenticated can execute" advisory is intended.

revoke execute on function public.apply_order_rewards(uuid) from anon;
revoke execute on function public.reverse_order_rewards(uuid) from anon;
