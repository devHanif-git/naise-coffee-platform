# Product Page Checkout Button — Design

**Date:** 2026-06-24
**Status:** Approved (pending spec review)
**Scope:** `components/product-customizer.tsx` only.

## Problem

On a product page (`/menu/[slug]` and `/store/[slug]`), the fixed bottom bar
is a single horizontal row: a quantity stepper `[− 1 +]` next to one black
**Add to Cart** button that also shows the total price.

When a customer is ordering a single drink, they must Add to Cart and then go
to the menu/cart and start checkout — two steps for a one-drink order. We want a
**Checkout** button directly on the product page so a single drink can go
straight to checkout.

## Goal

Restyle the bottom bar (ZUS-style) so the price and stepper share a top row,
and two buttons sit on the row below: **Checkout** and **Add to Cart**.

## Layout

### Normal mode (adding a new drink)

```
┌─────────────────────────────────────────┐
│  RM 10.00                    ⊖   1   ⊕   │   top row: price (left) · stepper (right)
│  ┌──────────────┐  ┌───────────────────┐ │
│  │   CHECKOUT   │  │    ADD TO CART    │ │   button row
│  └──────────────┘  └───────────────────┘ │
└─────────────────────────────────────────┘
```

- **Top row:** total price on the left, quantity stepper on the right.
  - Price reuses the existing total logic. When the drink is on sale, show the
    discounted total with the original struck through (same data the button
    shows today), now positioned top-left.
- **Button row:** two buttons side by side, equal width (`flex-1`).
  - **Checkout** — left, secondary style.
  - **Add to Cart** — right, primary style (black). Primary action keeps the
    dominant right-hand position.

### Edit mode (editing an existing cart line, `?edit=<key>`)

```
┌─────────────────────────────────────────┐
│  RM 10.00                    ⊖   1   ⊕   │
│  ┌─────────────────────────────────────┐ │
│  │            UPDATE CART              │ │   single full-width button
│  └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

- Price + stepper top row stays (quantity is still editable while editing).
- Single full-width **Update Cart** button. No Checkout button.

### Reward mode (`?reward=<id>` or editing a reward line)

Unchanged from today: no stepper, single **Redeem Reward** button with its
existing price/Beans line. The new Checkout button does not appear.

### Sold out

Unchanged: single disabled **Sold Out** button, no stepper.

## Behavior

A new `submit(target)` path generalizes the current `addToCart`:

- **Add to Cart** → existing behavior: `addItem(input)`, then
  `router.push(isReward ? "/rewards" : routes.menu)`.
- **Checkout** (normal mode only) → `addItem(input)`, then
  `router.push(routes.checkout)`. The drink is added to the cart and the user
  lands on checkout, which settles the **whole cart** (this drink plus anything
  already in it). Confirmed: checkout is always whole-cart.
- **Update Cart** (edit mode) → existing behavior unchanged
  (`updateItem` + `router.push(routes.editReturn)`).

`routes.checkout` already resolves to `/checkout` (storefront) or
`/store/checkout` (kiosk), so both surfaces work with no extra wiring.

Checkout is only reachable in normal mode, so it never collides with the
reward redemption or edit flows.

## Styling

Follow the existing design system (CLAUDE.md UI rules) — do not invent a new
look. Reuse the tokens already in this file:

- **Add to Cart (primary):** existing black button style —
  `rounded-2xl bg-black text-white h-12`, hover/active scale, focus ring,
  disabled `bg-neutral-300`.
- **Checkout (secondary):** same shape/height (`rounded-2xl h-12`), lighter
  surface to read as secondary — `bg-neutral-100 text-foreground` with
  `hover:bg-neutral-200`, same focus-ring treatment. (Outlined `border` is the
  alternative; neutral-100 matches the app's existing "unselected" surfaces
  like the size chips.)
- **Stepper:** unchanged markup, moved into the top row, right-aligned.
- **Price:** reuse the existing `formatPrice` / sale strikethrough markup,
  placed top-left, sized to sit comfortably opposite the stepper.

Container stays `fixed bottom-[...] left-1/2 ... max-w-md` as today; inner
layout changes from a single `flex` row to a `flex-col` with a top row
(`flex items-center justify-between`) and a button row (`flex gap-3`).

## Out of scope

- No "checkout this drink only" / cart-bypass — checkout always settles the
  whole cart.
- No changes to the cart store, checkout page, routes, or reward logic.
- No changes to edit/reward/sold-out behavior beyond the layout described.

## Test plan (manual)

1. Normal drink → top row shows price + stepper; two buttons below.
2. Add to Cart → drink added, returns to menu (unchanged).
3. Checkout (empty cart) → drink added, lands on checkout showing the drink.
4. Checkout (cart already has items) → lands on checkout showing all items.
5. Change quantity → price and added quantity reflect it for both buttons.
6. On-sale drink → top-row price shows discounted + struck-through original.
7. Edit a line (`?edit=`) → stepper + single Update Cart; no Checkout.
8. Reward redeem (`?reward=`) → unchanged (no stepper, Redeem Reward only).
9. Sold-out drink → single disabled Sold Out button, no stepper.
10. Kiosk (`/store/[slug]`) → Checkout lands on `/store/checkout`.
