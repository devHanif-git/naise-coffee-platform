-- Per-drink amendments on the manage screen: void a single drink or swap it for
-- another. Voided lines stay in order_items for history (excluded from totals and
-- the "all drinks done" check); every amendment is logged in order_adjustments,
-- which drives the price-difference panel shown above the order total.

-- 1. Soft-void flag on a drink line. null = active; set = removed from the bill.
alter table public.order_items
  add column voided_at timestamptz;

comment on column public.order_items.voided_at is
  'When set, this drink was voided by staff: kept for history, excluded from totals and the all-done check.';

-- 2. Amendment log. One row per void/swap, carrying the signed price delta (sen):
--    negative = refund / cheaper, positive = customer owes more.
create table public.order_adjustments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  item_position int not null,
  kind          text not null check (kind in ('void', 'swap')),
  from_label    text not null,
  to_label      text,
  delta         integer not null,
  created_at    timestamptz not null default now()
);

comment on table public.order_adjustments is
  'Staff amendments to an order (void/swap of a single drink). delta in sen; +owes more, -refund.';

create index order_adjustments_order_id_idx on public.order_adjustments (order_id);

alter table public.order_adjustments enable row level security;

-- Read if you can read the parent order (own order or staff), mirroring order_items.
create policy "order_adjustments_select_own_or_staff"
  on public.order_adjustments for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_adjustments.order_id
        and (
          (select auth.uid()) = o.user_id
          or public.current_user_role() in ('admin', 'manager', 'staff')
        )
    )
  );

-- Only staff insert amendments.
create policy "order_adjustments_insert_staff"
  on public.order_adjustments for insert
  to authenticated
  with check (public.current_user_role() in ('admin', 'manager', 'staff'));
