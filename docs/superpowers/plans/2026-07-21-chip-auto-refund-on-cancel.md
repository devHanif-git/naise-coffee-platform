# CHIP Auto-Refund on Order Cancel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff refund a CHIP-gateway-paid order via CHIP when they cancel it in `/manage/[token]`, with the cancel always committing even if the refund fails.

**Architecture:** A CHIP-paid order is one with a `chip_purchases` row where `status='paid'`. Two new nullable columns (`refunded_at`, `refund_error`) record the refund outcome on that row. A thin `refundPurchase` client wrapper calls CHIP's refund endpoint; `refundChipPurchase` in the order store records the result; `cancelOrderAction` runs the refund after the cancel commits and folds the outcome into its result. The manage detail view shows a two-button cancel dialog (Cancel & Refund / Cancel without Refund) for CHIP orders only, plus a retry affordance for a failed refund.

**Tech Stack:** Next.js 16 App Router, TypeScript (strict, no `any`), Supabase (Postgres + service-role client), CHIP Collect REST API. No JS test framework by design — the runnable check is a plain Node `assert` script (`npx tsx`), and `npm run build` (EXIT 0) is the type/integration gate.

## Global Constraints

- Money is integer **sen** (1 MYR = 100 sen). Never floats.
- No new dependencies without approval — none are needed here.
- Strict TypeScript, no `any`. Generated DB types live in `types/database.ts`.
- `chip_purchases` has no member RLS policy — always read/write it with the service-role admin client (`createAdminClient`).
- CHIP is server-only; never import the client into a `"use client"` component. Secret key stays server-side.
- CHIP endpoint paths are cross-checked against the CHIP Collect OpenAPI spec (`https://docs.chip-in.asia/openapi/chip-collect.yaml`) — the spec wins over memory.
- Refund amount is always the **full captured amount** (`chip_purchases.amount` = order total + gateway fee).
- The cancel **always commits**; a refund failure is recorded and surfaced, never blocks the cancel.
- Auth gate for refund actions is `canManageOrders()` (same gate as cancel).
- Verification per repo convention: `npm run build` (EXIT 0) and `npx eslint <changed paths>` (scoped, not whole-repo).

---

### Task 1: Pure refund-state helpers + runnable check

Pure, I/O-free helpers used by both the store and the UI, with the plan's one runnable assert check. No DB or network — a clean TDD unit.

**Files:**
- Create: `lib/payments/chip/refund.ts`
- Create (test): `scripts/check-chip-refund.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RefundState = "none" | "refunded" | "failed"`
  - `isRefundAccepted(status: string): boolean`
  - `deriveRefundState(input: { refundedAt: string | null; refundError: string | null }): RefundState`

- [ ] **Step 1: Write the failing check**

Create `scripts/check-chip-refund.mjs`:

```js
// Smoke check for lib/payments/chip/refund pure helpers. No test runner in this
// repo, so this is a plain Node script: run with `npx tsx scripts/check-chip-refund.mjs`.
// Exits non-zero on the first failed assertion.
import assert from "node:assert/strict";
import { isRefundAccepted, deriveRefundState } from "../lib/payments/chip/refund.ts";

// isRefundAccepted: an immediate "refunded" and the async "pending_refund" both
// count as accepted; every other CHIP status does not.
assert.equal(isRefundAccepted("refunded"), true);
assert.equal(isRefundAccepted("pending_refund"), true);
assert.equal(isRefundAccepted("paid"), false);
assert.equal(isRefundAccepted("created"), false);
assert.equal(isRefundAccepted(""), false);

// deriveRefundState: the three states from (refundedAt, refundError).
assert.equal(deriveRefundState({ refundedAt: null, refundError: null }), "none");
assert.equal(
  deriveRefundState({ refundedAt: "2026-07-21T00:00:00Z", refundError: null }),
  "refunded",
);
assert.equal(
  deriveRefundState({ refundedAt: null, refundError: "CHIP refund failed (400)" }),
  "failed",
);
// A recorded refund wins even if a stale error lingers from an earlier attempt.
assert.equal(
  deriveRefundState({ refundedAt: "2026-07-21T00:00:00Z", refundError: "stale" }),
  "refunded",
);

console.log("chip-refund checks passed");
```

