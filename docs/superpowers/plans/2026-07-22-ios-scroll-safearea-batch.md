# iOS Scroll & Safe-Area Foundation Batch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate iOS safe-area insets app-wide, fix the body scroll-lock technique, unify all 12 hand-rolled modal locks onto the shared refcounted hook, and stabilise sheet sizing/overscroll.

**Architecture:** One `viewport` export turns on `env(safe-area-inset-*)` (currently resolving to 0). The shared `useBodyScrollLock` hook switches from `overflow:hidden` (iOS ignores it) to `position:fixed` + saved scroll position, keeping its existing reference counting. Every modal that currently pokes `document.body.style.overflow` directly is routed through that one hook so locks compose. Four sheets move `vh`→`dvh` and gain `overscroll-contain`.

**Tech Stack:** Next.js App Router, TypeScript, Tailwind, shadcn/ui.

## Global Constraints

- `themeColor` value is exactly `#171717` (matches `app/manifest.ts` `theme_color`).
- Do NOT add status-bar `black-translucent` or any top-inset work — explicitly deferred (needs its own pass; translucent draws content under the status bar once cover is on).
- No JS test framework exists in this repo by design (per CLAUDE.md) — do NOT add one. Verification for every task = `npm run build` (must exit 0) + `npx eslint <changed files>` + the manual checks stated in the task.
- `overscroll-contain` is scoped to the 5 sheets touched here — no global sweep.
- All 12 hand-rolled modal locks get converted (user-approved scope).
- The `position:fixed` body lock is correct because the app scrolls on `window` (customer layout is a `min-h-dvh` flex column); the body carries no transform, so fixed-position chrome (tab bar, FAB) stays pinned.

---

### Task 1: KEYSTONE — activate safe-area insets

**Files:**
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: a live `env(safe-area-inset-*)` context for the whole app. No exported symbols other tasks depend on.

- [ ] **Step 1: Add the `Viewport` import and export**

In `app/layout.tsx`, change the first import line and add a `viewport` export directly after the `metadata` export (leave `metadata`, including `appleWebApp.statusBarStyle: "default"`, unchanged).

Change:
```tsx
import type { Metadata } from "next";
```
to:
```tsx
import type { Metadata, Viewport } from "next";
```

Add after the closing `};` of `export const metadata`:
```tsx
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#171717",
};
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exit 0, no type error on the `viewport` export.

- [ ] **Step 3: Lint**

Run: `npx eslint app/layout.tsx`
Expected: no errors.

- [ ] **Step 4: Manual check**

Run `npm run dev`, open the customer storefront in a mobile viewport (or a real iPhone/simulator if available). Confirm the tab bar and cart FAB now clear the home-indicator area (previously flush to the physical bottom edge). On a non-notched screen there is no visible change — that is expected.

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(ios): enable viewport-fit=cover so safe-area insets apply"
```

---

### Task 2: Fix the body scroll-lock hook

**Files:**
- Modify: `hooks/use-body-scroll-lock.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `useBodyScrollLock(active: boolean): void` — unchanged signature; locks the body via `position:fixed` and restores scroll position on the last release. Task 3 depends on this exact signature.

- [ ] **Step 1: Replace the lock technique, keep the reference counting**

Replace the entire contents of `hooks/use-body-scroll-lock.ts` with:
```ts
import { useEffect } from "react";

// Shared, reference-counted body scroll lock. Several modals can be open at
// once (e.g. Install + Welcome both fire right after login). Counting locks and
// only releasing when the last one closes composes safely. Uses position:fixed
// rather than overflow:hidden because mobile Safari ignores the latter and keeps
// rubber-banding the page behind the overlay.
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

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Lint**

Run: `npx eslint hooks/use-body-scroll-lock.ts`
Expected: no errors.

- [ ] **Step 4: Manual check (existing hook consumers)**

The install-prompt and welcome-modal already use this hook. In `npm run dev`: trigger the welcome/install modal, scroll attempt on the background — background must NOT move. Close the modal — the page must be exactly where it was, not jumped to the top.

- [ ] **Step 5: Commit**

```bash
git add hooks/use-body-scroll-lock.ts
git commit -m "fix(ios): lock body scroll via position:fixed instead of overflow:hidden"
```

---

### Task 3: Route all 12 modals through the shared hook

**Files (modify):**
- `components/cart-sheet.tsx`
- `components/order-finished-modal.tsx`
- `components/avatar-crop-modal.tsx`
- `components/change-payment-modal.tsx`
- `components/order-complete-modal.tsx`
- `components/phone-prompt-sheet.tsx`
- `components/receipt-modal.tsx`
- `components/refund-passcode-modal.tsx`
- `components/rewards-info-modal.tsx`
- `components/rewards-tiers-modal.tsx`
- `components/rewards-referral-modal.tsx`
- `components/signout-confirm-modal.tsx`

**Interfaces:**
- Consumes: `useBodyScrollLock(true)` from Task 2 (`@/hooks/use-body-scroll-lock`).
- Produces: nothing new.

