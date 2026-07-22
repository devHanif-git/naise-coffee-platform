# iOS Polish Batch — Audit Items #5, #6, #15, #16

**Date:** 2026-07-22
**Scope:** Customer storefront. Four small, independent iOS/PWA polish fixes from `docs/ios-mobile-ux-audit.md`.
**Status:** Design approved, ready for implementation plan.

> KEYSTONE (`viewportFit: "cover"`) already shipped, so `env(safe-area-inset-*)` resolves. This batch does **not** depend on further safe-area work.

---

## #16 — Status bar style (skip splash)

**File:** `app/layout.tsx:31`

Change `statusBarStyle: "default"` → `"black"`.

- `"black"` = solid black bar, white text. Matches the `#171717` theme color, needs no layout change.
- `"black-translucent"` was rejected: the customer layout pads only the bottom safe area (`app/(customer)/layout.tsx:34`) and storefront pages are light at the top, so translucent white text would sit over white content. Not worth the per-page top-padding surgery.

**Splash images:** skipped by decision. iOS requires ~15-20 exact per-device `apple-touch-startup-image` PNGs; no source launch design exists yet. Leave a `ponytail:` comment marking the upgrade path.

---

## #15 — Suppress iOS tap-highlight + long-press callout

**File:** `app/globals.css` (new rule in `@layer base`)

```css
@layer base {
  button, a, label, [role="tab"], [role="button"] {
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
  }
}
```

Scoped to interactive chrome only. Text, paragraphs, images, and inputs keep native selection and callout untouched — no accessibility regression.

---

## #5 — Tap targets (pragmatic 44px)

**Rule:** standalone controls get a true 44px hit box (`min-h-11 min-w-11`, icon size unchanged). The grouped cart quantity stepper stays a compact pill, but its buttons grow 28px → 36px (`size-7` → `size-9`) so the cluster is comfortable without becoming ~100px wide.

**Standalone → 44px hit box (icon unchanged):**

| Control | File / line | Current | Change |
|---|---|---|---|
| Sheet close | `components/ui/sheet.tsx:75` | `size="icon-sm"` | add `min-h-11 min-w-11` (keep icon) |
| Reward-remove | `components/cart-sheet.tsx:125` | `size-8` | `min-h-11 min-w-11` |
| Category pills | `components/category-tabs.tsx:44,61` | `py-1.5` | add `min-h-11` |
| Checkout back | `components/checkout-screen.tsx:300` | `size-9` | `min-h-11 min-w-11` |
| Voucher "Change" | `components/checkout-screen.tsx:628` | `px-2 py-1` | `min-h-11` |
| Voucher remove | `components/checkout-screen.tsx:636` | `size-7` | `min-h-11 min-w-11` |
| Sort select | `components/menu-browser.tsx:228` | `py-1.5` | bump padding to reach `min-h-11` |

**Compact-but-bigger (grouped qty stepper):**

| Control | File / line | Current | Change |
|---|---|---|---|
| Qty − | `components/cart-sheet.tsx:135` | `size-7` | `size-9` |
| Qty + | `components/cart-sheet.tsx:146` | `size-7` | `size-9` |

**Expected tradeoff:** 44px-tall category pills make the scroll strip slightly taller. Accepted as part of the pragmatic rule.

---

## #6 — Validate cart after `JSON.parse`

**File:** `store/cart.tsx:125`

The audit's sketch validator (`x.id`, `x.price`) does not match this codebase. `CartItem` (`types/cart.ts`) has no `id`/`price`; it uses `key`, `name`, `unitPrice`, `quantity`, and `productId` is **optional** (custom off-menu lines omit it). Validate the real required shape.

**Validator (module-scope helper in `store/cart.tsx`):**

```ts
function isValidCartItem(x: unknown): x is CartItem {
  if (!x || typeof x !== "object") return false;
  const i = x as Record<string, unknown>;
  return (
    typeof i.key === "string" &&
    typeof i.name === "string" &&
    Number.isInteger(i.unitPrice) && (i.unitPrice as number) >= 0 &&
    Number.isInteger(i.quantity) && (i.quantity as number) > 0 &&
    Array.isArray(i.addonIds) &&
    Array.isArray(i.addonNames)
  );
}
```

`unitOriginalPrice` stays optional — carts persisted before discounts shipped omit it, and the total memo (`cart.tsx:281`) already falls back to `unitPrice`.

**Hydrate change (line 125):**

```ts
// BEFORE
if (raw) setItems(JSON.parse(raw) as CartItem[]);

// AFTER
if (raw) {
  const parsed = JSON.parse(raw);
  setItems(Array.isArray(parsed) ? parsed.filter(isValidCartItem) : []);
}
```

Invalid/stale lines are dropped on hydrate; a corrupt entry can no longer produce `NaN` totals. Server-side repricing already protects the money path — this keeps the UI cart honest.

---

## Verification

- `npm run build` → EXIT 0 (type/integration gate).
- `npx eslint` on the four changed files.
- **#6 self-check:** one runnable assert-based script (no framework) proving `isValidCartItem` accepts a valid line, a valid custom line (no `productId`), and a pre-discount line (no `unitOriginalPrice`); and rejects a missing `key`, a `quantity: 0`, a non-integer `unitPrice`, and a non-object. Delete after it passes.
- **Cannot verify without an iOS device:** actual status-bar rendering, tap-highlight/callout suppression feel, real 44px tap comfort. State this explicitly rather than claiming success.

## Out of scope

Other audit items (body scroll-lock hook, modal consolidation, `vh`→`dvh`, `overscroll-contain`, CHIP return, focus trap, pollers, admin recipe drag, font self-host) — separate batches.
