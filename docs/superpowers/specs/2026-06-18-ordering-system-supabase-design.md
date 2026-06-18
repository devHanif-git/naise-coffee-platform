# Ordering System → Supabase — Design

Date: 2026-06-18
Status: Approved design, pending implementation plan
Scope: Move the ordering system from the in-memory mock store to Supabase, end to
end — checkout, customer history/tracking, and the staff manage surfaces — with
live updates, DuitNow QR receipt upload, and a Telegram "order ready" notice.

Rewards remain mocked and out of scope; the schema is designed so the order can
be linked to rewards later without rework.

---

## 1. Goals

- Orders are persisted in Supabase and linked to the user who placed them.
- Guests (browser owner-id) and signed-in members (Google OAuth, `auth.uid()`)
  can both order; guest orders carry over to the account on sign-up.
- `/manage` (staff board) and `/manage/[token]` (single order) use real data.
- Customer order history (`/profile/orders`) and detail (`/profile/orders/[token]`)
  use real data.
- Staff and customers both get **live** status updates (no manual refresh).
- The per-drink **undo** on the manage detail is removed and replaced with an
  explicit **"Mark order ready & notify"** confirmation modal.
- When an order is confirmed complete, a Telegram message is sent to the same
  group used for new-order notices, to drive the buyer pickup notice.
- DuitNow QR orders capture a payment receipt; other methods do not.

### Non-goals

- Rewards/Beans wiring (stays mocked).
- WhatsApp pickup automation (Telegram is the notice channel for now).
- Admin CMS beyond the existing manage surfaces.
- Changing any existing UI other than the manage-detail undo → notify change and
  the checkout receipt-upload addition for DuitNow QR.

---

## 2. Current state (what we are replacing)

- `lib/orders/store.ts` — in-memory mock store on `globalThis`, with 4 seed
  orders. Keyed by `token` (uuid). Exposes `createOrder`, `getOrderByToken`,
  `listOrders`, `listOrdersFor`, `setItemStatus`, `cancelOrder`,
  `deriveOrderStatus`. These signatures are kept; only the implementation moves
  to Supabase.
- `app/(customer)/checkout/actions.ts` — `placeOrder` server action: creates the
  order, posts the "NEW ORDER!" Telegram message with a manage-link button.
- `app/(admin)/manage/page.tsx` — lists all orders (staff-gated by
  `canManageOrders()`).
- `app/(admin)/manage/[token]/page.tsx` — single order (staff-gated).
- `app/(admin)/manage/actions.ts` — `updateDrinkStatus`, `cancelOrderAction`.
- `app/(customer)/profile/orders/*` — customer history + detail, scoped by the
  `naise_owner_id` cookie.
- `components/order-detail.tsx`, `components/drink-row.tsx` — manage detail UI
  with per-drink swipe + undo.
- `lib/orders/message.ts`, `lib/telegram.ts` — Telegram message builder + sender.
- `lib/auth/session.ts` — `getSessionRole`, `canManageOrders` (role from
  `profiles`, RLS-backed).
- `supabase/migrations/*` — `profiles` table + role enum + RLS exist. No order
  tables yet.

Identity today: `owner_id` is the per-browser cookie `naise_owner_id`, not the
Supabase auth user. The auth store adopts the same owner-id on sign-in so guest
orders carry over.

---

## 3. Decisions (from brainstorming)

1. **Ownership:** guests + members. Guest orders tracked by `owner_id`; member
   orders also carry `user_id = auth.uid()`. Identity is derived **server-side**
   (the action reads `auth.getUser()`), not trusted from the client. `owner_id`
   is always stored for carry-over and guest history.
2. **Lookup keys:** keep `token` (unguessable uuid) for the manage link and the
   customer order-detail link; `order_number` (`NAISE-XXXXXX`) is display-only;
   customer history is fetched by `user_id`/`owner_id`, never by order number
   (sequential numbers are guessable).
3. **Finish + notify:** explicit **"Mark order ready & notify"** button that
   opens a confirmation modal. Confirm → status `completed`, stamp
   `completed_at`, send Telegram. **Cancel → revert the last-completed drink to
   `preparing`** so the order leaves the `ready` state and nothing is sent. The
   per-drink undo (button + swipe-right) is removed.
