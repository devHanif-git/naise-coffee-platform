-- Least-privilege: broadcast_order_status is a trigger-only SECURITY DEFINER
-- function; it must not be callable as a public RPC. Revoking EXECUTE does not
-- affect trigger firing (triggers run as the table owner).
revoke execute on function public.broadcast_order_status() from anon, authenticated, public;
