# Unified Cart + Custom Line + Store Idle Timer — Design

**Date:** 2026-06-28
**Status:** Approved (pending spec review)

## Problem

Two related complaints about the in-store kiosk (`/store`) and custom drinks:

1. **The `/store` cart "disappears" after sitting idle.** The cart already persists to
   `localStorage` (`STORE_CART_KEY` in `store/cart.tsx`), so this is *not* a missing-storage
   bug. The real cause is the **90-second idle auto-clear** in
   `components/store/store-shell.tsx`: after 90s with no `pointerdown` / `keydown` / `scroll`,
   it calls `clear()` and routes back to `/store`. That empty cart is then written to
   `localStorage`, so the customer has to re-add everything. 90s is too aggressive for a
   real ordering session.

2. **Custom (off-menu) drinks become a separate order.** The admin custom-order flow
   (`/custom-order` → `placeCustomOrder`) builds its own line list and creates a *distinct*
   order (`source: "custom"`, `CUSTOM_OWNER_ID`). It never touches the shared cart. So a
   customer who wants one menu drink **and** one off-menu drink ends up as two separate
   orders placed twice. The same gap exists for the kiosk: there is no way to add an
   off-menu drink into the `/store` cart at all.

The cart type (`CartItem`) currently *requires* `productId` / `slug` / `image`, so it cannot
hold a free-form custom line today. That is the core blocker to merging the two flows.

## Decisions (locked)

- **Custom item shape:** free-form **name + price + quantity**, mirroring the existing admin
  custom order. Menu items keep their existing customizer (size / ice / sugar / add-ons);
  the custom builder is only for genuinely off-menu drinks.
- **Unified cart:** a custom line lives in the **same cart** as menu lines. One checkout,
  one order, mixed lines. No second order.
- **Idle timer:** keep the self-serve idle reset but change it from **90s → 180s (3 min)**.
  Single constant change. No new manual-clear button in this scope.
- **Access / pricing safety:** `/store` is **customer self-serve**, but a free-form *price*
  field must not be open to customers. The custom builder is **gated behind the existing
  store passcode** (`StorePasscodePrompt`, the same one `StoreEnter` uses). Normal menu
  ordering stays fully self-serve; adding an off-menu drink is a quick staff unlock.
- **Out of scope:** the standalone `/custom-order` admin screen is left as-is. We do not
  redirect or remove it in this change.

## Data model

**No schema change.** `order_items` already snapshots `name`, `quantity`, `unit_price`,
`line_total` and carries `is_custom` (added in the 2026-06-22 custom-drink work). `OrderLine`
already has `isCustom?: boolean` and `productId?: string | null`. A custom line flows through
the existing pipeline unchanged — we only need to carry `isCustom` from the cart into the
order line at checkout.

The custom-drink **presets** table (`custom_drinks`) and its `record_custom_drinks` RPC stay
where they are; they are admin-screen-scoped and not wired into the kiosk in this change
(keeps the kiosk read path simple and avoids needing the admin-gated RPC from a passcode
session). Quick-select presets in the kiosk can be a follow-up.

## Changes

### 1. `constants/store.ts` — idle timer

```ts
export const STORE_IDLE_TIMEOUT_MS = 180_000; // was 90_000; clear abandoned cart after 3 min idle
```

That is the entire fix for complaint #1. `store-shell.tsx` reads the constant; no logic change.

### 2. `types/cart.ts` — allow custom lines

Make product-specific fields optional and add custom markers. A custom line has no product,
so `productId` / `slug` / `image` / `addonIds` / `addonNames` must not be required.

```ts
export type CartItem = {
  key: string;
  // Menu lines carry a product; custom (off-menu) lines do not.
  productId?: string;
  slug?: string;
  name: string;
  image?: string;
  sizeId?: string;
  sizeName?: string;
  addonIds: string[];      // [] for custom lines
  addonNames: string[];    // [] for custom lines
  unitPrice: number;
  unitOriginalPrice: number;
  discountLabel?: string;
  discountPercentOff?: number;
  isReward?: boolean;
  rewardId?: string;
  rewardCost?: number;
  redeemedBy?: string;
  // True when this is a staff-entered off-menu drink (name + price). Maps to
  // order_items.is_custom at checkout. Custom lines never carry a productId.
  isCustom?: boolean;
  quantity: number;
};
```

### 3. `store/cart.tsx` — keying custom lines

`buildKey` currently keys on `productId | sizeId | addons | rewardId`. A custom line has no
product id, so two different custom drinks ("Affogato" RM12 vs "Special" RM8) would both key
to the empty-product key and wrongly merge. Add a custom discriminator to the key.

Approach: when adding a custom line, pass a synthetic identity into the existing key inputs —
key custom lines on `custom:<name>:<unitPrice>` in the `productId` slot. Same name **and**
same price merges (quantity sums, which is the desired behaviour); a different name or price
becomes its own line. No new key function needed; `addItem` already routes everything through
`buildKey`.

`addItem` stays the generic entry point — the custom builder calls `addItem({ name, unitPrice,
unitOriginalPrice: unitPrice, addonIds: [], addonNames: [], isCustom: true, productId:
\`custom:${name}:${sen}\`, quantity })`. Totals, increment/decrement, persistence, and the
reward-stripping effect all operate on lines generically and need no change. (The reward effect
only touches `isReward` lines, so custom lines are untouched.)

### 4. `components/store/custom-line-builder.tsx` (new) — the gated builder