4. **Receipt upload:** built now, **DuitNow QR only**. Other methods skip it.
5. **Realtime:** built now. Staff board via Postgres Changes (RLS by role);
   customer tracking (guest + member) via a per-order Broadcast channel keyed by
   the token.

---

## 4. Architecture

The store module stays the seam. `lib/orders/store.ts` keeps its exported
function signatures and becomes a thin async data layer over Supabase. Pages and
components change as little as possible.

```
checkout-screen (client)
  -> placeOrder (server action)
       - derive user_id from auth.getUser() (server-side)
       - member: cookie-scoped server client (RLS insert: user_id = auth.uid())
       - guest:  service-role admin client   (no auth identity)
       - insert order + order_items
       - upload DuitNow QR receipt -> orders.proof_of_payment_url
       - Telegram "NEW ORDER!" (unchanged)

manage board / detail (server components, staff-gated)
  -> read via cookie-scoped server client (RLS: staff role)
  -> updateDrinkStatus / markReadyAndNotify / cancel (server actions)

customer history / detail (server components)
  -> member: RLS own rows;  guest: service-role admin client scoped by owner_id

realtime
  -> staff:    Postgres Changes on orders/order_items (RLS by role)
  -> customer: Broadcast channel `order:<token>` fed by a DB trigger
```

### Supabase clients

