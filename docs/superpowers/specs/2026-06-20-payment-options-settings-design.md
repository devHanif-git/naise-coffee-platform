# Payment Options Settings — Design

**Date:** 2026-06-20
**Status:** Approved

## Goal

Let an admin enable/disable payment options from `/admin/settings`, controlled both
per-category (Cash, QR Code, Card, E-Wallet, Bank) and per-method within each category.
Add a new **Bank Transfer** method whose account details are admin-editable and shown to
the customer at checkout. Checkout must only offer the methods the admin has left enabled.

## Decisions

- **Granularity:** category master switch + per-method toggles inside each category.
- **Categories:** five — Cash, QR Code, Card, E-Wallet, Bank. Adds a new Bank Transfer method.
- **Bank details:** admin-editable in Settings (bank name, account number, account holder).
- **Receipt:** Bank Transfer **requires** a proof-of-payment receipt upload, like DuitNow QR.
  (Revised after first review — originally specced as no receipt.) Implemented via a
  `requiresReceipt` flag on the method so checkout gates the upload generically rather than by
  hardcoded id.

## Category → method mapping

| Category  | `PaymentCategoryId` | Methods                                  |
| --------- | ------------------- | ---------------------------------------- |
| Cash      | `cash`              | `cash`                                   |
| QR Code   | `qr`                | `duitnow-qr`                             |
| Card      | `card`              | `apple-pay`, `google-pay`                |
| E-Wallet  | `ewallet`           | `tng-ewallet`, `boost`, `grabpay`        |
| Bank      | `bank`              | `bank-transfer` (new)                    |

## Architecture

### Source of truth split

- **Catalog stays in code** (`data/payment-methods.ts`): identity, label, description,
  category, `featured`, `requiresAuth`. Each method has bespoke checkout behavior (icon
  mapping, DuitNow's receipt flow, Bank's detail card), so the *list* is code-owned.
- **State lives in the DB** (`payment_settings`): which categories/methods are enabled, plus
  the bank account details. The DB never defines *what* the methods are, only their on/off
  state and the bank fields.

**Effective availability** of a method at checkout =
`categoryEnabled[method.category] && methodEnabled[method.id]`.

Storing both category and method flags (rather than collapsing) means turning a category
off and back on restores the prior per-method states.

### Data model — new `payment_settings` table

A single-row table (boolean PK = `true`), mirroring `store_settings`: world-readable
(`anon`, `authenticated` SELECT `using (true)`), admin-write
(`current_user_role() = 'admin'`), `set_updated_at` trigger, seeded with one row of
defaults (everything enabled, bank fields empty).

Columns:

- Category flags: `cash_enabled`, `qr_enabled`, `card_enabled`, `ewallet_enabled`,
  `bank_enabled` — all `boolean not null default true`.
- Method flags: `cash_method_enabled`, `duitnow_qr_enabled`, `apple_pay_enabled`,
  `google_pay_enabled`, `tng_ewallet_enabled`, `boost_enabled`, `grabpay_enabled`,
  `bank_transfer_enabled` — all `boolean not null default true`.
- Bank details: `bank_name text not null default ''`, `bank_account_number text not null
  default ''`, `bank_account_holder text not null default ''`.

Migration file: `supabase/migrations/<timestamp>_payment_settings.sql`. Reuses existing
`public.set_updated_at()` and `public.current_user_role()`.

### Reads — `lib/settings/payments.ts`

- `PaymentSettings` type: `categories: Record<PaymentCategoryId, boolean>`,
  `methods: Record<PaymentMethodId, boolean>`, `bank: { name; accountNumber; accountHolder }`.
- `DEFAULT_PAYMENT_SETTINGS`: all categories/methods enabled, bank fields empty strings.
- `getPaymentSettings()`: reads the row, maps columns → typed object. **Fails open** to
  `DEFAULT_PAYMENT_SETTINGS` (all enabled) on any read error or missing row — blocking all
  payments would be worse than a stale config. (This deliberately differs from store-closure,
  which fails *closed*.)