- [ ] **Step 2: Run the check to verify it fails**

Run: `npx tsx scripts/check-chip-refund.mjs`
Expected: FAIL — cannot resolve `../lib/payments/chip/refund.ts` (module does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `lib/payments/chip/refund.ts`:

```ts
// Pure refund-state helpers for the CHIP gateway. No I/O — kept separate from the
// API client so they are unit-testable and shareable with the UI.

// CHIP purchase statuses that count as a refund we can record as done. A DuitNow
// QR refund often settles asynchronously and returns "pending_refund" rather than
// an immediate "refunded"; both mean CHIP accepted the refund.
export function isRefundAccepted(status: string): boolean {
  return status === "refunded" || status === "pending_refund";
}

// The refund state of a chip_purchases row, derived from its two nullable stamps.
// A set refunded_at wins (a recorded refund); otherwise a set refund_error marks a
// failed, retryable attempt; otherwise nothing has been tried.
export type RefundState = "none" | "refunded" | "failed";

export function deriveRefundState(input: {
  refundedAt: string | null;
  refundError: string | null;
}): RefundState {
  if (input.refundedAt) return "refunded";
  if (input.refundError) return "failed";
  return "none";
}
```

- [ ] **Step 4: Run the check to verify it passes**

Run: `npx tsx scripts/check-chip-refund.mjs`
Expected: PASS — prints `chip-refund checks passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/payments/chip/refund.ts scripts/check-chip-refund.mjs
git commit -m "feat(chip): pure refund-state helpers + runnable check"
```

---

### Task 2: Migration — add refund columns to `chip_purchases` + regenerate types

Additive, non-destructive schema change (two nullable columns). Regenerating types is part of this task because later tasks select the new columns and must typecheck.

**Files:**
- Create: `supabase/migrations/20260721120000_chip_refund_columns.sql`
- Modify: `types/database.ts` (regenerated)

**Interfaces:**
- Consumes: nothing.
- Produces: `public.chip_purchases.refunded_at timestamptz`, `public.chip_purchases.refund_error text`, and their entries in the generated `types/database.ts`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260721120000_chip_refund_columns.sql`:

```sql
-- CHIP refund tracking — auto-refund on order cancel.
--
-- When staff cancel a CHIP-paid order and choose to refund, we call CHIP's refund
-- API and record the outcome on the purchase row. Two nullable stamps, no enum:
--   refunded_at set                     -> refund recorded (incl. async pending_refund)
--   refund_error set (refunded_at null) -> last attempt failed, retryable
--   both null                           -> never attempted
-- We always refund the full captured `amount`, so there is no refunded-amount column.

alter table public.chip_purchases
  add column refunded_at timestamptz,
  add column refund_error text;

comment on column public.chip_purchases.refunded_at is
  'When a CHIP refund was accepted (refunded or pending_refund). Null until refunded.';
comment on column public.chip_purchases.refund_error is
  'Last refund failure reason. Null on success; set (with refunded_at null) marks a retryable failure.';
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool with name `chip_refund_columns` and the SQL above (additive/nullable — safe, reversible). Or, if using the CLI locally: `supabase db push`.
Expected: success; `list_migrations` shows `chip_refund_columns`.

- [ ] **Step 3: Regenerate the database types**

Regenerate `types/database.ts` (Supabase MCP `generate_typescript_types`, or `supabase gen types typescript --linked > types/database.ts`).
Verify the new columns landed:

Run: `npx eslint types/database.ts` (should pass) and grep the file for `refund_error`.
Expected: `types/database.ts` contains `refunded_at` and `refund_error` under the `chip_purchases` Row/Insert/Update shapes.

- [ ] **Step 4: Verify the build still compiles**

Run: `npm run build`
Expected: EXIT 0 (no code uses the columns yet; this confirms the regenerated types are valid).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721120000_chip_refund_columns.sql types/database.ts
git commit -m "feat(chip): add refund tracking columns to chip_purchases"
```

---

### Task 3: CHIP client — `refundPurchase`

Thin REST wrapper mirroring the existing `createPurchase` / `retrievePurchase` style in the same file.

**Files:**
- Modify: `lib/payments/chip/client.ts` (append a new exported function)

**Interfaces:**
- Consumes: `getChipConfig()` from `@/lib/payments/chip/config` (already imported at the top of the file).
- Produces: `refundPurchase(purchaseId: string, amount?: number): Promise<{ status: string }>`

- [ ] **Step 1: Add the function**

Append to `lib/payments/chip/client.ts` (after `retrievePurchase`, before `duitnowQrCheckoutUrl`):

```ts
// Refund a paid purchase. Full refund when `amount` is omitted; pass integer sen
// for a partial (unused today, kept for the signature). CHIP settles DuitNow QR
// refunds asynchronously, so a 2xx returning "pending_refund" is as good as
// "refunded" — callers decide via isRefundAccepted. Throws with the CHIP error
// body on non-2xx so the caller can record the failure. Endpoint path is
// cross-checked against the CHIP Collect OpenAPI spec.
export async function refundPurchase(
  purchaseId: string,
  amount?: number,
): Promise<{ status: string }> {
  const { baseUrl, secretKey } = getChipConfig();
  const res = await fetch(`${baseUrl}/purchases/${purchaseId}/refund/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    // Empty body = full refund; { amount } for a partial.
    body: JSON.stringify(amount !== undefined ? { amount } : {}),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`CHIP refund failed (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { status?: string };
  return { status: data.status ?? "" };
}
```

- [ ] **Step 2: Verify lint + build**

Run: `npx eslint lib/payments/chip/client.ts`
Expected: PASS.

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add lib/payments/chip/client.ts
git commit -m "feat(chip): add refundPurchase client wrapper"
```

---

### Task 4: Order store — `refundChipPurchase` + extend `getChipPurchaseByToken`

Records refund outcomes on the purchase row, and exposes the fields the UI needs.

**Files:**
- Modify: `lib/orders/store.ts` (add import lines; add `refundChipPurchase`; extend `getChipPurchaseByToken` return shape + select)

**Interfaces:**
- Consumes: `refundPurchase` (Task 3), `isRefundAccepted` (Task 1), `createAdminClient` (already imported in the file).
- Produces:
  - `refundChipPurchase(token: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - Extended `getChipPurchaseByToken(token: string): Promise<{ chipPurchaseId: string; checkoutUrl: string; status: string; amount: number; refundedAt: string | null; refundError: string | null } | null>`

- [ ] **Step 1: Add imports**

At the top of `lib/orders/store.ts`, after the existing imports, add:

```ts
import { refundPurchase } from "@/lib/payments/chip/client";
import { isRefundAccepted } from "@/lib/payments/chip/refund";
```

- [ ] **Step 2: Extend `getChipPurchaseByToken`**

Replace the existing `getChipPurchaseByToken` function (currently returns `{ chipPurchaseId, checkoutUrl, status }`) with:

```ts
// The CHIP purchase link + refund state for an order token — for the review,
// status, and manage screens. Service-role read (the order token already gates
// the page). Returns null when the order has no CHIP purchase.
export async function getChipPurchaseByToken(
  token: string,
): Promise<{
  chipPurchaseId: string;
  checkoutUrl: string;
  status: string;
  amount: number;
  refundedAt: string | null;
  refundError: string | null;
} | null> {
  const db = createAdminClient();
  const { data: orderRow } = await db
    .from("orders")
    .select("id")
    .eq("token", token)
    .maybeSingle();
  if (!orderRow) return null;
  const { data } = await db
    .from("chip_purchases")
    .select("chip_purchase_id, checkout_url, status, amount, refunded_at, refund_error")
    .eq("order_id", orderRow.id)
    .maybeSingle();
  if (!data) return null;
  return {
    chipPurchaseId: data.chip_purchase_id,
    checkoutUrl: data.checkout_url,
    status: data.status,
    amount: data.amount,
    refundedAt: data.refunded_at,
    refundError: data.refund_error,
  };
}
```

(The three existing callers — `checkout/pay`, `checkout/paid`, `profile/orders` — destructure a subset of these fields, so the added fields are backward-compatible.)

- [ ] **Step 3: Add `refundChipPurchase`**

Add after `getChipPurchaseByToken` (or near the other CHIP helpers):

```ts
// Refund a CHIP-paid order's captured amount via the gateway, recording the
// outcome on its chip_purchases row. Refunds only a paid, not-yet-refunded row:
// an already-refunded row is an idempotent success, and a non-CHIP / unpaid order
// is a harmless no-op success (nothing to refund). On CHIP failure, stamps
// refund_error and returns the reason — the caller (cancel) never blocks on this.
// Service-role: chip_purchases has no member policy. Full refund of `amount`
// (order total + gateway fee).
export async function refundChipPurchase(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = createAdminClient();
  const { data: orderRow } = await db
    .from("orders")
    .select("id")
    .eq("token", token)
    .maybeSingle();
  if (!orderRow) return { ok: false, error: "Order not found." };

  const { data: purchase } = await db
    .from("chip_purchases")
    .select("chip_purchase_id, amount, status, refunded_at")
    .eq("order_id", orderRow.id)
    .maybeSingle();
  // No CHIP purchase, or not paid -> nothing to refund.
  if (!purchase || purchase.status !== "paid") return { ok: true };
  // Already refunded -> idempotent success (guards a double refund).
  if (purchase.refunded_at) return { ok: true };

  try {
    const { status } = await refundPurchase(purchase.chip_purchase_id, purchase.amount);
    if (!isRefundAccepted(status)) {
      throw new Error(`CHIP returned status "${status}".`);
    }
    await db
      .from("chip_purchases")
      .update({ refunded_at: new Date().toISOString(), refund_error: null })
      .eq("order_id", orderRow.id);
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown refund error.";
    await db
      .from("chip_purchases")
      .update({ refund_error: reason })
      .eq("order_id", orderRow.id);
    return { ok: false, error: reason };
  }
}
```

- [ ] **Step 4: Verify lint + build**

Run: `npx eslint lib/orders/store.ts`
Expected: PASS.

Run: `npm run build`
Expected: EXIT 0 (this exercises the new `refunded_at` / `refund_error` / `amount` selects against the regenerated types from Task 2).

- [ ] **Step 5: Commit**

```bash
git add lib/orders/store.ts
git commit -m "feat(chip): record CHIP refunds + expose refund state on order lookup"
```

---

### Task 5: Actions — refund on cancel + retry

Wires the store refund into the staff cancel action and adds a retry action.

**Files:**
- Modify: `app/(admin)/manage/actions.ts` (import `refundChipPurchase`; add `CancelOrderResult` + `RetryRefundResult` types; rewrite `cancelOrderAction`; add `retryChipRefundAction`)

**Interfaces:**
- Consumes: `refundChipPurchase` (Task 4), `cancelOrder` / `reverseOrderRewards` / `reverseOrderStamp` / `canManageOrders` / `revalidatePath` (all already imported).
- Produces:
  - `type CancelOrderResult = { ok: true; orderStatus: OrderStatus; refund?: { status: "refunded" | "failed"; error?: string } } | { ok: false; error: string }`
  - `cancelOrderAction(token: string, refund?: boolean): Promise<CancelOrderResult>`
  - `type RetryRefundResult = { ok: true } | { ok: false; error: string }`
  - `retryChipRefundAction(token: string): Promise<RetryRefundResult>`

- [ ] **Step 1: Add the store import**

In `app/(admin)/manage/actions.ts`, add `refundChipPurchase` to the existing import block from `@/lib/orders/store`:

```ts
import {
  cancelOrder,
  completeOrder,
  countOrdersByGroup,
  getOrderByToken,
  listOrdersPage,
  refundChipPurchase,
  setItemStatus,
  setOrderPayment,
  swapOrderItem,
  voidOrderItem,
} from "@/lib/orders/store";
```

- [ ] **Step 2: Add the result types**

Add near the other exported result types (after `AmendActionResult`):

```ts
// Cancel returns the new status and, when a CHIP refund was requested, its
// outcome. The cancel always succeeds server-side; refund.status "failed" means
// the order is cancelled but the money wasn't returned (staff can retry).
export type CancelOrderResult =
  | {
      ok: true;
      orderStatus: OrderStatus;
      refund?: { status: "refunded" | "failed"; error?: string };
    }
  | { ok: false; error: string };

export type RetryRefundResult = { ok: true } | { ok: false; error: string };
```

- [ ] **Step 3: Rewrite `cancelOrderAction`**

Replace the existing `cancelOrderAction` with:

```ts
// Cancel the whole order (manual override). When `refund` is true and the order
// was CHIP-paid, refund the full captured amount via CHIP AFTER the cancel
// commits — a refund failure is reported in the result, never blocks the cancel.
export async function cancelOrderAction(
  token: string,
  refund = false,
): Promise<CancelOrderResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const updated = await cancelOrder(token);
  if (!updated) return { ok: false, error: "Order not found." };

  await reverseOrderRewards(token);
  await reverseOrderStamp(token);

  revalidatePath(`/manage/${token}`);
  revalidatePath("/manage");

  if (!refund) {
    return { ok: true, orderStatus: updated.status };
  }

  // Cancel already stands; fold the refund outcome in.
  const res = await refundChipPurchase(token);
  return {
    ok: true,
    orderStatus: updated.status,
    refund: res.ok
      ? { status: "refunded" }
      : { status: "failed", error: res.error },
  };
}
```

- [ ] **Step 4: Add `retryChipRefundAction`**

Add after `cancelOrderAction`:

```ts
// Retry a failed CHIP refund on an already-cancelled order. Staff-gated. Drives
// the "Refund failed — retry" affordance on the manage detail view.
export async function retryChipRefundAction(
  token: string,
): Promise<RetryRefundResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const res = await refundChipPurchase(token);
  revalidatePath(`/manage/${token}`);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true };
}
```

- [ ] **Step 5: Verify lint + build**

Run: `npx eslint "app/(admin)/manage/actions.ts"`
Expected: PASS.

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/manage/actions.ts"
git commit -m "feat(chip): refund on cancel + retry refund action"
```

