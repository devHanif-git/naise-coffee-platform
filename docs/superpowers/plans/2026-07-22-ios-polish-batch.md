# iOS Polish Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land four independent iOS/PWA polish fixes (audit #5, #6, #15, #16) on the customer storefront.

**Architecture:** Four unrelated, self-contained changes. Three are markup/CSS/metadata one-liners; one (#6) extracts a pure cart-line validator into its own framework-free module so it can carry a real self-check. No shared state between tasks — any order works; presented trivial → substantive.

**Tech Stack:** Next.js (App Router), TypeScript, Tailwind CSS, React. No new dependencies. `tsx` (via `npx`) is used transiently for the #6 self-check only.

## Global Constraints

- Verification gate is `npm run build` → EXIT 0. Lint is scoped per-file: `npx eslint <path>`. Whole-repo lint reports pre-existing unrelated errors — do not use it as a gate.
- No JS test framework exists by design; do not add one. The #6 self-check is a throwaway assert script run via `npx tsx`, deleted after it passes.
- Money is stored as integers in sen. `CartItem.unitPrice`/`quantity` are integers; `productId` and `unitOriginalPrice` are **optional** (custom lines omit `productId`; pre-discount carts omit `unitOriginalPrice`).
- Tailwind arbitrary/utility classes only for static values; no inline `style` for static values; no new CSS files (append to `app/globals.css`).
- iOS runtime behavior (status bar, tap-highlight, callout, real 44px comfort) **cannot** be verified without a physical device — state this, do not claim success.
- Commit style follows the repo: `fix(ios):` / `feat(ios):`.

---

### Task 1: #16 — Status bar style to black

**Files:**
- Modify: `app/layout.tsx:31`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (metadata-only).

- [ ] **Step 1: Edit the appleWebApp metadata**

In `app/layout.tsx`, replace line 31:

```ts
  appleWebApp: { capable: true, title: "Naise", statusBarStyle: "default" },
```

with:

```ts
  // ponytail: no apple-touch-startup-image (splash) — needs a per-device PNG
  // matrix generated from a source launch design; add when that art exists.
  appleWebApp: { capable: true, title: "Naise", statusBarStyle: "black" },
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 3: Lint the changed file**

Run: `npx eslint app/layout.tsx`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx
git commit -m "fix(ios): set apple status bar style to black"
```

Note in the commit body or PR: status-bar appearance is not verifiable without an iOS device.

---

### Task 2: #15 — Suppress iOS tap-highlight and long-press callout

**Files:**
- Modify: `app/globals.css` (inside the existing `@layer base` block, ~lines 121-131)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (global CSS).

- [ ] **Step 1: Append the rule to the existing `@layer base` block**

In `app/globals.css`, the current base layer is:

```css
@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
```

Add a fourth rule inside it, after the `html` rule:

```css
@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
  /* iOS: kill the grey tap flash and long-press callout on interactive chrome
     only. Text, paragraphs, images, and inputs keep native selection/callout. */
  button,
  a,
  label,
  [role="tab"],
  [role="button"] {
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
  }
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "fix(ios): suppress tap-highlight and long-press callout on chrome"
```

Note: the tap/callout feel is not verifiable without an iOS device.

---

### Task 3: #5 — Tap targets to 44px (pragmatic)

**Files:**
- Modify: `components/ui/sheet.tsx:75`
- Modify: `components/cart-sheet.tsx:125` (reward-remove), `:135` and `:146` (qty stepper)
- Modify: `components/category-tabs.tsx:44` and `:61`
- Modify: `components/checkout-screen.tsx:300` (back), `:628` (voucher change), `:636` (voucher remove)
- Modify: `components/menu-browser.tsx:228` (sort select)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (class-only markup changes).

**Rule:** standalone controls get a 44px hit box (`size-11`, or `min-h-11 min-w-11` where a fixed `size-*` shouldn't grow the visible box); icon sizes are unchanged. The grouped cart qty stepper stays compact — its buttons grow `size-7` → `size-9` (36px) only.

- [ ] **Step 1: Sheet close button** — `components/ui/sheet.tsx:73-77`

```tsx
            <Button
              variant="ghost"
              className="absolute top-3 right-3"
              size="icon-sm"
            >
```

→ add `min-h-11 min-w-11` to className (keeps the small icon, enlarges the hit box):

```tsx
            <Button
              variant="ghost"
              className="absolute top-3 right-3 min-h-11 min-w-11"
              size="icon-sm"
            >
```

- [ ] **Step 2: Cart reward-remove button** — `components/cart-sheet.tsx:125`

Change `size-8` → `size-11`:

```tsx
          className="flex size-11 shrink-0 items-center justify-center self-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-neutral-100 hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
```

- [ ] **Step 3: Cart qty stepper buttons** — `components/cart-sheet.tsx:135` and `:146`

Both buttons currently use `flex size-7 ...`. Change `size-7` → `size-9` on both (decrement at :135, increment at :146):

```tsx
            className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
```

Leave the icons (`size-3.5`) and the container pill (`p-0.5`) as-is.

- [ ] **Step 4: Category pills** — `components/category-tabs.tsx:44` and `:61`

Add `min-h-11` to both button classNames. Highlight button (line 44) starts `"inline-flex shrink-0 items-center gap-1.5 rounded-full ... px-4 py-1.5 ..."` → insert `min-h-11`:

```tsx
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-transparent bg-gradient-to-r from-amber-400 to-amber-600 px-4 py-1.5 text-xs font-semibold text-white shadow-[0_2px_8px_rgba(245,158,11,0.45)] transition-all outline-none focus-visible:ring-3 focus-visible:ring-amber-300",
```

Normal button (line 61):

```tsx
              "min-h-11 shrink-0 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
```

- [ ] **Step 5: Checkout back button** — `components/checkout-screen.tsx:300`

Change `size-9` → `size-11` (leave the `aria-label` alone — that mismatch is audit #10, out of scope):

```tsx
          className="flex size-11 items-center justify-center justify-self-start rounded-full text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
```

- [ ] **Step 6: Voucher "Change" button** — `components/checkout-screen.tsx:628`

Add `min-h-11`:

```tsx
                    className="min-h-11 rounded-lg px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-wide text-white/80 outline-none transition-colors hover:text-white focus-visible:ring-3 focus-visible:ring-white/40"
```

- [ ] **Step 7: Voucher remove button** — `components/checkout-screen.tsx:636`

Change `size-7` → `size-11`:

```tsx
                    className="flex size-11 items-center justify-center rounded-full text-white/70 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-3 focus-visible:ring-white/40"
```

- [ ] **Step 8: Sort select** — `components/menu-browser.tsx:228`

Add `min-h-11` (the chevron at line 234 is absolutely centered via `top-1/2 -translate-y-1/2`, so it stays put):

```tsx
              className="min-h-11 appearance-none rounded-lg border border-border bg-white py-1.5 pl-3 pr-8 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
```

- [ ] **Step 9: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 10: Lint changed files**

Run: `npx eslint components/ui/sheet.tsx components/cart-sheet.tsx components/category-tabs.tsx components/checkout-screen.tsx components/menu-browser.tsx`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add components/ui/sheet.tsx components/cart-sheet.tsx components/category-tabs.tsx components/checkout-screen.tsx components/menu-browser.tsx
git commit -m "fix(ios): enlarge tap targets toward 44px hit boxes"
```

Note: real one-handed tap comfort is not verifiable without an iOS device.

---

### Task 4: #6 — Validate cart lines after JSON.parse

**Files:**
- Create: `store/cart-validate.ts`
- Modify: `store/cart.tsx` (add import; rewrite the hydrate branch at ~line 123-125)
- Temp: `check-cart-validate.mts` (repo root; created, run, deleted)

**Interfaces:**
- Consumes: `CartItem` type from `types/cart.ts` (type-only, erased at runtime).
- Produces: `export function isValidCartItem(x: unknown): x is CartItem` — a pure type guard with no runtime imports. Consumed by `store/cart.tsx` and the self-check.

- [ ] **Step 1: Create the pure validator**

Create `store/cart-validate.ts`:

```ts
import type { CartItem } from "@/types/cart";

// Guards a persisted cart line before it re-enters state on hydrate. A stale
// schema or corrupt entry would otherwise survive the length check and produce
// NaN totals. Validates only the always-required fields: productId and
// unitOriginalPrice are optional by design (custom lines / pre-discount carts).
export function isValidCartItem(x: unknown): x is CartItem {
  if (!x || typeof x !== "object") return false;
  const i = x as Record<string, unknown>;
  return (
    typeof i.key === "string" &&
    typeof i.name === "string" &&
    Number.isInteger(i.unitPrice) &&
    (i.unitPrice as number) >= 0 &&
    Number.isInteger(i.quantity) &&
    (i.quantity as number) > 0 &&
    Array.isArray(i.addonIds) &&
    Array.isArray(i.addonNames)
  );
}
```

- [ ] **Step 2: Write the failing self-check**

Create `check-cart-validate.mts` at the repo root:

```ts
// Temporary self-check for isValidCartItem. Delete after it passes.
import assert from "node:assert/strict";
import { isValidCartItem } from "./store/cart-validate";

const valid = {
  key: "p1|s1|", name: "Latte", addonIds: [], addonNames: [],
  unitPrice: 1200, unitOriginalPrice: 1200, quantity: 2,
};
const validCustom = {
  key: "custom:Test:500|", name: "Off-menu", addonIds: [], addonNames: [],
  unitPrice: 500, quantity: 1, isCustom: true,
}; // no productId
const preDiscount = {
  key: "p2|s2|", name: "Mocha", addonIds: [], addonNames: [],
  unitPrice: 1500, quantity: 1,
}; // no unitOriginalPrice

assert.equal(isValidCartItem(valid), true, "valid line");
assert.equal(isValidCartItem(validCustom), true, "valid custom line");
assert.equal(isValidCartItem(preDiscount), true, "pre-discount line");

assert.equal(isValidCartItem({ ...valid, key: undefined }), false, "missing key");
assert.equal(isValidCartItem({ ...valid, quantity: 0 }), false, "zero quantity");
assert.equal(isValidCartItem({ ...valid, unitPrice: 12.5 }), false, "non-integer price");
assert.equal(isValidCartItem(null), false, "null");
assert.equal(isValidCartItem("nope"), false, "non-object");

console.log("cart-validate self-check passed");
```

- [ ] **Step 3: Run the self-check — expect PASS**

Run: `npx tsx check-cart-validate.mts`
Expected: prints `cart-validate self-check passed` and EXIT 0. (`npx` fetches `tsx` on first use if absent. The `import type` in `cart-validate.ts` is erased, so no path-alias resolution happens at runtime.)

If it fails, fix `store/cart-validate.ts` until it passes.

- [ ] **Step 4: Wire the validator into cart hydrate**

In `store/cart.tsx`, add the import near the other `@/store` / `@/types` imports (after line 12's `import type { CartItem } ...`):

```ts
import { isValidCartItem } from "@/store/cart-validate";
```

Then replace the hydrate branch (current lines 123-125):

```ts
      const raw = localStorage.getItem(storageKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage
      if (raw) setItems(JSON.parse(raw) as CartItem[]);
```

with:

```ts
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        const restored = Array.isArray(parsed) ? parsed.filter(isValidCartItem) : [];
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from localStorage
        setItems(restored);
      }
```

Leave the `import type { CartItem }` on line 12 — it is still used by `useState<CartItem[]>`.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 6: Lint changed files**

Run: `npx eslint store/cart.tsx store/cart-validate.ts`
Expected: no errors.

- [ ] **Step 7: Delete the temp self-check and confirm it's gone**

```bash
rm check-cart-validate.mts
git status --short
```

Expected: `check-cart-validate.mts` does not appear (it was never staged; confirm it's not left untracked).

- [ ] **Step 8: Commit**

```bash
git add store/cart.tsx store/cart-validate.ts
git commit -m "fix(ios): validate persisted cart lines on hydrate"
```

---

## Self-Review

**Spec coverage:**
- #16 status bar → Task 1. Splash skip recorded as a `ponytail:` note. ✓
- #15 tap-highlight/callout → Task 2. ✓
- #5 tap targets (all seven standalone spots + qty stepper) → Task 3, steps 1-8. ✓
- #6 cart validation (extract + wire + self-check) → Task 4. ✓
- Out-of-scope items untouched; #10 aria-label mismatch explicitly left alone in Task 3 step 5. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows full code. ✓

**Type consistency:** `isValidCartItem` signature identical in Task 4 step 1, the self-check (step 2), and the import site (step 4). `CartItem` optional-field assumptions match `types/cart.ts`. ✓

---

## Notes on ordering & isolation

Tasks are fully independent; execute in any order. Each ends on its own commit and its own `npm run build` EXIT 0, so a reviewer can accept or reject one without touching the others. No worktree needed — all work targets `development`.
