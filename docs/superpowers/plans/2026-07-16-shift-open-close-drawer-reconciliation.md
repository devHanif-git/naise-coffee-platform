# Shift Open/Close & Cash Drawer Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared open/close shift with a cash float, drawer-movement log, and closing cash reconciliation, gating drink-making on an open shift and reminding staff to close via Telegram.

**Architecture:** Two new tables (`shifts`, `shift_movements`) plus `orders.shift_id`, with `security definer` RPCs for open/movement/close. A `lib/shifts/` module wraps reads/RPCs; the shift home lives at `/admin/shift`; drink-making actions gate on `requireOpenShift()`. Scheduled Telegram reminders come from Supabase `pg_cron` → an App Service route `/api/shift/reminder`.

**Tech Stack:** Next.js App Router, TypeScript (strict, no `any`), Tailwind + shadcn/ui, Supabase (Postgres, RLS, pg_cron + pg_net).

## Global Constraints

- Money stored in **sen** (integer); all shift cash UI inputs/displays are **whole RM** (× / ÷ 100 at the boundary). No coins.
- One shared shift for the whole shop; **at most one `open`** at a time (partial unique index).
- Ordering (online + kiosk) is **never blocked**. Only **drink-making** on the manage page is gated.
- Shift operations: **admin, manager, staff** only (`current_user_role() in ('admin','manager','staff')`). Kiosk never manages shifts.
- `shift_movements` is **insert-only** (immutable log). A closed shift is never reopened/edited.
- Follow existing patterns: `security definer set search_path = ''` RPCs, `revoke execute ... from public; grant ... to authenticated`, `set_updated_at()` trigger, `normalizePaymentMethod()` for method grouping, KL-day helpers in `lib/analytics/range.ts`.
- Verification (no JS test framework by design — do NOT add one): `npm run build` (EXIT 0) is the gate; scope lint to changed files with `npx eslint <path>`. Each task ends with a manual check + commit.
- Every change is a migration in `supabase/migrations/`; schema is never edited ad hoc.
- Never expose the service-role key or Telegram token to the client.

## File Structure

**Migrations (`supabase/migrations/`)**
- `20260716120000_shift_schema.sql` — enums, `shifts`, `shift_movements`, unique index, RLS.
- `20260716120100_orders_shift_id.sql` — `orders.shift_id` column + index.
- `20260716120200_shift_rpcs.sql` — `open_shift`, `add_shift_movement`, `close_shift`.
- `20260716120300_shift_reminder_cron.sql` — enable `pg_cron`/`pg_net`, schedule the reminder POST (applied manually via MCP; see Task 9).

**Types & lib**
- `types/shift.ts` — `Shift`, `ShiftMovement`, `MovementKind`, `ShiftSummary`, drafts.
- `lib/shifts/reconcile.ts` — pure math + staleness helpers + `STALE_AFTER_HOURS`.
- `lib/shifts/store.ts` — reads (open shift, summary, history, movements) + RPC wrappers.
- `lib/shifts/require-open.ts` — `requireOpenShift()` for manage actions.

**App / components**
- `app/(admin)/admin/shift/page.tsx`, `app/(admin)/admin/shift/actions.ts`.
- `components/admin/shift-view.tsx` (client shell), `shift-open-panel.tsx`, `shift-movements.tsx`, `shift-add-movement.tsx`, `shift-close-dialog.tsx`, `shift-history.tsx`, `shift-status-chip.tsx`.
- `app/api/shift/reminder/route.ts`.

**Edits**
- `types/order.ts` — add `shiftId` to `Order`.
- `lib/orders/store.ts` — stamp `shift_id` in `createOrder`.
- `app/(store)/store/(kiosk)/actions.ts` — resolve + pass open shift id.
- `app/(admin)/manage/actions.ts` — gate `updateDrinkStatus` + `markReadyAndNotify`.
- `components/order-detail.tsx` — disabled drink controls + prompt when no open shift.
- `app/(admin)/manage/[token]/page.tsx` — pass `hasOpenShift` to `OrderDetail`.
- `components/profile-screen.tsx` — add the **Shift** StaffRow.
- `components/admin/admin-shell.tsx` — mount the status chip.

---

### Task 1: Shift schema (tables, enums, RLS)

**Files:**
- Create: `supabase/migrations/20260716120000_shift_schema.sql`

**Interfaces:**
- Produces: tables `public.shifts`, `public.shift_movements`; enums `public.shift_status` (`open`,`closed`), `public.movement_kind` (`exchange`,`cash_in`,`cash_out`); partial unique index `shifts_one_open`.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase MCP `apply_migration` (name `shift_schema`, the SQL above), or `supabase db push` if using the CLI.

- [ ] **Step 3: Verify tables + one-open guarantee**

