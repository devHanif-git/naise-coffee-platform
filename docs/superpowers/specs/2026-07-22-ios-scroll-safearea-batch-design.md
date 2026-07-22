# iOS Scroll & Safe-Area Foundation Batch — Design

**Date:** 2026-07-22
**Source:** `docs/ios-mobile-ux-audit.md` (KEYSTONE + P1 items #1–#4)
**Scope:** Activate iOS safe-area insets app-wide, fix the body scroll-lock technique, unify all modal locks onto the shared hook, and stabilise sheet sizing/overscroll. Mechanical, low-risk, tightly related — one pass.

---

## Problem

Four coupled iOS-mobile defects, all touching the same scroll/safe-area foundation:

1. **Safe-area insets are dead code.** `app/layout.tsx` has no `viewport` export with `viewportFit: "cover"`, so every `env(safe-area-inset-*)` reference in the app resolves to `0`. The tab bar, cart FAB, cart sheet, product CTA, and admin save bars all already reference the insets but get nothing.
2. **Body scroll-lock uses a technique iOS ignores.** `hooks/use-body-scroll-lock.ts` is already correctly reference-counted, but it locks via `document.body.style.overflow = "hidden"`, which mobile Safari does not honour — the page keeps rubber-banding behind modals.
3. **12 modals hand-roll their own lock and bypass the hook.** Each sets `document.body.style.overflow` directly with its own save/restore. These do not compose: a modal opened while another lock is active can capture `"hidden"` as the "previous" value and restore `"hidden"` on close, leaving the app permanently unscrollable.
4. **Sheet sizing/overscroll instability.** Four sheets still size in `vh` (includes space behind the iOS address bar → jump/overshoot when the toolbar resizes), and scrollable sheet regions lack `overscroll-behavior`, so momentum bleeds into the page at the top/bottom.

## Non-goals

- Status-bar `black-translucent` style (audit P5). With `viewport-fit=cover` enabled, translucent draws content *under* the status bar and needs its own top-inset pass; bundling it here risks overlap. Explicitly deferred.
- Any tap-target, font-self-host, CHIP-return, focus-trap, or cart-validation work (audit P1 #5–#6, P2+). Separate batches.
- A global `overscroll-contain` sweep. Only the sheets touched in this batch get it.

---

## Design

### KEYSTONE — activate safe-area insets

Add a `Viewport` export to `app/layout.tsx`:

```tsx
import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#171717", // matches manifest theme_color
};
```

No consumer changes — the inset references already exist across tab-bar, cart-fab, cart-sheet, product-customizer, the customer layout, and the admin save bars. This one export turns them on.

### #1 — Fix the scroll-lock hook

`hooks/use-body-scroll-lock.ts` keeps its reference-counting (which is already correct). Only the lock *technique* changes — from `overflow:hidden` to `position:fixed` with saved scroll position:

```ts
import { useEffect } from "react";

let locks = 0;
let savedScrollY = 0;

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      savedScrollY = window.scrollY;
      document.body.style.position = "fixed";
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.width = "100%";
    }
    locks += 1;
    return () => {
      locks -= 1;
      if (locks === 0) {
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.width = "";
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [active]);
}
```

**Why this is safe here:** the app scrolls on `window` (the customer layout is a `min-h-dvh` flex column, `app/(customer)/layout.tsx:34`), so fixing the body is the correct lock target. The body carries no `transform`, so it is not a containing block for the fixed tab bar / FAB — they stay pinned.

### #2 — Route all 12 modals through the hook

Replace each bespoke `document.body.style.overflow` effect with `useBodyScrollLock(<openState>)`. Files:

- `components/avatar-crop-modal.tsx`
- `components/cart-sheet.tsx` — mounted only while open, so `useBodyScrollLock(true)`
- `components/change-payment-modal.tsx`
- `components/order-complete-modal.tsx`
- `components/order-finished-modal.tsx`
- `components/phone-prompt-sheet.tsx`
- `components/receipt-modal.tsx`
- `components/refund-passcode-modal.tsx`
- `components/rewards-info-modal.tsx`
- `components/rewards-referral-modal.tsx`
- `components/rewards-tiers-modal.tsx`
- `components/signout-confirm-modal.tsx`

(`install-prompt.tsx` and `welcome-modal.tsx` already use the hook — untouched.) Each conversion removes the local effect + its `prev`/`prevOverflow` variable and adds the hook call gated on that modal's existing open state.

### #3 — `vh` → `dvh` (4 sheets)

Straight unit swaps:

- `components/drink-row.tsx:307`
- `components/rewards-tiers-modal.tsx:49`
- `components/stamps/voucher-picker-sheet.tsx:60`
- `components/swap-picker.tsx:147`

### #4 — `overscroll-contain` on touched scrollers

Add `overscroll-contain` to the `overflow-y-auto` scroll region in the sheets already being edited: `cart-sheet.tsx` (scroller at ~L262) plus the four `vh→dvh` sheets. Scoped, not global.

---

## Risk / watch item

Clicking a `Link` inside a modal (e.g. cart → checkout) unmounts the modal, firing the hook cleanup's `window.scrollTo(savedScrollY)` as Next navigates. Expected harmless (destination is a fresh page at scrollY 0; Next handles its own restoration). **Verify the cart→checkout transition specifically** rather than adding guard code pre-emptively. If a visible jump appears, the fix is to skip `scrollTo` when the pathname changed — but only add that if observed.

## Rejected approaches

- **`overscroll-behavior:none` alone as the lock** — does not lock iOS scrolling; the whole point is that `overflow:hidden` is what iOS ignores. Overscroll is complementary (#4), not a substitute for #1.
- **A scroll-lock npm package** — a new dependency for ~15 lines. No.

## Verification

- `npm run build` → exit 0 (the real type-check/integration gate for this repo).
- `npx eslint` on changed files only.
- Manual: open cart sheet, confirm background doesn't scroll behind it and scroll position is preserved on close; open a stacked case (e.g. install + welcome) and confirm no permanent lock; check a `dvh` sheet doesn't overshoot the viewport.
- **Cannot verify without a physical iPhone:** real home-indicator clearance, rubber-band feel, and toolbar-resize behavior. Flag these as statically-reasoned, not device-tested.
