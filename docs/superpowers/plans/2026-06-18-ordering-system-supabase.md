# Ordering System → Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the NAISE COFFEE ordering system from the in-memory mock store to Supabase end to end — persisted orders linked to guests and members, real data on the staff `/manage` surfaces and customer history, live status updates, DuitNow QR receipt upload, and an auto-opening completion modal that fires a buyer-facing Telegram "your drink is ready" notice.

**Architecture:** `lib/orders/store.ts` stays the seam: its exported functions keep their names but become **async** Supabase queries. Identity is derived **server-side** (the action reads `auth.getUser()`); members write under RLS, guests write via a server-only service-role admin client. Staff see live updates via Postgres Changes; every customer (guest or member) tracks their order live via a per-order Broadcast channel keyed by the unguessable token.

**Tech Stack:** Next.js 16 (App Router, RSC), TypeScript (strict, no `any`), Tailwind v4, Supabase (`@supabase/ssr` 0.12, `@supabase/supabase-js` 2.108) for Postgres + RLS + Storage + Realtime, Telegram Bot API.

## Global Constraints

- **Money is integer sen** (1 MYR = 100 sen) everywhere. Never floats.
- **No new libraries** without approval (AGENTS.md). There is **no unit-test runner**; the verification cycle per task is: `npx tsc --noEmit` (typecheck), `npm run lint`, and where noted `npm run build` + manual browser checks + SQL checks via the Supabase MCP.
- **Schema changes ship as migrations** in `supabase/migrations/`. Apply via the Supabase MCP (`apply_migration`), then save the identical SQL as a versioned file, then regenerate `types/database.ts` (`generate_typescript_types`).
- **TypeScript strict, no `any`.** Use generated DB types from `types/database.ts`.
- **Never expose the service-role key to the client.** `lib/supabase/admin.ts` is server-only and must never be imported by a `"use client"` module.
- **Do not change existing UI** except: (a) remove the per-drink undo and add the auto-opening completion modal on `/manage/[token]`, and (b) add the DuitNow QR receipt upload step in checkout. No other visual changes.
- **Server Components by default**; add `"use client"` only for interactivity/realtime.
- **Use `next/image`** for images (receipts); add the Supabase host to `next.config.ts` `images.remotePatterns`.
- **Commit after each task.** Branch: work on `dev` (current branch), commit per task. Do not push unless asked.
- Supabase project ref: `hodukwhqjhjzyfxlsovp` (from `.mcp.json`).
- Roles permitted on manage surfaces: `admin`, `manager`, `staff` (via `canManageOrders()` / `current_user_role()`).

---

## File Structure

**New files:**
- `supabase/migrations/<ts>_orders.sql` — enums, sequence, `orders`, `order_items`, RLS, `updated_at` trigger, realtime publication, broadcast trigger + `realtime.messages` policy.
- `supabase/migrations/<ts>_receipts_storage.sql` — private `receipts` bucket + storage RLS.
- `lib/supabase/admin.ts` — service-role client (server-only).
- `lib/orders/mappers.ts` — row↔`Order` mapping + DB enum mapping (pure, shared by store).
- `lib/orders/receipt.ts` — browser upload helper for DuitNow QR receipts.
- `lib/orders/realtime.ts` — client subscribe helpers (staff Postgres Changes + customer Broadcast).
- `components/order-complete-modal.tsx` — the auto-opening completion confirmation modal.
- `components/manage-orders-live.tsx` — thin client wrapper that refreshes the staff board on realtime events.
- `components/customer-order-live.tsx` — thin client wrapper that refreshes the customer detail on broadcast events.

**Modified files:**
- `lib/orders/store.ts` — Supabase-backed, async; seeds removed.
- `lib/orders/status.ts` — unchanged logic; (verify `ready` maps as intended).
- `lib/orders/message.ts` — add `buildOrderReadyMessage`.
- `lib/telegram.ts` — unchanged (reused).
- `types/order.ts` — `OrderDraft` stays; add `proofOfPaymentPath` note; no breaking change.
- `types/database.ts` — regenerated after migrations.
- `app/(customer)/checkout/actions.ts` — server-side `user_id`, receipt path, guest admin-client insert.
- `components/checkout-screen.tsx` — DuitNow QR receipt picker + upload before place.
- `app/(admin)/manage/page.tsx` — real data (await), wrap in live board.
- `app/(admin)/manage/[token]/page.tsx` — real data (await).
- `app/(admin)/manage/actions.ts` — add `markReadyAndNotify`; keep `updateDrinkStatus`, `cancelOrderAction`; all async store calls awaited.
- `components/order-detail.tsx` — remove undo wiring, auto-open completion modal on last drink done, realtime.
- `components/drink-row.tsx` — remove undo (button + swipe-right + `onReset`).
- `app/(admin)/manage/test/page.tsx` — keep mock; passes `persist={false}` (modal works locally, no Telegram).
- `app/(customer)/profile/orders/page.tsx` — real data (await), guest via admin client.
- `app/(customer)/profile/orders/[token]/page.tsx` — real data (await) + live wrapper.
- `data/mock-order.ts` — keep (used by `/manage/test`).
- `next.config.ts` — add `images.remotePatterns` for the Supabase host.
- `.env.example`, `.dev.vars.example` — add `SUPABASE_SERVICE_ROLE_KEY`.

---

## Task 1: Database migration — orders & order_items (schema, RLS, realtime)

**Files:**
- Apply via Supabase MCP, then create: `supabase/migrations/<ts>_orders.sql`
- Modify (regenerate): `types/database.ts`

**Interfaces:**
- Produces: tables `public.orders`, `public.order_items`; enums `public.order_status`, `public.item_status`; sequence `public.orders_seq`; function `public.broadcast_order_status()`; generated `order_number`.
- Consumes: existing `public.current_user_role()`, `public.set_updated_at()`, `public.profiles`.