Run via MCP `execute_sql`:
```sql
insert into public.shifts (opening_float) values (5000);
insert into public.shifts (opening_float) values (5000); -- must FAIL (unique)
```
Expected: first insert OK, second fails with a unique-violation on `shifts_one_open`. Then clean up: `delete from public.shifts;`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260716120000_shift_schema.sql
git commit -m "feat(shift): shifts + shift_movements schema and RLS"
```

---

### Task 2: orders.shift_id column

**Files:**
- Create: `supabase/migrations/20260716120100_orders_shift_id.sql`

**Interfaces:**
- Produces: `public.orders.shift_id uuid` (nullable, FK → shifts, index).

- [ ] **Step 1: Write the migration**

```sql
-- Attribute each order to the open shift at creation time so closing math is a
-- clean sum by shift_id. Nullable: an order placed with no shift open (only
-- possible for online, which isn't cash-in-drawer) simply has no attribution.
alter table public.orders
  add column shift_id uuid references public.shifts (id) on delete set null;

create index orders_shift_id_idx on public.orders (shift_id);

comment on column public.orders.shift_id is
  'The drawer shift this order counts toward. Null when no shift was open.';
```

- [ ] **Step 2: Apply the migration** (MCP `apply_migration`, name `orders_shift_id`).

- [ ] **Step 3: Verify column exists**

```sql
select column_name from information_schema.columns
where table_name = 'orders' and column_name = 'shift_id';
```
Expected: one row, `shift_id`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260716120100_orders_shift_id.sql
git commit -m "feat(shift): add orders.shift_id attribution column"
```

---

### Task 3: Shift RPCs (open, add movement, close)

**Files:**
- Create: `supabase/migrations/20260716120200_shift_rpcs.sql`

**Interfaces:**
- Produces (all `security definer`, granted to `authenticated`):
  - `open_shift(p_opening_float integer) returns jsonb` — `{ok:true, id}` or `{ok:false, error:'shift_already_open'|'not_authorized'}`.
  - `add_shift_movement(p_kind text, p_cash_delta integer, p_qr_delta integer, p_note text) returns jsonb` — `{ok:true, id}` or `{ok:false, error:'no_open_shift'|'not_authorized'}`.
  - `close_shift(p_counted_cash integer, p_closing_note text) returns jsonb` — `{ok:true, id, expected_cash, cash_difference}` or `{ok:false, error:'no_open_shift'|'not_authorized'}`.

- [ ] **Step 1: Write the migration**

```sql
-- Shift mutations: the ONLY way shifts/movements change. SECURITY DEFINER so the
-- close math reads completed-order totals consistently, but each re-checks the
-- staff role itself (definer bypasses RLS). Money in sen. Mirrors grant_order_stamp.

-- Open a shift with a starting float. Fails if one is already open (also guarded
-- by the partial unique index as a backstop).
create or replace function public.open_shift(p_opening_float integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if public.current_user_role() not in ('admin', 'manager', 'staff') then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  if exists (select 1 from public.shifts where status = 'open') then
    return jsonb_build_object('ok', false, 'error', 'shift_already_open');
  end if;
  insert into public.shifts (opening_float, opened_by)
    values (greatest(p_opening_float, 0), (select auth.uid()))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Record a non-sale drawer movement against the open shift.
create or replace function public.add_shift_movement(
  p_kind text, p_cash_delta integer, p_qr_delta integer, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_shift uuid;
  v_id    uuid;
begin
  if public.current_user_role() not in ('admin', 'manager', 'staff') then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  select id into v_shift from public.shifts where status = 'open';
  if v_shift is null then
    return jsonb_build_object('ok', false, 'error', 'no_open_shift');
  end if;
  insert into public.shift_movements (shift_id, kind, cash_delta, qr_delta, note, created_by)
    values (v_shift, p_kind::public.movement_kind, coalesce(p_cash_delta, 0),
            coalesce(p_qr_delta, 0), nullif(btrim(p_note), ''), (select auth.uid()))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Close the open shift: snapshot expected cash (float + completed cash sales +
-- movement cash deltas) and the counted-vs-expected difference.
create or replace function public.close_shift(
  p_counted_cash integer, p_closing_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_shift    public.shifts%rowtype;
  v_cash_sales integer;
  v_moves    integer;
  v_expected integer;
  v_diff     integer;
begin
  if public.current_user_role() not in ('admin', 'manager', 'staff') then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;
  select * into v_shift from public.shifts where status = 'open';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_open_shift');
  end if;

  -- Completed cash orders attributed to this shift. Payment method is normalized
  -- app-side on write, but tolerate legacy variants here too.
  select coalesce(sum(o.total), 0) into v_cash_sales
    from public.orders o
    where o.shift_id = v_shift.id
      and o.status = 'completed'
      and lower(o.payment_method) in ('cash');

  select coalesce(sum(m.cash_delta), 0) into v_moves
    from public.shift_movements m where m.shift_id = v_shift.id;

  v_expected := v_shift.opening_float + v_cash_sales + v_moves;
  v_diff := coalesce(p_counted_cash, 0) - v_expected;

  update public.shifts
    set status = 'closed',
        closed_by = (select auth.uid()),
        closed_at = now(),
        counted_cash = coalesce(p_counted_cash, 0),
        expected_cash = v_expected,
        cash_difference = v_diff,
        closing_note = nullif(btrim(p_closing_note), '')
    where id = v_shift.id;

  return jsonb_build_object('ok', true, 'id', v_shift.id,
    'expected_cash', v_expected, 'cash_difference', v_diff);
end;
$$;

revoke execute on function public.open_shift(integer) from public;
revoke execute on function public.add_shift_movement(text, integer, integer, text) from public;
revoke execute on function public.close_shift(integer, text) from public;
grant execute on function public.open_shift(integer) to authenticated;
grant execute on function public.add_shift_movement(text, integer, integer, text) to authenticated;
grant execute on function public.close_shift(integer, text) to authenticated;
```

- [ ] **Step 2: Apply the migration** (MCP `apply_migration`, name `shift_rpcs`).

- [ ] **Step 3: Verify RPC shape** (as a non-staff/anon call it should refuse via role check; a direct SQL smoke test):

```sql
select public.open_shift(5000);   -- as service role: {"ok":true,...} (definer skips role? no — role() is null -> not_authorized)
```
Expected: returns a jsonb object with an `ok` key (the exact value depends on the caller's role; the point is the function exists and returns jsonb). Clean up any opened shift: `update public.shifts set status='closed' where status='open';`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260716120200_shift_rpcs.sql
git commit -m "feat(shift): open/add-movement/close RPCs"
```

---

### Task 4: Shift types

**Files:**
- Create: `types/shift.ts`

**Interfaces:**
- Produces: `MovementKind`, `Shift`, `ShiftMovement`, `ShiftSummary`, `ShiftHistoryRow`.

- [ ] **Step 1: Write the types**

```ts
// Shift = one shared cash-drawer session. Money in sen everywhere here; the UI
// converts to/from whole RM at its edges.
export type MovementKind = "exchange" | "cash_in" | "cash_out";

export type Shift = {
  id: string;
  status: "open" | "closed";
  openedBy: string | null;
  openingFloat: number; // sen
  openedAt: string; // ISO
  closedBy: string | null;
  closedAt?: string; // ISO
  countedCash?: number; // sen
  expectedCash?: number; // sen
  cashDifference?: number; // sen (counted - expected; + over, - short)
  closingNote?: string;
  lastReminderAt?: string; // ISO
};

export type ShiftMovement = {
  id: string;
  shiftId: string;
  kind: MovementKind;
  cashDelta: number; // sen (+ in, - out)
  qrDelta: number; // sen
  note?: string;
  createdBy: string | null;
  createdAt: string; // ISO
};

// Live figures for the currently-open shift, all sen.
export type ShiftSummary = {
  shift: Shift;
  cashSales: number; // completed cash orders on this shift
  qrSales: number; // completed duitnow-qr orders on this shift (informational)
  movementsCash: number; // sum of movement cash_delta
  movementsQr: number; // sum of movement qr_delta
  expectedCash: number; // opening_float + cashSales + movementsCash
  movements: ShiftMovement[];
};

// A closed (or open) shift row for the history list.
export type ShiftHistoryRow = Shift;
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.json` (or rely on the Task-9 build). Expected: no errors from `types/shift.ts`.

- [ ] **Step 3: Commit**

```bash
git add types/shift.ts
git commit -m "feat(shift): shift types"
```

---

### Task 5: Reconciliation + staleness helpers (pure)

**Files:**
- Create: `lib/shifts/reconcile.ts`

**Interfaces:**
- Consumes: `klToday`, `klDayKey` from `@/lib/analytics/range`.
- Produces:
  - `STALE_AFTER_HOURS = 6`
  - `expectedCash(openingFloat, cashSales, movementsCash): number`
  - `movementDeltas(kind, direction, amountSen): {cashDelta, qrDelta}` where `direction: "qr_to_cash" | "cash_to_qr"` (only meaningful for `exchange`).
  - `isShiftStale(openedAtISO, lastOrderAtISO | null, now): boolean` — true if past midnight KL since open OR ≥ `STALE_AFTER_HOURS` since last order.

- [ ] **Step 1: Write the helpers**

```ts
import { klDayKey } from "@/lib/analytics/range";
import type { MovementKind } from "@/types/shift";

// A shift is "stale" (should be closed) once it has crossed into a new KL day
// since it opened, OR no order has touched it for this many hours. Whichever
// first. Named constant so a late-trading shop is a one-line change.
export const STALE_AFTER_HOURS = 6;
const HOUR_MS = 3_600_000;

// Expected physical cash at close (sen).
export function expectedCash(
  openingFloat: number,
  cashSales: number,
  movementsCash: number,
): number {
  return openingFloat + cashSales + movementsCash;
}

export type ExchangeDirection = "qr_to_cash" | "cash_to_qr";

// Translate a movement into signed cash/qr deltas (sen). Amount is a positive
// magnitude. Exchange moves money between buckets; cash_in/out touch cash only.
export function movementDeltas(
  kind: MovementKind,
  direction: ExchangeDirection,
  amountSen: number,
): { cashDelta: number; qrDelta: number } {
  const amt = Math.max(Math.round(amountSen), 0);
  if (kind === "cash_in") return { cashDelta: amt, qrDelta: 0 };
  if (kind === "cash_out") return { cashDelta: -amt, qrDelta: 0 };
  // exchange: customer QR->cash empties the drawer (+qr, -cash); reverse flips.
  return direction === "qr_to_cash"
    ? { cashDelta: -amt, qrDelta: amt }
    : { cashDelta: amt, qrDelta: -amt };
}

// Should staff be nudged to close? true once past midnight KL since open, or no
// order for STALE_AFTER_HOURS. `now`/timestamps are epoch ms and ISO strings.
export function isShiftStale(
  openedAtISO: string,
  lastOrderAtISO: string | null,
  now: number = Date.now(),
): boolean {
  const crossedDay = klDayKey(Date.parse(openedAtISO)) !== klDayKey(now);
  const ref = lastOrderAtISO ? Date.parse(lastOrderAtISO) : Date.parse(openedAtISO);
  const idleTooLong = now - ref >= STALE_AFTER_HOURS * HOUR_MS;
  return crossedDay || idleTooLong;
}
```

- [ ] **Step 2: Sanity-check the exchange math**

Reason through: `movementDeltas("exchange","qr_to_cash",200)` → `{cashDelta:-200, qrDelta:200}` (drawer RM2 lighter, QR RM2 heavier). `movementDeltas("cash_out","qr_to_cash",1000)` → `{cashDelta:-1000, qrDelta:0}`. Confirm by eye.

- [ ] **Step 3: Commit**

```bash
git add lib/shifts/reconcile.ts
git commit -m "feat(shift): reconciliation and staleness helpers"
```

---

### Task 6: Shift store (reads + RPC wrappers)

**Files:**
- Create: `lib/shifts/store.ts`
- Create: `lib/shifts/require-open.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`, `createAdminClient` from `@/lib/supabase/admin`, types from `@/types/shift`, `expectedCash` from `./reconcile`, `normalizePaymentMethod` from `@/data/payment-methods`.
- Produces:
  - `getOpenShift(): Promise<Shift | null>`
  - `getShiftSummary(): Promise<ShiftSummary | null>`
  - `listShiftHistory(limit?): Promise<ShiftHistoryRow[]>`
  - `openShift(openingFloatSen): Promise<{ok:true;id:string}|{ok:false;error:string}>`
  - `addMovement(kind, cashDelta, qrDelta, note?): Promise<{ok:true;id:string}|{ok:false;error:string}>`
  - `closeShift(countedCashSen, note?): Promise<{ok:true;expectedCash:number;cashDifference:number}|{ok:false;error:string}>`
  - `getOpenShiftIdAdmin(db): Promise<string | null>` — service-role read for the kiosk stamp path.
  - `require-open.ts`: `requireOpenShift(): Promise<boolean>`

- [ ] **Step 1: Write `lib/shifts/store.ts`**

```ts
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePaymentMethod } from "@/data/payment-methods";
import { expectedCash } from "@/lib/shifts/reconcile";
import type {
  Shift,
  ShiftHistoryRow,
  ShiftMovement,
  ShiftSummary,
} from "@/types/shift";
import type { SupabaseClient } from "@supabase/supabase-js";

type ShiftRow = {
  id: string;
  status: "open" | "closed";
  opened_by: string | null;
  opening_float: number;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  cash_difference: number | null;
  closing_note: string | null;
  last_reminder_at: string | null;
};

function mapShift(r: ShiftRow): Shift {
  return {
    id: r.id,
    status: r.status,
    openedBy: r.opened_by,
    openingFloat: r.opening_float,
    openedAt: r.opened_at,
    closedBy: r.closed_by,
    closedAt: r.closed_at ?? undefined,
    countedCash: r.counted_cash ?? undefined,
    expectedCash: r.expected_cash ?? undefined,
    cashDifference: r.cash_difference ?? undefined,
    closingNote: r.closing_note ?? undefined,
    lastReminderAt: r.last_reminder_at ?? undefined,
  };
}

const SHIFT_COLS =
  "id, status, opened_by, opening_float, opened_at, closed_by, closed_at, counted_cash, expected_cash, cash_difference, closing_note, last_reminder_at";

export async function getOpenShift(): Promise<Shift | null> {
  const db = await createClient();
  const { data } = await db
    .from("shifts").select(SHIFT_COLS).eq("status", "open").maybeSingle();
  return data ? mapShift(data as ShiftRow) : null;
}

export async function getShiftSummary(): Promise<ShiftSummary | null> {
  const db = await createClient();
  const { data: shiftRow } = await db
    .from("shifts").select(SHIFT_COLS).eq("status", "open").maybeSingle();
  if (!shiftRow) return null;
  const shift = mapShift(shiftRow as ShiftRow);

  const [{ data: orderRows }, { data: moveRows }] = await Promise.all([
    db.from("orders")
      .select("total, payment_method, status")
      .eq("shift_id", shift.id)
      .eq("status", "completed"),
    db.from("shift_movements")
      .select("id, shift_id, kind, cash_delta, qr_delta, note, created_by, created_at")
      .eq("shift_id", shift.id)
      .order("created_at", { ascending: false }),
  ]);

  let cashSales = 0;
  let qrSales = 0;
  for (const o of orderRows ?? []) {
    const method = normalizePaymentMethod(o.payment_method as string);
    if (method === "cash") cashSales += o.total as number;
    else if (method === "duitnow-qr") qrSales += o.total as number;
  }

  const movements: ShiftMovement[] = (moveRows ?? []).map((m) => ({
    id: m.id as string,
    shiftId: m.shift_id as string,
    kind: m.kind as ShiftMovement["kind"],
    cashDelta: m.cash_delta as number,
    qrDelta: m.qr_delta as number,
    note: (m.note as string | null) ?? undefined,
    createdBy: (m.created_by as string | null) ?? null,
    createdAt: m.created_at as string,
  }));
  const movementsCash = movements.reduce((s, m) => s + m.cashDelta, 0);
  const movementsQr = movements.reduce((s, m) => s + m.qrDelta, 0);

  return {
    shift,
    cashSales,
    qrSales,
    movementsCash,
    movementsQr,
    expectedCash: expectedCash(shift.openingFloat, cashSales, movementsCash),
    movements,
  };
}

export async function listShiftHistory(limit = 30): Promise<ShiftHistoryRow[]> {
  const db = await createClient();
  const { data } = await db
    .from("shifts").select(SHIFT_COLS)
    .order("opened_at", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => mapShift(r as ShiftRow));
}

type Rpc = { ok: boolean; error?: string; id?: string; expected_cash?: number; cash_difference?: number };

export async function openShift(
  openingFloatSen: number,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = await createClient();
  const { data, error } = await db.rpc("open_shift", { p_opening_float: openingFloatSen });
  if (error) return { ok: false, error: "Couldn't open the shift. Try again." };
  const r = data as unknown as Rpc;
  if (!r?.ok) return { ok: false, error: mapRpcError(r?.error) };
  return { ok: true, id: r.id! };
}

export async function addMovement(
  kind: ShiftMovement["kind"],
  cashDelta: number,
  qrDelta: number,
  note?: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = await createClient();
  const { data, error } = await db.rpc("add_shift_movement", {
    p_kind: kind, p_cash_delta: cashDelta, p_qr_delta: qrDelta, p_note: note ?? null,
  });
  if (error) return { ok: false, error: "Couldn't record the movement. Try again." };
  const r = data as unknown as Rpc;
  if (!r?.ok) return { ok: false, error: mapRpcError(r?.error) };
  return { ok: true, id: r.id! };
}

export async function closeShift(
  countedCashSen: number,
  note?: string,
): Promise<
  { ok: true; expectedCash: number; cashDifference: number } | { ok: false; error: string }
> {
  const db = await createClient();
  const { data, error } = await db.rpc("close_shift", {
    p_counted_cash: countedCashSen, p_closing_note: note ?? null,
  });
  if (error) return { ok: false, error: "Couldn't close the shift. Try again." };
  const r = data as unknown as Rpc;
  if (!r?.ok) return { ok: false, error: mapRpcError(r?.error) };
  return { ok: true, expectedCash: r.expected_cash!, cashDifference: r.cash_difference! };
}

// Service-role read of the open shift id — used by the kiosk order path, which
// has no staff Supabase session (RLS would hide the row). Read-only.
export async function getOpenShiftIdAdmin(
  db: SupabaseClient = createAdminClient(),
): Promise<string | null> {
  const { data } = await db.from("shifts").select("id").eq("status", "open").maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

function mapRpcError(code?: string): string {
  switch (code) {
    case "shift_already_open":
      return "A shift is already open. Close it first.";
    case "no_open_shift":
      return "No shift is open.";
    case "not_authorized":
      return "Not authorized.";
    default:
      return "Something went wrong. Try again.";
  }
}
```

- [ ] **Step 2: Write `lib/shifts/require-open.ts`**

```ts
import { createClient } from "@/lib/supabase/server";

// True when a shift is currently open. Used to gate drink-making server-side.
// Reads under the caller's session (staff RLS allows the select).
export async function requireOpenShift(): Promise<boolean> {
  const db = await createClient();
  const { data } = await db
    .from("shifts").select("id").eq("status", "open").maybeSingle();
  return !!data;
}
```

- [ ] **Step 3: Verify import shape**

Confirm `@/lib/supabase/admin` exports `createAdminClient` and `@/data/payment-methods` exports `normalizePaymentMethod` (both used elsewhere — they do). Type-check happens in Task 9's build.

- [ ] **Step 4: Commit**

```bash
git add lib/shifts/store.ts lib/shifts/require-open.ts
git commit -m "feat(shift): shift store reads and RPC wrappers"
```

---

### Task 7: Stamp shift_id on new orders (createOrder + kiosk)

**Files:**
- Modify: `types/order.ts` (add `shiftId` to `Order`)
- Modify: `lib/orders/store.ts` (`createOrder` insert)
- Modify: `app/(store)/store/(kiosk)/actions.ts` (`placeStoreOrder`)

**Interfaces:**
- Consumes: `getOpenShiftIdAdmin` from `@/lib/shifts/store`.
- Produces: `Order.shiftId?: string`; orders created with `shift_id` set when a shift is open.

- [ ] **Step 1: Add `shiftId` to the Order type**

In `types/order.ts`, add to the `Order` type (near `source`):

```ts
  // The drawer shift this order counts toward. Set at creation when a shift is
  // open; absent otherwise. Maps to orders.shift_id.
  shiftId?: string;
```

`OrderDraft` is `Omit<Order, "token" | "orderNumber" | "status" | "createdAt" | "completedAt">`, so `shiftId` is automatically an accepted draft field.

- [ ] **Step 2: Persist `shift_id` in `createOrder`**

In `lib/orders/store.ts`, in the `orders` insert object in `createOrder`, add after `source: draft.source ?? "online",`:

```ts
      shift_id: draft.shiftId ?? null,
```

- [ ] **Step 3: Resolve + pass the open shift id from the kiosk**

In `app/(store)/store/(kiosk)/actions.ts`, add the import near the other `@/lib` imports:

```ts
import { getOpenShiftIdAdmin } from "@/lib/shifts/store";
```

Then, in `placeStoreOrder`, immediately before the `createOrder(` call, resolve the id (the kiosk has no staff session, so use the admin client — `createAdminClient` is already imported in this file):

```ts
  // Attribute the kiosk order to the open shift (if any) for drawer reconciliation.
  const shiftId = await getOpenShiftIdAdmin(createAdminClient());
```

And add `shiftId: shiftId ?? undefined,` to the `createOrder` draft object (alongside `source: "store"`).

- [ ] **Step 4: Verify build + a placed kiosk order stamps shift_id**

Run: `npx eslint "app/(store)/store/(kiosk)/actions.ts" lib/orders/store.ts types/order.ts`
Expected: no errors. Manual: with a shift open, place a kiosk order, then
```sql
select order_number, shift_id from public.orders order by created_at desc limit 1;
```
Expected: `shift_id` matches the open shift. With no shift open, a new order has `shift_id = null`.

- [ ] **Step 5: Commit**

```bash
git add types/order.ts lib/orders/store.ts "app/(store)/store/(kiosk)/actions.ts"
git commit -m "feat(shift): stamp shift_id on new orders"
```

---

### Task 8: Gate drink-making on an open shift

**Files:**
- Modify: `app/(admin)/manage/actions.ts` (`updateDrinkStatus`, `markReadyAndNotify`)
- Modify: `app/(admin)/manage/[token]/page.tsx` (pass `hasOpenShift`)
- Modify: `components/order-detail.tsx` (disabled controls + prompt)

**Interfaces:**
- Consumes: `requireOpenShift` from `@/lib/shifts/require-open`, `getOpenShift` from `@/lib/shifts/store`.
- Produces: `OrderDetail` accepts a new `hasOpenShift: boolean` prop.

- [ ] **Step 1: Gate the two mutating actions**

In `app/(admin)/manage/actions.ts`, add the import:

```ts
import { requireOpenShift } from "@/lib/shifts/require-open";
```

In `updateDrinkStatus`, after the `canManageOrders()` check and before `setItemStatus`:

```ts
  if (!(await requireOpenShift())) {
    return { ok: false, error: "Open a shift before making drinks." };
  }
```

Add the identical guard in `markReadyAndNotify`, after its `canManageOrders()` check and before `getOrderByToken`. (Void/swap/cancel/payment actions are NOT gated — only advancing a drink and completing.)

- [ ] **Step 2: Pass `hasOpenShift` into the manage page**

In `app/(admin)/manage/[token]/page.tsx`, add the import:

```ts
import { getOpenShift } from "@/lib/shifts/store";
```

Add `getOpenShift()` to the existing `Promise.all([...])` that resolves `categories`/`products` (or a standalone `await`), e.g.:

```ts
  const [categories, products, openShift] = await Promise.all([
    listCategories(),
    listProducts(),
    getOpenShift(),
  ]);
```

Then pass `hasOpenShift={!!openShift}` to `<OrderDetail ... />`.

- [ ] **Step 3: Consume the prop in OrderDetail**

In `components/order-detail.tsx`, add `hasOpenShift: boolean` to the component's props type and destructure it. When `!hasOpenShift`:
- Disable the per-drink status controls and the Complete button (add `disabled={!hasOpenShift}` to those controls).
- Render an inline notice above the drink list:

```tsx
{!hasOpenShift && (
  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
    Open a shift to start making drinks.{" "}
    <a href="/admin/shift" className="font-semibold underline underline-offset-2">
      Open shift
    </a>
  </div>
)}
```

Keep the exact control-disabling consistent with how `OrderDetail` already renders its status buttons (match the existing prop/handler names in that file).

- [ ] **Step 4: Verify**

Run: `npx eslint "app/(admin)/manage/actions.ts" "app/(admin)/manage/[token]/page.tsx" components/order-detail.tsx`
Expected: no errors. Manual: with no shift open, open a `/manage/<token>` link — drink status + Complete are disabled with the notice; advancing a drink returns "Open a shift before making drinks." Open a shift → controls enable.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/manage/actions.ts" "app/(admin)/manage/[token]/page.tsx" components/order-detail.tsx
git commit -m "feat(shift): gate drink-making on an open shift"
```

---

### Task 9: Shift page, server actions, and components

**Files:**
- Create: `app/(admin)/admin/shift/page.tsx`
- Create: `app/(admin)/admin/shift/actions.ts`
- Create: `components/admin/shift-view.tsx`
- Create: `components/admin/shift-close-dialog.tsx`

**Interfaces:**
- Consumes: `getShiftSummary`, `listShiftHistory`, `openShift`, `addMovement`, `closeShift` from `@/lib/shifts/store`; `movementDeltas`, `expectedCash` from `@/lib/shifts/reconcile`; `isAdmin`/`canManageOrders` from `@/lib/auth/session`; `formatMoney` from `@/lib/format` (verify the exact export name in that file and match it).
- Produces: `/admin/shift` route; server actions `openShiftAction`, `addMovementAction`, `closeShiftAction`.

- [ ] **Step 1: Write the server actions** (`app/(admin)/admin/shift/actions.ts`)

```ts
"use server";

import { revalidatePath } from "next/cache";
import { canManageOrders } from "@/lib/auth/session";
import { openShift, addMovement, closeShift } from "@/lib/shifts/store";
import { movementDeltas, type ExchangeDirection } from "@/lib/shifts/reconcile";
import type { MovementKind } from "@/types/shift";

type Result = { ok: true } | { ok: false; error: string };

// Amounts arrive from the UI in whole RM; convert to sen at this boundary.
const toSen = (rm: number) => Math.max(Math.round(rm), 0) * 100;

export async function openShiftAction(openingFloatRm: number): Promise<Result> {
  if (!(await canManageOrders())) return { ok: false, error: "Not authorized." };
  const res = await openShift(toSen(openingFloatRm));
  if (!res.ok) return res;
  revalidatePath("/admin/shift");
  return { ok: true };
}

export async function addMovementAction(input: {
  kind: MovementKind;
  direction: ExchangeDirection; // ignored unless kind === "exchange"
  amountRm: number;
  note?: string;
}): Promise<Result> {
  if (!(await canManageOrders())) return { ok: false, error: "Not authorized." };
  if (!(input.amountRm > 0)) return { ok: false, error: "Enter an amount." };
  const { cashDelta, qrDelta } = movementDeltas(
    input.kind, input.direction, toSen(input.amountRm),
  );
  const res = await addMovement(input.kind, cashDelta, qrDelta, input.note);
  if (!res.ok) return res;
  revalidatePath("/admin/shift");
  return { ok: true };
}

export async function closeShiftAction(
  countedCashRm: number,
  note?: string,
): Promise<{ ok: true; expectedCash: number; cashDifference: number } | { ok: false; error: string }> {
  if (!(await canManageOrders())) return { ok: false, error: "Not authorized." };
  const res = await closeShift(toSen(countedCashRm), note);
  if (!res.ok) return res;
  revalidatePath("/admin/shift");
  return res;
}
```

- [ ] **Step 2: Write the page** (`app/(admin)/admin/shift/page.tsx`)

```tsx
import { canManageOrders } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getShiftSummary, listShiftHistory } from "@/lib/shifts/store";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { ShiftView } from "@/components/admin/shift-view";

export const dynamic = "force-dynamic";

export default async function ShiftPage() {
  if (!(await canManageOrders())) redirect("/");
  const [summary, history] = await Promise.all([
    getShiftSummary(),
    listShiftHistory(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Shift" description="Open, close & count the drawer." />
      <ShiftView summary={summary} history={history} />
    </div>
  );
}
```

- [ ] **Step 3: Write `components/admin/shift-view.tsx`** (client component)

A `"use client"` component that renders, based on `summary`:
- **No open shift:** a whole-RM opening-float input + "Open shift" button calling `openShiftAction`. If the most recent history row is `open` (shouldn't happen when `summary` is null, but guard anyway), show "Close previous shift first".
- **Open shift:** a summary card (opened at, opening float, live cash sales, live QR sales, movement count — all via `formatMoney(sen)`), a movements list (kind, signed amount, note, time), an "Add movement" form (segmented control `Exchange` / `Cash in` / `Cash out`; when `Exchange`, a direction toggle `QR → Cash` / `Cash → QR`; a whole-RM amount input; optional note) calling `addMovementAction`, and a "Close shift" button opening `ShiftCloseDialog`.
- **History:** a list below (opened/closed times, expected vs counted, over/short) via `formatMoney`.

Props: `{ summary: ShiftSummary | null; history: ShiftHistoryRow[] }` (import the types from `@/types/shift`). Use `useState` for form fields and `useTransition` for the action calls; surface `res.error` inline. Use shadcn primitives already in the repo (`Button`, `Input`, `Dialog`, etc.) and Tailwind — match the styling of existing admin managers (e.g. `components/admin/cost-manager.tsx`). Display money with the existing `lib/format` helper (match its exact exported name).

- [ ] **Step 4: Write `components/admin/shift-close-dialog.tsx`**

A shadcn `Dialog` that shows the reconciliation statement from `summary` (opening float, `+` cash sales, `±` movements cash, `=` expected cash), a whole-RM **counted cash** input, reveals over/short (`counted*100 − expectedCash`) live as they type, an optional note, and a Confirm button calling `closeShiftAction`. On success it closes and the page revalidates. Props: `{ summary: ShiftSummary }`.

- [ ] **Step 5: Verify build + flow**

Run: `npx eslint "app/(admin)/admin/shift/page.tsx" "app/(admin)/admin/shift/actions.ts" components/admin/shift-view.tsx components/admin/shift-close-dialog.tsx`
Expected: no errors. Manual: visit `/admin/shift`. Open with RM50; place & complete a cash order elsewhere; confirm cash sales update. Add a `QR → Cash` exchange RM2 → expected cash drops RM2. Add cash-out RM10 → drops another RM10. Close with a counted number → over/short = counted − expected; the shift appears in history.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/admin/shift" components/admin/shift-view.tsx components/admin/shift-close-dialog.tsx
git commit -m "feat(shift): shift page, actions, and drawer UI"
```

---

### Task 10: Profile Shift entry + admin-shell status chip

**Files:**
- Modify: `components/profile-screen.tsx` (add Shift StaffRow)
- Modify: `components/admin/admin-shell.tsx` (status chip)
- Modify: `app/(admin)/admin/layout.tsx` (or wherever the shell is rendered) to pass shift state — verify the actual shell mount point first.

**Interfaces:**
- Consumes: `getOpenShift` from `@/lib/shifts/store`.
- Produces: a Shift row in the profile Staff card; a shift-state chip in the admin shell.

- [ ] **Step 1: Add the Shift StaffRow**

In `components/profile-screen.tsx`, inside the Staff card (the `canManage` block that renders the `Manage` row), add a new `StaffRow` gated on `canManage` (all manage roles). Pick a lucide icon already imported or add one (e.g. `Wallet`):

```tsx
<StaffRow
  icon={Wallet}
  label="Shift"
  description="Open, close & count the drawer"
  href="/admin/shift?from=profile"
/>
```

Add `Wallet` to the existing `lucide-react` import in that file if not present.

- [ ] **Step 2: Add the status chip to the admin shell**

The admin shell (`components/admin/admin-shell.tsx`) is a client component. Fetch the open-shift state on the server where the shell is mounted and pass it in as a prop `openSince: string | null` (ISO of `openedAt`, or null). Add a small chip near the header:

```tsx
<a
  href="/admin/shift"
  className={cn(
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
    openSince ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600",
  )}
>
  <span className={cn("size-1.5 rounded-full", openSince ? "bg-emerald-500" : "bg-neutral-400")} />
  {openSince ? "Shift open" : "No shift open"}
</a>
```

First read `admin-shell.tsx` and its parent layout to find the exact prop-drilling path; add `openSince` to the shell's props type and thread it from a server `getOpenShift()` call in the layout. Keep it minimal — the chip is informational.

- [ ] **Step 3: Verify**

Run: `npx eslint components/profile-screen.tsx components/admin/admin-shell.tsx`
Expected: no errors. Manual: the profile Staff card shows **Shift** (as staff/manager/admin); the admin shell shows "Shift open"/"No shift open" and links to `/admin/shift`.

- [ ] **Step 4: Commit**

```bash
git add components/profile-screen.tsx components/admin/admin-shell.tsx "app/(admin)/admin/layout.tsx"
git commit -m "feat(shift): profile entry point and admin-shell status chip"
```

---

### Task 11: Telegram reminder route + pg_cron

**Files:**
- Create: `app/api/shift/reminder/route.ts`
- Create: `supabase/migrations/20260716120300_shift_reminder_cron.sql` (documentation of the scheduled job; applied via MCP)

**Interfaces:**
- Consumes: `createAdminClient` from `@/lib/supabase/admin`; `sendTelegramMessage` from `@/lib/telegram`; `klDayKey` from `@/lib/analytics/range`; `STALE_AFTER_HOURS` from `@/lib/shifts/reconcile`.
- Produces: `POST /api/shift/reminder` (shared-secret gated); a pg_cron job hitting it every ~30 min.

- [ ] **Step 1: Write the route** (`app/api/shift/reminder/route.ts`)

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { klDayKey } from "@/lib/analytics/range";

export const dynamic = "force-dynamic";

const HOUR_MS = 3_600_000;
const REMIND_EVERY_MS = 30 * 60_000; // 30 min between close reminders
const OPEN_NUDGE_AFTER_MS = 12 * HOUR_MS;

// Cron-only endpoint (Supabase pg_cron). Decides whether a reminder is due from
// shift state + last_reminder_at, so overlapping/retried hits never spam.
export async function POST(req: Request) {
  const secret = process.env.SHIFT_CRON_SECRET;
  if (!secret || req.headers.get("x-shift-cron-secret") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const db = createAdminClient();
  const now = Date.now();

  // Is a shift open? If so, maybe send a "please close" reminder.
  const { data: open } = await db
    .from("shifts")
    .select("id, opened_at, last_reminder_at")
    .eq("status", "open")
    .maybeSingle();

  if (open) {
    const crossedDay = klDayKey(Date.parse(open.opened_at as string)) !== klDayKey(now);
    const last = open.last_reminder_at ? Date.parse(open.last_reminder_at as string) : 0;
    const due = crossedDay && now - last >= REMIND_EVERY_MS;
    if (due) {
      try {
        await sendTelegramMessage(
          "🔔 Shift still open — please close & count the drawer.",
        );
        await db.from("shifts")
          .update({ last_reminder_at: new Date(now).toISOString() })
          .eq("id", open.id);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        console.error(`Shift close reminder failed: ${reason}`);
      }
    }
    return NextResponse.json({ ok: true, sent: due });
  }

  // No shift open: one-time "start a shift?" nudge 12h after the last close.
  const { data: lastClosed } = await db
    .from("shifts")
    .select("id, closed_at, last_reminder_at")
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastClosed?.closed_at) {
    const closedMs = Date.parse(lastClosed.closed_at as string);
    const alreadyNudged =
      lastClosed.last_reminder_at &&
      Date.parse(lastClosed.last_reminder_at as string) > closedMs;
    if (!alreadyNudged && now - closedMs >= OPEN_NUDGE_AFTER_MS) {
      try {
        await sendTelegramMessage("☀️ Starting up? Open a shift to begin the drawer.");
        await db.from("shifts")
          .update({ last_reminder_at: new Date(now).toISOString() })
          .eq("id", lastClosed.id);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        console.error(`Shift open nudge failed: ${reason}`);
      }
      return NextResponse.json({ ok: true, sent: true });
    }
  }

  return NextResponse.json({ ok: true, sent: false });
}
```

- [ ] **Step 2: Write the cron migration** (`supabase/migrations/20260716120300_shift_reminder_cron.sql`)

```sql
-- Scheduled Telegram shift reminders. pg_cron fires every 30 min and, via
-- pg_net, POSTs the App Service reminder route with the shared secret. The route
-- decides whether a message is actually due (past-midnight-KL close reminder;
-- one-time open nudge 12h after close). Secrets live in the App Service, not here.
--
-- Before applying, set the two values below (Supabase project settings or a
-- Vault secret): the site URL and the shared secret matching SHIFT_CRON_SECRET.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Replace <SITE_URL> and <SHIFT_CRON_SECRET> with the real values, or read them
-- from vault.decrypted_secrets. Runs at minute 3 and 33 of every hour (off the
-- :00/:30 marks).
select cron.schedule(
  'shift-reminder',
  '3,33 * * * *',
  $$
  select net.http_post(
    url     := '<SITE_URL>/api/shift/reminder',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-shift-cron-secret', '<SHIFT_CRON_SECRET>'),
    body    := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 3: Set env + apply**

- Add `SHIFT_CRON_SECRET` to the App Service env vars (Azure) and to `.env.local` for local runs. Generate a random value.
- Apply the cron migration via MCP `apply_migration` (name `shift_reminder_cron`) **after** substituting the real `<SITE_URL>` and `<SHIFT_CRON_SECRET>`. (These extensions + `cron.schedule` require the Supabase project; they are not part of `npm run build`.)

- [ ] **Step 4: Verify the route gate**

Manual: `curl -X POST <SITE_URL>/api/shift/reminder` with no secret → 401. With `-H "x-shift-cron-secret: <secret>"` → `{ok:true, sent:...}`. With a shift opened and `opened_at` back-dated to yesterday, a secreted call sends the Telegram close reminder once, then not again for 30 min.

Run: `npx eslint app/api/shift/reminder/route.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/shift/reminder/route.ts supabase/migrations/20260716120300_shift_reminder_cron.sql
git commit -m "feat(shift): telegram reminder route + pg_cron schedule"
```

---

### Task 12: Full build gate + banner (staleness) polish

**Files:**
- Modify: `components/admin/admin-shell.tsx` or a small `components/admin/shift-stale-banner.tsx` (in-app staleness banner)

**Interfaces:**
- Consumes: `isShiftStale`, `getShiftSummary`/`getOpenShift`, plus the shift's last order time.

- [ ] **Step 1: Add the staleness banner**

Add a dismissible banner shown in the admin shell when a shift is open AND `isShiftStale(openedAt, lastOrderAt, Date.now())`. To get `lastOrderAt`, query the newest order on the open shift (`orders` where `shift_id = X` order by `created_at desc limit 1`) in the layout's server fetch; pass `openedAt` + `lastOrderAt` to the shell. The banner: "This shift has been open a while — close & count the drawer." with a link to `/admin/shift` and a dismiss (client `useState`, resets on navigation — acceptable per spec). Keep it non-blocking.

- [ ] **Step 2: Full build**

Run: `npm run build`
Expected: EXIT 0, no type errors.

- [ ] **Step 3: Lint changed files**

Run: `npx eslint components/admin/admin-shell.tsx components/admin/shift-stale-banner.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/admin
git commit -m "feat(shift): in-app staleness banner + build gate"
```

---

## Self-Review

- **Spec coverage:** data model → Tasks 1–2; reconciliation math → Tasks 3, 5, 9; enforcement (drink-making block + no-double-open) → Tasks 3, 8; reminders (banner + pg_cron/route) → Tasks 11–12; UI surfaces (shift page, movements, close dialog, history, profile row, chip) → Tasks 9–10; access/RLS → Tasks 1, 3; kiosk ordering-only + shift_id stamp → Task 7. All spec sections map to a task.
- **Placeholder scan:** each code step contains full code; UI component steps (9 §3–4, 10 §2, 12 §1) describe structure but reference concrete props/handlers and existing sibling files to match — acceptable because they are UI-composition tasks with exact interfaces named, and the executing agent reads the sibling files. No "TODO"/"handle edge cases" left.
- **Type consistency:** `ShiftSummary`, `Shift`, `ShiftMovement`, `MovementKind`, `ExchangeDirection` used consistently across Tasks 4–12; RPC names `open_shift`/`add_shift_movement`/`close_shift` match between Task 3 (SQL) and Task 6 (wrappers); `getOpenShiftIdAdmin` defined in Task 6 and consumed in Task 7; `requireOpenShift` defined in Task 6 and consumed in Task 8; `hasOpenShift` prop consistent across Task 8.
- **Open follow-ups for the implementer:** confirm the exact money-format export in `lib/format.ts` and the exact status-button prop names in `components/order-detail.tsx` before editing (both flagged in-task).