Every one of these modals is mounted only while open, so the lock argument is always the literal `true`. Each file gets this import added near the other imports:
```tsx
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
```

There are three edit shapes. Apply the matching shape per file (table below).

**Shape A — combined Esc + lock effect (10 files).** These have the body-overflow lock living inside the SAME `useEffect` as an Escape-key handler. Strip ONLY the three overflow lines; keep the Escape listener. Add the hook call immediately above the effect.

BEFORE (variable is `prev` or `prevOverflow`; the Esc guard may include `&& !busy`; deps vary):
```tsx
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);
```
AFTER (preserve the file's original Esc guard, callback name, and deps array exactly — only the three overflow lines are removed and the hook line added):
```tsx
  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
```

**Shape B — dedicated lock effect (`cart-sheet.tsx` only).** The lock is its own effect, separate from the Esc effect. Delete the whole lock effect and its comment; add the hook call. Leave the separate Esc effect and the reprice effect untouched.

DELETE this block (around L184–191):
```tsx
  // Lock background scroll while the sheet is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
```
ADD near the top of the `CartSheet` component body (e.g. right after the `useState`/hook declarations):
```tsx
  useBodyScrollLock(true);
```

**Shape C — lock-only effect (`order-finished-modal.tsx` only).** The effect does nothing but lock. Replace the whole effect with the hook call. This modal has no other `useEffect`, so also remove `useEffect` from its `react` import.

DELETE (L20–26):
```tsx
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
```
ADD in its place:
```tsx
  useBodyScrollLock(true);
```
Then fix the import: if the line is `import { useEffect } from "react";` remove it entirely; if `useEffect` is part of a larger destructured import, drop just `useEffect`.

**Per-file map:**

| File | Shape | Effect location | Notes |
|------|-------|-----------------|-------|
| `cart-sheet.tsx` | B | lock effect ~L184–191 | keep Esc effect (~L193–200) + reprice effect (~L170) |
| `order-finished-modal.tsx` | C | ~L20–26 | remove now-unused `useEffect` import |
| `avatar-crop-modal.tsx` | A | ~L60–71 | Esc guard is `&& !busy`, deps `[busy, onCancel]` |
| `change-payment-modal.tsx` | A | ~L36–47 | Esc guard `&& !busy`, deps `[busy, onCancel]` |
| `order-complete-modal.tsx` | A | ~L36–47 | Esc guard `&& !busy`, deps `[busy, onCancel]` |
| `phone-prompt-sheet.tsx` | A | ~L28–39 | Esc guard `&& !busy`, deps `[busy, onClose]` |
| `receipt-modal.tsx` | A | ~L19–30 | deps `[onClose]` |
| `refund-passcode-modal.tsx` | A | ~L27–38 | Esc guard `&& !busy`, deps `[busy, onClose]` |
| `rewards-info-modal.tsx` | A | ~L33–44 | deps `[onClose]` |
| `rewards-tiers-modal.tsx` | A | ~L21–32 | deps `[onClose]` |
| `rewards-referral-modal.tsx` | A | ~L12–23 | deps `[onClose]` |
| `signout-confirm-modal.tsx` | A | ~L15–26 | deps `[onClose]` |

- [ ] **Step 1: Apply the import + matching shape to each of the 12 files** (use the table).

- [ ] **Step 2: Verify no direct body-overflow locks remain in components**

Use the Grep tool: pattern `document\.body\.style\.overflow`, path `components/`.
Expected: zero matches under `components/` (all locks now go through the hook).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0. In particular no "useEffect is defined but never used" from `order-finished-modal.tsx`.

- [ ] **Step 4: Lint the changed files**

Run: `npx eslint components/cart-sheet.tsx components/order-finished-modal.tsx components/avatar-crop-modal.tsx components/change-payment-modal.tsx components/order-complete-modal.tsx components/phone-prompt-sheet.tsx components/receipt-modal.tsx components/refund-passcode-modal.tsx components/rewards-info-modal.tsx components/rewards-tiers-modal.tsx components/rewards-referral-modal.tsx components/signout-confirm-modal.tsx`
Expected: no errors.

- [ ] **Step 5: Manual checks**

In `npm run dev`:
- Open the cart sheet, try to scroll the menu behind it — background must not move; close it — scroll position preserved.
- Open a rewards modal (info/tiers/referral) — Escape key still closes it (proves the Esc handler survived the edit).
- Stacked case: from the cart sheet, tap the clear-cart confirmation — closing both must leave the page scrollable (no permanent lock).
- **Watch item (from spec):** in the cart sheet tap through to checkout (a `Link` that unmounts the sheet). Confirm no visible scroll jump on arrival. If a jump appears, the fix is to skip `window.scrollTo` when the pathname changed — add that ONLY if observed.

- [ ] **Step 6: Commit**

```bash
git add components/cart-sheet.tsx components/order-finished-modal.tsx components/avatar-crop-modal.tsx components/change-payment-modal.tsx components/order-complete-modal.tsx components/phone-prompt-sheet.tsx components/receipt-modal.tsx components/refund-passcode-modal.tsx components/rewards-info-modal.tsx components/rewards-tiers-modal.tsx components/rewards-referral-modal.tsx components/signout-confirm-modal.tsx
git commit -m "refactor(ios): route all modal scroll locks through shared hook"
```

---

### Task 4: `dvh` sizing + `overscroll-contain` on the 5 sheets

**Files (modify):**
- `components/cart-sheet.tsx`
- `components/drink-row.tsx`
- `components/rewards-tiers-modal.tsx`
- `components/stamps/voucher-picker-sheet.tsx`
- `components/swap-picker.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

Pure Tailwind className edits. `cart-sheet.tsx` is already `dvh`, so it only needs `overscroll-contain` on its scroller.

- [ ] **Step 1: `cart-sheet.tsx` scroller** — add `overscroll-contain`

Change (~L262-263):
```tsx
          className="flex-1 overflow-y-auto px-5"
```
to:
```tsx
          className="flex-1 overflow-y-auto overscroll-contain px-5"
```

- [ ] **Step 2: `drink-row.tsx` recipe sheet** — `55vh`→`55dvh` + `overscroll-contain`

Change (L307):
```tsx
                  <SheetContent side="bottom" aria-describedby={undefined} className="max-h-[55vh] overflow-y-auto rounded-t-2xl px-4 pb-6 pt-4">
```
to:
```tsx
                  <SheetContent side="bottom" aria-describedby={undefined} className="max-h-[55dvh] overflow-y-auto overscroll-contain rounded-t-2xl px-4 pb-6 pt-4">
```

- [ ] **Step 3: `rewards-tiers-modal.tsx`** — `80vh`→`80dvh` (panel) + `overscroll-contain` (list scroller)

Change (L49):
```tsx
        className="relative flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white naise-pop"
```
to:
```tsx
        className="relative flex max-h-[80dvh] w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white naise-pop"
```
Change (L73):
```tsx
        <ul className="flex flex-col gap-3 overflow-y-auto px-6 py-6">
```
to:
```tsx
        <ul className="flex flex-col gap-3 overflow-y-auto overscroll-contain px-6 py-6">
```

- [ ] **Step 4: `stamps/voucher-picker-sheet.tsx`** — `85vh`→`85dvh` + `overscroll-contain`

Change (L60):
```tsx
        className="z-[60] mx-auto flex max-h-[85vh] w-full max-w-md flex-col gap-0 rounded-t-3xl p-0"
```
to:
```tsx
        className="z-[60] mx-auto flex max-h-[85dvh] w-full max-w-md flex-col gap-0 rounded-t-3xl p-0"
```
Change (L72):
```tsx
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
```
to:
```tsx
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
```

- [ ] **Step 5: `swap-picker.tsx`** — `88vh`→`88dvh` + `overscroll-contain` on each body scroller

Change (L147):
```tsx
        className="mx-auto flex max-h-[88vh] w-full max-w-md flex-col gap-0 rounded-t-3xl p-0"
```
to:
```tsx
        className="mx-auto flex max-h-[88dvh] w-full max-w-md flex-col gap-0 rounded-t-3xl p-0"
```
Then add `overscroll-contain` to every `min-h-0 flex-1 overflow-y-auto ...` scroll region in this sheet's body (there is the customize-step scroller at ~L181; use the Grep tool for `overflow-y-auto` within `components/swap-picker.tsx` to catch the drink-list scroller too, and add `overscroll-contain` to each). Example — change:
```tsx
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
```
to:
```tsx
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
```

- [ ] **Step 6: Verify no `vh` sheet sizing remains**

Use the Grep tool for `\[\d+vh\]` across `components/`.
Expected: zero matches (the 4 sheet sizes are now `dvh`; there is no other intentional `vh` sheet sizing in scope).

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 8: Lint the changed files**

Run: `npx eslint components/cart-sheet.tsx components/drink-row.tsx components/rewards-tiers-modal.tsx components/stamps/voucher-picker-sheet.tsx components/swap-picker.tsx`
Expected: no errors.

- [ ] **Step 9: Manual checks**

In `npm run dev`, on a mobile viewport: open each sheet (recipe from a menu card, vouchers at checkout, swap-drink, rewards tiers, cart) and confirm none overshoots the visible viewport when the Safari toolbar is showing, and that reaching the top/bottom of a sheet's scroll does not drag the page behind it.

- [ ] **Step 10: Commit**

```bash
git add components/cart-sheet.tsx components/drink-row.tsx components/rewards-tiers-modal.tsx components/stamps/voucher-picker-sheet.tsx components/swap-picker.tsx
git commit -m "fix(ios): use dvh sheet heights and contain sheet overscroll"
```

---

## Notes for the executor

- End on the `development` branch (this repo's working branch). Push to `development` directly per the project git workflow — no PR needed for this batch.
- If any manual check on a real device reveals home-indicator overlap on a specific fixed element, that element already references the insets; the fix is a CSS tweak on that element, not a change to Tasks 1–2. Note it, don't rework the foundation.
