# Pay-Later Store Orders — Design

**Date:** 2026-06-30
**Status:** Approved (design)

## Problem

In the kiosk/store surface (`/store`), staff take orders on behalf of customers.
Today the kiosk checkout (`components/store/store-checkout.tsx`) forces staff to
pick **Cash** or **DuitNow QR** before placing the order, and that choice is
written to `orders.payment_method`.

But customers often pay *after* receiving the drink, so at order time staff don't
yet know how payment will land. A wrong guess corrupts the cash-vs-QR split in
reports, because `lib/analytics/reports.ts` builds the payment breakdown by
grouping completed orders on `payment_method`.

We want staff to be able to place a store order with payment **unresolved**, then
set the real method later — and we want this controllable by an admin toggle so it
can be switched off once customers self-order at the kiosk.

## Goals

- Let staff place a store order without committing to a payment method.
- Let staff resolve the real method (Cash / DuitNow QR) afterward.
- Guarantee an unpaid order can never reach reports as a real payment method.
- Gate the whole feature behind an admin toggle in `/admin/settings`, default OFF
  (today's behavior unchanged until switched on).

## Non-Goals

- No change to the online customer checkout — this is store/kiosk only.
- No payment history / audit trail of "was unpaid, then resolved". Once resolved,
  an order looks like any normal order.
- No new payment methods beyond the existing Cash / DuitNow QR for store orders.

## Design

### 1. Data model — sentinel value, no orders migration

`orders.payment_method` is `not null text` and the codebase already treats it as
free text canonicalized by `normalizePaymentMethod` / labelled by
`paymentMethodLabel` (`data/payment-methods.ts`).

A pay-later order is stored with **`payment_method = 'unpaid'`** — just another text
value, so no migration on `orders` is needed. Resolution overwrites the column with
`'cash'` or `'duitnow-qr'`; there is no separate paid/unpaid column to keep in sync.

Add `'unpaid'` handling to `data/payment-methods.ts`:
- `paymentMethodLabel('unpaid')` → `"Unpaid"`.
- `'unpaid'` is **not** added to the `paymentMethods` catalog (it must never appear
  as a customer-selectable method).
- Export a small constant/helper so other modules reference the sentinel by name
  rather than a magic string (e.g. `UNPAID_PAYMENT_METHOD = "unpaid"`).

**Why a sentinel over a `payment_status` column:** the method already tells you
whether it's resolved, so a second column is redundant and adds a sync burden. The
sentinel is simpler and reports stay clean via the completion guard below.

### 2. Admin settings toggle

Add one boolean to the single-row `payment_settings` table:

- Migration: `alter table public.payment_settings add column pay_later_enabled
  boolean not null default false;` (default false → existing behavior preserved).
- Extend `lib/settings/payments.ts`: add `payLaterEnabled` to `PaymentSettings`,
  to `DEFAULT_PAYMENT_SETTINGS` (`false`), to the `Row` type, `COLUMNS`, and `map()`.
- Surface it in `components/admin/payment-settings-form.tsx` and its save action as
  a toggle labelled **"Allow 'Pay later' at kiosk"** with hint *"Staff can place a
  store order before payment is decided, then set it later."*
- Admin-only write / world read, identical to the existing toggles on the table.

### 3. Kiosk + resolution flow

**Kiosk checkout (`components/store/store-checkout.tsx`):**
- The store checkout page passes a new `payLaterEnabled` prop (read from
  `getPaymentSettings()` where `cashOk` / `qrOk` are already derived).
- When `payLaterEnabled` is true, render a third button below Cash / DuitNow QR:
  **"Pay later"**. Selecting it submits with `paymentMethod = 'unpaid'`.
- The `Method` union widens to `"cash" | "duitnow-qr" | "unpaid"`.

**Server action (`app/(store)/store/(kiosk)/actions.ts` `placeStoreOrder`):**
- Widen `PlaceStoreOrderInput.paymentMethod` to include `'unpaid'`.
- Add a gate mirroring the existing cash/qr checks: if `paymentMethod === 'unpaid'`
  and `!payments.payLaterEnabled`, return an error. Defense in depth — the kiosk
  already hides the button when off.

**Resolution — two touchpoints (the "Both" decision):**

1. **Order detail screen (`components/order-detail.tsx`):** when
   `order.paymentMethod === 'unpaid'`, show a **"Set payment"** control (Cash /
   DuitNow QR picker). A new staff-only server action in
   `app/(admin)/manage/actions.ts` writes the chosen method to the order and
   revalidates `/manage` + `/manage/[token]`. This is the anytime path — resolve
   the moment the customer pays.

2. **At completion (`markReadyAndNotify` in `app/(admin)/manage/actions.ts`):** if
   the order is still `'unpaid'` when staff confirm completion, block completion and
   require a method first (same Cash/QR picker, surfaced in the completion modal).
   This is the safety net that **guarantees** no unpaid order reaches reports.

**Visibility:** show a small **"Unpaid"** badge on the order card
(`components/order-card.tsx`) and order detail so staff can spot unresolved orders
on the board at a glance.

### 4. Reports

- In `lib/analytics/reports.ts`, exclude `'unpaid'` rows from `paymentBreakdown`
  (belt-and-suspenders; the completion guard already prevents a completed order from
  being `'unpaid'`). All other totals (revenue, counts, source split) are unaffected
  since they don't key on method.
- `paymentMethodLabel('unpaid')` → "Unpaid" covers any in-progress unpaid order
  shown on the board / detail.

## New staff server action

`setOrderPayment(token, method)` in `app/(admin)/manage/actions.ts`:
- Gate with `canManageOrders()`.
- Validate `method` is one of the allowed store methods (`cash`, `duitnow-qr`) —
  never accept `'unpaid'` here (resolution only moves *away* from unpaid).
- Update `orders.payment_method` via a store helper (cookie client, staff RLS
  update policy applies), revalidate `/manage` and `/manage/[token]`.

## Testing

1. Toggle OFF (default): kiosk shows only Cash / DuitNow QR — unchanged.
2. Toggle ON: kiosk shows a third "Pay later" button; placing creates an order with
   `payment_method = 'unpaid'`.
3. Order board / detail show an **"Unpaid"** badge.
4. "Set payment" on detail writes the chosen method; badge clears; method persists.
5. Completing a still-unpaid order is blocked until a method is chosen.
6. Reports show no "Unpaid" bucket in the payment breakdown; revenue totals correct.
7. `placeStoreOrder` rejects `'unpaid'` when the setting is off (server gate).

## Files Touched

- `supabase/migrations/<ts>_payment_settings_pay_later.sql` (new column)
- `lib/settings/payments.ts`
- `components/admin/payment-settings-form.tsx` (+ its save action)
- `data/payment-methods.ts` (sentinel label/helper)
- `components/store/store-checkout.tsx`
- `app/(store)/store/(kiosk)/actions.ts`
- store checkout page (passes `payLaterEnabled`)
- `app/(admin)/manage/actions.ts` (new `setOrderPayment`, completion guard)
- `components/order-detail.tsx` (Set payment control + badge)
- `components/order-card.tsx` (Unpaid badge)
- `lib/orders/store.ts` (set-payment helper)
- `lib/analytics/reports.ts` (exclude unpaid from breakdown)
