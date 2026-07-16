# CHIP DuitNow QR Payment — Design

**Date:** 2026-07-16
**Branch:** `feature/payment-integration`
**Status:** Design — awaiting user review
**Reference:** `chip-skill/CHIP-INTEGRATION-REFERENCE.md`, `chip-skill/SKILL.md`

---

## 1. Goal & scope

Replace the current **manual** DuitNow QR flow (static QR image → screenshot →
receipt upload) with a **CHIP-gateway-confirmed** DuitNow QR flow, on the
**customer storefront only**, in **CHIP test mode**.

### In scope (this phase)
- CHIP **Collect** integration (not Send).
- **Test mode** only.
- **DuitNow QR** only — the single method routed through CHIP.
- **Customer online checkout** only.
- Admin-configurable **gateway fee** (flat + percentage).
- New **Payment Review** screen before redirecting to CHIP.
- **Webhook = source of truth**; rewards/Telegram settle after payment.
- **Auto-expire** abandoned unpaid orders.

### Explicitly OUT of scope (later phases)
- Kiosk / in-store surface (`app/(store)/...`) — stays on cash/manual for now.
- Card, FPX, e-wallet, bank transfer via CHIP — later, reusing the same client.
- CHIP Send (payouts).
- Live mode (a later flip of credentials + go-live checklist).

---

## 2. Decisions (locked with user)

| Decision | Choice |
|---|---|
| Gateway fee owner | **Admin-configurable** per shop |
| Fee formula | **Flat + percentage** (`flat + round(total × percent)`) |
| Manual QR (static + receipt upload) | **Fully replaced** by CHIP for the QR method |
| Staff visibility of unpaid orders | **Hidden until paid** |
| Abandoned unpaid orders | **Auto-expire** (pg_cron → App Service route) |
| Rewards/vouchers/Telegram timing | **Settle after payment** (in the webhook) |
| CHIP line items | **Itemised** (drink lines + separate fee line) |

---

## 3. Flow & states

```
Cart → Checkout → pick "DuitNow QR"
  → summary only (NO static QR, NO save button, NO receipt upload)
  → CTA "Continue to payment"
  → [server action] create order (status = awaiting_payment)
                    + create CHIP purchase (itemised + fee line)
                    store chip_purchase_id, gateway_fee on the order
  → redirect to Payment Review screen  /checkout/pay/[token]
       ┌ Pay now  → redirect to checkout_url?preferred=duitnow_qr  (QR-only)
       └ Cancel   → cancel the awaiting_payment order → back to checkout
  → CHIP hosted page → customer scans & pays
  → CHIP browser redirect → order status page ("confirming payment…")
  → CHIP webhook purchase.paid  (SOURCE OF TRUTH)
       → verify signature → idempotency check
       → flip order awaiting_payment → pending  (the normal "Received" start)
       → settle rewards (Beans earn/redeem, vouchers)
       → fire Telegram "NEW ORDER!"
       → NOW the order appears on the staff board
```

### Status model
The codebase **already defines** `awaiting_payment` in `types/order.ts` and
`statusDisplay`. We reuse it as the pre-payment state.

- `awaiting_payment` — order row exists, **not paid**, **hidden from staff**.
- `pending` — paid & confirmed; the normal start of fulfilment ("Received").
- Existing `preparing` / `ready` / `completed` / `cancelled` unchanged.

**Bug to fix (pre-existing):** `lib/orders/status.ts` currently folds
`awaiting_payment` INTO the staff "Pending" tab:

```ts
// statusesForFilter("pending") today returns:
["pending", "awaiting_payment"]      // ← wrong for "hidden until paid"
// matchesFilter(..., "pending") today:
status === "pending" || status === "awaiting_payment"   // ← wrong
```

Both must change so `awaiting_payment` is **excluded from every staff tab**:
- `statusesForFilter("pending")` → `["pending"]`
- `matchesFilter(status,"pending")` → `status === "pending"`
- `awaiting_payment` maps to **no** staff filter (never in `all` either — the
  board should not show unpaid attempts). Confirm `listOrdersPage`/`countOrders`
  for the `all` filter (which uses `statusesForFilter` → `null`, no constraint)
  explicitly excludes `awaiting_payment` via an added `.neq("status",
  "awaiting_payment")` on the staff queries, OR the board filters it out.
  **Chosen:** add an explicit exclusion on the staff board queries so `all` never
  surfaces unpaid orders.

The customer's own order views (history, status page) DO show `awaiting_payment`
so they can resume/track — scoped by `user_id`/token, not the staff board.

---

## 4. Gateway fee

### Storage — extend `payment_settings`
Add columns (all with safe defaults, matching the fail-open pattern in
`lib/settings/payments.ts`):

| Column | Type | Meaning |
|---|---|---|
| `chip_enabled` | bool, default `false` | Master switch for CHIP-gateway QR |
| `chip_fee_flat` | int (sen), default `0` | Flat fee component |
| `chip_fee_percent` | int (basis points), default `0` | e.g. `150` = 1.50% |

