# Post-Finish Routing & Kiosk Success State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After an order's last drink is marked done, route staff back to `/manage`; for kiosk/counter orders skip the confirm modal and show an auto-complete success/error state instead.

**Architecture:** Branch the manage order-detail client view on `order.source`. Counter orders (`store`/`custom`) auto-run completion and show a new `OrderFinishedModal` (loading → success/error). Online orders keep the existing confirm modal, then show the same finished modal's success variant with a WhatsApp anchor. All "done" affordances route to `/manage` via the already-imported `router`.

**Tech Stack:** Next.js (App Router, client components), TypeScript, Tailwind, lucide-react icons. No test harness in repo — verification is `npm run lint` + `npm run build` (type-checks) + manual scenarios.

## Global Constraints

- Money/format helpers and existing modal styling conventions unchanged: rounded-3xl, `naise-fade`/`naise-pop` animations, emerald = success, rose/amber = error, `Loader2` spinner from `lucide-react`.
- No new libraries (per AGENTS.md — ask before adding).
- No `any`; strict TypeScript.
- Server action `markReadyAndNotify` and `app/(admin)/manage/actions.ts` are NOT modified.
- `components/order-complete-modal.tsx` is NOT modified (still used for the online confirm step).
- Routing target is exactly `/manage`, via the already-imported `useRouter` `router.push("/manage")`.
- Branch: `feat/post-finish-route-to-manage`, based on `origin/master`.
- Use the `frontend-design` skill when building the new modal's visuals.

---

## File Structure

- `components/order-finished-modal.tsx` — **new.** Presentational modal with `loading` / `success` / `error` states and `counter` / `online` variants. No data fetching; pure props + callbacks.
- `components/order-detail.tsx` — **modify.** Orchestration: branch on source, new `completeCounterOrder()`, finished-modal state, auto-resume on payment resolve, route on done. Replaces the same-tab WhatsApp jump.
- `components/order-complete-modal.tsx` — unchanged.
- `app/(admin)/manage/actions.ts` — unchanged.

---

### Task 1: Create `OrderFinishedModal` component

**Files:**
- Create: `components/order-finished-modal.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a default-exported-free named component
  ```ts
  export function OrderFinishedModal(props: {
    orderNumber: string;
    state: "loading" | "success" | "error";
    variant: "counter" | "online";
    waReadyLink: string | null;
    error?: string | null;
    onDone: () => void;   // routes to /manage (caller decides)
    onClose: () => void;  // dismiss without routing (error case)
  }): JSX.Element
  ```
  Task 2 imports and renders this.

- [ ] **Step 1: Write the component**

Create `components/order-finished-modal.tsx`. Mirror the markup conventions of the cancel dialog already in `order-detail.tsx` (overlay `fixed inset-0 z-[60] ... bg-black/70 p-4 naise-fade`, inner `rounded-3xl bg-white ... naise-pop`, `stopPropagation` on the inner). Match `OrderCompleteModal` for the body-scroll lock and Escape handling, but Escape and backdrop only dismiss when **not** loading, and for the `error` state Escape/backdrop call `onClose` (success/loading are not backdrop-dismissible — staff use the explicit buttons).

```tsx
"use client";

import { useEffect } from "react";
import { BellRing, CheckCircle2, Loader2, MessageCircle, TriangleAlert } from "lucide-react";