---

### Task 6: UI — manage page context + two-button cancel dialog + retry affordance

Passes refund context to the detail view and renders the CHIP-only cancel choices and the failed-refund retry.

**Files:**
- Modify: `app/(admin)/manage/[token]/page.tsx` (fetch CHIP refund context, pass `chipRefund` prop)
- Modify: `components/order-detail.tsx` (accept `chipRefund`; split cancel into two buttons for CHIP orders; render refund status + retry)

**Interfaces:**
- Consumes: `getChipPurchaseByToken` (Task 4), `cancelOrderAction` / `retryChipRefundAction` (Task 5), `deriveRefundState` + `RefundState` (Task 1), `formatPrice` (already imported in order-detail).
- Produces: new optional prop `chipRefund?: { amount: number; refundedAt: string | null; refundError: string | null } | null` on `OrderDetail` (defaults `null`; non-manage/non-CHIP renders unaffected).

- [ ] **Step 1: Fetch and pass refund context from the manage page**

In `app/(admin)/manage/[token]/page.tsx`, add `getChipPurchaseByToken` to the store import:

```ts
import { getOrderByToken, getChipPurchaseByToken } from "@/lib/orders/store";
```

Then, just before the `return (` that renders `<OrderDetail ... />`, add:

```tsx
  // CHIP refund context — only paid gateway orders get the refund UI. Manual
  // DuitNow-QR orders have no chip_purchases row, so this is null for them.
  const chip = await getChipPurchaseByToken(token);
  const chipRefund =
    chip && chip.status === "paid"
      ? {
          amount: chip.amount,
          refundedAt: chip.refundedAt,
          refundError: chip.refundError,
        }
      : null;
```