A small client component shown in the kiosk cart sheet:

- Collapsed by default as a single **"+ Add custom drink"** row.
- Tapping it opens the existing `StorePasscodePrompt` in a modal (reused, not rebuilt). On
  success it unlocks the form **for the rest of the session** (local component state — the
  device is already in store mode, this is just the price-field guard).
- Unlocked form: `name` text input, `RM` decimal input, qty defaulting to 1, and an
  **"Add to cart"** button that calls `addItem(...)` with the custom line, then clears the form.
- Mirrors the look of the existing `custom-order-screen.tsx` add-drink section (same inputs,
  radii, spacing) so it is visually consistent.

This component renders inside the cart UI alongside menu lines, so the custom drink visibly
joins the same list.

### 5. Cart display — show custom lines

Wherever the cart renders lines (`components/store/store-cart.tsx` and the shared cart sheet),
custom lines must render without a product image / slug link. Show the custom name, a small
**"Custom"** badge, unit price, and the qty stepper. Because `image`/`slug` are now optional,
guard the image render (`item.image ? <SmartImage…/> : <placeholder/>`) and don't link a custom
line to a product page. The qty stepper uses the existing `incrementItem` / `decrementItem`.

### 6. `placeStoreOrder` — carry the custom flag

`PlaceStoreOrderInput.items` gains optional `isCustom`. The action already maps cart items to
`OrderLine`; set `isCustom: item.isCustom ?? false` and `productId: item.isCustom ? null :
item.productId`. The live-catalogue availability re-check already filters on truthy
`productId`, so custom lines (no product id) skip that check naturally — confirm the filter
treats a synthetic/empty product id as "not a product" and does not block. Custom lines must be
excluded from the `products` availability lookup (filter to real UUID product ids only).

`store-checkout.tsx` passes `isCustom: i.isCustom` through in its `items.map`, and **must not
send the synthetic cart key as a product id**: map `productId: i.isCustom ? undefined :
i.productId`. The `custom:<name>:<sen>` value is a cart-internal keying device only — it never
leaves the cart. This guarantees the availability lookup (`.in("id", productIds)`) only ever
sees real UUIDs and custom lines are skipped cleanly.

### 7. Customer storefront (`/menu`) — unchanged for customers

The customer-app cart (`app/(customer)/layout.tsx`) gets the same `CartItem` type changes for
free, but **no custom builder is mounted there** in this scope. Custom drinks are a kiosk /
staff concern. (The standalone `/custom-order` admin screen is untouched.)

## Data flow

```
Staff taps "+ Add custom drink" (kiosk cart)
   → StorePasscodePrompt (reused) unlocks the form
   → name + RM + qty → addItem({ isCustom, productId: "custom:<name>:<sen>", … })
   → line joins the SAME cart as menu lines (localStorage-persisted)
Customer adds menu drinks normally (existing customizer)
   → one cart, mixed lines
Checkout (store-checkout → placeStoreOrder)
   → lines mapped to OrderLine with isCustom + productId(null for custom)
   → ONE order, one NAISE-XXXXXX number, on the live board
```

## Error handling

- **Empty / invalid custom input:** "Add to cart" is disabled until name is non-empty and
  price parses to a positive integer (sen), matching `custom-order-screen.tsx`'s `addManual`.
- **Wrong passcode:** `StorePasscodePrompt` already surfaces its own error; the form stays
  locked.
- **Availability re-check at checkout:** custom lines have no product id and must be skipped by
  the `products` lookup so they never trip a false "no longer available".
- **Idle reset mid-build:** the 3-min idle timer still applies; an abandoned half-built custom
  line is acceptable to lose on reset (same as a half-filled cart today).

## Testing

- **Unit (cart key):** two custom lines with different names → two lines; same name+price added
  twice → one line, quantity 2; a custom line and a menu line coexist; totals sum correctly.
- **Type:** `CartItem` with no `productId`/`image` compiles; menu lines still compile.
- **Manual / e2e:**
  1. `/store`: add a menu drink, unlock + add a custom drink → both show in one cart, custom
     line shows "Custom" badge and no image.
  2. Checkout → one order number; manage page shows both lines, custom line flagged custom.
  3. Idle 2 min → cart still present; idle past 3 min → cart clears (timer change verified).
  4. Customer (non-store) `/menu` cart is visually unchanged and has no custom builder.
- Run `npm run lint` and `npm run build` (or the project's typecheck) before finishing.

## Files touched

| File | Change |
|---|---|
| `constants/store.ts` | `STORE_IDLE_TIMEOUT_MS` 90_000 → 180_000 |
| `types/cart.ts` | product fields optional; add `isCustom` |
| `store/cart.tsx` | custom-line keying via synthetic product slot (comment + `addItem` usage) |
| `components/store/custom-line-builder.tsx` | **new** — passcode-gated name+price form |
| `components/store/store-cart.tsx` | render custom lines (badge, no image/link) + mount builder |
| `app/(store)/store/(kiosk)/actions.ts` | carry `isCustom`; skip custom lines in availability check |
| `components/store/store-checkout.tsx` | pass `isCustom` through `items.map` |

## YAGNI / explicitly not doing

- No kiosk quick-select presets (the `custom_drinks` table stays admin-only).
- No manual "Clear cart" button.
- No change to `/custom-order` admin screen.
- No custom builder on the customer `/menu` storefront.
- No schema migration.