// Shown after an order's last drink is marked done. Counter orders (kiosk/custom)
// open this directly in "loading" while completion runs, then settle to "success"
// or "error". Online orders open it in "success" after the confirm modal, where
// staff send the WhatsApp ready notice and return to the board.
//
// onDone routes back to /manage (the caller owns the router); onClose just
// dismisses (used for the counter "error" state so staff can set payment on the
// page without leaving the order).
export function OrderFinishedModal({
  orderNumber,
  state,
  variant,
  waReadyLink,
  error,
  onDone,
  onClose,
}: {
  orderNumber: string;
  state: "loading" | "success" | "error";
  variant: "counter" | "online";
  waReadyLink: string | null;
  error?: string | null;
  onDone: () => void;
  onClose: () => void;
}) {
  // Backdrop/Escape dismissal is only allowed in the error state; loading and
  // success settle through explicit buttons so staff don't skip the handoff.
  const dismissable = state === "error";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [dismissable, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Order ${orderNumber} ${state}`}
      onClick={() => dismissable && onClose()}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col items-center overflow-hidden rounded-3xl bg-white px-6 pb-6 pt-8 text-center naise-pop"
      >
        {state === "loading" && (
          <>
            <span className="flex size-14 items-center justify-center rounded-full bg-neutral-100 text-muted-foreground">
              <Loader2 className="size-6 animate-spin" strokeWidth={2} aria-hidden />
            </span>
            <h2 className="mt-4 font-heading text-xl font-bold tracking-tight tabular-nums">
              Completing {orderNumber}…
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Finishing up the order.
            </p>
          </>
        )}

        {state === "error" && (
          <>
            <span className="flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <TriangleAlert className="size-6" strokeWidth={2} aria-hidden />
            </span>
            <h2 className="mt-4 font-heading text-xl font-bold tracking-tight tabular-nums">
              Can&apos;t complete yet
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {error ?? "Something went wrong completing this order."}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl border border-border text-xs font-semibold uppercase tracking-[0.15em] text-foreground outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              OK
            </button>
          </>
        )}

        {state === "success" && (
          <>
            <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="size-6" strokeWidth={2} aria-hidden />
            </span>
            <span className="mt-4 text-[0.6875rem] font-bold uppercase tracking-[0.15em] text-emerald-700">
              Order complete
            </span>
            <h2 className="mt-1 font-heading text-xl font-bold tracking-tight tabular-nums">
              {orderNumber} done
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {variant === "online" && waReadyLink
                ? "Send the buyer their ready notice, or head back to the board."
                : "Handed over at the counter. Back to the board when you're ready."}
            </p>

            {variant === "online" && waReadyLink && (
              <a
                href={waReadyLink}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onDone}
                className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <MessageCircle className="size-4" strokeWidth={2} aria-hidden />
                Send on WhatsApp
              </a>
            )}

            <button
              type="button"
              onClick={onDone}
              className={
                (variant === "online" && waReadyLink
                  ? "mt-2 border border-border text-muted-foreground hover:bg-neutral-100 hover:text-foreground"
                  : "mt-6 bg-emerald-600 text-white hover:scale-[1.01] active:scale-[0.99]") +
                " flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-xs font-semibold uppercase tracking-[0.15em] outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50"
              }
            >
              {variant === "online" && waReadyLink ? "Done" : "OK"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

Note: `BellRing` import is unused above — remove it; final imports are `CheckCircle2, Loader2, MessageCircle, TriangleAlert` plus `useEffect`. (Listed here so the engineer prunes it before linting.)

- [ ] **Step 2: Type-check & lint the new file**

Run: `npm run lint`
Expected: PASS (no unused-import or type errors for `components/order-finished-modal.tsx`).

- [ ] **Step 3: Commit**

```bash
git add components/order-finished-modal.tsx
git commit -m "feat(manage): add OrderFinishedModal for post-completion state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire counter auto-complete + online success into `order-detail.tsx`

**Files:**
- Modify: `components/order-detail.tsx`

**Interfaces:**
- Consumes: `OrderFinishedModal` from Task 1 (signature above).
- Produces: nothing for later tasks (final task).

- [ ] **Step 1: Import the new modal**

Add to the imports block (near the other component imports, after the `ChangePaymentModal` import line):

```tsx
import { OrderFinishedModal } from "@/components/order-finished-modal";
```

- [ ] **Step 2: Add source branch + finished-modal state**

Below the existing state hooks (after the `const [, startTransition] = useTransition();` / `const router = useRouter();` lines), add:

```tsx
// Counter orders (kiosk + admin custom) are handed over at the counter, so the
// confirm-and-notify step is wasted movement: completion runs automatically and
// we show a success/error state instead.
const isCounterOrder = order.source === "store" || order.source === "custom";
// Drives the post-completion modal. null = not shown. For counter orders this
// opens in "loading" while markReadyAndNotify runs; online orders open it in
// "success" after the confirm modal.
const [finishState, setFinishState] = useState<
  "loading" | "success" | "error" | null
>(null);
```

- [ ] **Step 3: Add `completeCounterOrder` and a shared `goToBoard` helper**

Add these functions (place near `confirmComplete`):

```tsx
// Return to the staff board. Used by every post-completion "done" affordance so
// staff never have to hit Back on a finished order.
function goToBoard() {
  router.push(backHref);
}

// Counter-order completion: no confirm step. Runs markReadyAndNotify and shows
// the finished modal. On failure (almost always an unpaid order) we surface the
// error in the modal; dismissing it leaves staff on the page to set payment,
// after which resolvePayment auto-resumes this.
function completeCounterOrder() {
  setCompleteError(null);
  setFinishState("loading");
  startTransition(async () => {
    const res = await markReadyAndNotify(order.token);
    if (!res.ok) {
      setCompleteError(res.error);
      setFinishState("error");
      return;
    }
    setFinishState("success");
  });
}
```

- [ ] **Step 4: Branch the auto-open in `applyStatus`**

Replace the existing auto-open block inside `applyStatus`:

```tsx
    // Auto-open the completion modal the moment the last drink turns done, but
    // only for real (persisted) orders that aren't already completed.
    if (nowAllDone && status === "done") {
      setLastDoneIndex(index);
      setShowComplete(true);
    }
```

with:

```tsx
    // The moment the last drink turns done on a real, not-yet-complete order:
    // counter orders auto-complete (no confirm); online orders open the confirm
    // modal. Guard on persist so a read-only render never fires completion.
    if (nowAllDone && status === "done" && persist) {
      setLastDoneIndex(index);
      if (isCounterOrder) {
        completeCounterOrder();
      } else {
        setShowComplete(true);
      }
    }
```

- [ ] **Step 5: Route to the board on online success instead of jumping to WhatsApp**

In `confirmComplete`, replace the success tail. Current code:

```tsx
      setShowComplete(false);
      // Auto-open WhatsApp with the prefilled ready notice so staff don't tap a
      // second button. Same-tab navigation (not window.open) so it isn't
      // popup-blocked after the await; on mobile this hands off to the WA app.
      // The persistent button below stays for manual re-sends.
      if (persist && waReadyLink) window.location.href = waReadyLink;
```

Replace with:

```tsx
      setShowComplete(false);
      // Order is complete. Show the success state, where staff send the WhatsApp
      // ready notice from a real anchor tap (not popup-blocked) that also routes
      // back to the board. No same-tab jump here, so staff land on /manage.
      setFinishState("success");
```

- [ ] **Step 6: Auto-resume counter completion after payment is resolved**

In `resolvePayment`, the success branch currently ends with `setPaymentMethod(method);`. Replace that line with:

```tsx
      setPaymentMethod(method);
      // If this was a counter order blocked on payment with every drink already
      // done, finish it now so staff don't re-trigger completion by hand.
      if (isCounterOrder && allDone) {
        setFinishState(null);
        completeCounterOrder();
      }
```

- [ ] **Step 7: Render the finished modal**

After the `{showChangePayment && (...)}` block near the end of the JSX (before the closing `</main>`), add:

```tsx
      {finishState && (
        <OrderFinishedModal
          orderNumber={order.orderNumber}
          state={finishState}
          variant={isCounterOrder ? "counter" : "online"}
          waReadyLink={waReadyLink}
          error={completeError}
          onDone={goToBoard}
          onClose={() => setFinishState(null)}
        />
      )}
```

- [ ] **Step 8: Lint + build**

Run: `npm run lint && npm run build`
Expected: PASS. `npm run build` type-checks; confirm no errors in `components/order-detail.tsx` or `components/order-finished-modal.tsx`. Watch for an unused `waReadyLink`/`window` warning — the same-tab jump is gone, but `waReadyLink` is still used by the resend button and the finished modal.

- [ ] **Step 9: Manual verification**

Start the app (`npm run dev`) and run the spec scenarios:
1. Kiosk order, paid → mark all drinks done → loading → success → OK → lands on `/manage`.
2. Kiosk order, unpaid → all done → error ("Set the payment method…") → OK dismisses → set payment via picker → auto-completes → success → OK → `/manage`.
3. Online order with phone → all done → confirm modal → confirm → success → "Send on WhatsApp" opens WA in a new tab AND routes to `/manage`; re-run and use "Done" → routes without sending.
4. Online order without phone → all done → confirm → success → only "Done" → `/manage`.
5. Confirm the WhatsApp anchor is not popup-blocked (real tap, `target="_blank"`).

- [ ] **Step 10: Commit**

```bash
git add components/order-detail.tsx
git commit -m "feat(manage): route to board after finish; kiosk auto-complete

Counter orders (kiosk/custom) skip the confirm modal and auto-run completion,
showing a success/error state. Online orders keep the confirm step then show a
success state whose WhatsApp send routes back to /manage. Counter orders blocked
on payment auto-resume once staff set the method.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Kiosk no-confirm + auto-complete → Task 2 Step 4 (`completeCounterOrder` branch).
- Kiosk success OK → /manage → Task 1 success/counter + Task 2 `goToBoard`.
- Kiosk error (unpaid) state, no route → Task 1 error state + Task 2 `onClose`.
- Counter unpaid auto-resume → Task 2 Step 6.
- Online confirm retained → Task 2 Step 4 (`setShowComplete(true)` else-branch).
- Online success + WhatsApp anchor routing to /manage → Task 1 online/success + Task 2 Step 5.
- Online no-phone → only Done → Task 1 (`waReadyLink` null guards the anchor).
- Loading states → Task 1 `loading` state; counter opens in loading.
- Routing via `router.push("/manage")` → `goToBoard` uses `backHref` (defaults to `/manage`).
- `actions.ts` / `order-complete-modal.tsx` unchanged → not in any task's Modify list.

**Placeholder scan:** none — all steps carry full code. Step 1 of Task 1 flags the unused `BellRing` import to prune.

**Type consistency:** `OrderFinishedModal` prop names/types (`state`, `variant`, `waReadyLink`, `error`, `onDone`, `onClose`) match between Task 1's definition and Task 2 Step 7's render. `finishState` union matches the `state` prop union. `completeCounterOrder`, `goToBoard` referenced only after definition. `backHref` already a prop (defaults `/manage`); `waReadyLink`, `completeError`, `allDone`, `isCounterOrder` all in scope.
