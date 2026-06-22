# Custom Drink / Custom Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin place a one-off "custom order" made of custom drinks (name + admin-set price), persisted through the normal order pipeline, tagged as custom everywhere, with auto-saved quick-select presets.

**Architecture:** Adds an `is_custom` flag to `order_items`, a `'custom'` value to the `order_source` enum, and a `custom_drinks` presets table. A new admin-gated route `(customer)/custom-order` builds an `OrderDraft` (source `custom`, every line `isCustom`) and reuses the existing `createOrder` pipeline, then upserts presets via a SECURITY DEFINER RPC. Reports gain a custom source split and a "Top custom drinks" panel; the dashboard best-seller list excludes custom items; order detail shows a "Custom" badge per line.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), TypeScript (strict, no `any`), Tailwind, shadcn/ui, Supabase (Postgres + RLS + RPC). Money is stored in **sen** (1 MYR = 100 sen).

## Global Constraints

- Money is stored as integers in **sen**; admin enters MYR, client converts ×100 before sending.
- TypeScript strict mode, **no `any`**.
- All privileged writes are **admin-gated** in server code AND backed by RLS (`current_user_role() = 'admin'`).
- `orders.owner_id` is NOT NULL with a UUID-format CHECK — sentinel owner ids must be valid UUIDs.
- Do not add new libraries. There is no test runner; verify with `npx tsc --noEmit`, `npm run lint`, `npm run build`, and the manual steps in each task.
- Follow existing patterns: SECURITY DEFINER RPCs pin `search_path = ''` and are `revoke ... from public, anon; grant ... to authenticated` (mirror `supabase/migrations/20260620110000_admin_phase3_rpcs.sql`).
- Migrations are versioned files in `supabase/migrations/` named `YYYYMMDDHHMMSS_*.sql`.

---

### Task 1: Data-model migrations + regenerated DB types

**Files:**
- Create: `supabase/migrations/20260622130000_order_items_is_custom.sql`
- Create: `supabase/migrations/20260622130100_order_source_custom.sql`
- Create: `supabase/migrations/20260622130200_custom_drinks.sql`
- Modify: `types/database.ts` (regenerated)

**Interfaces:**
- Produces (DB): `order_items.is_custom boolean`; `order_source` enum value `'custom'`; table `public.custom_drinks`; RPC `public.record_custom_drinks(p_drinks jsonb) returns void`.
- Produces (TS): regenerated `types/database.ts` with the new column, enum value, and `custom_drinks` table so `Tables<"custom_drinks">` resolves.

- [ ] **Step 1: Write the `is_custom` column migration**

Create `supabase/migrations/20260622130000_order_items_is_custom.sql`:

```sql
-- Per-line "custom drink" flag. A custom drink is a one-off line an admin enters
-- with a hand-set price; it has no product_id (order_items never had one). This
-- flag lets reports rank custom drinks by name and tell them apart from menu
-- items. Backfills false for existing rows.
alter table public.order_items
  add column is_custom boolean not null default false;

comment on column public.order_items.is_custom is
  'True when this line is an admin-entered custom drink (no menu product).';
```

- [ ] **Step 2: Write the enum-value migration (separate file)**

`ALTER TYPE ... ADD VALUE` must be committed before the value is used. Keep it in its own migration so no later statement in the same transaction references it. Create `supabase/migrations/20260622130100_order_source_custom.sql`:

```sql
-- Third order channel: admin-placed custom orders. Joins 'online' (storefront)
-- and 'store' (in-store kiosk). Drives the source split in reports/dashboard.
alter type public.order_source add value if not exists 'custom';
```

- [ ] **Step 3: Write the `custom_drinks` table + RLS + RPC migration**

Create `supabase/migrations/20260622130200_custom_drinks.sql`:

```sql
-- Quick-select presets for admin custom orders. Auto-populated when a custom
-- order is placed: each distinct drink name is remembered with its last price
-- and a usage counter so the picker can surface the most-used first. This is
-- also a small analytics signal ("which off-menu drinks recur?").
create table public.custom_drinks (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  last_price   integer not null,            -- sen
  times_used   integer not null default 0,
  last_used_at timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.custom_drinks is
  'Admin custom-drink presets (quick select). Money in sen.';

-- Case-insensitive uniqueness so "Iced Gula Melaka" and "iced gula melaka"
-- collapse into one preset. This expression index is also the ON CONFLICT target
-- used by record_custom_drinks below.
create unique index custom_drinks_name_lower_key
  on public.custom_drinks (lower(name));

-- Picker ordering: most-used, then most-recent.
create index custom_drinks_rank_idx
  on public.custom_drinks (times_used desc, last_used_at desc);

create trigger custom_drinks_set_updated_at
  before update on public.custom_drinks
  for each row execute function public.set_updated_at();

alter table public.custom_drinks enable row level security;

-- Admin-only across the board (matches the admin-only Custom Order screen).
create policy "custom_drinks_select_admin"
  on public.custom_drinks for select
  to authenticated
  using (public.current_user_role() = 'admin');

create policy "custom_drinks_write_admin"
  on public.custom_drinks for all
  to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- Upsert a batch of custom drinks placed in one order. p_drinks is a JSON array
-- of { "name": text, "price": int(sen) }. SECURITY DEFINER so it can write the
-- usage counter regardless of caller RLS, but it gates on the admin role and is
-- granted to authenticated only. search_path pinned. Mirrors the phase-3 RPCs.
create or replace function public.record_custom_drinks(p_drinks jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d jsonb;
  v_name text;
  v_price integer;
begin
  if public.current_user_role() is distinct from 'admin' then
    raise exception 'NOT_ADMIN';
  end if;

  for d in select * from jsonb_array_elements(coalesce(p_drinks, '[]'::jsonb))
  loop
    v_name := btrim(d->>'name');
    v_price := (d->>'price')::integer;
    if v_name = '' or v_price is null or v_price <= 0 then
      continue;
    end if;

    insert into public.custom_drinks (name, last_price, times_used, last_used_at, created_by)
    values (v_name, v_price, 1, now(), (select auth.uid()))
    on conflict (lower(name)) do update
      set last_price   = excluded.last_price,
          times_used   = public.custom_drinks.times_used + 1,
          last_used_at = now();
  end loop;
end;
$$;

revoke execute on function public.record_custom_drinks(jsonb) from public, anon;
grant execute on function public.record_custom_drinks(jsonb) to authenticated;
```

- [ ] **Step 4: Apply the migrations**

Use the project's Supabase workflow. With the linked CLI:

Run: `npx supabase db push`
Expected: the three new migrations apply with no error.

(If the project applies migrations via the Supabase MCP instead, apply each file's SQL in order: `20260622130000`, then `20260622130100`, then `20260622130200`.)

- [ ] **Step 5: Regenerate DB types**

Run: `npx supabase gen types typescript --linked > types/database.ts`
Expected: `types/database.ts` now contains `is_custom` on `order_items`, `'custom'` in the `order_source` union, and a `custom_drinks` table.

Verify:

Run: `git diff --stat types/database.ts`
Expected: file shows additions for the column, enum value, and table.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260622130000_order_items_is_custom.sql \
        supabase/migrations/20260622130100_order_source_custom.sql \
        supabase/migrations/20260622130200_custom_drinks.sql \
        types/database.ts
git commit -m "feat(custom-order): db schema — is_custom, custom source, presets table"
```

---

### Task 2: Domain types + order pipeline plumbing

**Files:**
- Modify: `types/order.ts` (`OrderLine`, `Order.source`)
- Modify: `lib/orders/store.ts:57-69` (createOrder insert payload)
- Modify: `lib/orders/mappers.ts:9-19` (rowToOrderLine)

**Interfaces:**
- Consumes: `Tables<"order_items">` now has `is_custom` (Task 1).
- Produces: `OrderLine.isCustom?: boolean`; `Order.source` / `OrderDraft.source` union includes `"custom"`; `createOrder` persists `is_custom`; `rowToOrderLine` returns `isCustom`.

- [ ] **Step 1: Add `isCustom` to `OrderLine` and `'custom'` to the source union**

In `types/order.ts`, add to `OrderLine` (after the `rewardCost?` line, before the closing `};` at line 30):

```ts
  // True when this line is an admin-entered custom drink (no menu product).
  // Maps to order_items.is_custom; drives the "Custom" badge and custom-drink
  // analytics.
  isCustom?: boolean;
```

Then change the `source` field (line 68) from:

```ts
  source?: "online" | "store";
```

to:

```ts
  source?: "online" | "store" | "custom";