- [ ] **Step 1: Apply the migration via Supabase MCP**

Use the Supabase MCP `apply_migration` with name `orders` and this SQL:

```sql
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
```

- [ ] **Step 2: Verify the schema applied**

Use the Supabase MCP `execute_sql`:

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'orders' order by ordinal_position;
```

Expected: rows including `order_number` (text), `token` (uuid), `user_id` (uuid), `owner_id` (text), `status` (USER-DEFINED), `total` (integer).

Then verify the generated number format:

```sql
insert into public.orders (owner_id, payment_method, subtotal, total)
values ('verify-temp', 'Cash', 1000, 1000) returning order_number, token;
```

Expected: `order_number` like `NAISE-000001`. Then clean up:

```sql
delete from public.orders where owner_id = 'verify-temp';
```

- [ ] **Step 3: Save the migration file**

Create `supabase/migrations/<ts>_orders.sql` (use the MCP-applied timestamp as `<ts>`, format `YYYYMMDDHHMMSS`) containing the **exact** SQL from Step 1.

- [ ] **Step 4: Regenerate database types**

Use the Supabase MCP `generate_typescript_types` and overwrite `types/database.ts` with the result.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (new tables present in `Database` type; nothing references them yet).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations types/database.ts
git commit -m "feat(db): orders + order_items tables, RLS, realtime, broadcast trigger"
```

---

## Task 2: Database migration — receipts storage bucket

**Files:**
- Apply via Supabase MCP, then create: `supabase/migrations/<ts>_receipts_storage.sql`

**Interfaces:**
- Produces: private storage bucket `receipts` with RLS; objects stored under `<owner_id>/<token>.<ext>`.

- [ ] **Step 1: Apply the migration via Supabase MCP**

Use `apply_migration` with name `receipts_storage`:

```sql
-- Private bucket for DuitNow QR payment receipts (sensitive payment screenshots).
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Anyone (incl. guests) may upload a receipt object. Path is unguessable
-- (owner_id/token). Reads are NOT public — staff read via service role / signed
-- URLs generated server-side, so no select policy is granted to anon here.
create policy "receipts_insert_any"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'receipts');

-- Staff may read receipts directly (e.g. for moderation tooling).
create policy "receipts_select_staff"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and public.current_user_role() in ('admin', 'manager', 'staff')
  );
```

- [ ] **Step 2: Verify the bucket exists**

`execute_sql`:

```sql
select id, public from storage.buckets where id = 'receipts';
```

Expected: one row, `public = false`.

- [ ] **Step 3: Save the migration file**

Create `supabase/migrations/<ts>_receipts_storage.sql` with the exact SQL from Step 1.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): private receipts storage bucket + policies"
```

---

## Task 3: Service-role admin client + env

**Files:**
- Create: `lib/supabase/admin.ts`
- Modify: `.env.example`, `.dev.vars.example`

**Interfaces:**
- Produces: `createAdminClient(): SupabaseClient<Database>` — server-only, bypasses RLS.

- [ ] **Step 1: Create the admin client**

Create `lib/supabase/admin.ts`:

```ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Server-only Supabase client using the service-role key. Bypasses RLS, so it
// must NEVER be imported into a client component. Used for actions a guest
// (no auth identity) legitimately needs to perform server-side: inserting their
// own order and reading their own order history scoped by owner_id.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

- [ ] **Step 2: Document the env var**

In `.env.example`, under the Supabase section, add:

```
# Supabase — server-only. NEVER expose to the client. Bypasses RLS.
# Used for guest order writes/reads (guests have no auth identity).
SUPABASE_SERVICE_ROLE_KEY=
```

In `.dev.vars.example`, add the same `SUPABASE_SERVICE_ROLE_KEY=` line.

- [ ] **Step 3: Add the real value locally**

Add `SUPABASE_SERVICE_ROLE_KEY=<value>` to `.env.local` (and `.dev.vars` if used). The value is the project's service-role key from the Supabase dashboard. (Do not commit these files.)

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/admin.ts .env.example .dev.vars.example
git commit -m "feat(supabase): server-only service-role admin client + env"
```

---

## Task 4: Order row↔domain mappers

**Files:**
- Create: `lib/orders/mappers.ts`

**Interfaces:**
- Consumes: `Order`, `OrderLine`, `ItemStatus`, `OrderStatus` from `types/order.ts`; `Tables` from `types/database.ts`.
- Produces:
  - `type OrderRow = Tables<"orders">`
  - `type OrderItemRow = Tables<"order_items">`
  - `rowToOrder(order: OrderRow, items: OrderItemRow[]): Order`
  - `rowToOrderLine(item: OrderItemRow): OrderLine`

- [ ] **Step 1: Write the mappers**

Create `lib/orders/mappers.ts`:

```ts
import type { Tables } from "@/types/database";
import type { Order, OrderLine } from "@/types/order";

export type OrderRow = Tables<"orders">;
export type OrderItemRow = Tables<"order_items">;

// Maps one order_items row to the domain OrderLine. addon_names is never null
// (DB default '{}'), but guard anyway.
export function rowToOrderLine(item: OrderItemRow): OrderLine {
  return {
    name: item.name,
    quantity: item.quantity,
    sizeName: item.size_name ?? undefined,
    addonNames: item.addon_names ?? [],
    unitPrice: item.unit_price,
    lineTotal: item.line_total,
    status: item.status,
  };
}

