# Admin Unsaved-Changes Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn an admin before they navigate away from a form that has unsaved changes.

**Architecture:** A React context (`UnsavedChangesProvider`) rendered in the admin layout holds a registry of "dirty" form sources and a pending navigation destination. Forms register their dirty state via a `useUnsavedChanges(dirty)` hook. Sidebar/back links become `GuardedLink`s that use Next.js `onNavigate` to cancel navigation and open one shared shadcn `AlertDialog` when anything is dirty; a native `beforeunload` listener covers tab close/reload.

**Tech Stack:** Next.js 16.2.9 (App Router, `next/link` `onNavigate`), React, TypeScript (strict, no `any`), Tailwind, shadcn/ui (`AlertDialog`).

## Global Constraints

- Next.js 16.2.9 — `onNavigate` on `next/link` is available (added v15.3.0). Read `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md` before editing Link usage.
- TypeScript strict mode. No `any`.
- shadcn primitives added via CLI (`npx shadcn@latest add ...`), never hand-written.
- Tailwind utilities only; use `cn()` for conditional classes. Static values use Tailwind arbitrary values, not inline `style`.
- No JS test framework exists by design — do NOT add one. Verification per task = `npm run build` (EXIT 0) + `npx eslint <changed paths>` + the manual checklist. Whole-repo `npm run lint` is not a reliable gate (pre-existing unrelated errors).
- Git workflow: work on `development`, push directly, end on `development`. Commit per task.
- Dialog copy (verbatim):
  - Title: `Unsaved changes`
  - Body: `You've made changes that haven't been saved. If you leave now, they'll be lost.`
  - Cancel button: `Stay`
  - Confirm button: `Leave without saving`
- "Leave" discards edits — never auto-save on exit.
- Dirty detection reuses the serialize-baseline-vs-current snapshot approach (as in `components/admin/rewards-manager.tsx`), not generic `onChange`.

---

## File Structure

New files:

- `components/admin/unsaved-changes.tsx` — `UnsavedChangesProvider`, `useUnsavedChanges(dirty)`, `useGuardedNavigation()` → `{ guardedPush }`, `UnsavedChangesDialog`. Owns the dirty registry, pending destination, dialog open state, and `beforeunload` arming.
- `components/admin/guarded-link.tsx` — `GuardedLink`, a `next/link` wrapper using `onNavigate`.
- `components/ui/alert-dialog.tsx` — shadcn primitive (CLI-generated).

Modified files:

- `app/(admin)/admin/layout.tsx` — wrap `AdminShell` + children in `UnsavedChangesProvider`; render one `UnsavedChangesDialog`.
- `components/admin/admin-shell.tsx` — `NavLinks` + `ExitToApp` use `GuardedLink`.
- `components/admin/admin-back-link.tsx` — use `GuardedLink`.
- Forms wire `useUnsavedChanges(dirty)`:
  - `components/admin/rewards-manager.tsx` (already computes `dirty`)
  - `components/admin/settings-form.tsx`
  - `components/admin/product-form.tsx`
  - `components/admin/category-manager.tsx`
  - `components/admin/addon-manager.tsx`
  - `components/admin/promotions-manager.tsx`
  - `components/admin/cost-manager.tsx` (also swap its `router.push` for `guardedPush`)
  - `components/admin/payment-settings-form.tsx`
  - `components/admin/stamp-settings-form.tsx`
  - `components/admin/customer-detail.tsx` (also swap its `router.push` for `guardedPush`)

Excluded (documented in spec): `store-account-form.tsx` — its toggle auto-saves instantly and the passcode field is transient (cleared on save), so it has no meaningful unsaved state.

Note on `/manage`: the orders board at `app/(admin)/manage` is NOT under `admin/layout.tsx`, so the provider does not wrap it. That is intentional — it is not a form-save surface.

---

## Task 1: Add the shadcn AlertDialog primitive

**Files:**
- Create: `components/ui/alert-dialog.tsx` (via CLI)

**Interfaces:**
- Produces: `AlertDialog`, `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogFooter`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogAction`, `AlertDialogCancel` (standard shadcn exports) — consumed by Task 2's `UnsavedChangesDialog`.

- [ ] **Step 1: Generate the component**

Run: `npx shadcn@latest add alert-dialog`
Expected: creates `components/ui/alert-dialog.tsx`. If it prompts to install `@radix-ui/react-alert-dialog`, allow it.

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add components/ui/alert-dialog.tsx package.json package-lock.json
git commit -m "feat(admin): add shadcn alert-dialog primitive"
```