```

- [ ] **Step 2: Persist `is_custom` in `createOrder`**

In `lib/orders/store.ts`, in the `itemsPayload` map (lines 57-69), add the field after `reward_cost`:

```ts
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
    is_reward: item.isReward ?? false,
    reward_cost: item.rewardCost ?? 0,
    is_custom: item.isCustom ?? false,
  }));
```

- [ ] **Step 3: Map `is_custom` back in `rowToOrderLine`**

In `lib/orders/mappers.ts`, in `rowToOrderLine` (lines 9-19), add the field to the returned object:

```ts
export function rowToOrderLine(item: OrderItemRow): OrderLine {
  return {
    name: item.name,
    quantity: item.quantity,
    sizeName: item.size_name ?? undefined,
    addonNames: item.addon_names ?? [],
    unitPrice: item.unit_price,
    lineTotal: item.line_total,
    status: item.status,
    isCustom: item.is_custom,
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add types/order.ts lib/orders/store.ts lib/orders/mappers.ts
git commit -m "feat(custom-order): plumb isCustom + custom source through order types"
```

---

### Task 3: Constant + presets reader + place-custom-order action

**Files:**
- Create: `constants/custom-order.ts`
- Create: `types/custom-order.ts`
- Create: `lib/custom-order/presets.ts`
- Create: `app/(customer)/custom-order/actions.ts`

**Interfaces:**
- Consumes: `createOrder` (Task 2), `isAdmin()` from `lib/auth/session`, `getPaymentSettings()` from `lib/settings/payments`, `buildOrderMessage`/`sendTelegramMessage`, `record_custom_drinks` RPC (Task 1).
- Produces:
  - `CUSTOM_OWNER_ID: string`
  - `CustomDrinkPreset = { id: string; name: string; lastPrice: number }` (lastPrice in sen)
  - `getCustomDrinkPresets(limit?: number): Promise<CustomDrinkPreset[]>`
  - `placeCustomOrder(input: PlaceCustomOrderInput): Promise<PlaceCustomOrderResult>` where
    `PlaceCustomOrderInput = { items: { name: string; unitPrice: number; quantity: number }[]; paymentMethod: "cash" | "duitnow-qr"; notes?: string }` (unitPrice in sen)
    and `PlaceCustomOrderResult = { ok: true; orderNumber: string } | { ok: false; error: string }`.

- [ ] **Step 1: Add the sentinel owner id constant**

Create `constants/custom-order.ts`:

```ts
// owner_id stamped on every admin custom order. Like STORE_OWNER_ID, orders.owner_id
// is NOT NULL with a UUID-format CHECK, so this must be a valid UUID. Custom orders
// have no per-customer identity; they share this fixed sentinel, distinct from the
// kiosk's STORE_OWNER_ID so the two channels never collide.
export const CUSTOM_OWNER_ID = "00000000-0000-4000-8000-000000005703";
```

- [ ] **Step 2: Add the preset type**

Create `types/custom-order.ts`:

```ts
// A saved custom-drink preset for the quick-select picker. lastPrice is in sen.
export type CustomDrinkPreset = {
  id: string;
  name: string;
  lastPrice: number;
};
```

- [ ] **Step 3: Add the presets reader**

Create `lib/custom-order/presets.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { CustomDrinkPreset } from "@/types/custom-order";

// Quick-select presets for the custom-order screen, most-used first. Reads under
// the caller's RLS (admin-only select policy) — callers gate with isAdmin() first.
export async function getCustomDrinkPresets(
  limit = 24,
): Promise<CustomDrinkPreset[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("custom_drinks")
    .select("id, name, last_price")
    .order("times_used", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map((r) => ({ id: r.id, name: r.name, lastPrice: r.last_price }));
}
```

- [ ] **Step 4: Add the place-custom-order server action**

Create `app/(customer)/custom-order/actions.ts`:

```ts
"use server";

import { createOrder } from "@/lib/orders/store";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";
import { getPaymentSettings } from "@/lib/settings/payments";
import { buildOrderMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import type { OrderLine } from "@/types/order";
import { CUSTOM_OWNER_ID } from "@/constants/custom-order";

type CustomOrderItem = { name: string; unitPrice: number; quantity: number };

export type PlaceCustomOrderInput = {
  items: CustomOrderItem[];
  paymentMethod: "cash" | "duitnow-qr";
  notes?: string;
};

export type PlaceCustomOrderResult =
  | { ok: true; orderNumber: string }
  | { ok: false; error: string };

export async function placeCustomOrder(
  input: PlaceCustomOrderInput,
): Promise<PlaceCustomOrderResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };

  // Validate lines: non-empty name, positive integer price (sen), qty >= 1.
  const items = input.items
    .map((i) => ({
      name: i.name.trim(),
      unitPrice: Math.round(i.unitPrice),
      quantity: Math.floor(i.quantity),
    }))
    .filter((i) => i.name !== "" && i.unitPrice > 0 && i.quantity >= 1);
  if (items.length === 0) return { ok: false, error: "Add at least one custom drink." };

  // The chosen method must be enabled server-side (same gate as store orders).
  const payments = await getPaymentSettings();
  const cashOk = payments.categories.cash && payments.methods.cash;
  const qrOk = payments.categories.qr && payments.methods["duitnow-qr"];
  if (input.paymentMethod === "cash" && !cashOk)
    return { ok: false, error: "Cash is not available." };
  if (input.paymentMethod === "duitnow-qr" && !qrOk)
    return { ok: false, error: "QR is not available." };

  const lines: OrderLine[] = items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    addonNames: [],
    unitPrice: item.unitPrice,
    lineTotal: item.unitPrice * item.quantity,
    status: "pending",
    isCustom: true,
  }));
  const total = lines.reduce((s, l) => s + l.lineTotal, 0);

  let order;
  try {
    order = await createOrder(
      {
        ownerId: CUSTOM_OWNER_ID,
        paymentMethod: input.paymentMethod,
        items: lines,
        subtotal: total,
        total,
        notes: input.notes?.trim() || undefined,
        source: "custom",
      },
      { userId: null },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't save the order: ${reason}` };
  }

  // Auto-save presets (best-effort — the order is already saved). Admin-gated RPC.
  try {
    const db = await createClient();
    await db.rpc("record_custom_drinks", {
      p_drinks: items.map((i) => ({ name: i.name, price: i.unitPrice })),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.error(`Custom order ${order.orderNumber} saved but preset upsert failed: ${reason}`);
  }

  // Notify staff (best-effort), mirroring placeStoreOrder.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const manageUrl = `${baseUrl}/manage/${order.token}`;
  const canUseButton = /^https:\/\//i.test(manageUrl) && !/localhost|127\.0\.0\.1/.test(manageUrl);
  try {
    await sendTelegramMessage(
      buildOrderMessage(order, manageUrl, !canUseButton),
      canUseButton ? { buttons: [[{ text: "📋 Manage Order", url: manageUrl }]] } : {},
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.error(`Custom order ${order.orderNumber} placed but Telegram notice failed: ${reason}`);
  }

  return { ok: true, orderNumber: order.orderNumber };
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (If `createClient().rpc` rejects the args type, confirm Task 1 Step 5 regenerated `types/database.ts` with `record_custom_drinks`.)

- [ ] **Step 6: Commit**

```bash
git add constants/custom-order.ts types/custom-order.ts lib/custom-order/presets.ts app/(customer)/custom-order/actions.ts
git commit -m "feat(custom-order): owner constant, presets reader, place-order action"
```

---

### Task 4: Custom Order screen, route page, and profile entry point

**Files:**
- Create: `components/custom-order/custom-order-screen.tsx`
- Create: `app/(customer)/custom-order/page.tsx`
- Modify: `components/profile-screen.tsx:281-287` (wire the `href`)

**Interfaces:**
- Consumes: `getCustomDrinkPresets`, `placeCustomOrder` (Task 3), `getPaymentSettings`, `isAdmin`, `formatPrice` from `lib/format`, `CustomDrinkPreset` type.
- Produces: route `/custom-order` (admin-only); the profile "Custom Order" row links to it.

- [ ] **Step 1: Build the screen (client component)**

Create `components/custom-order/custom-order-screen.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Minus, Plus, Trash2 } from "lucide-react";
import { SmartImage } from "@/components/ui/smart-image";
import { formatPrice } from "@/lib/format";
import { images } from "@/constants/images";
import type { CustomDrinkPreset } from "@/types/custom-order";
import { placeCustomOrder } from "@/app/(customer)/custom-order/actions";

type Method = "cash" | "duitnow-qr";
type Line = { name: string; unitPrice: number; quantity: number };

export function CustomOrderScreen({
  presets,
  cashOk,
  qrOk,
  qrUrl,
}: {
  presets: CustomDrinkPreset[];
  cashOk: boolean;
  qrOk: boolean;
  qrUrl: string | null;
}) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState(""); // MYR text input
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<Method | null>(cashOk ? "cash" : qrOk ? "duitnow-qr" : null);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const total = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  function addLine(n: string, sen: number) {
    const trimmed = n.trim();
    if (trimmed === "" || sen <= 0) return;
    setLines((prev) => [...prev, { name: trimmed, unitPrice: sen, quantity: 1 }]);
  }

  function addManual() {
    const sen = Math.round(parseFloat(price) * 100);
    if (!name.trim() || !Number.isFinite(sen) || sen <= 0) return;
    addLine(name, sen);
    setName("");
    setPrice("");
  }

  function setQty(i: number, delta: number) {
    setLines((prev) =>
      prev
        .map((l, idx) => (idx === i ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity >= 1),
    );
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  function submit() {
    if (!method || lines.length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await placeCustomOrder({
        items: lines.map((l) => ({ name: l.name, unitPrice: l.unitPrice, quantity: l.quantity })),
        paymentMethod: method,
        notes: notes || undefined,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlaced(res.orderNumber);
    });
  }

  if (placed) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm uppercase tracking-wider text-muted-foreground">Order placed</p>
        <p className="font-heading text-4xl font-bold">{placed}</p>
        <button
          type="button"
          onClick={() => {
            setLines([]);
            setNotes("");
            setMethod(cashOk ? "cash" : qrOk ? "duitnow-qr" : null);
            setPlaced(null);
          }}
          className="mt-4 h-12 rounded-2xl bg-black px-6 text-sm font-semibold text-white"
        >
          New custom order
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <button
          type="button"
          onClick={() => router.push("/profile")}
          aria-label="Go back"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </button>
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">Custom Order</h1>
        <div className="size-9" aria-hidden />
      </header>

      <main className="flex flex-col gap-6 px-5 pb-8 pt-2">
        {/* Quick select */}
        {presets.length > 0 && (
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wide">Quick select</h2>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addLine(p.name, p.lastPrice)}
                  className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-neutral-50"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{formatPrice(p.lastPrice)}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Add a custom drink */}
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide">Add custom drink</h2>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Drink name"
              className="h-12 flex-1 rounded-2xl border border-border px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="RM"
              className="h-12 w-24 rounded-2xl border border-border px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <button
            type="button"
            onClick={addManual}
            className="h-11 rounded-2xl bg-neutral-100 text-sm font-semibold transition-colors hover:bg-neutral-200"
          >
            Add to order
          </button>
        </section>

        {/* Lines */}
        {lines.length > 0 && (
          <section className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border">
            {lines.map((l, i) => (
              <div key={`${l.name}-${i}`} className="flex items-center gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{l.name}</span>
                  <span className="text-xs text-muted-foreground">{formatPrice(l.unitPrice)} each</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setQty(i, -1)} aria-label="Decrease" className="flex size-7 items-center justify-center rounded-full bg-neutral-100">
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-5 text-center text-sm font-semibold tabular-nums">{l.quantity}</span>
                  <button type="button" onClick={() => setQty(i, 1)} aria-label="Increase" className="flex size-7 items-center justify-center rounded-full bg-neutral-100">
                    <Plus className="size-3.5" />
                  </button>
                </div>
                <button type="button" onClick={() => removeLine(i)} aria-label="Remove" className="flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-neutral-100">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </section>
        )}

        {/* Notes */}
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          rows={2}
          className="rounded-2xl border border-border px-4 py-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />

        {/* Payment */}
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wide">Payment</h2>
          {cashOk && (
            <button type="button" onClick={() => setMethod("cash")} aria-pressed={method === "cash"} className={`h-14 rounded-2xl border text-sm font-semibold ${method === "cash" ? "border-black bg-black text-white" : "border-border bg-white"}`}>
              Cash
            </button>
          )}
          {qrOk && (
            <button type="button" onClick={() => setMethod("duitnow-qr")} aria-pressed={method === "duitnow-qr"} className={`h-14 rounded-2xl border text-sm font-semibold ${method === "duitnow-qr" ? "border-black bg-black text-white" : "border-border bg-white"}`}>
              DuitNow QR
            </button>
          )}
          {!cashOk && !qrOk && (
            <p className="text-sm text-muted-foreground">No payment method is enabled. Enable one in Settings.</p>
          )}
          {method === "duitnow-qr" && (
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-neutral-50 p-6">
              <div className="relative size-64">
                <SmartImage src={qrUrl ?? images.qrDuitnow} alt="DuitNow QR" fill sizes="256px" className="object-contain" />
              </div>
            </div>
          )}
        </section>

        <div className="flex items-center justify-between text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatPrice(total)}</span>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={pending || !method || lines.length === 0}
          className="h-14 rounded-2xl bg-black text-base font-semibold text-white disabled:opacity-40"
        >
          Place order
        </button>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Build the route page (server, admin-gated)**

Create `app/(customer)/custom-order/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth/session";
import { getPaymentSettings } from "@/lib/settings/payments";
import { getCustomDrinkPresets } from "@/lib/custom-order/presets";
import { CustomOrderScreen } from "@/components/custom-order/custom-order-screen";

export const dynamic = "force-dynamic";

export default async function CustomOrderPage() {
  if (!(await isAdmin())) redirect("/profile");

  const [presets, payments] = await Promise.all([
    getCustomDrinkPresets(),
    getPaymentSettings(),
  ]);
  const cashOk = payments.categories.cash && payments.methods.cash;
  const qrOk = payments.categories.qr && payments.methods["duitnow-qr"];

  return (
    <CustomOrderScreen
      presets={presets}
      cashOk={cashOk}
      qrOk={qrOk}
      qrUrl={payments.duitnowQrUrl}
    />
  );
}
```

- [ ] **Step 3: Wire the profile entry point**

In `components/profile-screen.tsx`, give the admin "Custom Order" `StaffRow` (lines 281-287) an `href`:

```tsx
              {isAdminRole && (
                <StaffRow
                  icon={Coffee}
                  label="Custom Order"
                  description="Build a one-off order"
                  href="/custom-order"
                />
              )}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. (Confirm `images.qrDuitnow` exists in `constants/images.ts`; it is the same fallback used by `store-checkout.tsx`.)

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: build succeeds; `/custom-order` appears in the route list.

- [ ] **Step 6: Manual verification**

Sign in as an **admin**, open Profile → tap **Custom Order**. Add a drink via the manual form and via a quick-select chip (after the first order), adjust quantity, pick a payment method, Place order. Expected: a `NAISE-XXXXXX` confirmation. Then sign in as a **non-admin** and visit `/custom-order` directly — expected: redirect to `/profile`.

- [ ] **Step 7: Commit**

```bash
git add components/custom-order/custom-order-screen.tsx app/(customer)/custom-order/page.tsx components/profile-screen.tsx
git commit -m "feat(custom-order): admin custom order screen + route + profile link"
```

---

### Task 5: Reports — custom source split + Top custom drinks panel

**Files:**
- Modify: `lib/analytics/types.ts:11-29` (`ReportData`)
- Modify: `lib/analytics/reports.ts` (source split + custom items)
- Modify: `components/admin/reports-view.tsx` (render)

**Interfaces:**
- Consumes: `order_items.is_custom`, `orders.source = 'custom'`.
- Produces: `ReportData.totalsBySource.custom`; `ReportData.topCustomItems: { name: string; quantity: number; revenue: number }[]`.

- [ ] **Step 1: Extend the `ReportData` type**

In `lib/analytics/types.ts`, change `totalsBySource` and add `topCustomItems`:

```ts
  // Online vs in-store vs custom split of completed orders in the range.
  totalsBySource: {
    online: { orders: number; revenue: number };
    store: { orders: number; revenue: number };
    custom: { orders: number; revenue: number };
  };
  previous: { orders: number; revenue: number }; // equal-length window immediately before
  trend: { date: string; revenue: number; orders: number }[]; // per KL day, completed
  topItems: { name: string; quantity: number; revenue: number }[]; // top 10, completed
  topCustomItems: { name: string; quantity: number; revenue: number }[]; // top 10 custom drinks
  paymentBreakdown: { method: string; orders: number; revenue: number }[]; // completed
```

- [ ] **Step 2: Compute the custom source split**

In `lib/analytics/reports.ts`, update `bySource` (lines 54-58) so the type allows `"custom"` and add it to `totalsBySource`:

```ts
  // Online vs in-store vs custom split (completed orders in range).
  const bySource = (src: "online" | "store" | "custom") => {
    const rows = completed.filter((o) => (o.source ?? "online") === src);
    return { orders: rows.length, revenue: rows.reduce((s, o) => s + o.total, 0) };
  };
  const totalsBySource = {
    online: bySource("online"),
    store: bySource("store"),
    custom: bySource("custom"),
  };
```

- [ ] **Step 3: Compute `topCustomItems`**

In `lib/analytics/reports.ts`, add `is_custom` to the items select (line 104) and build a parallel custom map. Replace the items block (lines 102-120) with:

```ts
  let topItems: { name: string; quantity: number; revenue: number }[] = [];
  let topCustomItems: { name: string; quantity: number; revenue: number }[] = [];
  let redemptionBeans = 0;
  let rewardLines = 0;
  let itemsSold = 0;
  if (ids.length > 0) {
    const { data: items, error: itemsErr } = await db
      .from("order_items")
      .select("name, quantity, line_total, is_reward, reward_cost, is_custom, order_id")
      .in("order_id", ids);
    if (itemsErr) throw new Error(`getReportData failed: ${itemsErr.message}`);
    const map = new Map<string, { quantity: number; revenue: number }>();
    const customMap = new Map<string, { quantity: number; revenue: number }>();
    for (const it of items ?? []) {
      const cur = map.get(it.name) ?? { quantity: 0, revenue: 0 };
      cur.quantity += it.quantity; cur.revenue += it.line_total;
      map.set(it.name, cur);
      itemsSold += it.quantity;
      if (it.is_reward) { rewardLines += 1; redemptionBeans += it.reward_cost; }
      if (it.is_custom) {
        const c = customMap.get(it.name) ?? { quantity: 0, revenue: 0 };
        c.quantity += it.quantity; c.revenue += it.line_total;
        customMap.set(it.name, c);
      }
    }
    const rank = (m: Map<string, { quantity: number; revenue: number }>) =>
      [...m.entries()]
        .map(([name, v]) => ({ name, quantity: v.quantity, revenue: v.revenue }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);
    topItems = rank(map);
    topCustomItems = rank(customMap);
  }
```

- [ ] **Step 4: Return `topCustomItems`**

In `lib/analytics/reports.ts`, add it to the returned object (after `topItems` at line 127):

```ts
    trend,
    topItems,
    topCustomItems,
    paymentBreakdown,
```

- [ ] **Step 5: Render custom source tile + Top custom drinks panel**

In `components/admin/reports-view.tsx`, in the "Online vs in-store split" grid (lines 177-196), change the grid to 3 columns and add a custom tile. Replace that `<div className="grid grid-cols-2 gap-4">...</div>` block with:

```tsx
        {/* Online vs in-store vs custom split. */}
        <div className="grid grid-cols-3 gap-4">
          <StatTile
            label="Online orders"
            value={String(data.totalsBySource.online.orders)}
            foot={<span className="text-xs text-muted-foreground">{formatPrice(data.totalsBySource.online.revenue)}</span>}
          />
          <StatTile
            label="In-store orders"
            value={String(data.totalsBySource.store.orders)}
            foot={<span className="text-xs text-muted-foreground">{formatPrice(data.totalsBySource.store.revenue)}</span>}
          />
          <StatTile
            label="Custom orders"
            value={String(data.totalsBySource.custom.orders)}
            foot={<span className="text-xs text-muted-foreground">{formatPrice(data.totalsBySource.custom.revenue)}</span>}
          />
        </div>
```

Then add a "Top custom drinks" section. Immediately after the closing `</div>` of the "Top items + payment mix" grid (line 275), insert:

```tsx
        {/* Top custom drinks — off-menu drinks ranked by quantity. A trending
            one here is a candidate to promote to the real menu. */}
        {data.topCustomItems.length > 0 && (
          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-heading text-base font-semibold">Top custom drinks</h2>
              <Eyebrow>Off-menu, by quantity</Eyebrow>
            </div>
            <ul className="flex flex-col gap-3">
              {data.topCustomItems.map((it, i) => (
                <li key={it.name} className="flex items-center gap-3 text-sm">
                  <span className="w-4 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{it.name}</span>
                  <span className="w-8 shrink-0 text-right font-mono tabular-nums">{it.quantity}</span>
                  <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{formatPrice(it.revenue)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 7: Manual verification**

After placing at least one custom order (Task 4), open Admin → Reports. Expected: a "Custom orders" tile with the right count/revenue, and a "Top custom drinks" panel listing the custom drink(s).

- [ ] **Step 8: Commit**

```bash
git add lib/analytics/types.ts lib/analytics/reports.ts components/admin/reports-view.tsx
git commit -m "feat(custom-order): custom source split + top custom drinks in reports"
```

---

### Task 6: Dashboard best-sellers exclude custom drinks

**Files:**
- Modify: `lib/analytics/dashboard.ts:65-80`

**Interfaces:**
- Consumes: `order_items.is_custom`.
- Produces: `DashboardMetrics.topSellers` counts **menu items only** (custom drinks excluded).

- [ ] **Step 1: Filter custom items out of top sellers**

In `lib/analytics/dashboard.ts`, change the topSellers block (lines 65-80). Add `is_custom` to the select and skip custom lines:

```ts
  let topSellers: { name: string; quantity: number }[] = [];
  if (monthCompletedIds.length > 0) {
    const { data: items, error: itemsErr } = await db
      .from("order_items")
      .select("name, quantity, is_custom, order_id")
      .in("order_id", monthCompletedIds);
    if (itemsErr) throw new Error(`getDashboardMetrics failed: ${itemsErr.message}`);
    const byName = new Map<string, number>();
    for (const it of items ?? []) {
      if (it.is_custom) continue; // best-sellers is for featurable menu items only
      byName.set(it.name, (byName.get(it.name) ?? 0) + it.quantity);
    }
    topSellers = [...byName.entries()]
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Open Admin → Dashboard. Expected: best-sellers shows only real menu items; the custom drink placed earlier does NOT appear there (it appears in Reports → Top custom drinks instead).

- [ ] **Step 4: Commit**

```bash
git add lib/analytics/dashboard.ts
git commit -m "feat(custom-order): exclude custom drinks from dashboard best-sellers"
```

---

### Task 7: "Custom" badge on order lines

**Files:**
- Modify: `components/drink-row.tsx:111-119` (staff/manage order detail)
- Modify: `components/customer-order-detail.tsx:85-92` (customer order detail)

**Interfaces:**
- Consumes: `OrderLine.isCustom` (Task 2; already mapped by `rowToOrderLine`).
- Produces: a small "Custom" badge next to the drink name when `item.isCustom`.

- [ ] **Step 1: Badge in the staff DrinkRow**

In `components/drink-row.tsx`, replace the name span block (lines 111-124) so the name and a badge sit on one row:

```tsx
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "truncate font-heading text-sm font-bold tracking-tight",
                status === "done" && "line-through",
              )}
            >
              {item.name}
            </span>
            {item.isCustom && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-amber-700">
                Custom
              </span>
            )}
          </span>
          {subtitle && (
            <span className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
```

(Leave the status line that follows, lines 125-133, unchanged.)

- [ ] **Step 2: Badge in the customer order detail**

In `components/customer-order-detail.tsx`, replace the name span (line 86) with a name + badge row:

```tsx
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{item.name}</span>
                      {item.isCustom && (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-amber-700">
                          Custom
                        </span>
                      )}
                    </span>
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Manual verification**

Open the custom order from Task 4 in the staff manage view (`/manage/<token>`) and in the customer order detail. Expected: each line shows a "Custom" badge next to the drink name.

- [ ] **Step 5: Commit**

```bash
git add components/drink-row.tsx components/customer-order-detail.tsx
git commit -m "feat(custom-order): show Custom badge on custom order lines"
```

---

## Final verification

- [ ] Run `npm run build` — expected: clean production build.
- [ ] End-to-end: as admin, place a custom order with two drinks (one via manual entry, one via quick select) → confirmation number shown. Reopen `/custom-order` → the new drink appears as a quick-select chip at its last price. Reports shows the custom source tile + Top custom drinks. Dashboard best-sellers excludes it. Order detail (staff + customer) shows the Custom badge.

## Self-review notes (coverage vs spec)

- Data model (is_custom, custom enum, custom_drinks + RLS + RPC) → Task 1.
- Types + pipeline (OrderLine.isCustom, source 'custom', createOrder, mappers) → Task 2.
- Owner constant, presets reader, place-custom-order action with auto-save → Task 3.
- Screen + route + profile href → Task 4.
- Reports custom split + Top custom drinks → Task 5.
- Dashboard best-sellers exclude custom → Task 6.
- Custom badge on order lines → Task 7.
- Out-of-scope items (preset management UI, mixing menu items, sizes/addons on custom drinks) intentionally excluded.
