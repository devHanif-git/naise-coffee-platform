-- Add an optional contact phone to orders. Collected (unverified) at checkout
-- from members and guests; used for the WhatsApp-ready handoff and the staff
-- Telegram "NEW ORDER!" notice. Nullable; no backfill. Existing order RLS
-- policies already govern row access, so no policy change is needed.
alter table public.orders
  add column contact_phone text;

comment on column public.orders.contact_phone is
  'Unverified MY mobile in E.164 (+60…), collected at checkout. Used for the wa.me ready handoff and the staff order notice.';
