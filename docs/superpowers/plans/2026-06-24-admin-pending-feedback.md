# Admin Pending-State Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every mutating control in the `/admin` (and shared `/manage`) module immediate in-flight feedback (disabled + spinner) and a clear result, matching the standard already set by `customer-detail.tsx` / `product-form.tsx` / `order-detail.tsx`.

**Architecture:** A pure client-feedback layer. Add one shared `PendingButton` primitive over the existing `Button`, then stop discarding the `useTransition` pending flag in each laggard manager and route it into buttons. Toggle/Switch surfaces gain a per-control in-flight lock so they can't be raced. No server-action, RLS, or schema changes.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind, shadcn/ui, `lucide-react` (`Loader2` spinner — already used in `order-detail.tsx`).

## Global Constraints

- **No new dependencies.** Inline feedback only — no toast/sonner. (AGENTS.md: ask before adding libraries.)
- **TypeScript strict, no `any`.** (AGENTS.md)
- **Tailwind utilities only**; reuse `cn()` from `@/lib/utils`; static values as Tailwind arbitrary values, never inline `style`. (AGENTS.md)
- **No changes** to server actions, `lib/`, RLS, or the database.
- **Do not touch** components that already surface pending: `customer-detail.tsx`, `product-form.tsx`, `order-detail.tsx`, `manage-orders-live.tsx`, `manage-orders-screen.tsx`, `settings-form.tsx`, `payment-settings-form.tsx`, `loyalty-settings-form.tsx`, `store-account-form.tsx`, `image-upload.tsx`, `reports-view.tsx`.
- **Per-row scope:** each row component owns its own `useTransition` instance, so a pending flag must stay scoped to its row — never hoist a single flag across a list.
- **Verification per task:** `npx tsc --noEmit` passes, `npm run lint` passes, plus the manual click-path named in the task. There is no automated UI test harness; do not invent one.
- **Commit after each task.** Branch is `development`; commit there. End commit messages with the `Co-Authored-By` trailer.

---

### Task 1: Shared `PendingButton` primitive

**Files:**
- Create: `components/ui/pending-button.tsx`

**Interfaces:**
- Consumes: `Button` from `@/components/ui/button` (its props are `React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }`).
- Produces: `PendingButton` — `function PendingButton(props: React.ComponentProps<typeof Button> & { pending?: boolean }): JSX.Element`. When `pending` is true it renders a leading `<Loader2 className="size-4 animate-spin" aria-hidden />` before `children` and sets `disabled={pending || disabled}`. Do NOT pass `asChild` through with a spinner (Slot requires a single child); `PendingButton` is for plain text/icon buttons only.

- [ ] **Step 1: Create the component**

```tsx
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

// Button + an in-flight spinner. Disables while `pending` so the action can't
// be re-fired or raced, and shows the same Loader2 used elsewhere in the app
// (e.g. order-detail). For plain text/icon buttons — not for asChild/Slot.
export function PendingButton({
  pending = false,
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

- [ ] **Step 2: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ui/pending-button.tsx
git commit -m "feat(admin): add PendingButton primitive for in-flight feedback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Add-ons manager feedback

**Files:**
- Modify: `components/admin/addon-manager.tsx`

**Interfaces:**
- Consumes: `PendingButton` from `@/components/ui/pending-button` (Task 1).

Two scopes: the parent `AddonManager` (New add-on) and each `AddonRow` (Save + Archive/Restore share one row transition).

- [ ] **Step 1: Parent — capture pending, swap the Add button**

In `AddonManager`, change `const [, startTransition] = useTransition();` to `const [pending, startTransition] = useTransition();`. Import `PendingButton`. Replace the New add-on `<Button onClick={add} ...>Add add-on</Button>` with:

```tsx
<PendingButton
  pending={pending}
  onClick={add}
  className="w-full rounded-full sm:w-auto"
>
  {pending ? "Adding…" : "Add add-on"}
