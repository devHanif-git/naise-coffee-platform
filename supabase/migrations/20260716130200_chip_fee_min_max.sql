-- Min/max clamp for the CHIP gateway fee. The fee is flat + percent, then
-- clamped into [min, max]. Both in sen, both admin-configurable. A value of 0
-- means "no bound" (0 min = no floor, 0 max = no cap), so existing behaviour is
-- unchanged until an admin sets them. Typical DuitNow QR: min 15 (RM0.15),
-- max 150 (RM1.50).

alter table public.payment_settings
  add column chip_fee_min integer not null default 0,
  add column chip_fee_max integer not null default 0;

comment on column public.payment_settings.chip_fee_min is
  'Minimum CHIP gateway fee in sen; the flat+percent fee is raised to this floor. 0 = no minimum.';
comment on column public.payment_settings.chip_fee_max is
  'Maximum CHIP gateway fee in sen; the flat+percent fee is capped here. 0 = no maximum.';