---

## Task 2: Build the unsaved-changes provider, hook, and dialog

**Files:**
- Create: `components/admin/unsaved-changes.tsx`

**Interfaces:**
- Consumes: `AlertDialog*` from `components/ui/alert-dialog.tsx` (Task 1).
- Produces:
  - `UnsavedChangesProvider({ children }: { children: React.ReactNode }): JSX.Element`
  - `useUnsavedChanges(dirty: boolean): void` — registers/deregisters this caller as a dirty source.
  - `useGuardedNavigation(): { guardedPush: (href: string) => void }`
  - `useUnsavedChangesGuard(): { anyDirty: boolean; requestNavigation: (href: string) => boolean }` — `requestNavigation` returns `true` if navigation may proceed immediately, `false` if it was intercepted (dialog opened). Consumed by `GuardedLink` (Task 3).
  - `UnsavedChangesDialog(): JSX.Element` — the single shared dialog; rendered once in the layout.

- [ ] **Step 1: Write the provider file**

Create `components/admin/unsaved-changes.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Ctx = {
  anyDirty: boolean;
  register: (id: string) => void;
  unregister: (id: string) => void;
  // Returns true if navigation may proceed now; false if intercepted.
  requestNavigation: (href: string) => boolean;
  // Dialog state (read by UnsavedChangesDialog).
  pending: string | null;
  confirm: () => void;
  cancel: () => void;
};

const UnsavedChangesContext = createContext<Ctx | null>(null);

function useCtx(): Ctx {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) {
    throw new Error("useUnsavedChanges must be used within UnsavedChangesProvider");
  }
  return ctx;
}

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // Set of dirty source ids. anyDirty === dirtyIds.size > 0.
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<string | null>(null);

  const anyDirty = dirtyIds.size > 0;

  const register = useCallback((id: string) => {
    setDirtyIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const unregister = useCallback((id: string) => {
    setDirtyIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const requestNavigation = useCallback(
    (href: string) => {
      if (dirtyIds.size === 0) return true;
      setPending(href);
      return false;
    },
    [dirtyIds],
  );

  const confirm = useCallback(() => {
    const href = pending;
    // Clear the whole registry: leaving discards all forms' edits.
    setDirtyIds(new Set());
    setPending(null);
    if (href) router.push(href);
  }, [pending, router]);

  const cancel = useCallback(() => setPending(null), []);

  // Native prompt for tab close / reload / hard back while anything is dirty.
  useEffect(() => {
    if (!anyDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);

  const value = useMemo<Ctx>(
    () => ({ anyDirty, register, unregister, requestNavigation, pending, confirm, cancel }),
    [anyDirty, register, unregister, requestNavigation, pending, confirm, cancel],
  );

  return (
    <UnsavedChangesContext.Provider value={value}>{children}</UnsavedChangesContext.Provider>
  );
}

// A form calls this with its own dirty boolean. Registers on dirty, clears on
// clean, and always clears on unmount.
export function useUnsavedChanges(dirty: boolean): void {
  const { register, unregister } = useCtx();
  const id = useId();
  useEffect(() => {
    if (dirty) register(id);
    else unregister(id);
  }, [dirty, id, register, unregister]);
  useEffect(() => () => unregister(id), [id, unregister]);
}

// For imperative navigation inside forms (Cancel buttons, post-action pushes).
export function useGuardedNavigation(): { guardedPush: (href: string) => void } {
  const router = useRouter();
  const { requestNavigation } = useCtx();
  const guardedPush = useCallback(
    (href: string) => {
      if (requestNavigation(href)) router.push(href);
    },
    [requestNavigation, router],
  );
  return { guardedPush };
}

// Read by GuardedLink.
export function useUnsavedChangesGuard(): {
  anyDirty: boolean;
  requestNavigation: (href: string) => boolean;
} {
  const { anyDirty, requestNavigation } = useCtx();
  return { anyDirty, requestNavigation };
}

export function UnsavedChangesDialog() {
  const { pending, confirm, cancel } = useCtx();
  const open = pending !== null;
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) cancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ve made changes that haven&apos;t been saved. If you leave now, they&apos;ll be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={cancel}>Stay</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Leave without saving
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Lint the new file**

Run: `npx eslint components/admin/unsaved-changes.tsx`
Expected: no errors.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add components/admin/unsaved-changes.tsx
git commit -m "feat(admin): unsaved-changes provider, hook, and dialog"
```

