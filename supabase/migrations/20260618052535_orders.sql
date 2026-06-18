-- Order status (overall, derived from drinks; completed/cancelled set explicitly).
create type public.order_status as enum
  ('pending', 'preparing', 'ready', 'completed', 'cancelled');

-- Per-drink fulfilment status.
create type public.item_status as enum ('pending', 'preparing', 'done');

-- Human order numbers: NAISE-000001, NAISE-000002, ...
create sequence public.orders_seq start 1;

create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  token                uuid not null unique default gen_random_uuid(),
  order_seq            bigint not null default nextval('public.orders_seq'),
  order_number         text generated always as
                         ('NAISE-' || lpad(order_seq::text, 6, '0')) stored,
  user_id              uuid references auth.users (id) on delete set null,
  owner_id             text not null,
  status               public.order_status not null default 'pending',
  payment_method       text not null,
  subtotal             integer not null,
  total                integer not null,
  notes                text,
  proof_of_payment_url text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  completed_at         timestamptz
);

comment on table public.orders is 'Customer orders. Money in sen. token = manage/detail lookup; owner_id = browser id (guests), user_id = auth.uid() (members).';

create index orders_user_id_idx on public.orders (user_id);
create index orders_owner_id_idx on public.orders (owner_id);
create index orders_created_at_idx on public.orders (created_at desc);

create table public.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete cascade,
  position    int not null,
  name        text not null,
  quantity    int not null,
  size_name   text,
  addon_names text[] not null default '{}',
  unit_price  integer not null,
  line_total  integer not null,
  status      public.item_status not null default 'pending',
  unique (order_id, position)
);

create index order_items_order_id_idx on public.order_items (order_id);

-- updated_at maintenance (reuses the existing trigger function).
create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- RLS.
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Orders: read own rows, or any row for staff/manager/admin.
create policy "orders_select_own_or_staff"
  on public.orders for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or public.current_user_role() in ('admin', 'manager', 'staff')
  );

-- Orders: members insert only their own row (guests insert via service role).
create policy "orders_insert_self"
  on public.orders for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- Orders: staff update (status/cancel). Members do not update orders.
create policy "orders_update_staff"
  on public.orders for update
  to authenticated
  using (public.current_user_role() in ('admin', 'manager', 'staff'))
  with check (public.current_user_role() in ('admin', 'manager', 'staff'));

-- Order items: read if you can read the parent order.
create policy "order_items_select_own_or_staff"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          (select auth.uid()) = o.user_id
          or public.current_user_role() in ('admin', 'manager', 'staff')
        )
    )
  );

-- Order items: members insert lines for their own order (guests via service role).
create policy "order_items_insert_self"
  on public.order_items for insert
  to authenticated
  with check (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (select auth.uid()) = o.user_id
    )
  );

-- Order items: staff update fulfilment status.
create policy "order_items_update_staff"
  on public.order_items for update
  to authenticated
  using (public.current_user_role() in ('admin', 'manager', 'staff'))
  with check (public.current_user_role() in ('admin', 'manager', 'staff'));

-- Realtime: staff board / detail use Postgres Changes (gated by select policy).
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.order_items;
alter table public.orders replica identity full;
alter table public.order_items replica identity full;

-- Broadcast customer-facing status changes to a per-order topic `order:<token>`.
-- The token is the secret (same model as the order-detail URL). Definer so it
-- can write to realtime.messages regardless of caller RLS.
create or replace function public.broadcast_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'order:' || new.token::text, -- topic
    tg_op,                       -- event
    tg_op,                       -- operation
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return new;
end;
$$;

create trigger orders_broadcast_status
  after update on public.orders
  for each row
  when (old.status is distinct from new.status
        or old.completed_at is distinct from new.completed_at)
  execute function public.broadcast_order_status();

-- Allow anyone (guest or member) to RECEIVE broadcasts on order:* topics.
-- No order row data is exposed by this; only the small change payload.
create policy "realtime_receive_order_topics"
  on realtime.messages for select
  to anon, authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() like 'order:%'
  );