</PendingButton>
```

- [ ] **Step 2: Row — capture pending, swap Save and Archive/Restore**

In `AddonRow`, change to `const [pending, startTransition] = useTransition();`. Replace the row's two `<Button>`s with `PendingButton`s that share the row `pending` (so both lock while either runs):

```tsx
<PendingButton
  pending={pending}
  size="sm"
  className="rounded-full"
  onClick={() => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await saveAddon({ id: addon.id, name, price: toSen(price) });
        if (!res.ok) return setError(res.error);
        onChanged();
      } catch {
        setError("Couldn't save. Please try again.");
      }
    });
  }}
>
  {pending ? "Saving…" : "Save"}
</PendingButton>
<PendingButton
  pending={pending}
  variant="ghost"
  size="sm"
  className="rounded-full"
  onClick={() => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await setAddonArchived(addon.id, !addon.isArchived);
        if (!res.ok) return setError(res.error);
        onChanged();
      } catch {
        setError("Couldn't update. Please try again.");
      }
    });
  }}
>
  {addon.isArchived ? "Restore" : "Archive"}
</PendingButton>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Manual: `npm run dev`, go to `/admin/addons`. Add an add-on (button shows "Adding…" + spinner, disables). Edit a row, Save (shows "Saving…"); Archive/Restore. Confirm both row buttons disable while one runs and re-enable after.

- [ ] **Step 4: Commit**

```bash
git add components/admin/addon-manager.tsx
git commit -m "feat(admin): pending feedback on add-on manager actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Tiers manager feedback

**Files:**
- Modify: `components/admin/tiers-manager.tsx`

**Interfaces:**
- Consumes: `PendingButton` (Task 1).

- [ ] **Step 1: Parent — Add tier**

In `TiersManager`, change `const [, startTransition] = useTransition();` to `const [pending, startTransition] = useTransition();`. Import `PendingButton`. Replace the `<Button onClick={add} ...>Add tier</Button>`:

```tsx
<PendingButton pending={pending} onClick={add} className="self-start rounded-full">
  {pending ? "Adding…" : "Add tier"}
</PendingButton>
```

- [ ] **Step 2: Row — Archive/Restore and Save**

In `TierRow`, change to `const [pending, startTransition] = useTransition();`. Replace the two row `<Button>`s:

```tsx
<PendingButton
  pending={pending}
  variant="outline"
  size="sm"
  className="rounded-full"
  onClick={() => startTransition(async () => { await setTierArchived(tier.id, !tier.isArchived); onChanged(); })}
>
  {tier.isArchived ? "Restore" : "Archive"}
</PendingButton>
<PendingButton
  pending={pending}
  size="sm"
  className="flex-1 rounded-full"
  onClick={() => startTransition(async () => { await saveTier({ id: tier.id, name, threshold: Number(threshold || "0"), perk }); onChanged(); })}
>
  {pending ? "Saving…" : "Save"}
</PendingButton>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Manual: `/admin/rewards` → Tiers section. Add a tier ("Adding…"), Save a row ("Saving…"), Archive/Restore — buttons lock during the call.

- [ ] **Step 4: Commit**

```bash
git add components/admin/tiers-manager.tsx
git commit -m "feat(admin): pending feedback on tiers manager actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Streak milestones manager feedback

**Files:**
- Modify: `components/admin/streak-milestones-manager.tsx`

**Interfaces:**
- Consumes: `PendingButton` (Task 1).

The Delete control is an icon button — show the spinner in place of the trash icon while deleting; keep its `aria-label`. The active Switch disables while the row transition runs.

- [ ] **Step 1: Parent — Add milestone**

In `StreakMilestonesManager`, change `const [, startTransition] = useTransition();` to `const [pending, startTransition] = useTransition();`. Import `PendingButton`. Replace the `<Button onClick={add} ...>Add milestone</Button>`:

```tsx
<PendingButton pending={pending} onClick={add} className="self-start rounded-full">
  {pending ? "Adding…" : "Add milestone"}
