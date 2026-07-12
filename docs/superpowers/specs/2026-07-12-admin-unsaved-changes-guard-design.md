# Admin Unsaved-Changes Guard — Design

Date: 2026-07-12
Status: Approved for planning

## Problem

Admin editing screens hold their edits in local `useState` and commit only when
the user presses a Save button. Nothing warns an admin who edits a form and then
navigates away — clicks another sidebar section, follows a Back link, or reloads
the tab — so unsaved work is silently lost. We want a safeguard: when a form has
unsaved changes and the user tries to leave, confirm first.

## Scope

In scope — the warning triggers on:

- **Sidebar navigation** — clicking another admin section (Menu, Promotions,
  Settings, etc.) in the left sidebar (`admin-shell.tsx`), and the "Back to app"
  link.
- **Back / cancel links** — the in-page `AdminBackLink` and imperative
  `router.push` cancels inside forms (e.g. `cost-manager`).
- **Browser close / reload / hard back** — native `beforeunload` prompt (the
  browser's own dialog; cannot be styled).

Out of scope (YAGNI):

- Warning on browser **tab switch** (visibilitychange) — fires constantly, feels
  broken, non-standard.
- Per-field "unsaved" indicators — only a single global guard.
- Draft persistence / autosave — a separate feature.
- Auto-saving on "Leave" — leaving discards edits.

## Approach

Adopt the official Next.js App Router pattern for blocking navigation on unsaved
changes (`next/link` `onNavigate` + React Context), upgrading the confirm step
from `window.confirm` to a styled shadcn `AlertDialog`. Next.js version in this
repo is 16.2.9; `onNavigate` is available (added v15.3.0).

Rejected alternatives:

- **Global document click interceptor** — fragile, misses `router.push` and
  keyboard nav, fights React's event system.
- **Per-form, no shared context** — cannot guard sidebar navigation (a form does
  not own the sidebar), so only the browser close prompt would work; also
  duplicates logic across ~10 forms.

## Architecture

```
app/(admin)/layout.tsx
  └─ <UnsavedChangesProvider>          holds dirty registry + pending-destination
       ├─ <AdminShell>                 sidebar links become <GuardedLink>
       │    └─ children (the forms)    each calls useUnsavedChanges(dirty)
       └─ <UnsavedChangesDialog>       one shared AlertDialog, rendered once
```

Four pieces:

1. **`UnsavedChangesProvider`** (`components/admin/unsaved-changes.tsx`) — React
   context holding the set of dirty sources, a pending destination, and the
   open/closed state of the dialog. Arms a `beforeunload` listener whenever
   anything is dirty.
2. **`useUnsavedChanges(dirty)` hook** — a form passes its own dirty boolean.
   The hook registers/deregisters the form as a dirty source in the provider and
   auto-clears on unmount. One line per form.
3. **`GuardedLink`** (`components/admin/guarded-link.tsx`) — wraps `next/link`.
   On `onNavigate`, if anything is dirty, cancels the navigation
   (`e.preventDefault()`), stores the destination in the provider, and opens the
   dialog.
4. **`UnsavedChangesDialog`** — a single shadcn `AlertDialog` rendered once in the
   layout. Confirm → clear dirty + navigate to stashed destination; cancel → stay.

Key choice: the dialog is rendered **once at the layout level**, not per link.
Links only signal intent; the provider owns the destination and performs the
actual navigation via `router.push`.

## Data flow

Marking dirty (each form) — reuse the snapshot approach `rewards-manager`
already uses (serialize initial props as `baseline`, compare to `current`):

```tsx
const dirty = current !== baseline;
useUnsavedChanges(dirty);   // the single line each form adds
```

On successful save the form's state resets to match the server (or the page
reloads, as `rewards-manager` does), so `dirty` flips to false and the guard
disarms automatically. No manual clear call.

In-app navigation (sidebar + back links):

```
user clicks GuardedLink
  → onNavigate fires
     → nothing dirty → navigate normally
     → dirty         → e.preventDefault()
                       provider stores destination = href
                       provider opens the AlertDialog
                          → "Leave"  → clear dirty; router.push(destination)
                          → "Stay"   → close dialog; stay put
```

Imperative `router.push` inside forms — the provider exposes
`useGuardedNavigation()` returning `guardedPush(href)`. Forms that navigate
imperatively (e.g. `cost-manager` Cancel) call it instead of `router.push`. Same
dialog, same flow.

Browser close / reload / hard back — while anything is dirty the provider
registers a `beforeunload` handler that calls `e.preventDefault()`, triggering
the browser's native prompt. Removed as soon as dirty clears. This case cannot
use the styled dialog (browsers disallow it); native prompt is expected behavior.

Multiple forms per page — the Settings page stacks three forms. The provider
tracks dirtiness as a set of registered dirty source ids ("is anything dirty"),
so a clean form does not disarm the guard for a dirty sibling. Each
`useUnsavedChanges` call owns a stable id.

## Files

New:

- `components/admin/unsaved-changes.tsx` — provider, `useUnsavedChanges` hook,
  `useGuardedNavigation` (`guardedPush`), `UnsavedChangesDialog`, `beforeunload`
  arming. (~90–120 lines.)
- `components/admin/guarded-link.tsx` — `next/link` wrapper using `onNavigate`.
  (~25 lines.)
- `components/ui/alert-dialog.tsx` — added via
  `npx shadcn@latest add alert-dialog` (not hand-written, per AGENTS.md).

Edited:

- `app/(admin)/layout.tsx` — wrap children in `UnsavedChangesProvider`; render one
  `UnsavedChangesDialog`.
- `components/admin/admin-shell.tsx` — `NavLinks` and `ExitToApp` use
  `GuardedLink`.
- `components/admin/admin-back-link.tsx` — use `GuardedLink`.
- Forms add `useUnsavedChanges(dirty)` (and a `baseline`/`current` snapshot where
  one does not already exist):
  - `settings-form`, `payment-settings-form`, `store-account-form`,
    `stamp-settings-form`
  - `product-form`, `category-manager`, `addon-manager`, `promotions-manager`,
    `cost-manager`
  - `rewards-manager` (already has `dirty` — just wire the hook)
  - `customer-detail` (role / beans changes)

## Dialog copy

> **Unsaved changes**
> You've made changes that haven't been saved. If you leave now, they'll be lost.
> **[ Stay ]**   **[ Leave without saving ]**

"Stay" is the default/safe action (autofocus). "Leave without saving" is styled
destructive.

## Decisions made

1. On "Leave," discard edits rather than auto-save. Auto-save on exit is
   surprising and can persist half-finished work.
2. Reuse each form's snapshot approach for dirty detection rather than a generic
   `onChange`-sets-dirty, because some forms use toggles/pickers that do not emit
   `onChange`, and snapshotting correctly reports "clean" when an edit is undone
   back to the original value.

## Verification

No JS test framework in this repo by design (AGENTS.md) — do not add one.

- `npm run build` exits 0 (the real type-check/integration gate).
- `npx eslint <path>` on each changed file.
- Manual checklist:
  - Edit a form → click a sidebar item → dialog appears.
  - "Stay" keeps edits and stays on the page.
  - "Leave without saving" discards edits and navigates.
  - Edit → reload/close tab → native browser prompt.
  - Save → navigate → no prompt (guard disarmed).
  - Settings page with two forms: one dirty still guards even if a sibling is
    clean.
  - Modifier-click / external links / downloads are unaffected (`onNavigate`
    does not fire for those).