---

## Task 3: Build GuardedLink

**Files:**
- Create: `components/admin/guarded-link.tsx`

**Interfaces:**
- Consumes: `useUnsavedChangesGuard` from `components/admin/unsaved-changes.tsx` (Task 2).
- Produces: `GuardedLink(props: React.ComponentProps<typeof Link>): JSX.Element` — drop-in replacement for `next/link` that intercepts client-side navigation when dirty.

- [ ] **Step 1: Write the component**

Create `components/admin/guarded-link.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useUnsavedChangesGuard } from "@/components/admin/unsaved-changes";

// Drop-in next/link wrapper. When any admin form is dirty, cancels client-side
// navigation and lets the provider open the confirm dialog (which performs the
// push itself on "Leave").
export function GuardedLink({ children, ...props }: React.ComponentProps<typeof Link>) {
  const { requestNavigation } = useUnsavedChangesGuard();
  return (
    <Link
      {...props}
      onNavigate={(e) => {
        const href = typeof props.href === "string" ? props.href : props.href.pathname ?? "";
        if (!requestNavigation(href)) {
          e.preventDefault();
        }
        props.onNavigate?.(e);
      }}
    >
      {children}
    </Link>
  );
}
```

- [ ] **Step 2: Lint**

Run: `npx eslint components/admin/guarded-link.tsx`
Expected: no errors.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 4: Commit**

```bash
git add components/admin/guarded-link.tsx
git commit -m "feat(admin): GuardedLink wrapper for next/link"
```

---

## Task 4: Wire the provider and dialog into the admin layout

**Files:**
- Modify: `app/(admin)/admin/layout.tsx`

**Interfaces:**
- Consumes: `UnsavedChangesProvider`, `UnsavedChangesDialog` (Task 2).

- [ ] **Step 1: Edit the layout**

Replace the body of `app/(admin)/admin/layout.tsx` so the shell is wrapped:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth/session";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  UnsavedChangesProvider,
  UnsavedChangesDialog,
} from "@/components/admin/unsaved-changes";

export const metadata: Metadata = {
  title: "Naise Admin",
  robots: { index: false, follow: false },
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAdmin())) redirect("/");
  return (
    <UnsavedChangesProvider>
      <AdminShell>{children}</AdminShell>
      <UnsavedChangesDialog />
    </UnsavedChangesProvider>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/layout.tsx"
git commit -m "feat(admin): mount unsaved-changes provider in admin layout"
```

---

## Task 5: Guard the sidebar and back link

**Files:**
- Modify: `components/admin/admin-shell.tsx`
- Modify: `components/admin/admin-back-link.tsx`

**Interfaces:**
- Consumes: `GuardedLink` (Task 3).

- [ ] **Step 1: Swap Link for GuardedLink in admin-shell**

In `components/admin/admin-shell.tsx`:
- Replace the import `import Link from "next/link";` with `import { GuardedLink } from "@/components/admin/guarded-link";`.
- In `NavLinks`, change the `<Link ...>...</Link>` (the nav item) to `<GuardedLink ...>...</GuardedLink>` — keep every prop (`key`, `href`, `onClick`, `aria-current`, `className`) identical.
- In `ExitToApp`, change its `<Link ...>...</Link>` to `<GuardedLink ...>...</GuardedLink>` — keep all props identical.

- [ ] **Step 2: Swap Link for GuardedLink in admin-back-link**

Replace the full contents of `components/admin/admin-back-link.tsx`:

```tsx
import { GuardedLink } from "@/components/admin/guarded-link";
import { ChevronLeft } from "lucide-react";

// Back control for CMS sub-pages reached by an in-page link (not from the
// drawer). Padding-free; the parent page controls spacing.
export function AdminBackLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <GuardedLink
      href={href}
      className="flex w-fit items-center gap-1 rounded-sm text-sm font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft className="size-4" aria-hidden /> {label}
    </GuardedLink>
  );
}
```

- [ ] **Step 3: Lint both files**

Run: `npx eslint components/admin/admin-shell.tsx components/admin/admin-back-link.tsx`
Expected: no errors.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add components/admin/admin-shell.tsx components/admin/admin-back-link.tsx
git commit -m "feat(admin): route sidebar and back links through the guard"
```

---

## Task 6: Wire the hook into rewards-manager (already has dirty)

**Files:**
- Modify: `components/admin/rewards-manager.tsx`