And add the prop to the JSX:

```tsx
    <OrderDetail
      order={order}
      recipeMap={recipeMap}
      paymentOptions={paymentOptions}
      categories={categories}
      products={products}
      hasOpenShift={!!openShift}
      chipRefund={chipRefund}
    />
```

- [ ] **Step 2: Add the prop + imports to OrderDetail**

In `components/order-detail.tsx`, add imports:

```ts
import { deriveRefundState, type RefundState } from "@/lib/payments/chip/refund";
import {
  cancelOrderAction,
  changeOrderPaymentAction,
  markReadyAndNotify,
  retryChipRefundAction,
  setOrderPaymentAction,
  swapDrinkAction,
  updateDrinkStatus,
  voidDrinkAction,
  type SwapDrinkInput,
} from "@/app/(admin)/manage/actions";
```

Add `chipRefund` to the props destructuring and its type in the props object:

```tsx
  hasOpenShift = true,
  chipRefund = null,
}: {
  // ...existing prop types...
  hasOpenShift?: boolean;
  // CHIP refund context for a paid gateway order; null for manual/non-CHIP orders.
  // Drives the two-button cancel dialog and the failed-refund retry affordance.
  chipRefund?: {
    amount: number;
    refundedAt: string | null;
    refundError: string | null;
  } | null;
}) {
```

