-- Attribute each order to the open shift at creation time so closing math is a
-- clean sum by shift_id. Nullable: an order placed with no shift open (only
-- possible for online, which isn't cash-in-drawer) simply has no attribution.
alter table public.orders
  add column shift_id uuid references public.shifts (id) on delete set null;

create index orders_shift_id_idx on public.orders (shift_id);

comment on column public.orders.shift_id is
  'The drawer shift this order counts toward. Null when no shift was open.';