**Interfaces:**
- Consumes: `useUnsavedChanges` (Task 2). `rewards-manager` already computes `const dirty = current !== baseline;` (around line 93).

- [ ] **Step 1: Add the import**

Add near the other component imports: `import { useUnsavedChanges } from "@/components/admin/unsaved-changes";`

- [ ] **Step 2: Call the hook**

Immediately after the existing `const dirty = current !== baseline;` line, add:

```tsx
  useUnsavedChanges(dirty);
```

- [ ] **Step 3: Lint**

Run: `npx eslint components/admin/rewards-manager.tsx`
Expected: no errors.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add components/admin/rewards-manager.tsx
git commit -m "feat(admin): guard rewards-manager unsaved changes"
```

---

## Task 7: Add snapshot dirty detection + hook to settings-form

**Files:**
- Modify: `components/admin/settings-form.tsx`

**Interfaces:**
- Consumes: `useUnsavedChanges` (Task 2). This form holds all edits in a single `s` state object (`useState<StoreSettings>(initial)`), so dirty = `JSON.stringify(s) !== JSON.stringify(initial)`.

- [ ] **Step 1: Add the import**

Add: `import { useUnsavedChanges } from "@/components/admin/unsaved-changes";`

- [ ] **Step 2: Compute dirty and call the hook**

Inside `SettingsForm`, after the `const [pending, startTransition] = useTransition();` line, add:

```tsx
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);
  useUnsavedChanges(dirty);
```

- [ ] **Step 3: Lint**

Run: `npx eslint components/admin/settings-form.tsx`
Expected: no errors.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 5: Commit**

```bash
git add components/admin/settings-form.tsx
git commit -m "feat(admin): guard settings-form unsaved changes"
```

---

## Task 8: Add snapshot dirty detection + hook to product-form

**Files:**
- Modify: `components/admin/product-form.tsx`

**Interfaces:**
- Consumes: `useUnsavedChanges` (Task 2), `useGuardedNavigation` (Task 2). This form spreads edits across many `useState` fields and already imports `useRouter`.

- [ ] **Step 1: Read the file to enumerate every edit state field**

Run: read `components/admin/product-form.tsx` fully. Identify every `useState` that represents editable form data (name, slug, description, categoryId, imageUrl, pricingMode, basePrice, variants, maxAddons, isBestSeller, isNew, isAvailable, recipe/addon selections, etc.). Exclude transient UI state (`pending`, `error`).

- [ ] **Step 2: Add the import**

Add: `import { useUnsavedChanges, useGuardedNavigation } from "@/components/admin/unsaved-changes";`

- [ ] **Step 3: Build a baseline snapshot and dirty compare**

Where the initial props are known, build a stable baseline once with `useState(() => serialize(initialValues))` and compare against a `serialize(currentValues)`, mirroring `rewards-manager`'s `strip`/`serialize`/`baseline` approach. Add, after the state declarations:

```tsx
  // Serialize every editable field; compare to the as-loaded snapshot.
  const currentSnapshot = JSON.stringify({
    name, slug, description, categoryId, imageUrl, pricingMode, basePrice,
    variants, maxAddons, isBestSeller, isNew, isAvailable,
    // include recipe/addon-selection state variables here by their actual names
  });
  const [baselineSnapshot] = useState(currentSnapshot);
  useUnsavedChanges(currentSnapshot !== baselineSnapshot);
```

Adjust the object keys to the exact state variable names found in Step 1 (include recipe and addon-selection state).

- [ ] **Step 4: Route the post-save / cancel navigation through the guard**

Replace `const router = useRouter();` usage: keep `useRouter` only if still needed for post-save success navigation. For any user-initiated cancel/back `router.push`, switch to:

```tsx
  const { guardedPush } = useGuardedNavigation();