- [ ] **Step 3: Add refund state, derived value, and handlers**

Add state near the other cancel state (after the `cancelError` line):

```tsx
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
```

Add a prop-derived refund state (NOT stored in state, so `router.refresh()` re-derives it) near the other derived flags (e.g. after `canCancel`):

```tsx
  // Refund state derived straight from the prop, so a router.refresh() after a
  // refund/retry re-renders the right affordance without stale local state.
  const refundState: RefundState = chipRefund
    ? deriveRefundState(chipRefund)
    : "none";
```

Replace `confirmCancelOrder` with a parameterized `runCancel`:

```tsx
  // Cancel the whole order (staff override). `refund` requests a CHIP refund of
  // the captured amount (only offered for CHIP-paid orders). The cancel always
  // commits server-side: on a refund success (or a plain cancel) we return to the
  // board; on a refund failure we refresh in place so the failed-refund retry
  // banner shows on the now-cancelled order.
  function runCancel(refund: boolean) {
    setCancelError(null);
    setCancelling(true);
    startTransition(async () => {
      const result = await cancelOrderAction(order.token, refund);
      setCancelling(false);
      if (!result.ok) {
        setCancelError(result.error);
        return;
      }
      setShowCancel(false);
      if (result.refund?.status === "failed") {
        setRetryError(result.refund.error ?? null);
        router.refresh();
        return;
      }
      router.push(backHref);
    });
  }
```