</PendingButton>
```

- [ ] **Step 2: Row — Save, Delete, and lock the Switch**

In `MilestoneRow`, change to `const [pending, startTransition] = useTransition();`, and import `Loader2` from `lucide-react` (alongside the existing `Trash2`). Disable the active Switch while pending, render the Delete as a `PendingButton` with a manual spinner swap, and the Save as a `PendingButton`:

```tsx
<label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
  Active
  <Switch
    checked={milestone.isActive}
    disabled={pending}
    onCheckedChange={(v) => startTransition(async () => { await setMilestoneActive(milestone.id, v); onChanged(); })}
  />
</label>
<PendingButton
  pending={false}
  disabled={pending}
  variant="destructive"
  size="icon-sm"
  className="rounded-full"
  onClick={() => startTransition(async () => { await deleteMilestone(milestone.id); onChanged(); })}
  aria-label="Delete milestone"
>
  {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Trash2 className="size-4" />}
</PendingButton>
<PendingButton
  pending={pending}
  size="sm"
  className="ml-auto rounded-full"
  onClick={() => startTransition(async () => {
    await saveMilestone({ id: milestone.id, label, displayLabel, beans: Number(beans || "0"), triggerDay: Number(triggerDay || "0"), repeatEveryDays: repeat.trim() === "" ? null : Number(repeat) });
    onChanged();
  })}
>
  {pending ? "Saving…" : "Save"}
</PendingButton>
```

Note: the Delete button passes `pending={false}` (so `PendingButton` doesn't auto-prepend a second spinner) and uses `disabled={pending}` plus a manual icon/spinner swap, because its child is an icon, not text.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Manual: `/admin/rewards` → Streak milestones. Add ("Adding…"), Save a row ("Saving…"), toggle Active (Switch disables briefly), Delete (trash icon becomes a spinner). All row controls lock together while one runs.

- [ ] **Step 4: Commit**

```bash
git add components/admin/streak-milestones-manager.tsx
git commit -m "feat(admin): pending feedback on streak milestones manager

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Reward catalog manager feedback

**Files:**
- Modify: `components/admin/reward-catalog-manager.tsx`

**Interfaces:**
- Consumes: `PendingButton` (Task 1).

Two scopes: `RewardEditor` (Save/Add) and `RewardRow` (active Switch + Archive/Restore). The `RewardCatalogManager` parent's transition is only used for `reload()` and drives no visible control — leave it.

- [ ] **Step 1: RewardEditor — Save/Add**

In `RewardEditor`, change `const [, startTransition] = useTransition();` to `const [pending, startTransition] = useTransition();`. Import `PendingButton`. Replace `<Button onClick={save} ...>{reward ? "Save" : "Add reward"}</Button>`:

```tsx
<PendingButton pending={pending} onClick={save} className="self-start rounded-full">
  {pending ? "Saving…" : reward ? "Save" : "Add reward"}
</PendingButton>
```

- [ ] **Step 2: RewardRow — lock the Switch and Archive/Restore**

In `RewardRow`, change to `const [pending, startTransition] = useTransition();`. Add `disabled={pending}` to the active `<Switch>`. Replace the Archive/Restore `<Button>` (inside the `open` block) with a `PendingButton`:

```tsx
<Switch
  checked={reward.isActive}
  disabled={pending}
  aria-label={`${reward.name} active`}
  onCheckedChange={(v) => startTransition(async () => { await setRewardActive(reward.id, v); onChanged(); })}
/>
```

```tsx
<PendingButton
  pending={pending}
  variant="outline"
  size="sm"
  className="self-start rounded-full"
  onClick={() => startTransition(async () => { await setRewardArchived(reward.id, !reward.isArchived); onChanged(); })}
>
  {reward.isArchived ? "Restore" : "Archive"}
</PendingButton>
```

Note: the `Edit`/`Close` toggle button is local UI state (not a server action) — leave it a plain `Button`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Manual: `/admin/rewards` → Reward catalog. Add a reward ("Saving…"), toggle a row's active Switch (disables briefly), open a row and Archive/Restore. Save inside an open row also shows "Saving…".

- [ ] **Step 4: Commit**