```

and call `guardedPush(href)` instead of `router.push(href)` for those cancel paths. Leave the post-successful-save navigation as a direct `router.push` (state is no longer dirty after a successful save, but to be safe, saving should reset the baseline or the code already navigates on success — a direct push there is correct because the user chose to save).

- [ ] **Step 5: Lint**

Run: `npx eslint components/admin/product-form.tsx`
Expected: no errors.

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 7: Commit**

```bash
git add components/admin/product-form.tsx
git commit -m "feat(admin): guard product-form unsaved changes"
```

---

## Task 9: Add snapshot dirty detection + hook to cost-manager

**Files:**
- Modify: `components/admin/cost-manager.tsx`

**Interfaces:**
- Consumes: `useUnsavedChanges`, `useGuardedNavigation` (Task 2). This form holds `rows` state (`useState<Row[]>(initial.map(toRow))`) and calls `router.push("/admin/menu")` (line ~248).

- [ ] **Step 1: Read the file** to confirm the editable state (`rows`) and the initial source (`initial`).

- [ ] **Step 2: Add the import**

Add: `import { useUnsavedChanges, useGuardedNavigation } from "@/components/admin/unsaved-changes";`

- [ ] **Step 3: Compute dirty and call the hook**

After the `rows` state declaration, add:

```tsx
  const [baseline] = useState(() => JSON.stringify(initial.map(toRow)));
  useUnsavedChanges(JSON.stringify(rows) !== baseline);
```

- [ ] **Step 4: Route the Cancel push through the guard**

Add near the top of the component: `const { guardedPush } = useGuardedNavigation();`
Change `onClick={() => router.push("/admin/menu")}` to `onClick={() => guardedPush("/admin/menu")}`.
If `router` is now unused, remove the `useRouter` import and its `const router = useRouter();`.

- [ ] **Step 5: Lint**

Run: `npx eslint components/admin/cost-manager.tsx`
Expected: no errors.

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 7: Commit**

```bash
git add components/admin/cost-manager.tsx
git commit -m "feat(admin): guard cost-manager unsaved changes"
```

---

## Task 10: Add snapshot dirty detection + hook to category-manager, addon-manager, promotions-manager

**Files:**
- Modify: `components/admin/category-manager.tsx`
- Modify: `components/admin/addon-manager.tsx`
- Modify: `components/admin/promotions-manager.tsx`

**Interfaces:**
- Consumes: `useUnsavedChanges` (Task 2). Each may have an editor sub-component that holds the editable state (e.g. category editor holds `picked: Set<string>` and `recipe: RecipeEntry[]`; promotions editor holds `productIds`/`categoryIds` Sets). Apply the hook in whichever component owns the editable state.

- [ ] **Step 1: Read all three files** to find the component that owns editable state and its initial source. For `Set` state, serialize as a sorted array: `JSON.stringify([...set].sort())`.

- [ ] **Step 2: category-manager — add import + dirty**

In the component holding `picked`/`recipe` state, add `import { useUnsavedChanges } from "@/components/admin/unsaved-changes";` and after the state declarations:

```tsx
  const dirty =
    JSON.stringify([...picked].sort()) !== JSON.stringify([...category.addonIds].sort()) ||
    JSON.stringify(recipe) !== JSON.stringify(category.recipe);
  useUnsavedChanges(dirty);
```

- [ ] **Step 3: addon-manager — add import + dirty**

Identify the editable state in `addon-manager.tsx` (from Step 1) and compute a snapshot dirty compare against its initial props, calling `useUnsavedChanges(dirty)`. Use the same serialize approach (`JSON.stringify(current) !== baseline`, with `baseline` captured once via `useState(() => ...)`).

- [ ] **Step 4: promotions-manager — add import + dirty**

In the component holding `productIds`/`categoryIds` (and any other fields), add the import and:

```tsx
  const dirty =
    JSON.stringify([...productIds].sort()) !== JSON.stringify([...(promo?.productIds ?? [])].sort()) ||
    JSON.stringify([...categoryIds].sort()) !== JSON.stringify([...(promo?.categoryIds ?? [])].sort());
  useUnsavedChanges(dirty);
```

Extend the compare to include any other editable fields (name, discount, dates) found in Step 1.

- [ ] **Step 5: Lint all three**

Run: `npx eslint components/admin/category-manager.tsx components/admin/addon-manager.tsx components/admin/promotions-manager.tsx`
Expected: no errors.

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 7: Commit**

```bash
git add components/admin/category-manager.tsx components/admin/addon-manager.tsx components/admin/promotions-manager.tsx
git commit -m "feat(admin): guard category, addon, promotions managers"
```

---

## Task 11: Add snapshot dirty detection + hook to payment-settings-form, stamp-settings-form, customer-detail

**Files:**
- Modify: `components/admin/payment-settings-form.tsx`
- Modify: `components/admin/stamp-settings-form.tsx`
- Modify: `components/admin/customer-detail.tsx`

**Interfaces:**
- Consumes: `useUnsavedChanges` (Task 2), and `useGuardedNavigation` for `customer-detail` (which imports `useRouter`).

- [ ] **Step 1: Read all three files** to find editable state and initial props.

- [ ] **Step 2: payment-settings-form — add import + dirty**

Compute `const dirty = JSON.stringify(current) !== JSON.stringify(initial);` over the form's editable state object (matching how it stores state — a single object or grouped fields found in Step 1), then `useUnsavedChanges(dirty)`.

- [ ] **Step 3: stamp-settings-form — add import + dirty**

`stamp-settings-form.tsx` holds `form` state (`useState<StampSettingsInput>({...})`). Add the import and:

```tsx
  const [baseline] = useState(() => JSON.stringify(form));
  useUnsavedChanges(JSON.stringify(form) !== baseline);
