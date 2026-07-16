# Shift Open/Close & Cash Drawer Reconciliation — Design

**Date:** 2026-07-16
**Status:** Approved (pending spec review)

## Problem

NAISE COFFEE takes money two ways at the counter: **cash** and **DuitNow QR**.
Today nothing ties a day's takings to a physical drawer count, so cash and QR
profit can't be reconciled. Staff also perform **cash↔QR exchanges** (a customer
transfers RM2 to the shop's DuitNow QR and takes RM2 cash from the drawer, or the
reverse) — these move money between the cash and QR buckets without being a sale,
and currently leave the drawer looking "short" with no explanation.

We need a **shift** (open → operate → close) with a starting cash float, a log of
non-sale drawer movements, and a closing count that reconciles counted cash
against what the system expects.

## Goals

- Open a shift with a starting cash **float**; close it with a physical **cash count**.
- One shared shift for the whole shop at a time (single physical drawer).
- Attribute every order to the open shift so closing math is exact.
- Record **drawer movements**: cash↔QR exchanges (both directions) and general
  cash in / cash out.
- At close, compute **expected cash** and show **over/short** vs the counted cash.
- **Block drink-making** (advancing item status / completing an order) when no
  shift is open. **Never block ordering** — customers and the kiosk order freely.
- **Remind** staff to close a stale shift (in-app banner + repeating Telegram
  nudges past midnight KL), and nudge to open a new shift the next day.

## Non-Goals

- Counting/reconciling QR at close. QR is digital and verified against the bank
  app out of band; only cash is physically counted. (The close screen *shows* QR
  totals for eyeballing, but there is no QR "difference".)
- Per-person / multi-register shifts. One shared drawer only.
- Coins / sen-level cash inputs. Every item is priced in whole ringgit, so all
  shift cash inputs and displays are **whole RM** (stored as sen internally).
- Shift management from the kiosk. The kiosk is an **ordering terminal only**.
- Reopening or editing a closed shift. Corrections are compensating movements or
  a note, not edits.
- Changing the existing `store_settings.is_open` storefront-closure toggle. That
  is a separate concern (stops customers ordering); shifts never touch it.

## Decisions (from brainstorming)

1. **Scope:** one shared shift at a time for the whole shop (single drawer).
2. **Opening float:** required, entered in **whole RM** (no coins).
3. **Movements:** exchanges **both directions** (QR→Cash and Cash→QR) **plus**
   general cash-in / cash-out. Immutable log.
4. **Close:** count **cash only**; QR/online totals come from the system.
5. **Enforcement:** ordering is **never** blocked. The block is on
   **drink-making** on the manage page (item status advance + order complete).
6. **Staleness:** soft, non-blocking in-app banner + repeating Telegram reminders
   once past midnight KL or 6h since the shift's last order (whichever first).
   The only **hard** block: you cannot open a new shift while one is still open —
   the stale one must be closed (reconciled) first.
7. **Reminder cadence:** past-midnight-KL close reminder repeats every **30 min**
   until closed; a **one-time** open reminder fires **12h after** the last close.
8. **Scheduler:** Supabase **pg_cron + pg_net** calls an App Service route
   `POST /api/shift/reminder` (shared-secret header). App is hosted on Azure App
   Service (no built-in cron); Supabase is already in the stack.
9. **Kiosk is ordering-only.** All shift management lives in the admin CMS. The
   entry point is a **Shift** row in the profile Staff card. Kiosk orders are
   auto-stamped with the open `shift_id` but the kiosk never opens/closes a shift.
10. **Access:** shift operations are **admin, manager, staff** only.

## Data Model

Money stored in **sen** (consistent with the rest of the app). All UI
inputs/displays are **whole RM** (multiply/divide by 100 at the boundary).

### `shifts`

One row per shift. At most one `open` at a time (enforced by a partial unique
index).

| column | type | notes |
|---|---|---|
| `id` | uuid PK default `gen_random_uuid()` | |
| `status` | enum `shift_status` (`open`, `closed`) not null default `open` | |
| `opened_by` | uuid → `auth.users(id)` on delete set null | staff who opened |
| `opening_float` | integer (sen) not null | starting cash |
| `opened_at` | timestamptz not null default `now()` | |
| `closed_by` | uuid → `auth.users(id)` on delete set null, null | |
| `closed_at` | timestamptz, null | |
| `counted_cash` | integer (sen), null | physical count at close |
| `expected_cash` | integer (sen), null | snapshotted at close |
| `cash_difference` | integer (sen), null | `counted − expected` (over +, short −) |
| `closing_note` | text, null | optional discrepancy explanation |
| `last_reminder_at` | timestamptz, null | dedupe for Telegram reminders. While `open`: last close-reminder send. After `closed`: reused to mark the one-time open-reminder as sent. |
| `created_at` / `updated_at` | timestamptz not null default `now()` | `updated_at` via `set_updated_at()` trigger |

