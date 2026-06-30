# Pay-Later Store Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let store/kiosk staff place an order with payment unresolved ("Pay later"), resolve the real method (Cash / DuitNow QR) afterward, gated behind an admin toggle — without corrupting the cash-vs-QR split in reports.

**Architecture:** A pay-later order is stored with the sentinel `payment_method = 'unpaid'` (no `orders` migration — it's just another text value). An admin toggle (`pay_later_enabled` on the single-row `payment_settings` table) controls whether the kiosk offers the option. Staff resolve the method anytime on the order detail screen, and a guard at order completion blocks completing a still-unpaid order — which guarantees no `'unpaid'` order ever reaches reports. Reports also skip `'unpaid'` rows as a backstop.

**Tech Stack:** Next.js 16 (App Router, Server Components + server actions), TypeScript (strict), Supabase (Postgres + RLS), Tailwind, shadcn/ui.

## Global Constraints

- Money is stored as integers in sen. (not relevant to payment method, but don't introduce floats anywhere)
- No `any`. Strict TypeScript.
- This project has **no automated test framework**. Verification per task = `npm run lint` and (where types change across files) `npm run build`, plus the manual checks listed in each task. Do NOT add a test framework.
- Settings tables are single-row, admin-only write / world read, reusing `public.set_updated_at()` and `public.current_user_role()`.
- Sentinel value is the literal string `"unpaid"`. Reference it via the exported `UNPAID_PAYMENT_METHOD` constant (Task 2), never as a bare magic string in new code.
- Store payment methods are exactly `"cash"` and `"duitnow-qr"`. `"unpaid"` is never a customer-selectable method and is never accepted by the resolution action.
- The feature defaults OFF (`pay_later_enabled` default `false`) so existing behavior is unchanged until an admin switches it on.
- Follow existing file patterns exactly (server action shape `{ ok: true } | { ok: false; error }`, `revalidatePath` after mutations, `canManageOrders()` / `isAdmin()` gating).

---

### Task 1: Add `pay_later_enabled` column to `payment_settings`

**Files:**
- Create: `supabase/migrations/20260630120000_payment_settings_pay_later.sql`

**Interfaces:**
- Produces: a `pay_later_enabled boolean not null default false` column on `public.payment_settings`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260630120000_payment_settings_pay_later.sql`:

```sql
-- Pay-later toggle for the store/kiosk: when on, staff can place a store order
-- before payment is decided (payment_method = 'unpaid') and resolve it later.
-- Defaults OFF so existing behavior is unchanged until an admin enables it.
alter table public.payment_settings
  add column pay_later_enabled boolean not null default false;

comment on column public.payment_settings.pay_later_enabled is
  'When true, the kiosk offers a "Pay later" option that places store orders as payment_method = ''unpaid'' for later resolution.';
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push` (or apply via your migration workflow / the Supabase MCP `apply_migration`).
Expected: migration applies cleanly; `payment_settings` now has `pay_later_enabled`.

- [ ] **Step 3: Verify the column exists and defaults false**

Run this query (Supabase SQL editor or MCP `execute_sql`):

```sql
select pay_later_enabled from public.payment_settings;
```

Expected: one row, value `false`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260630120000_payment_settings_pay_later.sql
git commit -m "feat(store): add pay_later_enabled to payment_settings"
```

---

### Task 2: Add the `unpaid` sentinel to payment-methods helpers

**Files:**
- Modify: `data/payment-methods.ts`

**Interfaces:**
- Produces: `export const UNPAID_PAYMENT_METHOD = "unpaid"`. `paymentMethodLabel("unpaid")` returns `"Unpaid"`. `"unpaid"` is NOT added to the `paymentMethods` catalog.

- [ ] **Step 1: Add the sentinel constant and label handling**

In `data/payment-methods.ts`, after the `defaultPaymentMethodId` declaration (currently line 76), add:

```ts
// Sentinel payment_method for a store order placed before payment is decided
// ("Pay later"). NOT a member of `paymentMethods` — it must never be a
// customer-selectable method — but it is a valid stored value that staff later
// overwrite with a real method. See paymentMethodLabel below for its label.
export const UNPAID_PAYMENT_METHOD = "unpaid";
```

Then change `paymentMethodLabel` (currently lines 99-103) to label the sentinel explicitly:

```ts
// Human-readable label for a stored payment_method value. Falls back to a
// prettified form for any value not in the catalogue (legacy/removed methods).
export function paymentMethodLabel(value: string): string {
  if (value === UNPAID_PAYMENT_METHOD) return "Unpaid";
  const method = methodById.get(normalizePaymentMethod(value));
  if (method) return method.name;
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add data/payment-methods.ts
git commit -m "feat(store): add unpaid payment-method sentinel + label"
```

---

### Task 3: Read & write `payLaterEnabled` in payment settings

**Files:**
- Modify: `lib/settings/payments.ts`
- Modify: `app/(admin)/admin/settings/actions.ts:46-90` (`updatePaymentSettings`)

**Interfaces:**
- Consumes: `pay_later_enabled` column (Task 1).
- Produces: `PaymentSettings.payLaterEnabled: boolean`; `getPaymentSettings()` returns it; `updatePaymentSettings()` persists it. `DEFAULT_PAYMENT_SETTINGS.payLaterEnabled === false`.

- [ ] **Step 1: Extend the `PaymentSettings` type and default**

In `lib/settings/payments.ts`, add `payLaterEnabled` to the `PaymentSettings` type (after `duitnowQrUrl`, currently line 19):

```ts
export type PaymentSettings = {
  categories: Record<PaymentCategoryId, boolean>;
  methods: Record<PaymentMethodId, boolean>;
  bank: BankDetails;
  // Public URL of the uploaded DuitNow QR; null = use the bundled fallback.
  duitnowQrUrl: string | null;
  // When true, the kiosk offers a "Pay later" option (store orders only).
  payLaterEnabled: boolean;
};
```

Add it to `DEFAULT_PAYMENT_SETTINGS` (after `duitnowQrUrl: null`, currently line 38). Note this default is `false` — but see the comment: payment config fails OPEN. Pay-later defaulting to `false` is correct because it's a feature gate, not a checkout blocker:

```ts
  duitnowQrUrl: null,
  payLaterEnabled: false,
};
```

- [ ] **Step 2: Read the column**

In `lib/settings/payments.ts`, add `pay_later_enabled: boolean;` to the `Row` type (after `duitnow_qr_url`, currently line 58). Add `, pay_later_enabled` to the end of the `COLUMNS` string (currently lines 61-65). In `map()` add the field (after `duitnowQrUrl: row.duitnow_qr_url`, currently line 91):

```ts
    duitnowQrUrl: row.duitnow_qr_url,
    payLaterEnabled: row.pay_later_enabled,
  };
```

- [ ] **Step 3: Persist the column**

In `app/(admin)/admin/settings/actions.ts`, inside `updatePaymentSettings`'s `.update({ ... })` (currently ends with `duitnow_qr_url` at line 77), add:

```ts
      duitnow_qr_url: input.duitnowQrUrl?.trim() ? input.duitnowQrUrl.trim() : null,
      pay_later_enabled: input.payLaterEnabled,
    })
```

- [ ] **Step 4: Build (types cross files here)**

Run: `npm run build`
Expected: compiles. If it fails on `PaymentSettingsForm` not supplying `payLaterEnabled`, that's Task 4 — for now confirm the error is ONLY about the form's `useState<PaymentSettings>(initial)` (initial already carries the field from the server, so it should actually be fine) and not about `lib/settings/payments.ts` or the action.

- [ ] **Step 5: Commit**

```bash
git add lib/settings/payments.ts "app/(admin)/admin/settings/actions.ts"
git commit -m "feat(store): read/write payLaterEnabled in payment settings"
```

---

### Task 4: Add the toggle to the admin Payments form

**Files:**
- Modify: `components/admin/payment-settings-form.tsx`

**Interfaces:**
- Consumes: `PaymentSettings.payLaterEnabled` (Task 3).
- Produces: a Switch in the Payments settings card bound to `s.payLaterEnabled`.

- [ ] **Step 1: Render the toggle**

In `components/admin/payment-settings-form.tsx`, add a bordered toggle row immediately AFTER the `paymentCategories.map(...)` block closes (after its closing `})}` — currently line 146, just before the `{msg && ...}` block at line 148):

```tsx
      <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-muted/40 p-3.5">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-heading text-sm font-semibold">Allow &ldquo;Pay later&rdquo; at kiosk</span>
          <span className="text-xs text-muted-foreground">
            Staff can place a store order before payment is decided, then set it later.
          </span>
        </div>
        <Switch
          checked={s.payLaterEnabled}
          onCheckedChange={(v) => setS({ ...s, payLaterEnabled: v })}
        />
      </div>
```

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Manual check**

Start the app (`npm run dev`), sign in as admin, open `/admin/settings`. Confirm the "Allow 'Pay later' at kiosk" toggle renders in the Payments card, toggling + "Save payments" persists (reload the page → state sticks).

- [ ] **Step 4: Commit**

```bash
git add components/admin/payment-settings-form.tsx
git commit -m "feat(store): admin toggle for kiosk pay-later"
```

---

### Task 5: Place store orders as `unpaid` from the kiosk

**Files:**
- Modify: `app/(store)/store/(kiosk)/actions.ts:26-57` (`PlaceStoreOrderInput` + `placeStoreOrder` gates)
- Modify: `app/(store)/store/(kiosk)/checkout/page.tsx`
- Modify: `components/store/store-checkout.tsx`

**Interfaces:**
- Consumes: `getPaymentSettings().payLaterEnabled` (Task 3), `UNPAID_PAYMENT_METHOD` (Task 2).
- Produces: kiosk can submit `paymentMethod: "unpaid"`; `placeStoreOrder` accepts it only when `payLaterEnabled`.

- [ ] **Step 1: Widen the server action input + add the gate**

In `app/(store)/store/(kiosk)/actions.ts`:

Import the sentinel at the top with the other imports:

```ts
import { UNPAID_PAYMENT_METHOD } from "@/data/payment-methods";
```

Widen `PlaceStoreOrderInput.paymentMethod` (currently line 28):

```ts
  paymentMethod: "cash" | "duitnow-qr" | "unpaid";
```

In `placeStoreOrder`, after the existing cash/qr validation block (currently lines 51-57, right after the `qrOk` check), add the pay-later gate:

```ts
  if (input.paymentMethod === UNPAID_PAYMENT_METHOD && !payments.payLaterEnabled)
    return { ok: false, error: "Pay later is not available." };
```

(The existing cash/qr `if` checks remain unchanged. `payments` is already in scope from `getPaymentSettings()` at the existing line 51.)

- [ ] **Step 2: Pass `payLaterEnabled` into the checkout UI**

In `app/(store)/store/(kiosk)/checkout/page.tsx`, pass the new prop (the `payments` object already carries it):

```tsx
  return (
    <StoreCheckout
      cashOk={cashOk}
      qrOk={qrOk}
      payLaterEnabled={payments.payLaterEnabled}
      qrUrl={payments.duitnowQrUrl}
      closedMessage={settings.isOpen ? null : settings.closedMessage}
    />
  );
```

- [ ] **Step 3: Render the "Pay later" button + widen the client method type**

In `components/store/store-checkout.tsx`:

Change the `Method` type (currently line 12):

```ts
type Method = "cash" | "duitnow-qr" | "unpaid";
```

Add `payLaterEnabled` to the component props (in the destructured params + their type, currently lines 14-24):

```tsx
export function StoreCheckout({
  cashOk,
  qrOk,
  payLaterEnabled,
  qrUrl,
  closedMessage,
}: {
  cashOk: boolean;
  qrOk: boolean;
  payLaterEnabled: boolean;
  qrUrl: string | null;
  closedMessage: string | null;
}) {
```

Add the "Pay later" button inside the method list, AFTER the `qrOk` button block and BEFORE the `{!cashOk && !qrOk && ...}` fallback (currently between lines 106 and 107):

```tsx
        {payLaterEnabled && (
          <button type="button" onClick={() => setMethod("unpaid")} aria-pressed={method === "unpaid"} className={`h-14 rounded-2xl border text-sm font-semibold ${method === "unpaid" ? "border-black bg-black text-white" : "border-border bg-white"}`}>
            Pay later
          </button>
        )}
```

Update the empty-state condition so it only shows when NOTHING is available (currently line 107 `{!cashOk && !qrOk && (`):

```tsx
        {!cashOk && !qrOk && !payLaterEnabled && (
```

(The `qrUrl` block stays gated on `method === "duitnow-qr"`, so choosing "Pay later" shows no QR — correct.)

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Manual check**

With the admin toggle ON: open the kiosk (`/store`), add a drink, go to checkout. Confirm a third "Pay later" button appears. Place an order with it. Then verify in the DB:

```sql
select order_number, payment_method, source, status
from public.orders order by created_at desc limit 1;
```

Expected: newest row has `payment_method = 'unpaid'`, `source = 'store'`, `status = 'pending'`.

With the toggle OFF: reload the kiosk checkout, confirm only Cash / DuitNow QR show.

- [ ] **Step 6: Commit**

```bash
git add "app/(store)/store/(kiosk)/actions.ts" "app/(store)/store/(kiosk)/checkout/page.tsx" components/store/store-checkout.tsx
git commit -m "feat(store): kiosk Pay later places order as unpaid"
```

---

### Task 6: Add the `setOrderPayment` resolution helper + action

**Files:**
- Modify: `lib/orders/store.ts` (add `setOrderPayment`)
- Modify: `app/(admin)/manage/actions.ts` (add `setOrderPaymentAction`)

**Interfaces:**
- Consumes: `UNPAID_PAYMENT_METHOD` (Task 2), `getOrderByToken` (existing in `lib/orders/store.ts`).
- Produces:
  - `setOrderPayment(token: string, method: "cash" | "duitnow-qr"): Promise<Order | null>` in `lib/orders/store.ts`.
  - `setOrderPaymentAction(token: string, method: "cash" | "duitnow-qr"): Promise<OrderActionResult>` in `app/(admin)/manage/actions.ts`.

- [ ] **Step 1: Add the store helper**

In `lib/orders/store.ts`, add after `cancelOrder` (currently ends at line 294), before `cancelOrderAsSystem`:

```ts
// Set the real payment method on an order. Used to resolve a "pay later" store
// order (payment_method = 'unpaid') once the customer pays. Staff-only; callers
// gate first. Uses the cookie client so the staff RLS update policy applies.
// Only ever moves TO a real method — never back to 'unpaid'.
export async function setOrderPayment(
  token: string,
  method: "cash" | "duitnow-qr",
): Promise<Order | null> {
  const db = await createClient();
  const { error } = await db
    .from("orders")
    .update({ payment_method: method })
    .eq("token", token);
  if (error) return null;
  return getOrderByToken(token);
}
```

- [ ] **Step 2: Add the server action**

In `app/(admin)/manage/actions.ts`, add `setOrderPayment` to the import from `@/lib/orders/store` (currently lines 6-13):

```ts
import {
  cancelOrder,
  completeOrder,
  countOrdersByGroup,
  getOrderByToken,
  listOrdersPage,
  setItemStatus,
  setOrderPayment,
} from "@/lib/orders/store";
```

Add the action at the end of the file (after `cancelOrderAction`, currently ends line 131):

```ts
// Resolve the payment method on a "pay later" store order. Only Cash / DuitNow QR
// are accepted — never 'unpaid' (resolution only moves away from unpaid).
export async function setOrderPaymentAction(
  token: string,
  method: "cash" | "duitnow-qr",
): Promise<OrderActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  if (method !== "cash" && method !== "duitnow-qr") {
    return { ok: false, error: "Invalid payment method." };
  }
  const updated = await setOrderPayment(token, method);
  if (!updated) return { ok: false, error: "Order not found." };

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");
  return { ok: true, orderStatus: updated.status };
}
```

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: both pass (action is exported but not yet used — that's Task 7/8).

- [ ] **Step 4: Commit**

```bash
git add lib/orders/store.ts "app/(admin)/manage/actions.ts"
git commit -m "feat(store): setOrderPayment helper + staff action"
```

---

### Task 7: "Set payment" control + Unpaid badge on order detail

**Files:**
- Modify: `components/order-detail.tsx`

**Interfaces:**
- Consumes: `setOrderPaymentAction` (Task 6), `UNPAID_PAYMENT_METHOD` (Task 2), `Order.paymentMethod` (existing).
- Produces: when `order.paymentMethod === "unpaid"`, the Payment cell shows an "Unpaid" badge and a Cash / DuitNow QR picker that calls `setOrderPaymentAction` and refreshes.

- [ ] **Step 1: Wire imports + local state**

In `components/order-detail.tsx`:

Add to the existing action import (currently lines 12-16):

```ts
import {
  cancelOrderAction,
  markReadyAndNotify,
  setOrderPaymentAction,
  updateDrinkStatus,
} from "@/app/(admin)/manage/actions";
```

Add the sentinel import near the `paymentMethodLabel` import (currently line 11):

```ts
import { paymentMethodLabel, UNPAID_PAYMENT_METHOD } from "@/data/payment-methods";
```

Add local state for the resolved method + in-flight/error, alongside the other `useState` calls (after `cancelError`, currently line 59). The local `paymentMethod` lets the UI update without a full reload:

```ts
  const [paymentMethod, setPaymentMethod] = useState(order.paymentMethod);
  const [settingPayment, setSettingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
```

Add a handler next to the other handlers (e.g. after `confirmCancelOrder`, currently line 139):

```ts
  // Resolve a pay-later order's method. Staff-only; the action re-checks auth.
  function resolvePayment(method: "cash" | "duitnow-qr") {
    setPaymentError(null);
    setSettingPayment(true);
    startTransition(async () => {
      const res = await setOrderPaymentAction(order.token, method);
      setSettingPayment(false);
      if (!res.ok) {
        setPaymentError(res.error);
        return;
      }
      setPaymentMethod(method);
    });
  }

  const isUnpaid = paymentMethod === UNPAID_PAYMENT_METHOD;
```

- [ ] **Step 2: Replace the Payment cell with badge + picker**

Replace the Payment `<div>` in the `<dl>` (currently lines 242-245):

```tsx
        <div className="rounded-2xl bg-neutral-100 px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">Payment</dt>
          <dd className="mt-0.5 text-sm font-bold">{paymentMethodLabel(order.paymentMethod)}</dd>
        </div>
```

with:

```tsx
        <div className="rounded-2xl bg-neutral-100 px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">Payment</dt>
          {isUnpaid ? (
            <dd className="mt-1 flex flex-col gap-2">
              <span className="inline-flex w-fit items-center rounded-full bg-amber-100 px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-amber-700">
                Unpaid
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => resolvePayment("cash")}
                  disabled={settingPayment}
                  className="h-8 flex-1 rounded-xl border border-border bg-white text-xs font-semibold disabled:opacity-50"
                >
                  Cash
                </button>
                <button
                  type="button"
                  onClick={() => resolvePayment("duitnow-qr")}
                  disabled={settingPayment}
                  className="h-8 flex-1 rounded-xl border border-border bg-white text-xs font-semibold disabled:opacity-50"
                >
                  DuitNow QR
                </button>
              </div>
              {paymentError && <span className="text-xs text-rose-600">{paymentError}</span>}
            </dd>
          ) : (
            <dd className="mt-0.5 text-sm font-bold">{paymentMethodLabel(paymentMethod)}</dd>
          )}
        </div>
```

- [ ] **Step 3: Lint + build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Manual check**

Open a pay-later order at `/manage/[token]`. Confirm the Payment cell shows an "Unpaid" badge + Cash / DuitNow QR buttons. Tap "Cash"; confirm it switches to showing "Cash" and persists across reload. Verify in DB the `payment_method` is now `cash`.

- [ ] **Step 5: Commit**

```bash
git add components/order-detail.tsx
git commit -m "feat(store): set-payment control + Unpaid badge on order detail"
```

---

### Task 8: Block completing a still-unpaid order

**Files:**
- Modify: `app/(admin)/manage/actions.ts:75-114` (`markReadyAndNotify`)
- Modify: `components/order-detail.tsx` (surface the block in the completion flow)

**Interfaces:**
- Consumes: `markReadyAndNotify` (existing), `getOrderByToken` (existing), `UNPAID_PAYMENT_METHOD` (Task 2), the resolution UI from Task 7.
- Produces: `markReadyAndNotify` returns `{ ok: false, error }` for an unpaid order; the detail screen shows the error and keeps the completion modal open.

- [ ] **Step 1: Guard the completion action**

In `app/(admin)/manage/actions.ts`, import the sentinel (add to the top imports):

```ts
import { UNPAID_PAYMENT_METHOD } from "@/data/payment-methods";
```

In `markReadyAndNotify`, after the `if (!order) ...` check (currently line 82) and BEFORE `completeOrder` is called, add the guard:

```ts
  if (order.paymentMethod === UNPAID_PAYMENT_METHOD) {
    return { ok: false, error: "Set the payment method before completing this order." };
  }
```

- [ ] **Step 2: Surface the block in the detail UI**

First add the error state with the other `useState` declarations (alongside the Task 7 additions near line 59 — NOT inside any function, to satisfy the rules of hooks):

```ts
  const [completeError, setCompleteError] = useState<string | null>(null);
```

Then `confirmComplete` currently fires `markReadyAndNotify` and unconditionally closes the modal (lines 101-113). Replace `confirmComplete` (lines 101-113) with a version that respects a failed result:

```tsx
  function confirmComplete() {
    setCompleting(true);
    setCompleteError(null);
    startTransition(async () => {
      if (persist) {
        const res = await markReadyAndNotify(order.token);
        setCompleting(false);
        if (!res.ok) {
          // Most common cause: order still 'unpaid'. Keep the modal open and
          // tell staff to resolve payment first (the picker is in the modal).
          setCompleteError(res.error);
          return;
        }
      } else {
        setCompleting(false);
      }
      setShowComplete(false);
      if (persist && waReadyLink) window.location.href = waReadyLink;
    });
  }
```

Also clear the error when the modal is cancelled: in `cancelComplete` (currently lines 117-121), add `setCompleteError(null);` as the first line.

- [ ] **Step 3: Show payment resolution inside the completion modal**

The simplest correct UX: when completion is blocked, the staff member scrolls to the Payment cell (Task 7) which already has the picker. To make that obvious, pass `completeError` into `OrderCompleteModal` and render it. Update the `OrderCompleteModal` usage in `order-detail.tsx` (find `<OrderCompleteModal ... />`) to pass the error, and add an `error?: string | null` prop to the modal.

In `components/order-complete-modal.tsx`, add `error` to the props type and destructure:

```tsx
export function OrderCompleteModal({
  orderNumber,
  busy,
  hasContactPhone,
  error,
  onConfirm,
  onCancel,
}: {
  orderNumber: string;
  busy: boolean;
  hasContactPhone: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
```

Render it just above the confirm button (before the `<button ... onClick={onConfirm}>`):

```tsx
        {error && (
          <p className="mt-4 w-full rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {error}
          </p>
        )}
```

In `order-detail.tsx`, pass it where the modal is rendered:

```tsx
        error={completeError}
```

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Manual check**

Take a pay-later (unpaid) order, advance all drinks to done so the completion modal opens. Tap "Complete" — confirm it does NOT complete and shows "Set the payment method before completing this order." Close the modal, resolve payment via the Payment cell picker (Task 7), advance/complete again — confirm it now completes. Verify in DB the order is `completed` with a real `payment_method`.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/manage/actions.ts" components/order-detail.tsx components/order-complete-modal.tsx
git commit -m "feat(store): block completing an unpaid order until payment set"
```

---

### Task 9: Unpaid badge on the order card

**Files:**
- Modify: `components/order-card.tsx`

**Interfaces:**
- Consumes: `UNPAID_PAYMENT_METHOD` (Task 2), `Order.paymentMethod` (existing).
- Produces: an "Unpaid" badge next to the payment label on the board list card.

- [ ] **Step 1: Render the badge**

In `components/order-card.tsx`, import the sentinel (add to the `paymentMethodLabel` import, currently line 8):

```ts
import { paymentMethodLabel, UNPAID_PAYMENT_METHOD } from "@/data/payment-methods";
```

Replace the payment label span (currently line 42):

```tsx
            <span className="font-medium">{paymentMethodLabel(order.paymentMethod)}</span>
```

with:

```tsx
            {order.paymentMethod === UNPAID_PAYMENT_METHOD ? (
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-amber-700">
                Unpaid
              </span>
            ) : (
              <span className="font-medium">{paymentMethodLabel(order.paymentMethod)}</span>
            )}
```

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Manual check**

Open `/manage`. Confirm a pay-later order's card shows the amber "Unpaid" badge in place of a payment method, and resolved orders show their normal method label.

- [ ] **Step 4: Commit**

```bash
git add components/order-card.tsx
git commit -m "feat(store): Unpaid badge on order board card"
```

---

### Task 10: Exclude `unpaid` from the reports payment breakdown

**Files:**
- Modify: `lib/analytics/reports.ts:78-99` (the `payMap` aggregation)

**Interfaces:**
- Consumes: `UNPAID_PAYMENT_METHOD` (Task 2).
- Produces: `paymentBreakdown` never contains an `"unpaid"` row.

- [ ] **Step 1: Skip unpaid rows when aggregating**

In `lib/analytics/reports.ts`, import the sentinel (add to the existing `@/data/payment-methods` import, currently line 2):

```ts
import { normalizePaymentMethod, UNPAID_PAYMENT_METHOD } from "@/data/payment-methods";
```

In the `for (const o of completed)` loop, inside the payment-aggregation part (currently lines 87-91), skip the sentinel. Replace:

```ts
    // Group on the canonical method id so legacy display-name variants
    // ("DuitNow QR", "Duitnow QR") collapse into the same method as "duitnow-qr".
    const method = normalizePaymentMethod(o.payment_method);
    const p = payMap.get(method) ?? { orders: 0, revenue: 0 };
    p.orders += 1; p.revenue += o.total;
    payMap.set(method, p);
```

with:

```ts
    // Group on the canonical method id so legacy display-name variants
    // ("DuitNow QR", "Duitnow QR") collapse into the same method as "duitnow-qr".
    // Skip the 'unpaid' sentinel — the completion guard already prevents an
    // unpaid order from completing, so this is a belt-and-suspenders backstop.
    const method = normalizePaymentMethod(o.payment_method);
    if (method !== UNPAID_PAYMENT_METHOD) {
      const p = payMap.get(method) ?? { orders: 0, revenue: 0 };
      p.orders += 1; p.revenue += o.total;
      payMap.set(method, p);
    }
```

(Revenue / order-count totals are NOT keyed on method, so they stay correct and need no change.)

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Manual check**

Open `/admin/reports` (or wherever the reports view lives). Confirm there is no "Unpaid" bucket in the payment breakdown, and revenue/order totals look correct. (To force-verify the backstop: temporarily set a completed order's `payment_method` to `'unpaid'` in the DB, reload reports, confirm it's excluded from the breakdown but the order is still counted in totals — then revert.)

- [ ] **Step 4: Commit**

```bash
git add lib/analytics/reports.ts
git commit -m "feat(store): exclude unpaid sentinel from reports breakdown"
```

---

## End-to-end verification (after all tasks)

Run the full flow once, toggle ON:

1. `/admin/settings` → enable "Allow 'Pay later' at kiosk", save.
2. Kiosk `/store` → add drinks → checkout → "Pay later" → place. Note the order number.
3. `/manage` → the order card shows "Unpaid".
4. Open it → advance all drinks → completion modal → "Complete" is blocked with the payment message.
5. Resolve payment (Cash) via the Payment cell → complete again → completes.
6. `/admin/reports` → the completed order appears in revenue/totals, the breakdown shows it under "Cash", no "Unpaid" bucket.
7. `/admin/settings` → disable the toggle → kiosk checkout shows only Cash / DuitNow QR.

Final: `npm run lint && npm run build` both green.

---

## Self-Review Notes

- **Spec coverage:** §1 sentinel → Task 2; §2 admin toggle → Tasks 1,3,4; §3 kiosk → Task 5, resolution detail → Tasks 6,7, completion guard → Task 8, badge → Tasks 7,9; §4 reports → Task 10. All spec sections covered.
- **Type consistency:** `setOrderPayment` / `setOrderPaymentAction` / `UNPAID_PAYMENT_METHOD` / `payLaterEnabled` used identically across tasks. Store methods constrained to `"cash" | "duitnow-qr"` everywhere resolution happens.
- **No test framework:** verification is lint + build + manual, matching the project (no test files exist).