```bash
git add components/admin/reward-catalog-manager.tsx
git commit -m "feat(admin): pending feedback on reward catalog manager

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Promotions manager feedback

**Files:**
- Modify: `components/admin/promotions-manager.tsx`

**Interfaces:**
- Consumes: `PendingButton` (Task 1).

`PromotionEditor`'s Save already shows "Saving…" via its own `pending` — leave it. Changes are in `PromotionRow`: the active Switch and the Delete button.

- [ ] **Step 1: PromotionRow — capture pending, lock Switch, swap Delete**

In `PromotionRow`, change `const [, startTransition] = useTransition();` to `const [pending, startTransition] = useTransition();`. Import `PendingButton`. Add `disabled={pending}` to the active `<Switch>`. Replace the Delete `<Button variant="destructive" ...>`:

```tsx
<Switch
  checked={promo.isActive}
  disabled={pending}
  aria-label={`${promo.label} active`}
  onCheckedChange={(v) => startTransition(async () => { await setPromotionActive(promo.id, v); onChanged(); })}
/>
```

```tsx
<PendingButton
  pending={pending}
  variant="destructive"
  size="sm"
  onClick={() => startTransition(async () => { await deletePromotion(promo.id); onChanged(); })}
  className="self-start rounded-full"
>
  {pending ? "Deleting…" : <><Trash2 className="size-3.5" /> Delete promotion</>}
</PendingButton>
```

Note: the `Edit`/`Close` toggle is local UI state — leave it a plain `Button`. The parent `PromotionsManager` `reload()` transition drives no visible control — leave it.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Manual: `/admin/promotions`. Toggle a promotion's active Switch (disables briefly). Open a row, Delete promotion (shows "Deleting…"). Create/Save a promotion still shows "Saving…" (unchanged).

- [ ] **Step 3: Commit**

```bash
git add components/admin/promotions-manager.tsx
git commit -m "feat(admin): pending feedback on promotions manager row actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Categories manager feedback (incl. reorder arrows)

**Files:**
- Modify: `components/admin/category-manager.tsx`

**Interfaces:**
- Consumes: `PendingButton` (Task 1).

Two scopes: parent `CategoryManager` (Add category + reorder arrows) and `CategoryRow` (Save + Archive/Restore). The reorder arrows live in `CategoryRow` but call the parent's `move()` (parent transition), so the parent must expose a `reordering` flag to the rows.

- [ ] **Step 1: Parent — capture pending; thread a `reordering` flag to rows**

In `CategoryManager`, change `const [, startTransition] = useTransition();` to `const [pending, startTransition] = useTransition();`. Import `PendingButton`. Replace the Add category `<Button onClick={add} ...>Add category</Button>`:

```tsx
<PendingButton pending={pending} onClick={add} className="rounded-full">
  {pending ? "Adding…" : "Add category"}
</PendingButton>
```

Pass `reordering={pending}` to each `<CategoryRow ... />` in the list.

- [ ] **Step 2: Row — accept `reordering`, lock arrows, swap Save/Archive**

In `CategoryRow`, add `reordering` to the props type and destructure it:

```tsx
function CategoryRow({
  index, category, addons, onUp, onDown, isFirst, isLast, onChanged, reordering,
}: {
  index: number;
  category: AdminCategory;
  addons: AdminAddon[];
  onUp: () => void;
  onDown: () => void;
  isFirst: boolean;
  isLast: boolean;
  onChanged: () => void;
  reordering: boolean;
}) {
```

Change the row transition to `const [pending, startTransition] = useTransition();`. On the two arrow `<Button>`s, add `reordering` to the disabled condition:

```tsx
<Button variant="ghost" size="icon-sm" onClick={onUp} disabled={isFirst || reordering} aria-label="Move up">
  <ChevronUp className="size-4 text-muted-foreground" />
</Button>
<Button variant="ghost" size="icon-sm" onClick={onDown} disabled={isLast || reordering} aria-label="Move down">
  <ChevronDown className="size-4 text-muted-foreground" />
</Button>
```

Replace the Archive/Restore and Save `<Button>`s in the `open` block with `PendingButton`s sharing the row `pending`:

```tsx
<PendingButton
  pending={pending}
  variant="outline"
  className="rounded-full"
  onClick={() => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await setCategoryArchived(category.id, !category.isArchived);
        if (!res.ok) return setError(res.error);
        onChanged();
      } catch {
        setError("Couldn't update. Please try again.");
      }
    });
  }}
>
  {category.isArchived ? "Restore" : "Archive"}
</PendingButton>
<PendingButton pending={pending} onClick={save} className="flex-1 rounded-full">
  {pending ? "Saving…" : "Save"}
</PendingButton>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Manual: `/admin/categories`. Add a category ("Adding…"). Reorder a row with ▲▼ — both arrows on all rows disable while the reorder persists. Open a row, Save ("Saving…"), Archive/Restore.

- [ ] **Step 4: Commit**

```bash
git add components/admin/category-manager.tsx
git commit -m "feat(admin): pending feedback on category manager incl. reorder lock

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Menu list — per-control in-flight lock

**Files:**
- Modify: `components/admin/menu-list-live.tsx`

**Interfaces:**
- Consumes: nothing new (uses local state only). No `PendingButton` here — these controls are a Switch, chips, and a link, not buttons.

Track a `Set<string>` of in-flight keys `` `${productId}:${field}` `` where field ∈ `availability | best_seller | new | archive`. Add the key on action start; remove it in a `finally`. Disable the matching control while its key is present. The existing optimistic update + revert-on-failure is unchanged.

- [ ] **Step 1: Add the in-flight Set and a helper**

In `MenuListLive`, below the existing `useState`s, add:

```tsx
const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
const isBusy = (id: string, field: string) => busyKeys.has(`${id}:${field}`);
function withBusy(key: string, run: () => Promise<void>) {
  setBusyKeys((prev) => new Set(prev).add(key));
  startTransition(async () => {
    try {
      await run();
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  });
}
```

- [ ] **Step 2: Route the three handlers through `withBusy`**

Rewrite the bodies of `onAvailability`, `onFlag`, and `onArchiveToggle` to wrap their existing optimistic-update-and-persist logic in `withBusy` with the right key. Keep the optimistic `patch` + revert logic exactly as-is; only the transition wrapper changes:

```tsx
function onAvailability(p: AdminProduct, value: boolean) {
  patch(p.id, { isAvailable: value });
  withBusy(`${p.id}:availability`, async () => {
    try {
      const res = await setAvailability(p.id, value);
      if (!res.ok) patch(p.id, { isAvailable: !value });
    } catch {
      patch(p.id, { isAvailable: !value });
    }
  });
}

function onFlag(p: AdminProduct, flag: "best_seller" | "new" | "featured", value: boolean) {
  const key = flag === "best_seller" ? "isBestSeller" : flag === "new" ? "isNew" : "isFeatured";
  patch(p.id, { [key]: value } as Partial<AdminProduct>);
  withBusy(`${p.id}:${flag}`, async () => {
    try {
      const res = await setFlag(p.id, flag, value);
      if (!res.ok) patch(p.id, { [key]: !value } as Partial<AdminProduct>);
    } catch {
      patch(p.id, { [key]: !value } as Partial<AdminProduct>);
    }
  });
}

function onArchiveToggle(p: AdminProduct) {
  const value = !p.isArchived;
  patch(p.id, { isArchived: value });
  withBusy(`${p.id}:archive`, async () => {
    try {
      const res = await setArchived(p.id, value);
      if (!res.ok) patch(p.id, { isArchived: !value });
    } catch {
      patch(p.id, { isArchived: !value });
    }
  });
}
```

- [ ] **Step 3: Disable each control while its key is busy**

Availability Switch — add `disabled`:

```tsx
<Switch
  checked={p.isAvailable}
  disabled={isBusy(p.id, "availability")}
  onCheckedChange={(v) => onAvailability(p, v)}
  aria-label={`${p.name} available`}
/>
```

Best Seller / New chips — pass a `disabled` flag to `FlagChip`:

```tsx
<FlagChip
  label="Best Seller"
  active={p.isBestSeller}
  disabled={isBusy(p.id, "best_seller")}
  onClick={() => onFlag(p, "best_seller", !p.isBestSeller)}
/>
<FlagChip
  label="New"
  active={p.isNew}
  disabled={isBusy(p.id, "new")}
  onClick={() => onFlag(p, "new", !p.isNew)}
/>
```

Archive/Restore link — disable + dim while busy:

```tsx
<button
  onClick={() => onArchiveToggle(p)}
  disabled={isBusy(p.id, "archive")}
  className="ml-auto rounded-sm text-xs font-semibold text-muted-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 disabled:no-underline"
>
  {p.isArchived ? "Restore" : "Archive"}
</button>
```

- [ ] **Step 4: Extend `FlagChip` with a `disabled` prop**

Update the `FlagChip` signature and markup:

```tsx
function FlagChip({
  label,
  active,
  onClick,
  disabled = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

Manual: `/admin/menu`. Toggle availability on an item — the Switch disables until the call settles, then re-enables; the optimistic state holds (or reverts on a forced failure). Toggle Best Seller / New chips and Archive/Restore — each control locks independently (toggling availability does NOT lock the chip, and vice versa). Two different items remain independently operable.

- [ ] **Step 6: Commit**

```bash
git add components/admin/menu-list-live.tsx
git commit -m "feat(admin): per-control in-flight lock on menu list toggles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Full-module verification pass

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + lint the whole module**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 2: Production build sanity**

Run: `npm run build`
Expected: build succeeds (no type or RSC boundary errors introduced).

- [ ] **Step 3: Manual click-path across every touched surface**

With `npm run dev`, walk each surface and confirm controls disable + spin during the action and re-enable on completion/error:

1. `/admin/menu` — availability Switch, Best Seller, New, Archive (independent per control).
2. `/admin/categories` — Add, row Save, Archive/Restore, reorder ▲▼ (arrows lock during reorder).
3. `/admin/addons` — Add, row Save, Archive/Restore.
4. `/admin/rewards` — reward Add/Save, active Switch, Archive; Tiers Add/Save/Archive; Milestones Add/Save/Delete (trash → spinner)/active Switch.
5. `/admin/promotions` — active Switch, Delete; create/Save still shows "Saving…".
6. Regression spot-check (untouched): `/admin/customers/[id]` (role Save, Adjust Beans), `/admin/menu/new` (product form Save) — confirm unchanged behavior.

- [ ] **Step 4: Final commit if any fixups were needed**

If the verification pass surfaced fixes, commit them:

```bash
git add -A
git commit -m "fix(admin): pending-feedback verification fixups

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

If nothing needed fixing, skip this step.

---

## Self-Review

**Spec coverage** — every spec item maps to a task:
- Shared `PendingButton` primitive → Task 1.
- Button-driven managers: addon → T2, tiers → T3, milestones → T4, rewards → T5, promotions → T6, category (incl. reorder arrows) → T7.
- Toggle/Switch in-flight lock: menu-list (Set-based) → T8; per-row Switch locks folded into T4 (milestones), T5 (rewards), T6 (promotions).
- Untouched list, no-new-deps, Tailwind-only, strict TS → Global Constraints, enforced per task.
- Testing checklist → per-task manual steps + Task 9 full pass.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the one "shape only" block (Task 1 Step 1) is immediately followed by the real, complete component (it IS the real code). No "similar to Task N" references — each task repeats its code.

**Type consistency:** `PendingButton` signature (`React.ComponentProps<typeof Button> & { pending?: boolean }`) is used consistently in Tasks 2–7. `withBusy`/`isBusy`/`busyKeys` naming is consistent within Task 8. `FlagChip`'s new `disabled?: boolean` prop (Task 8 Step 4) matches its usage (Task 8 Step 3). `CategoryRow`'s new `reordering: boolean` prop (Task 7) matches the parent passing `reordering={pending}`.

**Note on the icon-only Delete (Task 4):** passes `pending={false}` + `disabled={pending}` and swaps the icon manually, because `PendingButton` auto-prepends a spinner only when `pending` is true and that would double-render alongside the manual swap. This is intentional and documented in-task.
