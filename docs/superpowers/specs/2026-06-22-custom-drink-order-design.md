# Custom Drink / Custom Order — Design

**Date:** 2026-06-22
**Status:** Approved (pending spec review)

## Problem

The admin profile has an inert "Custom Order" row (`components/profile-screen.tsx`,
the admin-only `StaffRow` with no `href`). Staff regularly serve drinks that aren't
on the menu and need to charge a one-off, admin-decided price. Today there is no way
to record such a sale, so the data is lost — it never reaches orders, reports, or the
dashboard.

We want admins to place a **custom order** made of **custom drinks** (name +
admin-set price), have it flow through the normal order pipeline (order number, live
board, persistence), and be **tagged as custom** everywhere so we can analyse it —
e.g. spot a custom drink trending in the last 7 days and decide whether to promote it
to the real menu. We also want a **quick-select** of previously-entered custom drinks
for fast reuse.

## Decisions (locked)

- **Composition:** custom drinks only. Each line is `name + price + quantity`. Regular
  menu items keep their existing ordering flow; they are not mixed in here.
- **Fulfillment:** full order flow — pick payment method (cash / DuitNow QR), get a
  `NAISE-XXXXXX` number, appears on the live order board, persisted like a store order.
- **Quick select:** auto-save by name. Every placed custom drink is upserted into a
  presets table, remembering the last price as the default and counting usage. Admin
  can override the price at any time.
- **Access:** admin-only, matching the button's current `isAdminRole` gate.

## Data model

The existing `order_items` table already snapshots `name`, `quantity`, `unit_price`,
and `line_total` and has **no `product_id`**, so a custom drink fits with no structural
change to how a line is stored. We add three things:

### a) `order_items.is_custom boolean not null default false`

The per-drink custom flag. This is what lets reports group custom drinks by name and
distinguish them from menu items. Backfills to `false` for existing rows.

### b) Extend the `order_source` enum with `'custom'`

Currently `order_source` is `('online', 'store')`. Add `'custom'`. The whole custom
order's `source = 'custom'`, which feeds the order-level source split in the dashboard
and reports (online vs store vs custom revenue). The enum value must be added in its
own migration / committed before any row uses it (Postgres restriction on using a new
enum value in the same transaction that adds it).

### c) New table `custom_drinks` (quick-select presets + usage signal)

| column         | type                          | purpose                                            |
|----------------|-------------------------------|----------------------------------------------------|
| `id`           | `uuid pk default gen_random_uuid()` |                                              |
| `name`         | `text not null`               | display name; **unique on `lower(name)`** (case-insensitive dedupe) |
| `last_price`   | `integer not null`            | remembered default price in sen, prefilled next time |
| `times_used`   | `integer not null default 0`  | sort the quick-select picker (most-used first)     |
| `last_used_at` | `timestamptz`                 | recency                                            |
| `created_by`   | `uuid references auth.users (id) on delete set null` | who introduced it          |
| `created_at`   | `timestamptz not null default now()` |                                             |
| `updated_at`   | `timestamptz not null default now()` | maintained by the shared `set_updated_at` trigger |

Indexes: unique index on `lower(name)`; index on `(times_used desc, last_used_at desc)`
for the picker ordering.

**RLS:** enable RLS. Admin-only `select`/`insert`/`update` via `current_user_role() = 'admin'`,
mirroring the existing admin-gated patterns. Writes happen server-side in the
place-order action; strict RLS is defense in depth.

## Flow

### Route & entry point

- New route `app/(customer)/custom-order/page.tsx`, a Server Component gated by
  `isAdmin()` — redirect to `/profile` (or `/menu`) if not admin. Uses the same mobile
  `max-w-md` shell and header style as the profile screen.
- In `components/profile-screen.tsx`, the admin "Custom Order" `StaffRow` gets
  `href="/custom-order"`. The inert-button branch of `StaffRow` can stay for safety but
  is no longer exercised by this row.

### Screen (client component)

- **Quick-select chips:** presets fetched server-side, most-used first. Tapping a chip
  adds a line pre-filled with its `last_price` (editable).
- **Add custom drink:** a small inline form — `name` (text) + `price` (MYR) — that
  appends a line.
