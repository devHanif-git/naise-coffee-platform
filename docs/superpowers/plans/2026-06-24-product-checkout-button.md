# Product Page Checkout Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Checkout button to the product page's bottom bar and restyle it (ZUS-style) so price + stepper share a top row and Checkout + Add to Cart sit on the row below.

**Architecture:** Single-file change to `components/product-customizer.tsx`. The current `addToCart()` is generalized into a `submit(target)` helper that adds the line then routes to either the menu (Add to Cart) or checkout (Checkout). The fixed bottom bar restructures from one horizontal row into a `flex-col`: a top row (price left, stepper right) and a button row. Edit and reward/sold-out modes keep their existing single-button behavior.

**Tech Stack:** Next.js (App Router) client component, React 19, Tailwind CSS, lucide-react icons.

## Global Constraints

- Match the existing design system exactly — black primary buttons, `rounded-2xl`, `h-12`, `neutral-100` secondary surfaces, existing focus-ring/hover/active patterns (CLAUDE.md UI rules). Do not introduce a new visual look.
- Mobile-first; container stays `fixed ... left-1/2 -translate-x-1/2 w-full max-w-md`.
- TypeScript strict, no `any`.
- Static styles use Tailwind utilities/arbitrary values, never inline `style`.
- No new dependencies; no changes outside `components/product-customizer.tsx`.
- Verification is `npm run lint` + `npx tsc --noEmit` + manual checks (project has no test runner).

---

### Task 1: Restyle bottom bar and add Checkout button

**Files:**
- Modify: `components/product-customizer.tsx` (function `addToCart` ~lines 116-155; bottom-bar JSX ~lines 275-349)

**Interfaces:**
- Consumes (already in file): `routes.checkout`, `routes.menu`, `routes.editReturn` from `useOrderRoutes()`; `addItem`, `updateItem` from `useCart()`; `router` from `useRouter()`; state `quantity/setQuantity`, computed `total`, `totalOriginal`, `onSale`, `isReward`, `isEditing`, `soldOut`, `effectiveQuantity`, `activeRewardCost`, `addonsTotal`; `formatPrice`; `Minus`/`Plus` from lucide-react.
- Produces: a `submit(target: "menu" | "checkout")` helper replacing `addToCart`. `target` only matters in normal mode; edit and reward paths ignore it and keep their existing routing.

- [ ] **Step 1: Generalize `addToCart` into `submit(target)`**

Replace the `addToCart` function (lines 116-155) with:

```tsx
  function submit(target: "menu" | "checkout") {
    if (soldOut) return;
    const selectedAddons = product.addons.filter((a) =>
      addonIds.includes(a.id),
    );
    const input = {
      productId: product.id,
      slug: product.slug,
      name: product.name,
      image: product.image,
      sizeId: selectedSize?.id,
      sizeName: selectedSize?.name,
      addonIds,
      addonNames: selectedAddons.map((a) => a.name),
      unitPrice,
      unitOriginalPrice: drinkOriginal + addonsTotal,
      discountLabel: onSale ? discount?.label : undefined,
      discountPercentOff: onSale ? basePricing.percentOff : undefined,
      isReward: isReward || undefined,
      rewardId: isReward ? activeRewardId : undefined,
      rewardCost: isReward ? activeRewardCost : undefined,
      redeemedBy: isReward ? activeRedeemedBy : undefined,
      quantity: effectiveQuantity,
    };

    if (isEditing && editKey) {
      updateItem(editKey, input);
      // Both surfaces return to the menu, where the floating cart sheet lives
      // (it stays open across the edit). Neither reads ?merged=, so a silent
      // merge just shows the combined line when the sheet reopens.
      router.push(routes.editReturn);
      return;
    }

    addItem(input);
    // A redeemed reward returns to Rewards (where the redemption started).
    // Otherwise route by the button pressed: Checkout goes straight to the
    // checkout screen (settling the whole cart); Add to Cart returns to the
    // menu to keep browsing. Reward mode never engages in the kiosk (empty
    // catalog), so it always lands on Rewards there.
    if (isReward) {
      router.push("/rewards");
      return;
    }
    router.push(target === "checkout" ? routes.checkout : routes.menu);
  }
```

- [ ] **Step 2: Replace the bottom-bar inner JSX**

Replace the inner `<div className="flex items-center gap-3"> ... </div>` block (lines 278-348, i.e. everything inside the fixed container) with the structure below. Keep the outer `<div className="fixed ...">` wrapper (lines 275-277) and the closing `</div>` exactly as they are.