- Percentage stored as **basis points (integer)** to avoid float drift, matching
  the "money as integers" rule. `1.50%` → `150`.
- CHIP **credentials live in env, never in the DB**. `.gitignore` already ignores
  `chip.env` (line 53) — credentials belong there / in the deployment env, read
  server-side only.

### Calculation (server-side, authoritative)
```
fee = chip_fee_flat + round(orderTotal * chip_fee_percent / 10000)
amountToPay = orderTotal + fee
```
Recomputed at purchase-creation from the **server** order total (never the
client value), same discipline as the existing reprice logic in
`checkout/actions.ts`.

### `PaymentSettings` type + `map()` + `DEFAULT_PAYMENT_SETTINGS` in
`lib/settings/payments.ts` extended to carry these three fields. Admin settings
UI (`app/(admin)/admin/settings/`) gets a CHIP section: enable toggle, flat fee
(RM input → sen), percent (→ basis points). Out-of-scope detail: exact admin UI
layout follows the existing settings patterns; not fully specced here.

---

## 5. Payment Review screen

**Route:** `app/(customer)/checkout/pay/[token]/page.tsx` — server component,
rendered from the `awaiting_payment` order (refresh-safe; the token is the key).

Displays:
- **Transaction no.** — CHIP `chip_purchase_id` (shortened for display)
- **Bill / Order no.** — `NAISE-xxxxxx`
- **Date** — order `created_at`
- **Description** — e.g. "NAISE COFFEE order"
- **Amount** — order total (sen → RM)
- **Gateway fee** — `gateway_fee` line
- **Total to pay** — amount + fee
- **Pay now** → redirect to `checkout_url?preferred=duitnow_qr`
- **Cancel** → server action cancels the order, returns to checkout

Guard: if the order is not `awaiting_payment` (already paid/cancelled/expired),
redirect to the appropriate place (order status page if paid, checkout if
cancelled/expired).

---

## 6. Order status / return page

**Route:** reuse or extend the customer order detail (`app/(customer)/profile/
orders/[token]/page.tsx`) or a dedicated post-payment landing.

- CHIP `success_redirect` → this page with a "confirming payment…" state while
  `awaiting_payment`.
- Flips to the normal tracker once the webhook has moved it to `pending`.
- `failure_redirect` / `cancel_redirect` → messaging + back-to-checkout.
- Belt-and-braces: on load, server-side `retrievePurchase()` to reconcile in
  case the webhook is delayed (does NOT replace the webhook; just improves UX).

---

## 7. Data model changes (migration + RLS)

New migration under `supabase/migrations/`.

### `orders` — add columns
| Column | Type | Notes |
|---|---|---|
| `chip_purchase_id` | text, nullable | CHIP purchase `id`; also lets the webhook find the order |
| `gateway_fee` | int (sen), default `0` | Fee charged on top of `total` for the CHIP path |

- Index `chip_purchase_id` (webhook lookup).
- `payment_method` for this path = `duitnow-qr` (existing canonical id). The
  gateway vs manual distinction is implicit: CHIP orders have `chip_purchase_id`.
- `proof_of_payment_url` is simply **not used** for the CHIP QR path (no upload).
  Manual receipt columns remain for legacy/other methods.

### `payment_settings` — add `chip_enabled`, `chip_fee_flat`, `chip_fee_percent`
(see §4).

### RLS
- Customer can **read their own** `awaiting_payment` order (already covered by the
  existing owner/user scoping + token read path via `getOrderByToken`, which uses
  the admin client — verify the customer-facing read path allows it).
- The **webhook** runs server-side with the **service-role admin client**
  (`createAdminClient()`), so it bypasses RLS to flip status / settle rewards —
  same pattern as `cancelOrderAsSystem` and the store kiosk path.
- No new customer write policy needed: order creation already supports the
  authenticated member path in `createOrder`.

---

## 8. Server pieces

### `lib/payments/chip/` (server-only)
| File | Exports |
|---|---|
| `client.ts` | `createPurchase(input)`, `retrievePurchase(id)` — thin fetch wrappers over `https://gate.chip-in.asia/api/v1/`, Bearer secret from env |
| `signature.ts` | `verifyWebhookSignature(rawBody, xSignature, publicKey)` — RSA PKCS#1 v1.5 / SHA-256, base64-decoded sig, verified over **raw bytes** |
| `config.ts` | reads `CHIP_SECRET_KEY`, `CHIP_PUBLIC_KEY`, `CHIP_BRAND_ID` from env (server-only) |

`createPurchase` builds the body per `CHIP-INTEGRATION-REFERENCE.md §6`:
- `client.email` (member email), `client.full_name` (display name)
- `purchase.currency = "MYR"`, `purchase.products = [ ...drink lines, fee line ]`
  (itemised, each `price` in sen = CHIP cents)
- `brand_id`, `reference = orderNumber`
- `payment_method_whitelist = ["duitnow_qr"]`
- `success_callback` = webhook URL, `success_redirect`/`failure_redirect`/
  `cancel_redirect` = customer status routes