```

Place this immediately after the `form` state declaration (baseline captures the initial seed once).

- [ ] **Step 4: customer-detail — add import + dirty + guarded nav**

`customer-detail.tsx` holds `role` state (edited independently and saved). The beans field is transient (an amount to grant, cleared after submit) — treat only `role` as dirty-tracked:

```tsx
  const dirty = role !== summary.role;
  useUnsavedChanges(dirty);
```

If the component uses `router.push` for a user-initiated navigation (not a post-save refresh), route it via `guardedPush`. Leave `router.refresh()` calls as-is.

- [ ] **Step 5: Lint all three**

Run: `npx eslint components/admin/payment-settings-form.tsx components/admin/stamp-settings-form.tsx components/admin/customer-detail.tsx`
Expected: no errors.

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 7: Commit**

```bash
git add components/admin/payment-settings-form.tsx components/admin/stamp-settings-form.tsx components/admin/customer-detail.tsx
git commit -m "feat(admin): guard payment, stamp, customer-detail forms"
```

---

## Task 12: Manual verification pass

**Files:** none (manual QA).

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 2: Run the dev server and walk the checklist**

Run: `npm run dev`, sign in as admin, and verify each:

- [ ] Edit a field in Settings → click "Menu" in the sidebar → dialog "Unsaved changes" appears.
- [ ] Click "Stay" → dialog closes, still on Settings, edit preserved.
- [ ] Click "Menu" again → "Leave without saving" → navigates to Menu, edit discarded.
- [ ] Edit a product → press the browser reload → native browser prompt appears.
- [ ] Edit → Save → then navigate via sidebar → NO dialog (guard disarmed).
- [ ] Settings page (three stacked forms): edit only `settings-form`, leave `payment-settings-form` clean → sidebar nav still prompts.
- [ ] Cost-manager: edit a row → click Cancel/back → dialog appears; Leave discards.
- [ ] `AdminBackLink` on a product edit page → prompts when dirty.
- [ ] Cmd/Ctrl-click a sidebar link while dirty → opens in new tab WITHOUT prompt (onNavigate does not fire for modified clicks) — confirms we did not over-block.
- [ ] Store Ordering form (`store-account-form`): toggling/typing does NOT prompt (intentionally excluded).

- [ ] **Step 3: Commit any fixes** discovered during QA with descriptive messages.

---

## Self-Review

Spec coverage:
- Sidebar navigation guard → Tasks 3, 5. ✓
- Back/cancel links → Task 5 (`AdminBackLink`), Tasks 8/9/11 (`guardedPush`). ✓
- Browser close/reload → Task 2 (`beforeunload`). ✓
- Styled AlertDialog → Tasks 1, 2. ✓
- One dialog at layout level → Task 4. ✓
- Multi-form-per-page (dirty registry as a set) → Task 2 (`dirtyIds` Set). ✓
- Reuse rewards-manager snapshot approach → Task 6, and mirrored in 7–11. ✓
- Leave discards, no autosave → Task 2 (`confirm` clears registry, pushes). ✓
- store-account-form excluded → documented in File Structure + Task 12 check. ✓
- No JS test framework; build+eslint+manual gate → Global Constraints + every task. ✓

Placeholder scan: Tasks 8, 10, 11 include a "read the file to enumerate exact state fields" step because those components spread editable state across many variables whose exact names must be read at implementation time; the serialize pattern and hook call are fully specified, only the field list is component-specific. This is a deliberate instruction, not a TODO.

Type consistency: `useUnsavedChanges(dirty: boolean)`, `useGuardedNavigation(): { guardedPush }`, `useUnsavedChangesGuard(): { anyDirty, requestNavigation }`, and `requestNavigation(href): boolean` are used consistently across Tasks 2, 3, 6–11. ✓
