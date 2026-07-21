-- CHIP refund tracking — auto-refund on order cancel.
--
-- When staff cancel a CHIP-paid order and choose to refund, we call CHIP's refund
-- API and record the outcome on the purchase row. Two nullable stamps, no enum:
--   refunded_at set                     -> refund recorded (incl. async pending_refund)
--   refund_error set (refunded_at null) -> last attempt failed, retryable
--   both null                           -> never attempted
-- We always refund the full captured `amount`, so there is no refunded-amount column.

alter table public.chip_purchases
  add column refunded_at timestamptz,
  add column refund_error text;

comment on column public.chip_purchases.refunded_at is
  'When a CHIP refund was accepted (refunded or pending_refund). Null until refunded.';
comment on column public.chip_purchases.refund_error is
  'Last refund failure reason. Null on success; set (with refunded_at null) marks a retryable failure.';