### `app/api/payments/chip/webhook/route.ts`
1. Read **raw** body (before JSON parse).
2. Verify `X-Signature` with `CHIP_PUBLIC_KEY`. On failure → **return 200**, skip.
3. Parse; on `purchase.paid`:
   - Look up order by `chip_purchase_id`.
   - **Idempotency:** if already `pending`/beyond → return 200, do nothing.
   - Flip `awaiting_payment` → `pending` (admin client).
   - **Settle rewards** (move the reward/voucher block out of `placeOrder`).
   - **Fire Telegram** "NEW ORDER!" (best-effort, as today).
4. Always return **200** (CHIP retries non-200; duplicates expected).

### Checkout action changes (`app/(customer)/checkout/actions.ts`)
- Split the current `placeOrder`: for the CHIP QR method, create the order as
  `awaiting_payment`, compute fee, call `createPurchase`, store
  `chip_purchase_id` + `gateway_fee`, return the review-screen redirect —
  **do NOT** settle rewards or fire Telegram yet.
- Non-CHIP methods (cash, etc.) keep today's behaviour.
- New `cancelPendingPayment(token)` action for the Cancel button.

### Rewards relocation (the delicate part)
Today `placeOrder` does: create order → redeem voucher → `applyOrderRewards` →
Telegram, with rollback-on-failure. For CHIP, this block **moves to the webhook**,
because the order isn't real until paid:

- At creation (awaiting_payment): **reserve nothing** irreversibly. Record the
  intended `voucherId` on the order (new nullable column `pending_voucher_id`, or
  reuse order metadata) so the webhook knows what to redeem.
- On `purchase.paid`: run the existing redeem + `applyOrderRewards` logic. If a
  reward/voucher can no longer be honoured (e.g. balance changed), the money is
  **already captured** — so we do NOT roll back the order; instead log + surface
  to staff (the drink is paid for; reward settlement failure becomes a staff
  concern, not a customer error). This is a real behavioural change from the
  synchronous path and must be called out in the plan.
  - **Open sub-decision for the plan:** exact handling when a voucher/reward is
    unhonourable at webhook time (paid already). Options: (a) settle what's
    possible, log the rest; (b) auto-refund via CHIP. Recommend (a) for phase 1.

### Auto-expire (`app/api/...` route + pg_cron)
- A route (service-role) cancels `awaiting_payment` orders older than **45 min**.
- Scheduled via **Supabase pg_cron → App Service route**, per the deployment
  memory (`naise-deployment-azure-supabase`). Mirrors the shift-reminder route
  pattern (`app/api/shift/reminder/route.ts`).

---

## 9. Testing (test mode)

- Standalone smoke test first (per `SKILL.md` Path A): `createPurchase` with
  test secret + brand id, open `checkout_url?preferred=duitnow_qr`, pay in
  sandbox, confirm the webhook fires and the order flips.
- Verify: signature verification (valid + tampered), idempotency (deliver twice),
  cancel path, auto-expire, fee math (flat only / percent only / both / zero).
- `npm run build` (EXIT 0) is the gate; `npx eslint` on changed files.
- No JS test framework in this repo by design — verify via the build + manual
  sandbox run.

---

## 10. Files touched (anticipated)

**New**
- `lib/payments/chip/{client,signature,config}.ts`
- `app/api/payments/chip/webhook/route.ts`
- `app/api/payments/chip/expire/route.ts` (auto-expire, cron target)
- `app/(customer)/checkout/pay/[token]/page.tsx` (+ its cancel action)
- `supabase/migrations/<ts>_chip_payments.sql`

**Modified**
- `lib/orders/status.ts` — fix `awaiting_payment` staff-tab mapping
- `lib/orders/store.ts` — staff queries exclude `awaiting_payment`; setters for
  chip fields
- `lib/settings/payments.ts` — CHIP fee fields
- `app/(customer)/checkout/actions.ts` — split CHIP path; move rewards to webhook
- `components/checkout-screen.tsx` — QR method: drop static QR/upload, new CTA
- `app/(admin)/admin/settings/` — CHIP fee admin UI
- `types/order.ts` — `gatewayFee`, `chipPurchaseId` on `Order`

---

## 11. Risks & call-outs

1. **Rewards move async.** The synchronous rollback safety of `placeOrder` is
   lost for the CHIP path — money is captured before rewards settle. Phase-1
   stance: settle-what's-possible + log; no auto-refund. Must be explicit in the
   plan.
2. **`awaiting_payment` staff-tab fix is a pre-existing-behaviour change** —
   verify nothing else relies on unpaid orders showing in Pending.
3. **Webhook publicly reachable + HTTPS** required (App Service prod). Localhost
   dev needs a tunnel (or rely on `retrievePurchase` reconciliation) for testing.
4. **Fee itemisation** — CHIP `purchase.total` is computed from products, so the
   fee line must be a real product line; confirm CHIP's displayed total equals
   `amountToPay`.
5. **DuitNow QR test-mode behaviour** was thinly documented — confirm sandbox QR
   simulation against a live test purchase early.
