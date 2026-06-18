-- owner_id is a non-secret correlation id minted client-side (crypto.randomUUID)
-- and used to scope guest order history via the service-role client. Constrain it
-- to a canonical UUID so a forged/garbage cookie value can't be stored and can't
-- broaden a lookup. Existing rows already conform.
alter table public.orders
  add constraint orders_owner_id_uuid
  check (owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
