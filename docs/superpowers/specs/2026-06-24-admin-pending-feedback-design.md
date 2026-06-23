# Admin Module — Pending-State Feedback

Date: 2026-06-24
Status: Approved design, ready for implementation plan

## Problem

Across the `/admin` module, several interactive components call `useTransition`
but discard the pending flag (`const [, startTransition] = useTransition()`).
During a server action the buttons, toggles, and chips stay fully active with no
spinner, no disabled state, and no confirmation. The operator can't tell whether
a tap registered, and rapid taps can race the server.

A good pattern already exists in the codebase — `customer-detail.tsx`,
`product-form.tsx`, and `order-detail.tsx` track pending, disable the control,
swap the label to a verb + spinner, and show inline success/error text. The work
is bringing the laggard components up to that existing standard.

## Goal

Every mutating control in `/admin` (and the `/manage` order board, which shares
the surface) gives immediate in-flight feedback and a clear result. Inline only —
no toast system, no new dependency, no server-action or schema changes. This is a
pure client-feedback layer.

## Non-Goals

- No toast / sonner system.
- No new libraries.
- No changes to server actions, RLS, or the database.
- No refactor of components that already surface pending correctly.

## The Standard

For every mutating control:

1. **In-flight:** the control disables and shows it is working.
   - Buttons: render `<Loader2 className="animate-spin" />` before the label and
     swap the label to a verb form ("Saving…", "Adding…", "Archiving…",
     "Deleting…").
   - Switches / chips / icon buttons: disable (and dim where it reads as active)
     so they can't be tapped again or raced.
2. **Result:**
   - Success: clears/closes/reloads exactly as it does today.
   - Failure: shows inline `text-destructive` text (most already do) AND the
     control re-enables so the action can be retried.

Optimistic toggles keep their current behavior (instant update, revert on
failure); the in-flight lock is added on top so the control gives feedback and
can't be raced.

## Shared Primitive

Add `components/ui/pending-button.tsx`: a thin wrapper over the existing
`Button` that

- accepts a `pending: boolean` prop plus all normal `Button` props,
- renders `<Loader2 className="size-4 animate-spin" />` before `children` when
  `pending` is true,
- sets `disabled={pending || disabled}`.

It reuses the same `Loader2` spinner already used in `order-detail.tsx`, so it
introduces nothing new visually. This is the DRY unit reused across the
button-driven managers (AGENTS.md: extract a component when a pattern repeats).

```tsx
// shape only — final code in implementation
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PendingButton({
  pending,
  disabled,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean }) {
  return (
    <Button disabled={pending || disabled} {...props}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
```

Components that need a different label while pending (e.g. "Save" → "Saving…")
pass the conditional text as `children`; `PendingButton` only owns the spinner +
disabled wiring.

## Per-File Changes

### Button-driven managers — capture and surface the pending flag

Each of these currently does `const [, startTransition] = useTransition()` in one
or more scopes. Change to `const [pending, startTransition] = useTransition()`
and route the flag into the relevant `PendingButton`(s). Because each row holds
its own `useTransition`, pending stays scoped to that row — pressing Save on one
card does not spin every card.

- **`addon-manager.tsx`**
  - Parent: New add-on (`add`).
  - `AddonRow`: Save, Archive/Restore. Both share the row transition; while one is
    in flight, both row buttons disable.
- **`tiers-manager.tsx`**
  - Parent: New tier (`add`).
  - `TierRow`: Save, Archive/Restore.
- **`streak-milestones-manager.tsx`**
  - Parent: New milestone (`add`).
  - `MilestoneRow`: Save, Delete (icon button — show spinner in place of the
    trash icon while deleting), and disable the active Switch while in flight.
- **`reward-catalog-manager.tsx`**
  - `RewardEditor`: Save / Add reward.
  - `RewardRow`: Archive/Restore, and disable the active Switch while in flight.
- **`promotions-manager.tsx`**
  - `PromotionEditor` Save already shows "Saving…" — leave as is.
  - `PromotionRow`: Delete promotion (verb + spinner), and disable the active
    Switch while in flight.
  - Parent New-promotion `reload()` transition: no visible control needs it; no
    change required beyond what the row/editor cover.
- **`category-manager.tsx`**
  - Parent: Add category (`add`).
  - `CategoryRow`: Save, Archive/Restore.
  - Reorder ▲▼ arrows: disable both arrows on a row while a `reorderCategories`
    call is in flight (in addition to the existing first/last disabling), so the
    optimistic reorder can't be raced.

### Toggle / Switch in-flight lock

- **`menu-list-live.tsx`** — the central one. Controls: availability Switch,
  Best Seller chip, New chip, Archive/Restore link. Track a `Set<string>` of
  in-flight keys formed as `` `${productId}:${field}` `` (e.g. `availability`,
  `best_seller`, `new`, `archive`). On action start, add the key; in a `finally`,
  remove it. The specific control disables (Switch `disabled`, chip `disabled` +
  dim, link `disabled`/`pointer-events-none`) until its own action settles. The
  existing optimistic update + revert-on-failure stays unchanged.
  - `FlagChip` gains a `disabled?: boolean` prop that disables the button and
    applies a dim/`opacity-60` class.

The Switch-only managers above (`reward-catalog-manager`, `promotions-manager`,
`streak-milestones-manager`) get the simpler per-row lock via their row
`useTransition` `pending` flag, not a Set, since each row has at most one Switch.

## Explicitly Untouched

These already track and surface pending correctly — no churn:

- `customer-detail.tsx`
- `product-form.tsx`
- `order-detail.tsx`
- `manage-orders-live.tsx` / `manage-orders-screen.tsx`
- `settings-form.tsx`, `payment-settings-form.tsx`, `loyalty-settings-form.tsx`,
  `store-account-form.tsx`, `image-upload.tsx`, `reports-view.tsx`

## Accessibility

- The spinner is `aria-hidden`; the button's accessible name comes from its text.
  Where a button has only an icon (Delete), keep the existing `aria-label` and
  swap the icon for the spinner while pending.
- Disabled controls already get the platform's disabled semantics; no extra ARIA
  needed.

## Testing

Manual verification (AGENTS.md — make the feature work end to end, no automated
test harness for admin UI today). Run the app and, for each surface, confirm the
control disables + spins during the action and re-enables on error:

1. **Menu** (`/admin/menu`): toggle availability, Best Seller, New, Archive on an
   item — control locks during the call, settles after. Force a failure (offline)
   and confirm revert + re-enable.
2. **Categories** (`/admin/categories`): Add, Save a row, Archive/Restore,
   reorder ▲▼ — arrows lock during reorder.
3. **Add-ons** (`/admin/addons`): Add, row Save, Archive/Restore.
4. **Rewards** (`/admin/rewards`): Add/Save reward, active Switch, Archive;
   Tiers Add/Save/Archive; Milestones Add/Save/Delete/active Switch.
5. **Promotions** (`/admin/promotions`): active Switch, Delete.
6. Spot-check an untouched surface (Customer detail, Product form) to confirm no
   regression.

## Risks

- Low. Changes are additive client wiring; no data path changes.
- Watch that row-scoped `useTransition` keeps pending isolated per row (it does —
  each row component owns its own hook instance).
