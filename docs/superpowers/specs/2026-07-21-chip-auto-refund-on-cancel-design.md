# CHIP Auto-Refund on Order Cancel — Design

Date: 2026-07-21

## Goal

When staff cancel an order in `/manage/[token]`, and that order was paid through
the CHIP DuitNow-QR gateway, offer staff the choice to refund the customer via
CHIP as part of the cancel. Manual (non-CHIP) orders are unaffected — the refund
option never appears for them.

## Constraints & decisions

- **Trigger:** a CHIP-paid order is one with a `chip_purchases` row whose
  `status = 'paid'`. Manual DuitNow-QR orders have no such row, so the refund UI
  never shows for them.
- **Refund amount:** the full captured amount — `chip_purchases.amount` (order
  total + gateway fee, in sen). Capped at CHIP's `refundable_amount` at call time.
- **On refund failure:** the cancel always commits (staff decided to cancel). A
  refund failure is recorded and surfaced with a retry affordance; it never traps
  the cancel.
- **Staff choice:** inside the existing cancel dialog, a CHIP-paid order shows two
  explicit buttons — "Cancel & Refund RM X.XX" and "Cancel without Refund" — plus
  "Keep Order". Non-CHIP orders keep today's single "Cancel Order" button.
- **Scope:** whole-order cancels only. Partial refunds for voids/swaps are out of
  scope (matches the existing CHIP payment plan's stance).
- **Async settlement:** DuitNow QR refunds may return `pending_refund` rather than
  `refunded`. Both count as accepted. Webhook reconciliation of a later settlement
  is out of scope — we record from the synchronous API response.

## Components

### 1. Migration — `chip_purchases` refund columns

Add to `public.chip_purchases`:

- `refunded_at timestamptz` — set when a refund is accepted (`refunded` or
  `pending_refund`). Null until then.
- `refund_error text` — last failure reason. Null on success.

Three states derived from the pair (no enum, no separate amount column since we
always refund the full captured amount):

| refunded_at | refund_error | State |
|-------------|--------------|-------|
| null        | null         | not refunded |
| set         | (ignored)    | refunded |
| null        | set          | failed (retryable) |

### 2. CHIP client — `refundPurchase`

`lib/payments/chip/client.ts`:

```
refundPurchase(purchaseId: string, amount?: number): Promise<{ status: string }>
```

- Wraps `POST /purchases/{id}/refund/`. The exact path is cross-checked against
  the CHIP Collect OpenAPI spec at implementation time (per the chip-skill rule:
  the spec wins over memory).
- Full refund when `amount` is omitted; otherwise partial (unused for now, kept
  for the signature).
- A 2xx whose returned status is `refunded` or `pending_refund` is success. Any
  non-2xx throws with the CHIP error body, matching `createPurchase`.
- Server-only, `cache: "no-store"`, `Authorization: Bearer <secretKey>`.

### 3. Order store

`lib/orders/store.ts`:

- `refundChipPurchase(token: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - Service-role client (chip_purchases has no member policy).
  - Resolves the order → its `chip_purchases` row. Refunds only when the row
    exists, is `status = 'paid'`, and `refunded_at IS NULL` (guard against a
    double refund). A row already refunded returns `{ ok: true }` idempotently.
  - Calls `refundPurchase(chip_purchase_id)` for the full `amount`.
  - On success: stamp `refunded_at = now()`, clear `refund_error`.
  - On throw: stamp `refund_error = <message>`, leave `refunded_at` null, return
    `{ ok: false, error }`.

- Extend `getChipPurchaseByToken` to also return `amount`, `refundedAt`,
  `refundError` so the manage page can render refund context and the button
  amount.

### 4. Actions — `app/(admin)/manage/actions.ts`

- `cancelOrderAction(token: string, refund?: boolean)` — extend the existing
  action:
  1. Cancel as today: `cancelOrder`, `reverseOrderRewards`, `reverseOrderStamp`.
  2. If `refund === true`, call `refundChipPurchase(token)` **after** the cancel
     commits. Fold the outcome into the result; never block the cancel on it.
  - Result gains an optional field:
    `{ ok: true; orderStatus; refund?: { status: "refunded" | "failed"; error?: string } }`.
  - Auth: `canManageOrders()` — same gate as cancel today. (Open question below.)

- `retryChipRefundAction(token: string): Promise<{ ok: boolean; error?: string }>`
  — re-runs `refundChipPurchase` for a cancelled order whose refund failed.
  `canManageOrders()` gated. Revalidates `/manage/[token]`.

### 5. Client — manage page + `order-detail.tsx`

- `/manage/[token]/page.tsx` reads CHIP refund context via the extended
  `getChipPurchaseByToken` and passes to `OrderDetail`:
  `chipRefund?: { amount: number; refundedAt: string | null; refundError: string | null } | null`
  (null for non-CHIP orders).

- Cancel dialog in `order-detail.tsx`:
  - **Non-CHIP** (chipRefund null): unchanged — single "Cancel Order" +
    "Keep Order".
  - **CHIP-paid, not yet refunded:** two buttons — "Cancel & Refund RM X.XX"
    (calls `cancelOrderAction(token, true)`) and "Cancel without Refund" (calls
    `cancelOrderAction(token, false)`), plus "Keep Order".
  - If a "Cancel & Refund" returns `refund.status === "failed"`: the order is
    still cancelled; the detail view shows a "Refund failed — retry" affordance
    wired to `retryChipRefundAction`, with a note that staff can refund manually
    in the CHIP portal as a fallback.
  - A CHIP order already refunded shows a small "Refunded" note instead of the
    refund button.

## Data flow (Cancel & Refund)

```
Staff taps "Cancel & Refund RM X.XX"
  → cancelOrderAction(token, refund=true)
      → cancelOrder(token)            # status = cancelled
      → reverseOrderRewards / Stamp   # Beans clawback (existing)
      → refundChipPurchase(token)
          → refundPurchase(chipId)    # POST /purchases/{id}/refund/
          → stamp refunded_at | refund_error
  → result { ok, orderStatus: cancelled, refund: { status } }
  → client: route to board on success; show retry affordance on failed refund
```

## Error handling

- Refund API failure: recorded in `refund_error`, cancel stands, retry offered.
- Double-webhook / double-tap: `refunded_at IS NULL` guard makes the refund
  fire at most once; an already-refunded row is a no-op success.
- Non-CHIP order passed `refund=true`: `refundChipPurchase` finds no paid row and
  returns `{ ok: true }` (nothing to refund) — the flag is harmless.

## Testing

One runnable assert-based check (no framework, per repo convention) on the
three-state refund derivation from `(refunded_at, refund_error)`:
not-refunded / refunded / failed. Placed as a standalone `assert` script.

Manual verification: `npm run build` (EXIT 0), plus a sandbox CHIP test order —
pay it, cancel with refund, confirm `refunded_at` set and the CHIP portal shows
the refund; then force a failure (e.g. refund twice) and confirm the retry
affordance appears and the cancel still stands.

## Open question

- **Refund auth gate:** currently `canManageOrders()`, same as cancel. Money-out
  could warrant the manager store-passcode gate (like `changeOrderPaymentAction`).
  Left at the cancel gate unless we decide otherwise.