- `getEnabledPaymentMethods(settings)`: merges settings + the code catalog → the ordered list
  of enabled `PaymentMethod`s (filtered by effective availability), preserving catalog order.

### Checkout integration

- `app/(customer)/checkout/page.tsx` (server) calls `getPaymentSettings()`, computes the
  enabled-method list and bank details, and passes them into `CheckoutScreen` as props.
  The static `paymentMethods` / `defaultPaymentMethodId` imports in the component are replaced
  by these props.
- Default selected method = first enabled method (no longer hardcoded `cash`).
- The guest/`requiresAuth` reconciliation logic stays, but operates over the enabled list.
- **Bank Transfer selected** → render a bank-details card (bank name, account number, account
  holder, each with a copy-to-clipboard button), followed by a proof-of-payment receipt upload
  (details shown above the upload so the customer pays before attaching).
- **DuitNow QR** behavior is unchanged (QR card + required receipt).
- **Edge case — no methods enabled:** if the enabled list is empty, the payment section shows a
  "Payments are temporarily unavailable" notice and Place Order is disabled.

No change to the orders schema or WhatsApp message: the method *name* ("Bank Transfer") flows
through the existing `paymentMethod` field unchanged.

### Admin UI — `components/admin/payment-settings-form.tsx`

A second card on `/admin/settings`, rendered below the existing `SettingsForm` (kept separate
so each form stays focused). Layout:

- One group per category. The group header shows the category label + a master `Switch`.
- Inside each group, one `ToggleRow`-style row per method with its own `Switch`. When the
  category master is off, the nested method switches render disabled/dimmed (their stored state
  is preserved, just not effective).
- The Bank group additionally renders three text inputs (bank name, account number, account
  holder).
- A single "Save" button persists the whole form via a new `updatePaymentSettings` server action.

`updatePaymentSettings` (in `app/(admin)/admin/settings/actions.ts`): guarded by `isAdmin()`,
writes all columns via `.update().eq("id", true)` (RLS also enforces admin), then
`revalidatePath("/admin/settings")` and `revalidatePath("/checkout")`.

### Type / catalog changes

- `types/payment.ts`: add `bank-transfer` to `PaymentMethodId`; add
  `PaymentCategoryId = "cash" | "qr" | "card" | "ewallet" | "bank"`; add `category:
  PaymentCategoryId` to `PaymentMethod`.
- `data/payment-methods.ts`: tag every method with its `category`; add the `bank-transfer`
  entry (`category: "bank"`). Bank Transfer is **prepaid** (the customer transfers before/at
  order), so it does **not** set `requiresAuth` — guests can use it, unlike Cash
  (pay-at-counter, members-only). Add a `paymentCategories` array with `{ id, label, order }`
  for the admin grouping + ordering.
- `components/checkout-screen.tsx`: add a `bank-transfer` entry to the `methodIcons` map
  (lucide `Landmark`); add the bank-details card; accept the new props.

## Testing

- Migration applies; seed row present with all flags true and empty bank fields.
- Admin: toggling a category master off hides all its methods at checkout; toggling individual
  methods works; bank details save and round-trip.
- Checkout: disabled methods don't appear; default selection falls to the first enabled method;
  Bank Transfer shows the saved details with working copy buttons and no receipt prompt;
  all-disabled shows the unavailable notice and blocks Place Order.
- Read failure path degrades to all-enabled (fail-open), verified by simulating a read error.
- RLS: a non-admin cannot update `payment_settings`; anon/customer can read it.

## Out of scope

- Per-method fees, surcharges, or minimum-order rules.
- Online payment gateway integration (methods remain pay-out-of-band as today).
- Making the method *catalog* itself admin-editable (add/remove methods) — catalog stays code-owned.