Add the retry handler after it:

```tsx
  // Retry a failed CHIP refund on the cancelled order. On success, refresh so the
  // banner flips to "Refunded" (chip_purchases.refunded_at is now set).
  function retryRefund() {
    setRetryError(null);
    setRetrying(true);
    startTransition(async () => {
      const res = await retryChipRefundAction(order.token);
      setRetrying(false);
      if (!res.ok) {
        setRetryError(res.error);
        return;
      }
      router.refresh();
    });
  }
```

- [ ] **Step 4: Render the refund status / retry section**

Add a section on the cancelled order (place it right after the closing `</dl>` of the Status/Payment grid, around line 529). It shows a confirmation when refunded and a retry affordance when failed:

```tsx
      {/* CHIP refund status on a cancelled gateway order. */}
      {chipRefund && order.status === "cancelled" && refundState !== "none" && (
        <section
          className={
            "mt-3 flex flex-col gap-3 rounded-2xl border p-4 " +
            (refundState === "refunded"
              ? "border-emerald-200 bg-emerald-50/60"
              : "border-rose-200 bg-rose-50/60")
          }
        >
          {refundState === "refunded" ? (
            <p className="text-xs font-medium text-emerald-700">
              Refunded {formatPrice(chipRefund.amount)} to the customer via CHIP.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-0.5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-rose-700">
                  Refund failed
                </h2>
                <p className="text-xs text-rose-700/90">
                  The order is cancelled but the {formatPrice(chipRefund.amount)}{" "}
                  refund didn&apos;t go through. Retry below, or refund it manually
                  in the CHIP portal.
                </p>
                {(retryError ?? chipRefund.refundError) && (
                  <p className="mt-1 text-[0.6875rem] text-rose-600">
                    {retryError ?? chipRefund.refundError}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={retryRefund}
                disabled={retrying}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 text-xs font-semibold uppercase tracking-[0.15em] text-white transition-transform hover:scale-[1.01] active:scale-[0.99] outline-none focus-visible:ring-3 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100"
              >
                {retrying ? (
                  <>
                    <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
                    Retrying refund
                  </>
                ) : (
                  "Retry refund"
                )}
              </button>
            </>
          )}
        </section>
      )}
```