Constraints / indexes:

- `create unique index shifts_one_open on public.shifts (status) where status = 'open';`
  — the hard "only one open shift" guarantee at the DB level.
- Index on `opened_at desc` for history listing.

### `shift_movements`

Immutable log of non-sale drawer changes.

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `shift_id` | uuid → `shifts(id)` on delete cascade, not null | |
| `kind` | enum `movement_kind` (`exchange`, `cash_in`, `cash_out`) not null | |
| `cash_delta` | integer (sen) not null | effect on physical cash: `+` in, `−` out |
| `qr_delta` | integer (sen) not null default 0 | effect on QR/bank balance (exchanges only) |
| `note` | text, null | |
| `created_by` | uuid → `auth.users(id)` on delete set null, null | |
| `created_at` | timestamptz not null default `now()` | |

Index on `shift_id`.

Movement encoding:

- **Exchange, customer QR→Cash (your RM2 example):** `kind = exchange`,
  `cash_delta = −200`, `qr_delta = +200`. Drawer loses RM2 cash, QR balance gains
  RM2 — so expected cash drops by RM2 and the lighter drawer reconciles.
- **Exchange, Cash→QR (reverse):** `cash_delta = +200`, `qr_delta = −200`.
- **Cash out** (e.g. bought milk with drawer cash): `kind = cash_out`,
  `cash_delta = −N`, `qr_delta = 0`.
- **Cash in** (added cash to drawer mid-shift): `kind = cash_in`,
  `cash_delta = +N`, `qr_delta = 0`.

### `orders` (modified)

Add `shift_id uuid → shifts(id) on delete set null, null`, plus an index.

