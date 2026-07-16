-- CHIP DuitNow QR — gateway fee + deferred voucher.
--
-- The prior CHIP attempt already created public.chip_purchases (purchase link
-- per order) and added `awaiting_payment` to order_status. This migration adds
-- only what the fee + settle-after-payment design needs on top of that:
--   * orders.gateway_fee       — fee (sen) added on top of total on the CHIP path
--   * orders.pending_voucher_id — voucher the customer chose, redeemed only when
--                                 payment confirms (so an abandoned order burns none)
--   * payment_settings.chip_*  — admin-configurable gateway toggle + fee (flat + %)
--
-- chip_purchase_id / checkout_url etc. live in public.chip_purchases, NOT here.

alter table public.orders
  add column gateway_fee integer not null default 0,
  add column pending_voucher_id uuid references public.vouchers (id) on delete set null;

comment on column public.orders.gateway_fee is
  'Payment-gateway fee (sen) added on top of total for the CHIP path. 0 for non-gateway orders.';
comment on column public.orders.pending_voucher_id is
  'Voucher the customer chose at checkout, redeemed only when payment confirms. Null when none.';

-- Admin-configurable CHIP gateway fee. chip_enabled defaults FALSE so CHIP is
-- off until an admin turns it on (unlike the fail-open method toggles).
alter table public.payment_settings
  add column chip_enabled boolean not null default false,
  add column chip_fee_flat integer not null default 0,
  add column chip_fee_percent integer not null default 0;

comment on column public.payment_settings.chip_enabled is
  'When true, DuitNow QR is collected via the CHIP gateway instead of the manual QR+receipt flow.';
comment on column public.payment_settings.chip_fee_flat is
  'Flat gateway fee component in sen, added to the order total on the CHIP path.';
comment on column public.payment_settings.chip_fee_percent is
  'Percentage gateway fee component in basis points (150 = 1.50%), applied to the order total.';