- `lib/supabase/server.ts` — existing cookie-scoped client (RLS as the caller).
- `lib/supabase/admin.ts` — **new**, service-role client. Server-only; never
  imported into a client component. Used for guest writes and guest history
  reads (no auth identity to satisfy RLS). Requires `SUPABASE_SERVICE_ROLE_KEY`.

Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.example`, `.dev.vars.example`, and the
real env files. Service role bypasses RLS, so the admin client is only used in
server code paths that have already validated intent.

---

## 5. Data model

New migration in `supabase/migrations/`. Money is integer **sen** throughout.

### Enums

- `public.order_status`: `pending | preparing | ready | completed | cancelled`
- `public.item_status`: `pending | preparing | done`

### `public.orders`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `token` | uuid | unique, `gen_random_uuid()`; manage + detail lookup |
| `order_seq` | bigint | `default nextval('public.orders_seq')` |
| `order_number` | text | generated: `'NAISE-' || lpad(order_seq::text, 6, '0')`, stored |
| `user_id` | uuid null | → `auth.users(id) on delete set null`; null for guests |
| `owner_id` | text not null | browser stable id; always set |
| `status` | order_status | default `pending` |
| `payment_method` | text not null | display name, e.g. `DuitNow QR` |
| `subtotal` | integer not null | sen |
| `total` | integer not null | sen |
| `notes` | text null | |
| `proof_of_payment_url` | text null | DuitNow QR receipt; signed/stored URL |
| `created_at` | timestamptz | default `now()` |
| `updated_at` | timestamptz | default `now()`, trigger-maintained |
| `completed_at` | timestamptz null | stamped on confirm-complete |

Indexes: `user_id`, `owner_id`, `token` (unique), `created_at desc`.

### `public.order_items`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `order_id` | uuid not null | → `orders(id) on delete cascade` |
| `position` | int not null | preserves line order; maps to itemIndex |
| `name` | text not null | |
| `quantity` | int not null | |
| `size_name` | text null | |
| `addon_names` | text[] not null | default `'{}'` |
| `unit_price` | integer not null | sen |
| `line_total` | integer not null | sen |
| `status` | item_status | default `pending` |

Index: `order_id`. Unique `(order_id, position)`.

### Sequence

`create sequence public.orders_seq start 1;` (first real order is `NAISE-000001`;
seeds are removed). The generated `order_number` keeps display formatting in the
DB so it is consistent everywhere.

---

## 6. Status model

Overall order status is derived from drink statuses, with the `ready` state added
for the explicit-notify flow:

- no drink past `pending` → `pending`
- at least one drink `preparing`/`done`, not all `done` → `preparing`
- **all drinks `done`, not yet confirmed → `ready`**
- staff confirms the modal → `completed` (+ `completed_at`, + Telegram)
- manual cancel → `cancelled`

`deriveOrderStatus` is updated so "all done" yields `ready` (not `completed`).
`completed` is only ever set by the explicit confirm action. `cancelled` is set
by the cancel action. The derivation runs server-side in the status update
action after writing the drink's status.

`lib/orders/status.ts` (filters, pills, progress) is unchanged: `ready` already
maps into the "In Progress" filter and progress index, which is acceptable —
`ready` is a short-lived staff-only intermediate state.

**Completion trigger (no separate button):** there is no "Mark order ready"
button to press. Staff just advance each drink. The moment the **last drink is
swiped (or tapped) to `done`** — i.e. all drinks are now `done` and the order
enters `ready` — the completion confirmation modal **auto-opens**. The modal is
the only confirmation step:

- **Confirm** → order `completed`, stamp `completed_at`, send the buyer the
  "your drink is ready" Telegram message.
- **Cancel** → revert that last drink from `done` back to `preparing`, so the
  order leaves `ready`, no message is sent, and the modal closes.

Example (2 drinks): drink 1 is `done`; drink 2 goes `pending → preparing →
done`. The instant drink 2 is swiped to `done`, the modal pops up on its own.

---

## 7. RLS

Enable RLS on `orders` and `order_items`.

- **SELECT** (both tables): `user_id = auth.uid()` OR
  `current_user_role() in ('admin','manager','staff')`.
  (`order_items` checks the parent order's `user_id`/role via an `exists`.)
- **INSERT** (`authenticated`): members only, `with check user_id = auth.uid()`.
- **UPDATE** (`authenticated`): staff roles only (status changes, cancel).
- Guest INSERT and guest history SELECT do **not** get `anon` policies; they go
  through the **service-role admin client** in server code. This avoids opening
  any broad anonymous read/write on the orders tables.

### Realtime authorization

- Add `public.orders` and `public.order_items` to the `supabase_realtime`
  publication; set replica identity as needed for Postgres Changes.
- Postgres Changes for staff is governed by the SELECT policy above (staff role).
- Broadcast: add an RLS policy on `realtime.messages` allowing `anon` and
  `authenticated` to **receive** on topics matching `order:%`. The token in the
  topic name is the secret (same model as the order-detail URL and manage link).
  No order row data is exposed via this — only the small status payload the
  trigger emits.

---

## 8. Realtime detail

- **Staff board (`/manage`) + detail (`/manage/[token]`):** client subscribes to
  Postgres Changes on `orders` (and `order_items` on the detail page),
  RLS-gated to staff. New orders appear and statuses update live across staff
  devices. The screens become (or wrap in) a thin client subscriber that
  refreshes data on change; server components still do the initial fetch.
- **Customer tracking (`/profile/orders/[token]`), guest + member:** client
  subscribes to Broadcast channel `order:<token>`. A trigger on `orders`
  (after update of `status`/`completed_at`) emits a broadcast to `order:<token>`
  with the new status. The customer screen updates live without refresh,
  including when staff advance the order.

Payload is minimal (e.g. `{ status, completed_at }`); the page already has the
rest of the order from its initial server render.

---

## 9. Manage UI change (authorized)

`components/order-detail.tsx` + `components/drink-row.tsx`:

- **Remove** the per-drink undo: the `RotateCcw` reset button and the
  swipe-right-to-undo gesture/hint in `drink-row.tsx`, and the `onReset` path.
  Drinks still swipe/tap forward `pending → preparing → done`.
- There is **no separate "Mark order ready" button.** The completion
  confirmation modal **auto-opens** the moment the last drink is advanced to
  `done` (all drinks done → order `ready`). See section 6.
- The auto-opened **confirmation modal**:
  - **Confirm** → `markReadyAndNotify` server action: set `completed`, stamp
    `completed_at`, send the buyer the "your drink is ready" Telegram message;
    revalidate.
  - **Cancel** → revert the **just-completed (last) drink** back to `preparing`
    (via the existing per-drink status action), dropping the order out of
    `ready`; no message is sent and the modal closes.

The "all drinks ready" note already in `order-detail.tsx` stays; only the
trigger mechanism (auto-modal instead of a button) is added. No other visual
changes to the manage surfaces. `/manage/test` stays a local mock harness (uses
`mockOrder()`), with its undo removed to match; the auto-modal works locally
there without sending a real Telegram message (persist=false path).

---

## 10. Telegram

- New `buildOrderReadyMessage(order)` in `lib/orders/message.ts`. This is a
  **buyer-facing pickup notice**, NOT the "NEW ORDER!" staff format. It reads
  like a message to the customer — e.g. opens with "Your drink is ready! ☕"
  (or similar), then the order detail: `order_number`, the item lines, and a
  short pickup prompt. Tone is friendly/customer-directed, not an internal
  staff alert.
- Sent via the existing `sendTelegramMessage` to the same `TELEGRAM_CHAT_ID`
  (same group as the new-order notice, for now).
- Fires only from `markReadyAndNotify` (modal confirm). The existing checkout
  "NEW ORDER!" message is unchanged.

---

## 11. Receipt upload (DuitNow QR)

- New **private** Storage bucket `receipts`.
- RLS: a customer can upload to a path scoped to their order/owner; staff can
  read. Customer read of their own receipt via signed URL or the admin client in
  the server-rendered detail. (Exact policy detailed in the plan.)
- Checkout (`checkout-screen.tsx`): when `duitnow-qr` is selected, the customer
  picks/uploads a payment screenshot before placing the order. The upload runs
  via the existing browser supabase client (member) or is handed to the server
  action; the resulting URL is stored on `orders.proof_of_payment_url`.
- Manage detail already renders the "Proof of Payment" section when
  `proof_of_payment_url` is present — no UI change there.
- Other payment methods skip the receipt entirely.

---

## 12. Checkout action changes

`placeOrder` (`app/(customer)/checkout/actions.ts`):

- Read the Supabase user server-side; set `user_id` when signed in.
- Keep accepting `ownerId` from the client (non-security browser id); store it.
- Accept the receipt reference for DuitNow QR; persist `proof_of_payment_url`.
- Insert `orders` + `order_items` (member: cookie client under RLS; guest: admin
  client). On success, build + send the "NEW ORDER!" Telegram (unchanged) with
  the `/manage/<token>` link.
- Return `{ ok, orderNumber }` as today.

---

## 13. Files touched (anticipated)

New:
- `supabase/migrations/<ts>_orders.sql` (enums, tables, sequence, RLS, realtime,
  trigger).
- `supabase/migrations/<ts>_receipts_storage.sql` (bucket + policies).
- `lib/supabase/admin.ts` (service-role client).
- `lib/orders/realtime.ts` (client subscribe helpers) — or inline per screen.

Changed:
- `lib/orders/store.ts` (Supabase-backed; same signatures, now async).
- `lib/orders/message.ts` (add `buildOrderReadyMessage`).
- `app/(customer)/checkout/actions.ts` (user_id, receipt).
- `components/checkout-screen.tsx` (DuitNow QR receipt upload).
- `app/(admin)/manage/page.tsx`, `app/(admin)/manage/[token]/page.tsx`
  (real data; realtime wrapper).
- `app/(admin)/manage/actions.ts` (add `markReadyAndNotify`; keep cancel).
- `components/order-detail.tsx`, `components/drink-row.tsx` (remove undo, add
  notify button + modal, realtime).
- `app/(customer)/profile/orders/page.tsx`,
  `app/(customer)/profile/orders/[token]/page.tsx`,
  `components/customer-order-detail.tsx` (real data; broadcast subscribe).
- `types/order.ts` (align with rows; `ready` handling already present).
- `types/database.ts` (regenerate after migration).
- `.env.example`, `.dev.vars.example` (service-role key).

Removed:
- The in-memory store seeds and `globalThis` store in `lib/orders/store.ts`.

---

## 14. Testing

- Place an order as a **guest** → appears in `/manage`, visible in that browser's
  `/profile/orders`, Telegram "NEW ORDER!" received.
- Place an order as a **member** → `user_id` set; appears in history; carry-over
  from a prior guest order on the same browser works.
- Staff advance each drink → status moves `pending → preparing → ready`; the
  customer's open tracking page updates live (guest and member).
- All drinks done → "Mark order ready & notify" enabled → confirm → `completed`,
  Telegram "order ready" sent, customer page flips live; cancel → last drink back
  to `preparing`, no message.
- DuitNow QR → receipt required/uploaded → visible in manage "Proof of Payment".
  Cash/others → no receipt step.
- RLS: a non-staff user cannot read `/manage`; a member cannot read another
  member's orders; anon cannot select `orders` directly.
- `npm run lint` / typecheck clean; `types/database.ts` regenerated.

---

## 15. Open items for the plan

- Exact `receipts` bucket RLS policy wording and the upload path scheme.
- Whether the manage board/detail wrap existing server components in a small
  client subscriber vs. refetch-on-change via `router.refresh()`.
- `orders_seq` start value (default 1 here; adjust if a different starting number
  is wanted).
