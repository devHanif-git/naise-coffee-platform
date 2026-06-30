# Post-Finish Routing & Kiosk Success State — Design

**Date:** 2026-06-30
**Branch:** `feat/post-finish-route-to-manage` (based on `origin/master`)
**Status:** Approved

## Problem

On the manage order detail screen (`/manage/[token]`), every order — kiosk or
online — shows a "Complete & Notify" confirmation modal after the last drink is
marked done. For **kiosk/counter orders** there is nobody to notify (the drink
is handed over at the counter), so the confirm step is wasted movement: an extra
tap that completes nothing meaningful.

Separately, after completion staff stay on the order's slug. There is nothing
left to do on a finished order, so staff must manually hit Back to return to the
board. This applies to both kiosk and online orders.

## Goals

1. **Kiosk/counter orders** (`source === "store" | "custom"`): no confirm modal.
   Marking the last drink done auto-completes the order and shows a success
   state with an **OK** button that routes back to `/manage`. If completion
   fails (order still unpaid), show an error state with the message and let
   staff resolve payment on the same screen — no routing.
2. **Online orders** (`source === "online"`): keep the confirm step, but after
   completion show a success state. Staff send the WhatsApp ready notice from a
   button that also routes back to `/manage`; a secondary "Done" routes back
   without sending. No contact phone → only "Done".
3. Apply loading states throughout so no async gap looks frozen.

## Non-Goals

- No change to the server completion logic (`markReadyAndNotify`), the Telegram
  fallback, or the WhatsApp message wording.
- No change to the cancel-order flow (it already routes to `/manage`).
- No change to the unpaid payment picker UI itself.

## Background (current behavior)

- `components/order-detail.tsx` is the client orchestration view.
  - `applyStatus()` opens `OrderCompleteModal` when the last drink turns done
    (for persisted, not-yet-complete orders).
  - `confirmComplete()` runs `markReadyAndNotify(order.token)`; on success it
    closes the modal and does `window.location.href = waReadyLink` (same-tab
    jump, used to dodge popup blocking), then **stays on the slug**.
- `markReadyAndNotify` (`app/(admin)/manage/actions.ts`) returns
  `{ ok: false, error: "Set the payment method before completing this order." }`
  when `paymentMethod === UNPAID_PAYMENT_METHOD`; otherwise completes and (for
  online orders without a phone) sends the Telegram ready notice.
- Order channel: `order.source: "online" | "store" | "custom"`. Counter orders
  are `"store"` (kiosk) and `"custom"` (admin-entered).
- `buildWhatsAppReadyLink(order)` returns a `wa.me` deep link or `null` when
  there is no contact phone.

All files this design touches are identical on `master` and `development`, and
every dependency (`order.source`, `UNPAID_PAYMENT_METHOD`, the counter-order
check) already exists on `master`. The branch is based on `origin/master` so
none of development's unmerged work is included.

## Design

### Branch on order source

In `order-detail.tsx`, derive:

```ts
const isCounterOrder = order.source === "store" || order.source === "custom";
```

When the last drink turns done in `applyStatus` (`nowAllDone && status === "done"`,
persisted, not already complete):

- **Counter order** → do *not* open the confirm modal. Call a new
  `completeCounterOrder()` that runs `markReadyAndNotify` immediately and shows
  the finished-modal (loading → success/error).
- **Online order** → open `OrderCompleteModal` as today.

### New component: `components/order-finished-modal.tsx`

A single modal handling the post-completion states for both flows. Built with
the `frontend-design` skill for visual polish; matches the existing modal
styling in `order-detail.tsx` (rounded-3xl, `naise-fade`/`naise-pop`, emerald
success / rose-amber error, `Loader2` spinner).

Props:

```ts
{
  orderNumber: string;
  state: "loading" | "success" | "error";
  variant: "counter" | "online";
  waReadyLink: string | null;
  error?: string | null;
  onDone: () => void;   // routes to /manage
  onClose: () => void;  // dismiss without routing (error case)
}
```

Rendered states:

- **loading**: spinner + "Completing order…". Not dismissible.
- **counter / success**: green check, "Order complete", single **OK** → `onDone`.
- **counter / error**: amber alert, `error` message, **OK** → `onClose`
  (dismiss; staff resolve payment on the page — no route).
- **online / success**:
  - With `waReadyLink`: **Send on WhatsApp** as a native anchor
    (`href={waReadyLink}` `target="_blank"` `rel="noopener noreferrer"`,
    `onClick={onDone}`) + secondary **Done** → `onDone`.
  - Without `waReadyLink`: only **Done** → `onDone`.

**Popup-blocking note:** the WhatsApp open is a native `<a target="_blank">`
fired directly by the user's tap (no `await` between gesture and open), so it is
never popup-blocked. The `onClick` routes the current tab to `/manage` in the
same gesture; on mobile the link hands off to the WhatsApp app while the tab is
already on `/manage`.

### `order-detail.tsx` orchestration changes

New state to drive the finished modal:

```ts
const [finishState, setFinishState] = useState<"loading" | "success" | "error" | null>(null);
```

- `completeCounterOrder()` (new): `setFinishState("loading")`, then in a
  transition run `markReadyAndNotify(order.token)`. On `ok` → `setFinishState("success")`.
  On failure → `setFinishState("error")` and store `completeError`.
- `confirmComplete()` (online, existing): on success, **replace** the
  `window.location.href = waReadyLink` jump with: close `OrderCompleteModal`,
  `setFinishState("success")`. Error handling stays as today (message in the
  confirm modal).
- `onDone` handler → `router.push("/manage")`.
- `onClose` for counter error → `setFinishState(null)` (dismiss only).

### Auto-resume for counter unpaid

When a counter order errors on completion because it's unpaid, staff use the
existing unpaid picker (`resolvePayment`). On its success, if the order is a
counter order and all drinks are done, re-run `completeCounterOrder()`
automatically so staff don't tap anything extra. Implementation: in
`resolvePayment`'s success branch, after `setPaymentMethod(method)`, check
`isCounterOrder && allDone` and call `completeCounterOrder()`.

### Routing

All post-completion routing uses the already-imported `router.push("/manage")`.
The existing cancel flow already routes there; this makes completion consistent.

## Edge cases

- **Re-opening a drink after completion**: unchanged — `completedAt` clears and
  status reverts; finished modal is not shown unless all drinks are done again.
- **No contact phone (online)**: success state shows only "Done".
- **Counter order with no phone**: never had WhatsApp; success shows OK only.
- **Non-persisting render** (`persist === false`): no completion calls fire;
  finished modal never opens (guarded by the same `persist` checks as today).
- **Telegram failure** (online, no phone): already best-effort server-side; the
  order still completes and the success state still shows.

## Testing

- Kiosk order, paid: mark all drinks done → loading → success → OK → lands on
  `/manage`.
- Kiosk order, unpaid: mark all done → error state with payment message → OK
  dismisses → set payment via picker → auto-completes → success → OK → `/manage`.
- Online order, with phone: all done → confirm modal → confirm → success →
  Send on WhatsApp opens WA in new tab and routes to `/manage`; Done routes
  without sending.
- Online order, no phone: all done → confirm → success → only Done → `/manage`.
- Verify no popup block on the WhatsApp anchor (real tap, new tab).
- Lint + typecheck pass.

## Files

- `components/order-detail.tsx` — branch on source, new `completeCounterOrder`,
  finished-modal state, auto-resume, route on done.
- `components/order-finished-modal.tsx` — new modal (loading/success/error).
- `components/order-complete-modal.tsx` — unchanged (online confirm step).
- `app/(admin)/manage/actions.ts` — unchanged.
