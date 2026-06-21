-- Adds the 'store' role for the in-store kiosk account. MUST be isolated in its
-- own migration: Postgres cannot use a new enum value in the same transaction
-- that adds it, so anything referencing 'store' goes in a later migration file.
alter type public.user_role add value if not exists 'store';
