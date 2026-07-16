-- Shift = one shared cash-drawer session for the whole shop. At most one open at
-- a time (partial unique index). Money in sen. Admin/manager/staff only; the
-- kiosk never manages shifts. shift_movements is an immutable (insert-only) log
-- of non-sale drawer changes (cash<->QR exchanges, cash in/out).

create type public.shift_status as enum ('open', 'closed');
create type public.movement_kind as enum ('exchange', 'cash_in', 'cash_out');

create table public.shifts (
  id              uuid primary key default gen_random_uuid(),
  status          public.shift_status not null default 'open',
  opened_by       uuid references auth.users (id) on delete set null,
  opening_float   integer not null,
  opened_at       timestamptz not null default now(),
  closed_by       uuid references auth.users (id) on delete set null,
  closed_at       timestamptz,
  counted_cash    integer,
  expected_cash   integer,
  cash_difference integer,
  closing_note    text,
  last_reminder_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.shifts is
  'Shared cash-drawer session. Money in sen. At most one open at a time.';

-- The hard "only one open shift" guarantee.
create unique index shifts_one_open on public.shifts (status)
  where status = 'open';
create index shifts_opened_at_idx on public.shifts (opened_at desc);

create table public.shift_movements (
  id         uuid primary key default gen_random_uuid(),
  shift_id   uuid not null references public.shifts (id) on delete cascade,
  kind       public.movement_kind not null,
  cash_delta integer not null,          -- + into drawer, - out of drawer
  qr_delta   integer not null default 0,-- + into QR balance (exchanges only)
  note       text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.shift_movements is
  'Immutable log of non-sale drawer changes. cash_delta/qr_delta in sen.';

create index shift_movements_shift_id_idx on public.shift_movements (shift_id);

create trigger shifts_set_updated_at before update on public.shifts
  for each row execute function public.set_updated_at();

-- RLS: admin/manager/staff only.
alter table public.shifts enable row level security;
alter table public.shift_movements enable row level security;

create policy "shifts_select_staff" on public.shifts for select to authenticated
  using (public.current_user_role() in ('admin', 'manager', 'staff'));
create policy "shifts_insert_staff" on public.shifts for insert to authenticated
  with check (public.current_user_role() in ('admin', 'manager', 'staff'));
create policy "shifts_update_staff" on public.shifts for update to authenticated
  using (public.current_user_role() in ('admin', 'manager', 'staff'))
  with check (public.current_user_role() in ('admin', 'manager', 'staff'));

-- Movements: read + insert only (immutable log — no update/delete policy).
create policy "shift_movements_select_staff" on public.shift_movements
  for select to authenticated
  using (public.current_user_role() in ('admin', 'manager', 'staff'));
create policy "shift_movements_insert_staff" on public.shift_movements
  for insert to authenticated
  with check (public.current_user_role() in ('admin', 'manager', 'staff'));