// Maps an orders row + its item rows to the domain Order. Items are sorted by
// position so the manage screen's itemIndex matches the DB `position`.
export function rowToOrder(order: OrderRow, items: OrderItemRow[]): Order {
  const lines = [...items]
    .sort((a, b) => a.position - b.position)
    .map(rowToOrderLine);
  return {
    token: order.token,
    orderNumber: order.order_number,
    ownerId: order.owner_id,
    status: order.status,
    paymentMethod: order.payment_method,
    items: lines,
    subtotal: order.subtotal,
    total: order.total,
    notes: order.notes ?? undefined,
    proofOfPaymentUrl: order.proof_of_payment_url ?? undefined,
    createdAt: order.created_at,
    completedAt: order.completed_at ?? undefined,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If `order.status`/`item.status` type mismatch with `OrderStatus`/`ItemStatus`, confirm the enum string unions match (they do: both are the same literals).

- [ ] **Step 3: Commit**

```bash
git add lib/orders/mappers.ts
git commit -m "feat(orders): row<->domain mappers"
```

---

## Task 5: Supabase-backed order store (async)

**Files:**
- Modify: `lib/orders/store.ts` (full rewrite)

**Interfaces:**
- Consumes: `createClient` (server), `createAdminClient`, `rowToOrder`, `OrderRow`, `OrderItemRow`.
- Produces (all now **async**, returning Promises):
  - `deriveOrderStatus(items: { status: ItemStatus }[]): OrderStatus` (sync, pure — keep)
  - `createOrder(draft: OrderDraft, opts: { userId: string | null }): Promise<Order>`
  - `getOrderByToken(token: string): Promise<Order | null>`
  - `listOrders(): Promise<Order[]>`
  - `listOrdersFor(ownerId: string | null | undefined, userId: string | null): Promise<Order[]>`
  - `setItemStatus(token: string, itemIndex: number, status: ItemStatus): Promise<Order | null>`
  - `cancelOrder(token: string): Promise<Order | null>`

> Note: `createOrder` and `listOrdersFor` gain parameters; all call sites are updated in later tasks. `deriveOrderStatus` changes so "all done" → `ready` (NOT `completed`).

- [ ] **Step 1: Rewrite the store**

Replace the entire contents of `lib/orders/store.ts` with:

```ts
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rowToOrder, type OrderItemRow } from "@/lib/orders/mappers";
import type { ItemStatus, Order, OrderDraft, OrderStatus } from "@/types/order";

// Supabase-backed order store. Members read/write under RLS via the cookie
// client; guests (no auth identity) go through the service-role admin client in
// these server-only functions. Money is in sen.

// Overall status derived from the drinks. All done -> "ready" (awaiting the
// staff completion confirm); "completed" and "cancelled" are set explicitly by
// their own actions, never derived here.
export function deriveOrderStatus(items: { status: ItemStatus }[]): OrderStatus {
  if (items.length > 0 && items.every((i) => i.status === "done")) {
    return "ready";
  }
  if (items.some((i) => i.status !== "pending")) {
    return "preparing";
  }
  return "pending";
}

// Create an order + its lines. Members: userId is set, insert under RLS via the
// cookie client. Guests: userId is null, insert via the admin client.
export async function createOrder(
  draft: OrderDraft,
  opts: { userId: string | null },
): Promise<Order> {
  const db = opts.userId ? await createClient() : createAdminClient();

  const { data: orderRow, error: orderErr } = await db
    .from("orders")
    .insert({
      user_id: opts.userId,
      owner_id: draft.ownerId,
      payment_method: draft.paymentMethod,
      subtotal: draft.subtotal,
      total: draft.total,
      notes: draft.notes ?? null,
      proof_of_payment_url: draft.proofOfPaymentUrl ?? null,
    })
    .select()
    .single();
  if (orderErr || !orderRow) {
    throw new Error(orderErr?.message ?? "Failed to create order.");
  }

  const itemsPayload = draft.items.map((item, position) => ({
    order_id: orderRow.id,
    position,
    name: item.name,
    quantity: item.quantity,
    size_name: item.sizeName ?? null,
    addon_names: item.addonNames,
    unit_price: item.unitPrice,
    line_total: item.lineTotal,
    status: item.status,
  }));

  const { data: itemRows, error: itemsErr } = await db
    .from("order_items")
    .insert(itemsPayload)
    .select();
  if (itemsErr || !itemRows) {
    throw new Error(itemsErr?.message ?? "Failed to create order items.");
  }

  return rowToOrder(orderRow, itemRows);
}

// Single order by token. Uses the admin client so it works for staff (manage
// link) and guests (their own order detail) alike; the token is the secret.
export async function getOrderByToken(token: string): Promise<Order | null> {
  const db = createAdminClient();
  const { data: orderRow } = await db
    .from("orders")
    .select()
    .eq("token", token)
    .maybeSingle();
  if (!orderRow) return null;

  const { data: itemRows } = await db
    .from("order_items")
    .select()
    .eq("order_id", orderRow.id);
  return rowToOrder(orderRow, (itemRows as OrderItemRow[]) ?? []);
}

// All orders, newest first. Staff board only — callers gate with
// canManageOrders() first. Reads under the caller's RLS (staff role).
export async function listOrders(): Promise<Order[]> {
  const db = await createClient();
  const { data: orderRows, error } = await db
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: false });
  if (error || !orderRows) return [];
  return orderRows.map((row) =>
    rowToOrder(row, (row.order_items as OrderItemRow[]) ?? []),
  );
}

// One customer's orders, newest first. Members match on user_id (RLS-scoped via
// the cookie client); guests match on owner_id via the admin client. A member is
// also shown any guest orders that share this browser's owner_id (carry-over).
export async function listOrdersFor(
  ownerId: string | null | undefined,
  userId: string | null,
): Promise<Order[]> {
  if (!userId && !ownerId) return [];

  const db = createAdminClient();
  let query = db
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: false });

  if (userId && ownerId) {
    query = query.or(`user_id.eq.${userId},owner_id.eq.${ownerId}`);
  } else if (userId) {
    query = query.eq("user_id", userId);
  } else {
    query = query.eq("owner_id", ownerId!);
  }

  const { data: orderRows, error } = await query;
  if (error || !orderRows) return [];
  return orderRows.map((row) =>
    rowToOrder(row, (row.order_items as OrderItemRow[]) ?? []),
  );
}

// Set one drink's status, re-derive the order status, and (when it flips to
// "ready") leave completion to the explicit confirm action. Staff-only; callers
// gate first. Uses the cookie client so the staff RLS update policy applies.
export async function setItemStatus(
  token: string,
  itemIndex: number,
  status: ItemStatus,
): Promise<Order | null> {
  const db = await createClient();

  const { data: orderRow } = await db
    .from("orders")
    .select("id")
    .eq("token", token)
    .maybeSingle();
  if (!orderRow) return null;

  const { data: itemRows } = await db
    .from("order_items")
    .select()
    .eq("order_id", orderRow.id)
    .order("position", { ascending: true });
  if (!itemRows || itemIndex < 0 || itemIndex >= itemRows.length) return null;

  const target = itemRows[itemIndex];
  const { error: updErr } = await db
    .from("order_items")
    .update({ status })
    .eq("id", target.id);
  if (updErr) return null;

  const nextItems = itemRows.map((it, i) =>
    i === itemIndex ? { ...it, status } : it,
  );
  const derived = deriveOrderStatus(nextItems);

  // Re-deriving never sets completed/cancelled. If the order was completed and a
  // drink is reopened, fall back to the derived in-progress status and clear the
  // completion stamp.
  const { error: ordErr } = await db
    .from("orders")
    .update({ status: derived, completed_at: null })
    .eq("id", orderRow.id);
  if (ordErr) return null;

  return getOrderByToken(token);
}

// Explicitly complete an order: set status=completed, stamp completed_at.
// Returns the updated order (or null if unknown). Staff-only.
export async function completeOrder(token: string): Promise<Order | null> {
  const db = await createClient();
  const { error } = await db
    .from("orders")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("token", token);
  if (error) return null;
  return getOrderByToken(token);
}

// Cancel an order outright (manual staff override).
export async function cancelOrder(token: string): Promise<Order | null> {
  const db = await createClient();
  const { error } = await db
    .from("orders")
    .update({ status: "cancelled" })
    .eq("token", token);
  if (error) return null;
  return getOrderByToken(token);
}
```

> This also adds `completeOrder` (used by Task 9's `markReadyAndNotify`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL — call sites still treat these as sync / use old signatures (`createOrder`, `listOrders`, `getOrderByToken`, `listOrdersFor`, `setItemStatus` in checkout action, manage pages, manage actions, profile pages). That is expected; later tasks fix each caller. Note the listed errors.

- [ ] **Step 3: Commit**

```bash
git add lib/orders/store.ts
git commit -m "feat(orders): Supabase-backed async store; ready-on-all-done; completeOrder"
```

---

## Task 6: Telegram "order ready" buyer-facing message

**Files:**
- Modify: `lib/orders/message.ts`

**Interfaces:**
- Consumes: `Order`, `formatPrice`.
- Produces: `buildOrderReadyMessage(order: Order): string`.

- [ ] **Step 1: Add the buyer-facing message builder**

Append to `lib/orders/message.ts` (keep `buildOrderMessage` unchanged):

```ts
// Buyer-facing pickup notice, sent when staff confirm the order is complete.
// Distinct from the staff "NEW ORDER!" format — this reads like a message to
// the customer. Sent to the same Telegram group for now.
export function buildOrderReadyMessage(order: Order): string {
  const itemLines = order.items.map((item) => {
    const options = [item.sizeName, ...item.addonNames]
      .filter(Boolean)
      .join(", ");
    const label = options ? `${item.name} (${options})` : item.name;
    return `• ${item.quantity}x ${label}`;
  });

  const parts = [
    "☕ Your drink is ready!",
    "",
    `Order ${order.orderNumber} is ready for pickup.`,
    "",
    "Items:",
    ...itemLines,
    "",
    "Thank you for ordering with NAISE Coffee — see you at the counter!",
  ];

  return parts.join("\n");
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS for this file (other call-site errors from Task 5 may remain).

- [ ] **Step 3: Commit**

```bash
git add lib/orders/message.ts
git commit -m "feat(orders): buyer-facing order-ready Telegram message"
```

---

## Task 7: Checkout action — server-side identity, guest writes, receipt

**Files:**
- Modify: `app/(customer)/checkout/actions.ts`

**Interfaces:**
- Consumes: `createOrder` (new signature), `createClient` (server), `buildOrderMessage`, `sendTelegramMessage`.
- Produces: `placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>` with `PlaceOrderInput` gaining `proofOfPaymentUrl?: string`.

- [ ] **Step 1: Update the action**

Edit `app/(customer)/checkout/actions.ts`. Add `proofOfPaymentUrl` to the input type, derive the user server-side, and pass `userId` to `createOrder`. Replace the body:

```ts
"use server";

import { createOrder } from "@/lib/orders/store";
import { createClient } from "@/lib/supabase/server";
import { buildOrderMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import type { OrderLine } from "@/types/order";

type PlaceOrderItem = {
  name: string;
  quantity: number;
  sizeName?: string;
  addonNames: string[];
  unitPrice: number;
};

export type PlaceOrderInput = {
  items: PlaceOrderItem[];
  paymentMethod: string;
  notes?: string;
  subtotal: number;
  total: number;
  ownerId: string;
  // Public URL of the uploaded DuitNow QR receipt, if any.
  proofOfPaymentUrl?: string;
};

export type PlaceOrderResult =
  | { ok: true; orderNumber: string }
  | { ok: false; error: string };

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  if (input.items.length === 0) {
    return { ok: false, error: "Your cart is empty." };
  }
  if (!input.ownerId) {
    return { ok: false, error: "Missing session id. Refresh and try again." };
  }

  // Derive identity server-side — never trust a user id from the client.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  const lines: OrderLine[] = input.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    sizeName: item.sizeName,
    addonNames: item.addonNames,
    unitPrice: item.unitPrice,
    lineTotal: item.unitPrice * item.quantity,
    status: "pending",
  }));

  let order;
  try {
    order = await createOrder(
      {
        ownerId: input.ownerId,
        paymentMethod: input.paymentMethod,
        items: lines,
        subtotal: input.subtotal,
        total: input.total,
        notes: input.notes?.trim() || undefined,
        proofOfPaymentUrl: input.proofOfPaymentUrl,
      },
      { userId },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't save your order: ${reason}` };
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const manageUrl = `${baseUrl}/manage/${order.token}`;

  const canUseButton = /^https:\/\//i.test(manageUrl) && !isLocalUrl(manageUrl);
  const message = buildOrderMessage(order, manageUrl, !canUseButton);

  try {
    await sendTelegramMessage(
      message,
      canUseButton
        ? { buttons: [[{ text: "📋 Manage Order", url: manageUrl }]] }
        : {},
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't notify the store: ${reason}` };
  }

  return { ok: true, orderNumber: order.orderNumber };
}

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    );
  } catch {
    return true;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: checkout action errors resolved; remaining errors only in manage pages/actions and profile pages (fixed later) plus `checkout-screen.tsx` (Task 8, not yet passing `proofOfPaymentUrl` — but that field is optional, so no new error). 

- [ ] **Step 3: Commit**

```bash
git add app/(customer)/checkout/actions.ts
git commit -m "feat(checkout): derive user_id server-side, guest writes, receipt url"
```

---

## Task 8: Checkout screen — DuitNow QR receipt upload

**Files:**
- Create: `lib/orders/receipt.ts`
- Modify: `components/checkout-screen.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: browser `createClient`, `getOrCreateOwnerId`.
- Produces: `uploadReceipt(file: File, ownerId: string): Promise<string>` (returns public URL — note: bucket is private, so this returns a path; see Step 1).

> Decision: the `receipts` bucket is private, so a plain public URL won't load. To keep `next/image` working in `ReceiptModal`, store a **signed URL** generated at upload time with a long expiry (7 days) for now. This is the smallest working version; a later task can move to on-demand signing in the server render. Record this in the order's `proof_of_payment_url`.

- [ ] **Step 1: Create the upload helper**

Create `lib/orders/receipt.ts`:

```ts
import { createClient } from "@/lib/supabase/client";

// Uploads a DuitNow QR payment receipt to the private `receipts` bucket and
// returns a signed URL (valid 7 days) for display in the manage/customer views.
// Path is `<ownerId>/<random>.<ext>` — unguessable and grouped per browser.
export async function uploadReceipt(
  file: File,
  ownerId: string,
): Promise<string> {
  const supabase = createClient();
  const ext = extensionFor(file.type);
  const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("receipts")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (uploadError) throw uploadError;

  const { data, error: signError } = await supabase.storage
    .from("receipts")
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signError || !data) {
    throw signError ?? new Error("Could not sign receipt URL.");
  }
  return data.signedUrl;
}

function extensionFor(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}
```

- [ ] **Step 2: Allow the Supabase image host in next.config**

Replace `next.config.ts` with:

```ts
import type { NextConfig } from "next";
import path from "node:path";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/**" }]
      : [],
  },
};

export default nextConfig;
```

- [ ] **Step 3: Add the receipt picker to checkout**

In `components/checkout-screen.tsx`:

1. Add imports near the others:

```ts
import { uploadReceipt } from "@/lib/orders/receipt";
```

2. Add state next to the existing `useState` declarations (after `error`):

```ts
  // DuitNow QR receipt: the picked file (held until place) and any upload error.
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
```

3. In `placeOrder()`, after the Beans re-validation block and before `setSubmitting(true)`, add a guard requiring a receipt for DuitNow QR:

```ts
    if (selected === "duitnow-qr" && !receiptFile) {
      setError("Please attach your DuitNow QR payment receipt.");
      return;
    }
```

4. Inside the `try` block, before calling `placeOrderAction`, upload the receipt when present:

```ts
      let proofOfPaymentUrl: string | undefined;
      if (selected === "duitnow-qr" && receiptFile) {
        proofOfPaymentUrl = await uploadReceipt(receiptFile, getOrCreateOwnerId());
      }
```

5. Pass it into the `placeOrderAction({ ... })` call by adding the field:

```ts
        proofOfPaymentUrl,
```

6. Render the picker only when DuitNow QR is selected. Place it directly above the Place Order button area (match the existing card styling — `rounded-2xl`, `bg-neutral-50`, etc.). Insert this block where the payment section renders the selected method details:

```tsx
{selected === "duitnow-qr" && (
  <div className="mt-4 flex flex-col gap-2 rounded-2xl bg-neutral-50 px-4 py-3">
    <label
      htmlFor="receipt"
      className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
    >
      Payment Receipt
    </label>
    <input
      id="receipt"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
      className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-black file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-white"
    />
    {receiptFile && (
      <span className="truncate text-xs text-muted-foreground">
        {receiptFile.name}
      </span>
    )}
  </div>
)}
```

> Exact insertion point: render this inside the payment-method section, after the method cards and before the totals/place-order footer. The implementer should match surrounding indentation and not alter other markup.

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: checkout-screen and receipt errors resolved.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS (validates next.config images + server/client boundaries).

- [ ] **Step 6: Manual browser check**

Run `npm run dev`. Add an item, go to checkout, select **DuitNow QR** → the receipt picker appears; other methods → no picker. Try placing DuitNow QR with no file → inline error. (Full end-to-end placement is verified in Task 13.)

- [ ] **Step 7: Commit**

```bash
git add lib/orders/receipt.ts components/checkout-screen.tsx next.config.ts
git commit -m "feat(checkout): DuitNow QR receipt upload + supabase image host"
```

---

## Task 9: Manage actions — async, markReadyAndNotify

**Files:**
- Modify: `app/(admin)/manage/actions.ts`

**Interfaces:**
- Consumes: `setItemStatus`, `cancelOrder`, `completeOrder`, `getOrderByToken` (all async), `canManageOrders`, `buildOrderReadyMessage`, `sendTelegramMessage`.
- Produces:
  - `updateDrinkStatus(token, itemIndex, status): Promise<OrderActionResult>`
  - `cancelOrderAction(token): Promise<OrderActionResult>`
  - `markReadyAndNotify(token): Promise<OrderActionResult>`

- [ ] **Step 1: Rewrite the actions**

Replace `app/(admin)/manage/actions.ts` with:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { canManageOrders } from "@/lib/auth/session";
import {
  cancelOrder,
  completeOrder,
  getOrderByToken,
  setItemStatus,
} from "@/lib/orders/store";
import { buildOrderReadyMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import type { ItemStatus, OrderStatus } from "@/types/order";

export type OrderActionResult =
  | { ok: true; orderStatus: OrderStatus }
  | { ok: false; error: string };

// Persist a single drink's fulfilment status. When all drinks are done the store
// derives status "ready"; the client then opens the completion modal, which
// calls markReadyAndNotify on confirm.
export async function updateDrinkStatus(
  token: string,
  itemIndex: number,
  status: ItemStatus,
): Promise<OrderActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const updated = await setItemStatus(token, itemIndex, status);
  if (!updated) return { ok: false, error: "Order not found." };

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: updated.status };
}

// Confirm completion: mark the order completed and send the buyer the ready
// notice over Telegram. Called from the completion modal's confirm button.
export async function markReadyAndNotify(
  token: string,
): Promise<OrderActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const order = await getOrderByToken(token);
  if (!order) return { ok: false, error: "Order not found." };

  try {
    await sendTelegramMessage(buildOrderReadyMessage(order));
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't notify the buyer: ${reason}` };
  }

  const completed = await completeOrder(token);
  if (!completed) return { ok: false, error: "Could not complete the order." };

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: completed.status };
}

// Cancel the whole order (manual override).
export async function cancelOrderAction(
  token: string,
): Promise<OrderActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const updated = await cancelOrder(token);
  if (!updated) return { ok: false, error: "Order not found." };

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: updated.status };
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: this file passes; remaining errors only in manage pages and profile pages (next tasks).

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/manage/actions.ts
git commit -m "feat(manage): async actions + markReadyAndNotify (buyer notice)"
```

---

## Task 10: Completion modal + drink-row undo removal + auto-open

**Files:**
- Create: `components/order-complete-modal.tsx`
- Modify: `components/drink-row.tsx`
- Modify: `components/order-detail.tsx`

**Interfaces:**
- Consumes: `markReadyAndNotify`, `updateDrinkStatus` (manage actions).
- Produces: `OrderCompleteModal` component; `DrinkRow` with no `onReset`.

- [ ] **Step 1: Remove undo from DrinkRow**

Edit `components/drink-row.tsx`:

1. Remove `onReset` from the props type and the destructured params.
2. Remove the `RotateCcw` import (keep `Check`, `ChevronLeft`, `ChevronRight`).
3. Remove `const canReset = status !== "pending";`.
4. In `onPointerMove`, remove the `if (clamped > 0 && !canReset) return;` line and prevent right-drag entirely: after computing `clamped`, add `if (clamped > 0) return;` (only left-swipe-to-advance remains).
5. In `onPointerUp`, remove the `else if (dragX >= SWIPE_THRESHOLD && canReset) { onReset(); }` branch.
6. Remove the entire left-side "Undo" hint `<span>` (the one with `RotateCcw` + "Undo") from the action-hints overlay.
7. Remove the `canReset && (<button ... onReset ...>)` undo button block from the right-side controls.

The forward swipe/tap (`onAdvance`) and the done check icon remain unchanged.

- [ ] **Step 2: Create the completion modal**

Create `components/order-complete-modal.tsx`:

```tsx
"use client";

import { useEffect } from "react";

// Auto-opens when the last drink is marked done. Confirm sends the buyer the
// "ready" notice and completes the order; Cancel reverts the just-completed
// drink back to "preparing" so nothing is sent.
export function OrderCompleteModal({
  orderNumber,
  busy,
  onConfirm,
  onCancel,
}: {
  orderNumber: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [busy, onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Complete order ${orderNumber}`}
      onClick={() => !busy && onCancel()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-white p-6 naise-pop"
      >
        <div className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
            All drinks ready
          </span>
          <h2 className="font-heading text-xl font-bold tracking-tight tabular-nums">
            Complete {orderNumber}?
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This marks the order complete and notifies the buyer that their
            order is ready for pickup.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-full bg-neutral-100 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-neutral-200 disabled:opacity-50 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-full bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {busy ? "Notifying…" : "Complete & notify"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the modal into OrderDetail**

Edit `components/order-detail.tsx`:

1. Add imports:

```ts
import { markReadyAndNotify } from "@/app/(admin)/manage/actions";
import { OrderCompleteModal } from "@/components/order-complete-modal";
```

2. Add state for the modal, the just-completed index, and busy flag (near the other `useState`s):

```ts
  const [showComplete, setShowComplete] = useState(false);
  const [lastDoneIndex, setLastDoneIndex] = useState<number | null>(null);
  const [completing, setCompleting] = useState(false);
```

3. In `applyStatus`, detect the transition into all-done and open the modal. Replace the existing `nowAllDone` block with:

```ts
    const nowAllDone = next.length > 0 && next.every((s) => s === "done");
    setCompletedAt((prev) =>
      nowAllDone ? (prev ?? new Date().toISOString()) : undefined,
    );
    // Auto-open the completion modal the moment the last drink turns done, but
    // only for real (persisted) orders that aren't already completed.
    if (nowAllDone && status === "done") {
      setLastDoneIndex(index);
      setShowComplete(true);
    }
```

4. Add the confirm/cancel handlers before the `return`:

```ts
  function confirmComplete() {
    setCompleting(true);
    startTransition(async () => {
      if (persist) await markReadyAndNotify(order.token);
      setCompleting(false);
      setShowComplete(false);
    });
  }

  // Cancel reverts the drink that just completed back to "preparing", so the
  // order leaves "ready" and no notice is sent.
  function cancelComplete() {
    setShowComplete(false);
    if (lastDoneIndex !== null) applyStatus(lastDoneIndex, "preparing");
    setLastDoneIndex(null);
  }
```

5. Render the modal at the end of the component (before the closing `</main>` or alongside the receipt modal):

```tsx
      {showComplete && (
        <OrderCompleteModal
          orderNumber={order.orderNumber}
          busy={completing}
          onConfirm={confirmComplete}
          onCancel={cancelComplete}
        />
      )}
```

6. Remove the `onReset={() => applyStatus(i, "pending")}` prop from the `<DrinkRow ... />` usage (DrinkRow no longer accepts it).

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS for these files.

- [ ] **Step 5: Manual browser check (mock harness)**

Run `npm run dev`, open `/manage/test`. Advance every drink to done by tapping the chevron. When the **last** drink turns done, the completion modal **auto-opens**. Click **Cancel** → modal closes and the last drink returns to "Making" (preparing). Advance it again → modal reopens → **Complete & notify** → modal closes (no Telegram on the test page since `persist={false}`). Confirm there is no longer any undo button or right-swipe.

- [ ] **Step 6: Commit**

```bash
git add components/order-complete-modal.tsx components/drink-row.tsx components/order-detail.tsx
git commit -m "feat(manage): auto-open completion modal; remove per-drink undo"
```

---

## Task 11: Manage pages — real data + staff realtime

**Files:**
- Create: `components/manage-orders-live.tsx`
- Modify: `app/(admin)/manage/page.tsx`
- Modify: `app/(admin)/manage/[token]/page.tsx`
- Create: `lib/orders/realtime.ts`

**Interfaces:**
- Consumes: browser `createClient`, `useRouter`.
- Produces:
  - `subscribeToOrders(onChange: () => void): () => void` (staff Postgres Changes)
  - `subscribeToOrderBroadcast(token: string, onChange: () => void): () => void` (customer broadcast)
  - `ManageOrdersLive` wrapper component.

- [ ] **Step 1: Create realtime helpers**

Create `lib/orders/realtime.ts`:

```ts
"use client";

import { createClient } from "@/lib/supabase/client";

// Staff board/detail: refetch whenever any order or order_item row changes.
// RLS on the tables restricts what staff actually receive.
export function subscribeToOrders(onChange: () => void): () => void {
  const supabase = createClient();
  const channel = supabase
    .channel("manage-orders")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders" },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_items" },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// Customer tracking (guest or member): listen on the per-order broadcast topic
// keyed by the unguessable token.
export function subscribeToOrderBroadcast(
  token: string,
  onChange: () => void,
): () => void {
  const supabase = createClient();
  const channel = supabase
    .channel(`order:${token}`, { config: { private: true } })
    .on("broadcast", { event: "*" }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
```

- [ ] **Step 2: Create the live board wrapper**

Create `components/manage-orders-live.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ManageOrdersScreen } from "@/components/manage-orders-screen";
import { subscribeToOrders } from "@/lib/orders/realtime";
import type { Order } from "@/types/order";

// Renders the staff board and refreshes server data when any order changes.
export function ManageOrdersLive({ orders }: { orders: Order[] }) {
  const router = useRouter();
  useEffect(() => subscribeToOrders(() => router.refresh()), [router]);
  return <ManageOrdersScreen orders={orders} />;
}
```

- [ ] **Step 3: Update the board page to real data + live**

Replace `app/(admin)/manage/page.tsx` body so it awaits `listOrders()` and renders the live wrapper:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canManageOrders } from "@/lib/auth/session";
import { listOrders } from "@/lib/orders/store";
import { ManageOrdersLive } from "@/components/manage-orders-live";

export const metadata: Metadata = {
  title: "Manage Orders",
  robots: { index: false, follow: false },
};

export default async function ManageOrdersPage() {
  if (!(await canManageOrders())) redirect("/");
  const orders = await listOrders();
  return <ManageOrdersLive orders={orders} />;
}
```

- [ ] **Step 4: Update the detail page to await getOrderByToken**

In `app/(admin)/manage/[token]/page.tsx`, change the lookup to await:

```ts
  const order = await getOrderByToken(token);
```

(Everything else in that file stays — the not-found block and `<OrderDetail order={order} />`. `OrderDetail` already subscribes via its own client; staff live updates on the detail are covered by the board refresh + the detail's optimistic updates. No further change needed here.)

- [ ] **Step 5: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/(admin)/manage/page.tsx "app/(admin)/manage/[token]/page.tsx" components/manage-orders-live.tsx lib/orders/realtime.ts
git commit -m "feat(manage): real data + staff realtime board"
```

---

## Task 12: Customer order pages — real data + live tracking

**Files:**
- Create: `components/customer-order-live.tsx`
- Modify: `app/(customer)/profile/orders/page.tsx`
- Modify: `app/(customer)/profile/orders/[token]/page.tsx`

**Interfaces:**
- Consumes: `listOrdersFor` (new signature), `getOrderByToken`, `getOwnerIdFromCookie`, `createClient` (server, for user), `subscribeToOrderBroadcast`.
- Produces: `CustomerOrderLive` wrapper.

- [ ] **Step 1: Create the customer live wrapper**

Create `components/customer-order-live.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CustomerOrderDetail } from "@/components/customer-order-detail";
import { subscribeToOrderBroadcast } from "@/lib/orders/realtime";
import type { Order } from "@/types/order";

// Customer-facing live tracking: refresh server data when the order's status is
// broadcast on its per-order topic. Works for guests and members alike.
export function CustomerOrderLive({
  order,
  backHref,
}: {
  order: Order;
  backHref: string;
}) {
  const router = useRouter();
  useEffect(
    () => subscribeToOrderBroadcast(order.token, () => router.refresh()),
    [order.token, router],
  );
  return <CustomerOrderDetail order={order} backHref={backHref} />;
}
```

- [ ] **Step 2: Update the orders list page**

Replace `app/(customer)/profile/orders/page.tsx` data lookup. Add the user lookup and pass both ids to `listOrdersFor`:

```ts
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listOrdersFor } from "@/lib/orders/store";
import { getOwnerIdFromCookie } from "@/lib/auth/owner-id-server";
import { createClient } from "@/lib/supabase/server";
import { CustomerOrderCard } from "@/components/customer-order-card";

export const metadata: Metadata = {
  title: "Your Orders",
  description: "Your full order history at Naise Coffee.",
};

export default async function ProfileOrdersPage() {
  const ownerId = await getOwnerIdFromCookie();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const orders = await listOrdersFor(ownerId, user?.id ?? null);

  return (
    // ...existing JSX unchanged...
  );
}
```

> Keep the existing JSX (header + empty state + list) exactly as-is; only the data-fetching lines above change.

- [ ] **Step 3: Update the order detail page**

In `app/(customer)/profile/orders/[token]/page.tsx`:

1. Change the lookup to await:

```ts
  const order = await getOrderByToken(token);
```

2. Swap the success render to the live wrapper. Replace the import:

```ts
import { CustomerOrderLive } from "@/components/customer-order-live";
```

and the final return:

```tsx
  return <CustomerOrderLive order={order} backHref={backHref} />;
```

(The not-found block stays unchanged.)

- [ ] **Step 4: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. This should clear the last of the Task 5 call-site errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(customer)/profile/orders/page.tsx" "app/(customer)/profile/orders/[token]/page.tsx" components/customer-order-live.tsx
git commit -m "feat(profile): real order history + live order tracking"
```

---

## Task 13: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck/lint/build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all PASS, no references to the removed in-memory seeds.

- [ ] **Step 2: Guest order flow**

`npm run dev`, in a normal browser window (signed out): add items, checkout with a **non-Cash** method (Cash is members-only), place the order. Expected: confirmation screen with an order number; the team Telegram gets "NEW ORDER!". In `/profile/orders` (same browser) the order appears.

Verify in DB via MCP `execute_sql`:

```sql
select order_number, user_id, owner_id, status from public.orders
order by created_at desc limit 3;
```

Expected: newest row has `user_id = null`, `owner_id` set, `status = pending`.

- [ ] **Step 3: Member order flow + carry-over**

Sign in with Google, place an order (try **DuitNow QR**: attach a receipt image). Expected: order saved with `user_id` set and `proof_of_payment_url` populated; appears in history. A prior guest order from the same browser still appears (owner_id carry-over).

- [ ] **Step 4: Staff fulfilment + live + notify**

As a staff/admin account, open `/manage` (board shows real orders). Open one order. In a second browser, open that order's customer tracking page (`/profile/orders/<token>`) as the buyer. Advance each drink on `/manage/<token>`. Expected: the customer page status updates live (pending → in progress). On the **last** drink → done, the completion modal auto-opens. Click **Complete & notify**. Expected: order → completed, buyer-facing "☕ Your drink is ready!" message in Telegram, and the customer page flips to completed live. Re-open another order, reach the modal, click **Cancel** → last drink reverts to preparing, no Telegram sent.

- [ ] **Step 5: RLS checks**

- As a signed-out/customer account, navigate to `/manage` → redirected to `/`.
- Via MCP, confirm a member cannot read another member's order (the RLS select policy). Spot-check:

```sql
select count(*) from public.orders;
```

(Confirms rows exist; detailed RLS is enforced by policy definitions from Task 1.)

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test: verify ordering system end to end"
```

---

## Self-Review Notes (addressed)

- **Spec coverage:** ownership (T5/T7), lookup by token (T5), guests+members (T5/T7/T12), real `/manage` + `/manage/[token]` (T11), real customer history/detail (T12), auto-modal completion replacing undo (T10), buyer-facing Telegram (T6/T9), DuitNow-only receipt (T8), realtime staff + customer (T11/T12), RLS (T1), storage (T2), service-role client (T3), schema/sen/money (T1) — all mapped.
- **No unit-test runner:** intentionally substituted typecheck/lint/build/SQL/manual checks, per Global Constraints (adding a framework would violate AGENTS.md "ask before new libraries").
- **Type consistency:** store functions are async with the exact signatures consumed in T7/T9/T11/T12; `completeOrder` defined in T5 and used in T9; `markReadyAndNotify`/`updateDrinkStatus` used in T10; `subscribeToOrders`/`subscribeToOrderBroadcast` defined in T11 and used in T11/T12.
- **Known follow-ups (not blocking):** signed receipt URLs expire after 7 days (acceptable first version; on-demand signing can replace it later); `ready` status maps into the "In Progress" filter on the board, which matches its short-lived staff-only meaning.
```
