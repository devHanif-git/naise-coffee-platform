-- Pay-later toggle for the store/kiosk: when on, staff can place a store order
-- before payment is decided (payment_method = 'unpaid') and resolve it later.
-- Defaults OFF so existing behavior is unchanged until an admin enables it.
alter table public.payment_settings
  add column pay_later_enabled boolean not null default false;

comment on column public.payment_settings.pay_later_enabled is
  'When true, the kiosk offers a "Pay later" option that places store orders as payment_method = ''unpaid'' for later resolution.';