- **Line list:** each line shows name, price, quantity stepper (±), and remove.
- **Notes:** optional free text (maps to `orders.notes`).
- **Payment method:** cash / DuitNow QR, limited to methods enabled in
  `getPaymentSettings()`, mirroring `components/store/store-checkout.tsx` (including the
  QR image panel when DuitNow QR is selected).
- **Place order** button → server action; on success show a confirmation screen with
  the order number, then reset for the next order.

### Server action `placeCustomOrder`

Lives in a server action file for the route (e.g. `app/(customer)/custom-order/actions.ts`).

1. Gate on `isAdmin()`; reject otherwise.
2. Validate: at least one line; every line has a non-empty name, price > 0, qty ≥ 1;
   payment method is server-side enabled.
3. Convert prices MYR → sen (×100).
4. Build an `OrderDraft` with `source: 'custom'`, `ownerId: CUSTOM_OWNER_ID` (new
   constant), and each line `{ ..., isCustom: true, status: 'pending' }`.
5. Call the existing `createOrder(draft, { userId: null })` (admin-client path, since
   `userId` is null).
6. **Auto-save presets:** upsert each line into `custom_drinks` keyed on `lower(name)` —
   set `last_price = unitPrice`, `times_used = times_used + 1`, `last_used_at = now()`,
   `created_by = auth.uid()` on insert. Done via an admin-gated SECURITY DEFINER RPC or
   the admin client inside the already-gated action.
7. Best-effort Telegram notify, reusing `buildOrderMessage` + `sendTelegramMessage` as
   `placeStoreOrder` does.
8. Return `{ ok: true, orderNumber }` or `{ ok: false, error }`.

No beans/rewards: custom orders have no `user_id`.

### Type changes

- `types/order.ts`: add `isCustom?: boolean` to `OrderLine`; add `'custom'` to the
  `Order.source` union (and therefore `OrderDraft.source`).
- `lib/orders/store.ts` `createOrder`: include `is_custom: item.isCustom ?? false` in
  the `order_items` insert payload.
- `lib/orders/mappers.ts`: map `is_custom` → `isCustom` when reading rows (so the badge
  can render). Regenerate Supabase types for the new column / enum value.

## Where the data surfaces

- **Reports** (`lib/analytics/reports.ts` + `lib/analytics/types.ts` + the reports view):
  - Add `'custom'` to `totalsBySource` (now `online` / `store` / `custom`).
  - Add a dedicated **"Top custom drinks"** panel: from `order_items` where
    `is_custom = true` within completed orders in range, grouped by name, ranked by
    quantity. This directly answers "is a custom drink trending → promote it".
  - Custom items still count toward overall `itemsSold` and revenue totals.
- **Dashboard best-sellers:** **exclude** custom items (that list is for featurable menu
  items). Custom revenue is visible via the source split instead.
- **Order board / order detail:** a small **"Custom"** badge on custom lines (driven by
  `isCustom`) so staff recognise them at a glance.

## Money & guards

- Admin enters price in MYR; stored in sen (×100), consistent with the rest of the app.
- Payment method must be re-validated server-side against `getPaymentSettings()`.
- All writes are admin-gated in the server action and backed by RLS.

## Out of scope (YAGNI)

- Editing/archiving presets in a management UI (auto-save only for now).
- Mixing custom drinks with menu items in one order.
- Sizes / ice / sugar / add-ons on custom drinks (a custom drink is just name + price).
- Per-preset categories or images.

## Files touched (anticipated)

- `supabase/migrations/` — three migrations: `is_custom` column; `order_source` enum
  value; `custom_drinks` table + RLS (+ optional upsert RPC).
- `types/order.ts`, `lib/orders/store.ts`, `lib/orders/mappers.ts`
- `constants/store.ts` (or similar) — `CUSTOM_OWNER_ID`
- `app/(customer)/custom-order/page.tsx`, `app/(customer)/custom-order/actions.ts`
- `components/custom-order/*` (the screen + line list + quick-select)
- `components/profile-screen.tsx` — wire the `href`
- `lib/analytics/reports.ts`, `lib/analytics/types.ts`, reports view, dashboard top
  sellers query, order card/detail badge