```tsx
        {/* Top row: price (left) + quantity stepper (right). Reward and sold-out
            modes have no editable quantity/price line, so the row is omitted. */}
        {!isReward && !soldOut && (
          <div className="mb-3 flex items-center justify-between">
            {onSale ? (
              <span className="flex items-baseline gap-2">
                <span className="text-lg font-bold tabular-nums text-rose-600">
                  {formatPrice(total)}
                </span>
                <span className="text-sm text-muted-foreground line-through tabular-nums">
                  {formatPrice(totalOriginal)}
                </span>
              </span>
            ) : (
              <span className="text-lg font-bold tabular-nums">
                {formatPrice(total)}
              </span>
            )}

            <div className="flex h-11 items-center gap-1 rounded-full bg-neutral-100 p-1">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                aria-label="Decrease quantity"
                className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white disabled:opacity-40 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Minus className="size-4" strokeWidth={2.5} aria-hidden />
              </button>
              <span
                className="w-6 text-center text-base font-bold tabular-nums"
                aria-live="polite"
              >
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                aria-label="Increase quantity"
                className="flex size-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Plus className="size-4" strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          </div>
        )}

        {/* Button row. Sold-out and reward render a single button; edit renders a
            single full-width Update Cart; normal renders Checkout + Add to Cart. */}
        {soldOut ? (
          <button
            type="button"
            disabled
            className="flex h-12 w-full items-center justify-center rounded-2xl bg-neutral-300 px-4 text-white"
          >
            <span className="text-xs font-bold uppercase tracking-wider">
              Sold Out
            </span>
          </button>
        ) : isReward ? (
          <button
            type="button"
            onClick={() => submit("menu")}
            className="flex h-12 w-full flex-col items-center justify-center rounded-2xl bg-black px-4 text-white transition-transform outline-none hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="text-xs font-bold uppercase tracking-wider">
              Redeem Reward
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-white">
                {addonsTotal > 0 ? formatPrice(total) : "Free Drink"}
              </span>
              <span className="text-xs text-neutral-400">
                · {activeRewardCost.toLocaleString()} Beans
              </span>
            </span>
          </button>
        ) : isEditing ? (
          <button
            type="button"
            onClick={() => submit("menu")}
            className="flex h-12 w-full items-center justify-center rounded-2xl bg-black px-4 text-white transition-transform outline-none hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="text-xs font-bold uppercase tracking-wider">
              Update Cart
            </span>
          </button>
        ) : (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => submit("checkout")}
              className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-neutral-100 px-4 text-foreground transition-colors outline-none hover:bg-neutral-200 active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="text-xs font-bold uppercase tracking-wider">
                Checkout
              </span>
            </button>
            <button
              type="button"
              onClick={() => submit("menu")}
              className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-black px-4 text-white transition-transform outline-none hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="text-xs font-bold uppercase tracking-wider">
                Add to Cart
              </span>
            </button>
          </div>
        )}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (Confirms `submit`'s union arg, removed `addToCart`, and all referenced identifiers resolve.)

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors/warnings for `components/product-customizer.tsx`.

- [ ] **Step 5: Manual verification**

Run `npm run dev`. On a phone-width viewport, walk the spec test plan:
1. Normal drink (`/menu/<slug>`) → top row shows price (left) + stepper (right); Checkout + Add to Cart below.
2. Add to Cart → drink added, lands on `/menu`.
3. Checkout with empty cart → drink added, lands on `/checkout` showing the drink.
4. Checkout with items already in cart → `/checkout` shows all items.
5. Change quantity → top-row price and added quantity both reflect it.
6. On-sale drink → top-row price shows discounted (rose) + struck-through original.
7. Edit a line (open cart → edit) → stepper + single Update Cart; no Checkout; saving returns to menu.
8. Reward redeem (Rewards → redeem) → unchanged: no stepper, single Redeem Reward with Beans line.
9. Sold-out drink → single disabled Sold Out button, no stepper.
10. Kiosk (`/store/<slug>`) → Checkout lands on `/store/checkout`.

- [ ] **Step 6: Commit**

```bash
git add components/product-customizer.tsx
git commit -m "feat(product): add checkout button, restyle bottom bar"
```

---

## Self-Review

**Spec coverage:**
- Normal-mode layout (price+stepper row, Checkout+Add to Cart) → Step 2 ✓
- Checkout behavior (add then `routes.checkout`, whole cart) → Step 1 ✓
- Add to Cart unchanged routing → Step 1 ✓
- Edit mode (stepper + single Update Cart, no Checkout) → Steps 1, 2 ✓
- Reward mode unchanged → Steps 1, 2 ✓
- Sold-out unchanged (single disabled, no stepper) → Step 2 ✓
- Styling reuses existing tokens → Step 2 ✓
- Kiosk routing via `routes.checkout` → Step 1 + Step 5.10 ✓

**Placeholder scan:** none — full code in every code step.

**Type consistency:** `submit(target: "menu" | "checkout")` defined in Step 1; all four call sites in Step 2 pass `"menu"` or `"checkout"`. Removed `addToCart` has no remaining references (only the bottom-bar JSX called it, and that JSX is fully replaced in Step 2).

**Note for implementer:** Step 2 replaces the JSX that referenced `addToCart`, and Step 1 removes `addToCart`. Apply both before typechecking (Step 3) — the file will not typecheck between Step 1 and Step 2 because the old JSX still references `addToCart`. This is expected; the two edits are one logical change.