Stamped at order creation (`createOrder`) with the currently-open shift's id
(null if none open). Applies to **both** online and store orders; only the drawer
math for cash uses it. A null `shift_id` on an online order is harmless (online
isn't cash-in-drawer).

## Reconciliation Math

Computed at close (and shown live on the shift page). All sen.

```
cash_sales = sum(orders.total)
             where shift_id = X
               and normalizePaymentMethod(payment_method) = 'cash'
               and status = 'completed'

movements_cash = sum(shift_movements.cash_delta) where shift_id = X

expected_cash = opening_float + cash_sales + movements_cash

cash_difference = counted_cash − expected_cash   -- (+) over, (−) short
```

Rules:

- **Only `completed` cash orders** count toward `cash_sales`. Cancelled took no
  money; pending/preparing haven't been paid at the counter. Matches how reports
  treat completed orders as revenue truth.
- **`unpaid` ("pay later") orders don't count** until settled — when staff switch
  them to `cash` and they complete, they fall into `cash_sales` naturally.
- **QR/online is informational** at close: the screen shows QR sales for the shift
  (`normalizePaymentMethod(...) = 'duitnow-qr'`, completed) and the net QR from
  exchanges (`sum(qr_delta)`), for eyeballing against the bank app. No QR count,
  no QR difference.
- Payment method comparison uses `normalizePaymentMethod()` so legacy
  id/display-name variants group correctly (see `data/payment-methods.ts`).

The close screen renders this as a statement: opening float, `+` cash sales,
`±` movements, `=` expected cash, vs counted cash, `=` over/short.

## Enforcement — the drink-making block

The gate is on **making the drink**, never on ordering.

- **Where:** the manage actions in `app/(admin)/manage/actions.ts` — advancing an
  item to `preparing`/`done` and completing an order. Each calls a shared
  `requireOpenShift()` server-side helper first; no open shift → the action
  returns a friendly error and mutates nothing. **Server-side is authoritative**
  (mirrors how `placeStoreOrder` re-checks `inStoreMode`).
- **UX on `/manage/[token]`:** if no shift is open, item-status controls and the
  Complete button are disabled with an inline **"Open a shift to start making
  drinks"** prompt linking to `/admin/shift`.
- **Untouched:** online ordering, kiosk `placeStoreOrder` (still takes orders,
  just stamps `shift_id`), reading orders / the board.
- **Hard block on double-open:** you cannot open a second shift while one is open
  (partial unique index + a pre-check in the open action). If a stale shift is
  open, the Open control reads **"Close previous shift first"**.

## Reminder System

Two layers.

### In-app banner (primary)

A dismissible banner in the admin shell when a shift has been open past its
"should close" threshold:

- Threshold = **past midnight KL** OR **6h since the shift's last order**,
  whichever first. Kept as named constants (`STALE_AFTER_HOURS = 6`) so a
  late-trading shop is a one-line change.
- Dismiss hides it for that page load; returns on next navigation until closed.
  Noticeable, non-blocking.

### Telegram nudges (backup) via pg_cron → App Service route

- **Scheduler:** Supabase `pg_cron` runs every ~30 min and, via `pg_net`, does
  `POST /api/shift/reminder` on the App Service with a shared-secret header
  (`x-shift-cron-secret`, compared to a server env var). Only cron can trigger it.
- **Route `app/api/shift/reminder/route.ts`:** re-reads shift state via the admin
  client, decides whether a message is due (logic in the app, not cron config),
  and sends via the existing `sendTelegramMessage`. Best-effort; failures logged
  and retried next tick (same pattern as order notices).
- **Close reminder:** once past midnight KL and a shift is still `open`, send
  "Shift still open — please close & count the drawer", then repeat every **30
  min** until closed. Dedupe via `shifts.last_reminder_at` (only send if
  ≥30 min since the last one).
- **Open reminder:** if **no** shift is open and it is **≥12h after** the most
  recent shift's `closed_at`, send a **one-time** "Start a new shift?" nudge.
  Dedupe by writing `last_reminder_at` on that most-recent closed shift when the
  open-nudge is sent; only send if it is still null (or predates `closed_at`).
  Fires even on a day off — accepted as a gentle one-time ping.
- **New-order notifications are unchanged** — separate messages.
- **Secrets:** the Telegram token stays server-side in the App Service (never in
  the DB). pg_cron only knows the route URL + the shared secret.

## UI Surfaces

### Entry point — profile Staff card

Add a **Shift** `StaffRow` in `components/profile-screen.tsx` (the Staff card that
already holds Manage / Admin Dashboard / Custom Order). Gated on `canManage`
(staff, manager, admin). Links to `/admin/shift?from=profile`. Description:
*"Open, close & count the drawer."* Icon: a wallet/drawer lucide icon.

### `/admin/shift` — the one home for shift operations

- **No open shift:** an **Open shift** panel — a single whole-RM opening-float
  input + Open button. If a shift is somehow already open, this is replaced by the
  current-shift view. If a *stale* shift is open it shows "Close previous shift
  first".
- **Open shift:** summary (opened at + by, opening float, **live** cash sales,
  live QR sales, movement count), the **Drawer movements** list, an **Add
  movement** action, and a **Close shift** button.
- **Add movement form:** choose `Exchange` / `Cash in` / `Cash out`. For Exchange,
  a direction toggle (**QR → Cash** / **Cash → QR**) + whole-RM amount. For
  in/out, a whole-RM amount. Optional note. Submits to a server action.
- **Close shift dialog:** shows the reconciliation statement (opening float,
  `+` cash sales, `±` movements, `=` expected cash), a whole-RM **counted cash**
  input, then reveals **over/short** once entered, plus optional note. Confirm →
  shift closes, totals snapshot into the row, drawer locks.
- **History:** list of past shifts (opened/closed times, expected vs counted,
  difference) below the current view.

### Admin shell indicator (minimal)

A compact **"Shift open · since 9:12 AM"** / **"No shift open"** chip in the admin
shell header so staff always know the state. Tapping goes to `/admin/shift`.

### Manage page

As in Enforcement: disabled drink controls + inline prompt when no shift is open.

### Kiosk

Untouched. Ordering only. `placeStoreOrder` reads the open shift id (admin client
it already uses) and passes `shiftId` into `createOrder`.

## Access Control & RLS

Following existing role patterns (`current_user_role()`), **no `store` role** for
shifts (kiosk doesn't manage shifts).

- **Operate shifts/movements:** `admin`, `manager`, `staff` — open, close, add
  movements, view history. Written directly under RLS with their real sessions.
- **customers / guests:** no access.

RLS:

- `shifts`: select + insert + update for `current_user_role() in
  ('admin','manager','staff')`. Update restricted to the `open → closed`
  transition and close fields; a `closed` shift can't be reopened/edited (enforce
  in the close RPC and/or a policy/trigger check).
- `shift_movements`: select + insert for the same roles. **Insert-only** — no
  update/delete policy (immutable log; correct mistakes with a compensating
  movement). Matches the order-amendment-log philosophy.
- The kiosk's `placeStoreOrder` only **reads** the open shift id to stamp the
  order — no shift writes — via the admin client it already uses.
- **`/api/shift/reminder`:** protected by a shared-secret header (cron-only),
  reads state via the admin client, trusts the caller for nothing but the secret.

RPCs (`security definer`, matching existing RPC style, so completed-order totals
read consistently regardless of caller):

- `open_shift(opening_float)` — fails if an open shift exists; inserts the row
  with `opened_by = auth.uid()`.
- `add_shift_movement(kind, cash_delta, qr_delta, note)` — inserts against the
  current open shift; validates there is one.
- `close_shift(counted_cash, closing_note)` — recomputes `expected_cash`
  atomically from orders + movements, sets `counted_cash`, `cash_difference`,
  `closed_at`, `closed_by`, `status = 'closed'`.
- `current_shift_summary()` — returns the open shift + live cash/QR sales +
  movement totals for the shift page (or done via typed queries in a lib module).

## Files (indicative)

**Migrations (`supabase/migrations/`):**

- `..._shift_schema.sql` — enums `shift_status`, `movement_kind`; `shifts`,
  `shift_movements` tables; partial unique index; RLS; `set_updated_at` trigger.
- `..._orders_shift_id.sql` — add `orders.shift_id` + index (separate file).
- `..._shift_rpcs.sql` — `open_shift`, `add_shift_movement`, `close_shift`,
  summary RPC.
- `..._shift_reminder_cron.sql` — enable `pg_cron` + `pg_net`; schedule the
  ~30-min job that POSTs to `/api/shift/reminder` with the secret header.

**App / lib:**

- `lib/shifts/store.ts` — typed reads/writes (open shift, summary, history,
  movements), calling the RPCs.
- `lib/shifts/reconcile.ts` — pure expected-cash math + KL-time staleness helpers
  (constants `STALE_AFTER_HOURS`).
- `lib/shifts/require-open.ts` — `requireOpenShift()` used by manage actions.
- `app/(admin)/admin/shift/page.tsx` + actions — the shift home.
- `components/admin/shift-*.tsx` — open panel, movements list, add-movement form,
  close dialog, history, shell indicator chip.
- `app/api/shift/reminder/route.ts` — cron-triggered Telegram reminder route.
- Edit `app/(admin)/manage/actions.ts` — gate drink-making on `requireOpenShift`.
- Edit `components/order-detail.tsx` (+ any item-status control) — disabled state
  + prompt when no shift is open.
- Edit `lib/orders/store.ts#createOrder` + `OrderDraft` type — accept/stamp
  `shiftId`.
- Edit `app/(store)/store/(kiosk)/actions.ts#placeStoreOrder` — resolve + pass the
  open shift id.
- Edit `components/profile-screen.tsx` — add the **Shift** StaffRow.
- Edit `components/admin/admin-shell.tsx` — add the shift-state chip.
- `types/shift.ts` — Shift, ShiftMovement, movement kinds, summary types.

## Testing / Verification

Per AGENTS.md: no JS test framework. Gate on `npm run build` (EXIT 0) and scoped
`npx eslint <changed paths>`. Manual verification:

- Open a shift with RM50 float; place & complete a cash order; confirm live cash
  sales update.
- Add a QR→Cash exchange of RM2; confirm expected cash drops by RM2.
- Add cash-out RM10 (milk); confirm expected cash drops by RM10.
- Close with a counted amount; confirm over/short is `counted − expected`.
- With no shift open, confirm drink-making on `/manage` is blocked but ordering
  (kiosk + online) still works, and kiosk orders stamp null `shift_id`.
- Confirm a second open is refused while one is open.
- Confirm the reminder route sends only when due and dedupes via
  `last_reminder_at` (test by calling the route with the secret and varying state).

## Open Questions

None outstanding. Late-night trading past midnight is assumed rare; the staleness
threshold is a named constant if that changes.