- [ ] **Step 5: Split the cancel dialog buttons for CHIP orders**

In the cancel confirm dialog, update the description paragraph and the button block. Replace the description `<p>` (currently "This marks the order cancelled and refunds any Beans it earned. This can't be undone.") with a CHIP-aware version:

```tsx
              <p className="text-sm text-muted-foreground">
                {chipRefund
                  ? `This marks the order cancelled and refunds any Beans it earned. Choose whether to refund the ${formatPrice(chipRefund.amount)} paid via CHIP. This can't be undone.`
                  : "This marks the order cancelled and refunds any Beans it earned. This can't be undone."}
              </p>
```

Replace the button block (the `<div className="flex flex-col gap-2">` holding the current "Cancel Order" + "Keep Order" buttons) with:

```tsx
            <div className="flex flex-col gap-2">
              {chipRefund ? (
                <>
                  <button
                    type="button"
                    onClick={() => runCancel(true)}
                    disabled={cancelling}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-rose-600 text-xs font-semibold uppercase tracking-[0.15em] text-white transition-transform hover:scale-[1.01] active:scale-[0.99] outline-none focus-visible:ring-3 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100"
                  >
                    {cancelling ? (
                      <>
                        <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
                        Cancelling
                      </>
                    ) : (
                      `Cancel & Refund ${formatPrice(chipRefund.amount)}`
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => runCancel(false)}
                    disabled={cancelling}
                    className="flex h-12 w-full items-center justify-center rounded-full border border-rose-200 text-xs font-semibold uppercase tracking-[0.15em] text-rose-600 transition-colors hover:bg-rose-50 outline-none focus-visible:ring-3 focus-visible:ring-rose-300 disabled:opacity-70"
                  >
                    Cancel without Refund
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => runCancel(false)}
                  disabled={cancelling}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-rose-600 text-xs font-semibold uppercase tracking-[0.15em] text-white transition-transform hover:scale-[1.01] active:scale-[0.99] outline-none focus-visible:ring-3 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100"
                >
                  {cancelling ? (
                    <>
                      <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
                      Cancelling
                    </>
                  ) : (
                    "Cancel Order"
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCancel(false)}
                disabled={cancelling}
                className="flex h-12 w-full items-center justify-center rounded-full border border-border text-xs font-semibold uppercase tracking-[0.15em] text-foreground transition-colors hover:bg-neutral-50 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
              >
                Keep Order
              </button>
            </div>
```

- [ ] **Step 6: Verify lint + build**

Run: `npx eslint "components/order-detail.tsx" "app/(admin)/manage/[token]/page.tsx"`
Expected: PASS (no unused `confirmCancelOrder` left behind — it was renamed to `runCancel`).

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 7: Commit**

```bash
git add "components/order-detail.tsx" "app/(admin)/manage/[token]/page.tsx"
git commit -m "feat(chip): two-button cancel-with-refund dialog + retry on manage view"
```

---

### Task 7: End-to-end sandbox verification

Manual verification against CHIP sandbox — the flow can't be automated (real gateway + DB). Do this after all code tasks land.

**Files:** none (verification only).

- [ ] **Step 1: Full build + lint gate**

Run: `npm run build`
Expected: EXIT 0.

Run: `npx tsx scripts/check-chip-refund.mjs`
Expected: `chip-refund checks passed`.

- [ ] **Step 2: Happy path — cancel & refund**

With CHIP enabled in payment settings (test-mode creds), place an online DuitNow-QR order and pay it via the CHIP sandbox so it becomes `pending`. In `/manage/[token]`, tap Cancel Order → the dialog shows **two** buttons. Tap **Cancel & Refund RM X.XX**.
Expected: routes to the board; order under Cancelled. Reopen it → "Refunded RM X.XX to the customer via CHIP." The CHIP portal shows the refund (or `pending_refund`). In the DB, `chip_purchases.refunded_at` is set for that order.

- [ ] **Step 3: Cancel without refund**

Place + pay another CHIP order. Cancel → **Cancel without Refund**.
Expected: order cancelled; `chip_purchases.refunded_at` stays null, no refund in the CHIP portal.

- [ ] **Step 4: Failed refund + retry**

Force a failure: on a CHIP order already refunded once (Step 2's order, still `paid` row), or by temporarily pointing at an invalid purchase id, trigger a refund that CHIP rejects. Confirm the order still cancels and the detail view shows **Refund failed** with a **Retry refund** button and the portal-fallback note. Tap Retry against a now-valid state.
Expected: on success the banner flips to "Refunded"; on repeated failure the error persists and the cancel still stands. `chip_purchases.refund_error` reflects the last failure.

- [ ] **Step 5: Non-CHIP order unaffected**

Open a cash or manual DuitNow-QR order in `/manage/[token]`. Tap Cancel.
Expected: the dialog shows the original **single** "Cancel Order" button — no refund UI anywhere.

---

## Self-Review

**Spec coverage:**
- Trigger = paid `chip_purchases` row → Task 6 Step 1 (`chip.status === "paid"`), Task 4 `refundChipPurchase` guard. ✅
- Full captured amount → Task 4 refunds `purchase.amount`; UI shows `chipRefund.amount`. ✅
- Cancel always commits, refund folded in → Task 5 `cancelOrderAction`. ✅
- Refund-failed flagged + retryable → Task 4 stamps `refund_error`; Task 5 `retryChipRefundAction`; Task 6 retry section. ✅
- Two-button dialog, CHIP only; non-CHIP single button → Task 6 Step 5. ✅
- Async `pending_refund` accepted → Task 1 `isRefundAccepted`; Task 3 comment; Task 4 uses it. ✅
- Migration columns `refunded_at`/`refund_error`, three-state derivation → Task 2; Task 1 `deriveRefundState`. ✅
- `canManageOrders()` gate → Task 5 both actions. ✅
- Scope: whole-order only; webhook reconciliation out of scope → no partial-refund or webhook task added. ✅
- One runnable assert check → Task 1 `scripts/check-chip-refund.mjs`. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✅

**Type consistency:** `refundPurchase(purchaseId, amount?) → { status }` (T3) consumed in T4; `refundChipPurchase(token) → { ok } | { ok, error }` (T4) consumed in T5; `RefundState` + `deriveRefundState` + `isRefundAccepted` (T1) consumed in T4/T6; `chipRefund` prop shape identical between page (T6.1) and component (T6.2); `getChipPurchaseByToken` extended shape (T4) matches the page's reads (T6.1). ✅
