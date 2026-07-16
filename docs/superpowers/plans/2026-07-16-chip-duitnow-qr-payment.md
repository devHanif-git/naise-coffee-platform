# CHIP DuitNow QR Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual DuitNow QR flow (static QR + screenshot upload) with a CHIP-gateway-confirmed DuitNow QR flow on the customer storefront, in CHIP test mode.

**Architecture:** Order is created as `awaiting_payment` (hidden from staff), a CHIP purchase is created, the customer reviews a payment screen then pays on CHIP's hosted DuitNow QR page. A signed CHIP webhook is the source of truth: it flips the order to `pending`, settles rewards, and fires the Telegram alert. Abandoned unpaid orders auto-expire via pg_cron.

**Tech Stack:** Next.js App Router (Server Components + server actions + route handlers), TypeScript (strict, no `any`), Supabase (Postgres + RLS + service-role admin client), Tailwind + shadcn/ui, CHIP Collect REST API.

## Global Constraints

- Money is stored as **integer sen** (1 MYR = 100 sen). CHIP `price` is in cents = same unit. No float conversion.
- Percentage fee stored as **integer basis points** (1.50% → `150`). Never a float.
- CHIP credentials are **server-only** env vars — never `NEXT_PUBLIC_`, never in the DB, never in a client component. CHIP has no CORS; all CHIP calls are server-side.
- Verification gate: `npm run build` must exit 0. Scope lint to changed files: `npx eslint <path>`. **There is no JS test framework in this repo by design** — do not add one. Verify via build + targeted eslint + manual CHIP sandbox run.
- TypeScript strict, no `any`. Use generated Supabase types (`types/database.ts`), regenerated after each migration.
- Follow existing patterns: server actions return `{ ok: true, ... } | { ok: false, error: string }`; admin actions gate with `isAdmin()`; service-role writes use `createAdminClient()`.
- Payment settings **fail open** (a read error → everything enabled) — but `chip_enabled` defaults **false** so CHIP is off until an admin turns it on.
- Money-in-sen, IDs, and status values must match `types/order.ts` and `lib/orders/status.ts` exactly.

---

## File Structure

**New files**
- `supabase/migrations/20260716130000_chip_payments.sql` — orders + payment_settings columns, index.
- `supabase/migrations/20260716130100_chip_expire_cron.sql` — pg_cron schedule for auto-expire.
- `lib/payments/chip/config.ts` — reads/validates CHIP env; exposes base URL + brand id + keys.
- `lib/payments/chip/client.ts` — `createPurchase()`, `retrievePurchase()`.
- `lib/payments/chip/signature.ts` — `verifyChipSignature()` (RSA PKCS#1 v1.5 / SHA-256 over raw bytes).
- `lib/payments/chip/fee.ts` — `computeGatewayFee()` pure fn.
- `app/api/payments/chip/webhook/route.ts` — signed webhook; flips to paid, settles rewards, Telegram.
- `app/api/payments/chip/expire/route.ts` — cron target; cancels stale `awaiting_payment` orders.
- `app/(customer)/checkout/pay/[token]/page.tsx` — Payment Review screen (server component).
- `app/(customer)/checkout/pay/[token]/actions.ts` — `cancelPendingPayment(token)`.
- `components/payment-review.tsx` — the review UI (client; Pay now / Cancel).

**Modified files**
- `types/order.ts` — add `gatewayFee`, `chipPurchaseId` to `Order`; `OrderStatus` already has `awaiting_payment`.
- `lib/orders/status.ts` — remove `awaiting_payment` from the staff "pending" tab mappings.
- `lib/orders/store.ts` — exclude `awaiting_payment` from staff board queries; add `markOrderPaid()` + chip fields in `createOrder`.
- `lib/orders/mappers.ts` — map new columns into `Order`.
- `lib/settings/payments.ts` — add CHIP fee fields to type/map/defaults/columns.
- `app/(customer)/checkout/actions.ts` — split the CHIP QR path (create `awaiting_payment` + CHIP purchase, defer rewards); export a settle helper reused by the webhook.
- `app/(admin)/admin/settings/actions.ts` — persist CHIP fee fields.
- `app/(admin)/admin/settings/page.tsx` + settings form component — CHIP admin UI.
- `components/checkout-screen.tsx` — QR method: drop static QR + receipt upload; CTA → "Continue to payment".
- `.env.example` — document CHIP env vars.

---

### Task 1: Database migration — CHIP columns

**Files:**
- Create: `supabase/migrations/20260716130000_chip_payments.sql`

**Interfaces:**
- Produces: `orders.chip_purchase_id` (text, nullable), `orders.gateway_fee` (int, default 0), `orders.pending_voucher_id` (uuid, nullable); `payment_settings.chip_enabled` (bool, default false), `payment_settings.chip_fee_flat` (int, default 0), `payment_settings.chip_fee_percent` (int basis points, default 0).

- [ ] **Step 1: Write the migration SQL**

```sql
-- CHIP DuitNow QR payment support.
--
-- Orders paid through the CHIP gateway are created as `awaiting_payment`
-- (hidden from staff), carry the CHIP purchase id for webhook lookup, a
-- gateway fee added on top of the total, and the voucher the customer chose
-- (redeemed only after payment confirms, so an abandoned order burns nothing).

alter table public.orders
  add column chip_purchase_id text,
  add column gateway_fee integer not null default 0,
  add column pending_voucher_id uuid references public.vouchers (id) on delete set null;

-- The webhook finds the order by the CHIP purchase id, so index it.
create unique index orders_chip_purchase_id_idx
  on public.orders (chip_purchase_id)
  where chip_purchase_id is not null;

comment on column public.orders.chip_purchase_id is
  'CHIP Collect purchase id for a gateway-paid order. Null for cash/manual orders. Webhook lookup key.';
comment on column public.orders.gateway_fee is
  'Payment-gateway fee (sen) added on top of total for the CHIP path. 0 for non-gateway orders.';
comment on column public.orders.pending_voucher_id is
  'Voucher the customer chose at checkout, redeemed only when payment confirms. Null when none.';

-- Admin-configurable CHIP gateway fee. chip_enabled defaults FALSE so CHIP is
-- off until an admin turns it on (unlike the fail-open method toggles).
alter table public.payment_settings
  add column chip_enabled boolean not null default false,
  add column chip_fee_flat integer not null default 0,
  add column chip_fee_percent integer not null default 0;

comment on column public.payment_settings.chip_enabled is
  'When true, DuitNow QR is collected via the CHIP gateway instead of the manual QR+receipt flow.';
comment on column public.payment_settings.chip_fee_flat is
  'Flat gateway fee component in sen, added to the order total on the CHIP path.';
comment on column public.payment_settings.chip_fee_percent is
  'Percentage gateway fee component in basis points (150 = 1.50%), applied to the order total.';
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push` (or apply via the Supabase MCP `apply_migration` with name `chip_payments` and the SQL above).
Expected: migration applies with no error; `orders` and `payment_settings` gain the new columns.

- [ ] **Step 3: Regenerate Supabase types**

Run: `npx supabase gen types typescript --linked > types/database.ts` (or the project's existing gen command).
Expected: `Tables<"orders">` now includes `chip_purchase_id`, `gateway_fee`, `pending_voucher_id`; `Tables<"payment_settings">` includes `chip_enabled`, `chip_fee_flat`, `chip_fee_percent`.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: EXIT 0 (no code consumes the new columns yet, so types still compile).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260716130000_chip_payments.sql types/database.ts
git commit -m "feat(payments): add CHIP purchase + gateway fee columns"
```

---

### Task 2: CHIP config + gateway fee math

**Files:**
- Create: `lib/payments/chip/config.ts`
- Create: `lib/payments/chip/fee.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces:
  - `getChipConfig(): { baseUrl: string; brandId: string; secretKey: string }` — throws if secret key or brand id missing. `baseUrl` is `https://gate.chip-in.asia/api/v1`.
  - `getChipPublicKey(): string` — throws if `CHIP_PUBLIC_KEY` missing (used by the webhook only).
  - `computeGatewayFee(total: number, flat: number, percentBasisPoints: number): number` — returns fee in sen: `flat + Math.round(total * percentBasisPoints / 10000)`.

- [ ] **Step 1: Write `lib/payments/chip/config.ts`**

```ts
// Server-only CHIP Collect configuration. Never import into a client component —
// it reads the secret key from a server-only env var. CHIP has no CORS, so every
// CHIP call happens on the server anyway.

// Test mode and live mode issue DIFFERENT secret/public keys. During development
// these hold the Test Mode credentials; going live swaps the env values.
const CHIP_BASE_URL = "https://gate.chip-in.asia/api/v1";

export type ChipConfig = {
  baseUrl: string;
  brandId: string;
  secretKey: string;
};

// Secret key + brand id are needed to create/retrieve purchases. Throws loudly
// if unset so a misconfigured deploy fails fast instead of calling CHIP anon.
export function getChipConfig(): ChipConfig {
  const secretKey = process.env.CHIP_SECRET_KEY;
  const brandId = process.env.CHIP_BRAND_ID;
  if (!secretKey) throw new Error("CHIP_SECRET_KEY is not set.");
  if (!brandId) throw new Error("CHIP_BRAND_ID is not set.");
  return { baseUrl: CHIP_BASE_URL, brandId, secretKey };
}

// The public key verifies webhook / success_callback signatures. Separate getter
// because most code paths (create purchase) don't need it.
export function getChipPublicKey(): string {
  const publicKey = process.env.CHIP_PUBLIC_KEY;
  if (!publicKey) throw new Error("CHIP_PUBLIC_KEY is not set.");
  return publicKey;
}
```

- [ ] **Step 2: Write `lib/payments/chip/fee.ts`**

```ts
// Gateway fee math, isolated + pure so it's trivial to reason about and reuse
// (checkout action to build the CHIP purchase, review screen to display it).
// All amounts are integer sen; the percent component is integer basis points
// (150 = 1.50%) to avoid floating-point drift. Rounded to the nearest sen.

export function computeGatewayFee(
  total: number,
  flat: number,
  percentBasisPoints: number,
): number {
  const pct = Math.round((total * percentBasisPoints) / 10000);
  return flat + pct;
}
```

- [ ] **Step 3: Document env vars in `.env.example`**

Append to `.env.example`:

```
# CHIP Collect (payment gateway) — Test Mode credentials.
# Get from https://portal.chip-in.asia/collect → Developers (toggle Test Mode ON).
# Server-only — never prefix with NEXT_PUBLIC_. Live values swap these when going live.
CHIP_SECRET_KEY=
CHIP_PUBLIC_KEY=
CHIP_BRAND_ID=
```

- [ ] **Step 4: Sanity-check the fee math by eye**

Confirm against the spec examples:
- `computeGatewayFee(5000, 50, 0)` → `50` (flat only, RM0.50 on RM50).
- `computeGatewayFee(5000, 0, 150)` → `75` (1.5% of RM50 = RM0.75).
- `computeGatewayFee(5000, 10, 100)` → `10 + 50 = 60`.
- `computeGatewayFee(0, 0, 150)` → `0`.

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npx eslint lib/payments/chip/config.ts lib/payments/chip/fee.ts`
Expected: EXIT 0, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add lib/payments/chip/config.ts lib/payments/chip/fee.ts .env.example
git commit -m "feat(payments): CHIP config loader and gateway fee math"
```

---

### Task 3: CHIP API client — create + retrieve purchase

**Files:**
- Create: `lib/payments/chip/client.ts`

**Interfaces:**
- Consumes: `getChipConfig()` from Task 2.
- Produces:
  - `type ChipProduct = { name: string; price: number; quantity?: number }`
  - `type CreatePurchaseInput = { email: string; fullName?: string; products: ChipProduct[]; reference: string; successCallback: string; successRedirect: string; failureRedirect: string; cancelRedirect: string }`
  - `type ChipPurchase = { id: string; status: string; checkout_url: string; is_test: boolean }`
  - `createPurchase(input: CreatePurchaseInput): Promise<ChipPurchase>` — POSTs `/purchases/`, whitelists `duitnow_qr`, throws on non-2xx.
  - `retrievePurchase(id: string): Promise<ChipPurchase>` — GETs `/purchases/<id>/`, throws on non-2xx.
  - `duitnowQrCheckoutUrl(checkoutUrl: string): string` — appends `?preferred=duitnow_qr`.

- [ ] **Step 1: Write `lib/payments/chip/client.ts`**

```ts
// Server-only CHIP Collect API client. Thin wrappers over the REST endpoints we
// use — create + retrieve purchase. Endpoint paths are copied verbatim from the
// CHIP OpenAPI spec (see chip-skill/CHIP-INTEGRATION-REFERENCE.md). All money is
// integer sen (== CHIP cents).

import { getChipConfig } from "@/lib/payments/chip/config";

export type ChipProduct = {
  name: string;
  // Integer sen (CHIP cents). 100 = RM 1.00.
  price: number;
  quantity?: number;
};

export type CreatePurchaseInput = {
  email: string;
  fullName?: string;
  products: ChipProduct[];
  // Our order number, stored on the CHIP purchase for cross-reference.
  reference: string;
  // Server-to-server webhook (source of truth).
  successCallback: string;
  // Browser redirects after the hosted payment page.
  successRedirect: string;
  failureRedirect: string;
  cancelRedirect: string;
};

// Only the fields we read back. CHIP returns far more (see reference doc).
export type ChipPurchase = {
  id: string;
  status: string;
  checkout_url: string;
  is_test: boolean;
};

// Create a purchase locked to DuitNow QR. Returns the purchase (with its
// checkout_url). Throws with the CHIP error body on any non-2xx so callers can
// fail the checkout cleanly.
export async function createPurchase(
  input: CreatePurchaseInput,
): Promise<ChipPurchase> {
  const { baseUrl, brandId, secretKey } = getChipConfig();

  const body = {
    brand_id: brandId,
    client: {
      email: input.email,
      ...(input.fullName ? { full_name: input.fullName } : {}),
    },
    purchase: {
      currency: "MYR",
      products: input.products.map((p) => ({
        name: p.name,
        price: p.price,
        quantity: p.quantity ?? 1,
      })),
    },
    reference: input.reference,
    // Restrict the hosted page to DuitNow QR only.
    payment_method_whitelist: ["duitnow_qr"],
    success_callback: input.successCallback,
    success_redirect: input.successRedirect,
    failure_redirect: input.failureRedirect,
    cancel_redirect: input.cancelRedirect,
  };

  const res = await fetch(`${baseUrl}/purchases/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    // Never cache a payment creation.
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`CHIP create purchase failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as ChipPurchase;
}

// Retrieve a purchase to re-verify status server-side (webhook reconciliation,
// review-screen belt-and-braces). Throws on non-2xx.
export async function retrievePurchase(id: string): Promise<ChipPurchase> {
  const { baseUrl, secretKey } = getChipConfig();
  const res = await fetch(`${baseUrl}/purchases/${id}/`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`CHIP retrieve purchase failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as ChipPurchase;
}

// Append the DuitNow-QR direct-post param so the hosted page skips method
// selection and lands straight on the QR screen. Falls back to ?preferred=dnqr
// is documented but duitnow_qr is the canonical value; keep the canonical one.
export function duitnowQrCheckoutUrl(checkoutUrl: string): string {
  const sep = checkoutUrl.includes("?") ? "&" : "?";
  return `${checkoutUrl}${sep}preferred=duitnow_qr`;
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npx eslint lib/payments/chip/client.ts`
Expected: EXIT 0, no lint errors.

- [ ] **Step 3: Manual sandbox smoke test (throwaway script)**

Create a temporary `scripts/chip-smoke.mjs` that imports nothing from the app (standalone fetch), fills `client.email`, one RM1.00 product, brand id + secret from `chip.env`, POSTs `/purchases/`, and prints `checkout_url`. Run it, open `checkout_url + "?preferred=duitnow_qr"` in a browser, confirm the DuitNow QR screen renders in sandbox. Delete the script afterward.

Expected: a `checkout_url` prints; opening it shows CHIP's DuitNow QR test page.

- [ ] **Step 4: Commit**

```bash
git add lib/payments/chip/client.ts
git commit -m "feat(payments): CHIP purchase create/retrieve client"
```

---

### Task 4: CHIP webhook signature verification

**Files:**
- Create: `lib/payments/chip/signature.ts`

**Interfaces:**
- Consumes: `getChipPublicKey()` from Task 2.
- Produces: `verifyChipSignature(rawBody: string, xSignatureHeader: string): boolean` — verifies the base64 `X-Signature` against the raw body using RSA PKCS#1 v1.5 + SHA-256 and the configured public key. Returns `true`/`false`, never throws for a bad signature (only for missing key config).

- [ ] **Step 1: Write `lib/payments/chip/signature.ts`**

```ts
// Verifies CHIP callback/webhook signatures. CHIP signs the raw request body
// with its private key; we verify with the public key. Algorithm per CHIP docs:
// RSA PKCS#1 v1.5, SHA-256 digest, signature base64-encoded in the X-Signature
// header. MUST verify against the RAW body bytes — parsing JSON first would
// reserialize and break the signature.

import { createVerify } from "node:crypto";
import { getChipPublicKey } from "@/lib/payments/chip/config";

export function verifyChipSignature(
  rawBody: string,
  xSignatureHeader: string | null,
): boolean {
  if (!xSignatureHeader) return false;

  // Throws if the public key isn't configured — a deploy misconfig, not a
  // per-request failure, so let it surface.
  const publicKey = getChipPublicKey();

  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(rawBody, "utf8");
    verifier.end();
    // The header is a base64-encoded signature.
    return verifier.verify(publicKey, xSignatureHeader, "base64");
  } catch {
    // Malformed signature/key material → treat as unverified, never throw.
    return false;
  }
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npx eslint lib/payments/chip/signature.ts`
Expected: EXIT 0, no lint errors.

- [ ] **Step 3: Note on runtime**

The webhook route (Task 8) MUST run on the Node.js runtime (not Edge) because this uses `node:crypto`. The route file will set `export const runtime = "nodejs"`. No action here beyond awareness.

- [ ] **Step 4: Commit**

```bash
git add lib/payments/chip/signature.ts
git commit -m "feat(payments): CHIP webhook signature verification"
```

---

### Task 5: Order type + staff-board status fix + mappers

**Files:**
- Modify: `types/order.ts`
- Modify: `lib/orders/status.ts:34-74`
- Modify: `lib/orders/mappers.ts:42-63`

**Interfaces:**
- Consumes: `OrderStatus` (already includes `awaiting_payment`).
- Produces: `Order.gatewayFee?: number`, `Order.chipPurchaseId?: string`; `awaiting_payment` no longer maps into any staff filter.

- [ ] **Step 1: Add fields to the `Order` type**

In `types/order.ts`, inside the `Order` type (after `shiftId`), add:

```ts
  // Gateway fee (sen) charged on top of `total` for a CHIP-paid order. 0/absent
  // for cash and manual orders. Maps to orders.gateway_fee.
  gatewayFee?: number;
  // CHIP Collect purchase id for a gateway-paid order; the webhook's lookup key.
  // Absent for non-gateway orders. Maps to orders.chip_purchase_id.
  chipPurchaseId?: string;
```

- [ ] **Step 2: Remove `awaiting_payment` from the staff "pending" tab**

In `lib/orders/status.ts`, change `matchesFilter` (the `case "pending"`):

```ts
    case "pending":
      return status === "pending";
```

And `statusesForFilter` (the `case "pending"`):

```ts
    case "pending":
      return ["pending"];
```

Leave the `awaiting_payment` entry in `statusDisplay` (still used by the customer's own views) and its `progressIndex` (returns -1) unchanged.

- [ ] **Step 3: Map the new columns in `rowToOrder`**

In `lib/orders/mappers.ts`, inside `rowToOrder`'s returned object (after `source: order.source,`), add:

```ts
    gatewayFee: order.gateway_fee ?? undefined,
    chipPurchaseId: order.chip_purchase_id ?? undefined,
```

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npx eslint types/order.ts lib/orders/status.ts lib/orders/mappers.ts`
Expected: EXIT 0, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add types/order.ts lib/orders/status.ts lib/orders/mappers.ts
git commit -m "feat(payments): order gateway fields; hide awaiting_payment from staff pending tab"
```

---

### Task 6: Store layer — hide unpaid from board, persist CHIP fields, mark paid

**Files:**
- Modify: `lib/orders/store.ts` (`createOrder` insert ~66-80; `listOrdersPage` ~196-209; `countOrders` ~230-238; add `markOrderPaid` near `setOrderPayment` ~729)
- Modify: `types/order.ts` (`OrderDraft` already omits status/etc.; the new optional `gatewayFee`/`chipPurchaseId` flow through `OrderDraft` automatically since it's `Omit<Order, ...>`)

**Interfaces:**
- Consumes: `Order.gatewayFee`, `Order.chipPurchaseId` (Task 5); `OrderDraft` includes them via `Omit`.
- Produces:
  - `createOrder` persists `gateway_fee`, `chip_purchase_id`, `pending_voucher_id`, and accepts an explicit `status` for the draft (default `pending`).
  - `markOrderPaid(chipPurchaseId: string): Promise<Order | null>` — flips an `awaiting_payment` order (matched by CHIP id) to `pending`; returns null if not found or not in `awaiting_payment`.
  - Staff board queries (`listOrdersPage`, `countOrders`) exclude `awaiting_payment` for every filter.

- [ ] **Step 1: Let `createOrder` set status + persist CHIP fields**

`OrderDraft` is `Omit<Order, "token" | "orderNumber" | "status" | "createdAt" | "completedAt">`, so it does NOT carry `status`. Add an optional status to the `createOrder` options and pass the new columns. Change the `createOrder` signature + insert:

```ts
export async function createOrder(
  draft: OrderDraft,
  opts: { userId: string | null; status?: OrderStatus; pendingVoucherId?: string },
): Promise<Order> {
  const db = opts.userId ? await createClient() : createAdminClient();

  const { data: orderRow, error: orderErr } = await db
    .from("orders")
    .insert({
      user_id: opts.userId,
      owner_id: draft.ownerId,
      payment_method: draft.paymentMethod,
      subtotal: draft.subtotal,
      total: draft.total,
      notes: draft.notes ?? null,
      contact_phone: draft.contactPhone ?? null,
      proof_of_payment_url: draft.proofOfPaymentUrl ?? null,
      source: draft.source ?? "online",
      shift_id: draft.shiftId ?? null,
      // Gateway fields — 0/null for non-CHIP orders.
      gateway_fee: draft.gatewayFee ?? 0,
      chip_purchase_id: draft.chipPurchaseId ?? null,
      pending_voucher_id: opts.pendingVoucherId ?? null,
      // Default to the normal start; the CHIP path passes "awaiting_payment".
      status: opts.status ?? "pending",
    })
    .select()
    .single();
  if (orderErr || !orderRow) {
    throw new Error(orderErr?.message ?? "Failed to create order.");
  }
```

Ensure `OrderStatus` is imported in `store.ts` (it already imports from `@/types/order` — add `OrderStatus` to that import if absent).

- [ ] **Step 2: Exclude `awaiting_payment` from the staff board list**

In `listOrdersPage`, after building the base query (the `db.from("orders").select(...)` chain, before the `.range(...)`), add a status exclusion so unpaid orders never appear on any staff tab:

```ts
  let query = db
    .from("orders")
    .select("*, order_items(*)")
    .neq("status", "awaiting_payment")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);
```

- [ ] **Step 3: Exclude `awaiting_payment` from the staff board counts**

In `countOrders`, add the same exclusion to the count query:

```ts
  let query = db
    .from("orders")
    .select("id", { count: "exact", head: true })
    .neq("status", "awaiting_payment");
```

- [ ] **Step 4: Add `markOrderPaid`**

Add near `setOrderPayment` (service-role, since the webhook is the caller and has no cookie session):

```ts
// Flip a CHIP-paid order from awaiting_payment to pending (the normal fulfilment
// start). Matched by CHIP purchase id. Idempotent at the caller: returns null if
// the order is missing or already past awaiting_payment, so the webhook can skip
// re-settling. Service-role — the webhook has no cookie session.
export async function markOrderPaid(chipPurchaseId: string): Promise<Order | null> {
  const db = createAdminClient();
  const { data: row } = await db
    .from("orders")
    .select("token, status")
    .eq("chip_purchase_id", chipPurchaseId)
    .maybeSingle();
  if (!row || row.status !== "awaiting_payment") return null;

  const { error } = await db
    .from("orders")
    .update({ status: "pending" })
    .eq("chip_purchase_id", chipPurchaseId)
    .eq("status", "awaiting_payment"); // guard against a concurrent double-webhook
  if (error) return null;
  return getOrderByToken(row.token);
}
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npx eslint lib/orders/store.ts`
Expected: EXIT 0, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add lib/orders/store.ts types/order.ts
git commit -m "feat(payments): persist CHIP fields, mark-paid, hide unpaid orders from staff board"
```

---

### Task 7: Payment settings — CHIP fee fields

**Files:**
- Modify: `lib/settings/payments.ts` (type ~14-22; defaults ~27-42; Row ~44-63; COLUMNS ~65-69; map ~71-98)

**Interfaces:**
- Produces: `PaymentSettings.chip: { enabled: boolean; feeFlat: number; feePercent: number }` (feeFlat in sen, feePercent in basis points).

- [ ] **Step 1: Extend the `PaymentSettings` type**

In `lib/settings/payments.ts`, add to the `PaymentSettings` type (after `payLaterEnabled`):

```ts
  // CHIP payment-gateway config. enabled routes DuitNow QR through CHIP;
  // feeFlat (sen) + feePercent (basis points, 150 = 1.50%) size the fee added
  // on top of the order total on the CHIP path.
  chip: { enabled: boolean; feeFlat: number; feePercent: number };
```

- [ ] **Step 2: Extend `DEFAULT_PAYMENT_SETTINGS`**

Add (after `payLaterEnabled: false,`):

```ts
  // CHIP defaults OFF — unlike the fail-open method toggles, the gateway must be
  // explicitly enabled by an admin.
  chip: { enabled: false, feeFlat: 0, feePercent: 0 },
```

- [ ] **Step 3: Extend the `Row` type + `COLUMNS`**

Add to the `Row` type:

```ts
  chip_enabled: boolean;
  chip_fee_flat: number;
  chip_fee_percent: number;
```

Extend `COLUMNS` (append to the string):

```ts
const COLUMNS =
  "cash_enabled, qr_enabled, card_enabled, ewallet_enabled, bank_enabled, " +
  "cash_method_enabled, duitnow_qr_enabled, apple_pay_enabled, google_pay_enabled, " +
  "tng_ewallet_enabled, boost_enabled, grabpay_enabled, bank_transfer_enabled, " +
  "bank_name, bank_account_number, bank_account_holder, duitnow_qr_url, pay_later_enabled, " +
  "chip_enabled, chip_fee_flat, chip_fee_percent";
```

- [ ] **Step 4: Map the columns**

In `map()`, add (after `payLaterEnabled: row.pay_later_enabled,`):

```ts
    chip: {
      enabled: row.chip_enabled,
      feeFlat: row.chip_fee_flat,
      feePercent: row.chip_fee_percent,
    },
```

- [ ] **Step 5: Verify build + lint**

Run: `npm run build && npx eslint lib/settings/payments.ts`
Expected: EXIT 0, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add lib/settings/payments.ts
git commit -m "feat(payments): CHIP fee fields in payment settings"
```

---

### Task 8: Checkout action — CHIP path + deferred settle helper

**Files:**
- Modify: `app/(customer)/checkout/actions.ts`

**Background:** Today `placeOrder` creates the order, redeems the voucher, calls `applyOrderRewards`, and fires Telegram — all synchronously with rollback-on-failure. For CHIP, the order isn't real until paid, so this settle work moves to the webhook. This task (a) extracts the post-payment work into a reusable `settlePaidOrder(token)` helper, (b) adds the CHIP branch to `placeOrder` that creates an `awaiting_payment` order + CHIP purchase and returns a redirect target, leaving cash/manual behaviour unchanged.

**Interfaces:**
- Consumes: `createPurchase` (Task 3); `computeGatewayFee` (Task 2); `getPaymentSettings` (Task 7); `createOrder` with status/pendingVoucherId (Task 6); existing `redeemVoucher`, `applyOrderRewards`, `getOrderByToken`, `cancelOrderAsSystem`, `buildOrderMessage`, `sendTelegramMessage`, `isLocalUrl`.
- Produces:
  - `settlePaidOrder(token: string): Promise<void>` — runs voucher redeem + `applyOrderRewards` + Telegram for an already-created (paid) order. Exported for the webhook. Best-effort: logs (does NOT throw/rollback) on failure because money is already captured.
  - `PlaceOrderResult` gains a `{ ok: true; redirectTo: string }` variant for the CHIP path.

- [ ] **Step 1: Extract `settlePaidOrder`**

Add this exported helper in `app/(customer)/checkout/actions.ts`. It reads the order to find its `pending_voucher_id`, redeems it, applies rewards, and notifies. Safe to call once per order after payment:

```ts
// Post-payment settlement, reused by the CHIP webhook after purchase.paid. The
// order already exists and is paid, so a reward/voucher failure here is LOGGED,
// not rolled back — the drink is paid for; unsettled rewards are a staff concern,
// never a customer error. Telegram is best-effort as before.
export async function settlePaidOrder(token: string): Promise<void> {
  const order = await getOrderByToken(token);
  if (!order) {
    console.error(`settlePaidOrder: order ${token} not found`);
    return;
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("orders")
    .select("pending_voucher_id")
    .eq("token", token)
    .maybeSingle();
  const voucherId = row?.pending_voucher_id as string | null | undefined;

  let voucherLabel: string | undefined;
  if (voucherId) {
    const redeemed = await redeemVoucher(voucherId, token);
    if (!redeemed.ok) {
      console.error(`settlePaidOrder: voucher ${voucherId} redeem failed for paid order ${order.orderNumber}`);
    } else {
      const { data: v } = await admin
        .from("vouchers")
        .select("type, discount_amount")
        .eq("id", voucherId)
        .maybeSingle();
      if (v) voucherLabel = v.type === "free_drink" ? "Free Drink" : `RM${(v.discount_amount / 100).toFixed(0)} Off`;
    }
  }

  const applied = await applyOrderRewards(token);
  if (!applied.ok) {
    console.error(`settlePaidOrder: rewards failed for paid order ${order.orderNumber}`);
  }

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const manageUrl = `${baseUrl}/manage/${order.token}`;
  const canUseButton = /^https:\/\//i.test(manageUrl) && !isLocalUrl(manageUrl);
  try {
    await sendTelegramMessage(
      buildOrderMessage({ ...order, voucherLabel }, manageUrl, !canUseButton),
      canUseButton ? { buttons: [[{ text: "📋 Manage Order", url: manageUrl }]] } : {},
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.error(`Order ${order.orderNumber} paid but Telegram notice failed: ${reason}`);
  }
}
```

Add imports at the top as needed: `createAdminClient` from `@/lib/supabase/admin`, `getOrderByToken` from `@/lib/orders/store` (both may already be partially imported — merge, don't duplicate).

- [ ] **Step 2: Add the CHIP result variant**

Change `PlaceOrderResult`:

```ts
export type PlaceOrderResult =
  | { ok: true; orderNumber: string; rewards?: OrderRewardsResult; voucherDiscount?: number }
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };
```

- [ ] **Step 3: Branch `placeOrder` for the CHIP QR method**

Inside `placeOrder`, AFTER `discountedTotal` is computed but BEFORE the existing `createOrder`/rewards block, insert the CHIP branch. It only triggers when the method is `duitnow-qr` AND CHIP is enabled:

```ts
  // CHIP gateway path: DuitNow QR routed through CHIP. Create the order as
  // awaiting_payment (hidden from staff), create the CHIP purchase, and hand the
  // customer to the review screen. Rewards/Telegram are deferred to the webhook —
  // the order isn't real until paid.
  const paymentSettings = await getPaymentSettings();
  if (input.paymentMethod === "duitnow-qr" && paymentSettings.chip.enabled) {
    const fee = computeGatewayFee(
      discountedTotal,
      paymentSettings.chip.feeFlat,
      paymentSettings.chip.feePercent,
    );

    let pendingOrder;
    try {
      pendingOrder = await createOrder(
        {
          ownerId: userId,
          paymentMethod: "duitnow-qr",
          items: lines,
          subtotal,
          total: discountedTotal,
          notes: input.notes?.trim() || undefined,
          contactPhone,
          gatewayFee: fee,
        },
        { userId, status: "awaiting_payment", pendingVoucherId: voucherToRedeem ?? undefined },
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      return { ok: false, error: `Couldn't start payment: ${reason}` };
    }

    // Itemised CHIP products: one line per drink, plus a fee line.
    const email = user.email ?? `${userId}@no-email.naise`;
    const products = lines.map((l) => ({
      name: [l.name, l.sizeName, ...(l.addonNames ?? [])].filter(Boolean).join(" · "),
      price: l.unitPrice,
      quantity: l.quantity,
    }));
    if (fee > 0) products.push({ name: "Payment gateway fee", price: fee, quantity: 1 });

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    let purchase;
    try {
      purchase = await createPurchase({
        email,
        fullName: undefined,
        products,
        reference: pendingOrder.orderNumber,
        successCallback: `${baseUrl}/api/payments/chip/webhook`,
        successRedirect: `${baseUrl}/profile/orders/${pendingOrder.token}`,
        failureRedirect: `${baseUrl}/profile/orders/${pendingOrder.token}`,
        cancelRedirect: `${baseUrl}/checkout/pay/${pendingOrder.token}`,
      });
    } catch (err) {
      await cancelOrderAsSystem(pendingOrder.token);
      const reason = err instanceof Error ? err.message : "Unknown error";
      return { ok: false, error: `Couldn't start payment: ${reason}` };
    }

    await createAdminClient()
      .from("orders")
      .update({ chip_purchase_id: purchase.id })
      .eq("token", pendingOrder.token);

    return { ok: true, redirectTo: `/checkout/pay/${pendingOrder.token}` };
  }
```

Add imports: `getPaymentSettings` from `@/lib/settings/payments`, `computeGatewayFee` from `@/lib/payments/chip/fee`, `createPurchase` from `@/lib/payments/chip/client`.

> The non-CHIP path below is unchanged — it still creates the order as `pending` and settles rewards inline. Do not refactor it in this task, to minimise risk.

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npx eslint "app/(customer)/checkout/actions.ts"`
Expected: EXIT 0, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(customer)/checkout/actions.ts"
git commit -m "feat(payments): CHIP checkout path + deferred settle helper"
```

---

### Task 9: CHIP webhook route

**Files:**
- Create: `app/api/payments/chip/webhook/route.ts`

**Interfaces:**
- Consumes: `verifyChipSignature` (Task 4); `markOrderPaid` (Task 6); `settlePaidOrder` (Task 8).
- Produces: `POST` handler that always returns HTTP 200, verifies the signature, and on `purchase.paid` flips the order to paid + settles rewards, idempotently.

- [ ] **Step 1: Write `app/api/payments/chip/webhook/route.ts`**

```ts
import { NextResponse } from "next/server";
import { verifyChipSignature } from "@/lib/payments/chip/signature";
import { markOrderPaid } from "@/lib/orders/store";
import { settlePaidOrder } from "@/app/(customer)/checkout/actions";

// node:crypto (signature verify) needs the Node.js runtime, not Edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CHIP success_callback / webhook. ALWAYS returns 200 — CHIP retries any non-200
// (up to 8 times over ~36h) and may deliver duplicates, so processing must be
// idempotent and a rejected/duplicate delivery must still 200 to stop retries.
export async function POST(req: Request) {
  // Read the RAW body first — signature is over the exact bytes; parsing JSON
  // then reserializing would break verification.
  const rawBody = await req.text();
  const signature = req.headers.get("X-Signature");

  if (!verifyChipSignature(rawBody, signature)) {
    // Unverified — do not process, but 200 so CHIP doesn't hammer retries.
    console.error("CHIP webhook: signature verification failed");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  let payload: { event_type?: string; id?: string; status?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("CHIP webhook: unparseable body");
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // The callback payload is a Purchase snapshot; the paid event carries
  // status "paid". event_type may be "purchase.paid" for webhooks. Accept either
  // signal. `id` is the CHIP purchase id.
  const isPaid = payload.status === "paid" || payload.event_type === "purchase.paid";
  const chipId = payload.id;
  if (!isPaid || !chipId) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Idempotency lives in markOrderPaid: it only flips awaiting_payment → pending
  // and returns null if the order is missing or already advanced. So a duplicate
  // delivery finds nothing to do and we skip settlement.
  const order = await markOrderPaid(chipId);
  if (!order) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Order is freshly paid — settle rewards + notify staff (best-effort).
  try {
    await settlePaidOrder(order.token);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.error(`CHIP webhook: settle failed for ${order.orderNumber}: ${reason}`);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
```

- [ ] **Step 2: Verify build + lint**

Run: `npm run build && npx eslint "app/api/payments/chip/webhook/route.ts"`
Expected: EXIT 0, no lint errors.

- [ ] **Step 3: Register the webhook URL in CHIP (manual, test mode)**

In the CHIP Merchant Portal → Developers → Webhooks (test mode), add the public webhook URL `<SITE_URL>/api/payments/chip/webhook` for the `purchase.paid` event. For local dev, expose via a tunnel or rely on the review-screen `retrievePurchase` reconciliation (Task 11).

- [ ] **Step 4: Commit**

```bash
git add "app/api/payments/chip/webhook/route.ts"
git commit -m "feat(payments): CHIP paid webhook flips order + settles rewards"
```

---

### Task 10: Payment Review screen + cancel action

**Files:**
- Create: `app/(customer)/checkout/pay/[token]/page.tsx`
- Create: `app/(customer)/checkout/pay/[token]/actions.ts`
- Create: `components/payment-review.tsx`

**Interfaces:**
- Consumes: `getOrderByToken` (store); `getOwnerIdFromCookie`, `createClient` (ownership check, mirroring `profile/orders/[token]/page.tsx`); `retrievePurchase`, `duitnowQrCheckoutUrl` (Task 3); `cancelOrderAsSystem` (store).
- Produces:
  - `cancelPendingPayment(token: string): Promise<{ ok: true } | { ok: false; error: string }>` — cancels an `awaiting_payment` order the caller owns.
  - Review screen showing txn no, order no, date, description, amount, gateway fee, total, and Pay now / Cancel.

- [ ] **Step 1: Write the cancel action**

`app/(customer)/checkout/pay/[token]/actions.ts`:

```ts
"use server";

import { getOrderByToken, cancelOrderAsSystem } from "@/lib/orders/store";
import { getOwnerIdFromCookie } from "@/lib/auth/owner-id-server";
import { createClient } from "@/lib/supabase/server";

// Cancel an awaiting_payment order the caller owns (Cancel on the review screen).
// Ownership mirrors the customer order detail page: match user_id or owner_id.
export async function cancelPendingPayment(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const order = await getOrderByToken(token);
  if (!order) return { ok: false, error: "Order not found." };
  if (order.status !== "awaiting_payment") {
    return { ok: false, error: "This order can no longer be cancelled." };
  }

  const ownerId = await getOwnerIdFromCookie();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const owned =
    (user?.id != null && order.userId === user.id) ||
    (ownerId != null && order.ownerId === ownerId);
  if (!owned) return { ok: false, error: "Not authorized." };

  await cancelOrderAsSystem(token);
  return { ok: true };
}
```

- [ ] **Step 2: Write the review screen page**

`app/(customer)/checkout/pay/[token]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getOrderByToken } from "@/lib/orders/store";
import { getOwnerIdFromCookie } from "@/lib/auth/owner-id-server";
import { createClient } from "@/lib/supabase/server";
import { retrievePurchase, duitnowQrCheckoutUrl } from "@/lib/payments/chip/client";
import { PaymentReview } from "@/components/payment-review";

export const metadata: Metadata = { title: "Confirm Payment" };

export default async function PayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = await getOrderByToken(token);

  // Ownership gate (defense-in-depth on top of the unguessable token).
  let owned = false;
  if (order) {
    const ownerId = await getOwnerIdFromCookie();
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    owned =
      (user?.id != null && order.userId === user.id) ||
      (ownerId != null && order.ownerId === ownerId);
  }

  // Not found / not owned → back to checkout.
  if (!order || !owned) redirect("/checkout");
  // Already resolved → send to the order status page (paid) or checkout.
  if (order.status !== "awaiting_payment") {
    redirect(`/profile/orders/${order.token}`);
  }

  // Resolve the CHIP checkout URL (QR-only). retrievePurchase gives us the
  // current checkout_url; append the DuitNow QR direct-post param.
  let payUrl = "";
  if (order.chipPurchaseId) {
    try {
      const purchase = await retrievePurchase(order.chipPurchaseId);
      payUrl = duitnowQrCheckoutUrl(purchase.checkout_url);
    } catch {
      payUrl = "";
    }
  }

  const fee = order.gatewayFee ?? 0;
  return (
    <PaymentReview
      token={order.token}
      transactionNo={order.chipPurchaseId ?? ""}
      orderNumber={order.orderNumber}
      createdAt={order.createdAt}
      amount={order.total}
      fee={fee}
      total={order.total + fee}
      payUrl={payUrl}
    />
  );
}
```

- [ ] **Step 3: Write the review component**

`components/payment-review.tsx`. Follow the app's Tailwind conventions (rounded cards, tabular-nums for money, amber CTA like the shift hero). Money helper: `(sen / 100).toFixed(2)`.

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelPendingPayment } from "@/app/(customer)/checkout/pay/[token]/actions";

function rm(sen: number): string {
  return `RM${(sen / 100).toFixed(2)}`;
}

export function PaymentReview({
  token,
  transactionNo,
  orderNumber,
  createdAt,
  amount,
  fee,
  total,
  payUrl,
}: {
  token: string;
  transactionNo: string;
  orderNumber: string;
  createdAt: string;
  amount: number;
  fee: number;
  total: number;
  payUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onPay() {
    if (!payUrl) {
      setError("Payment link unavailable. Please try again.");
      return;
    }
    // Full navigation to CHIP's hosted DuitNow QR page.
    window.location.href = payUrl;
  }

  function onCancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelPendingPayment(token);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.replace("/checkout");
    });
  }

  const shortTxn = transactionNo ? transactionNo.slice(0, 8).toUpperCase() : "—";
  const date = new Date(createdAt).toLocaleString("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <main className="flex flex-1 flex-col px-5 py-6">
      <header className="mb-4">
        <p className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
          Confirm Payment
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight">
          Review your transaction
        </h1>
      </header>

      <section className="rounded-2xl border border-border bg-card p-5">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Transaction No.</dt>
            <dd className="font-medium tabular-nums">{shortTxn}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Bill No.</dt>
            <dd className="font-medium">{orderNumber}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Date</dt>
            <dd className="font-medium">{date}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Description</dt>
            <dd className="font-medium">NAISE COFFEE order</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Payment method</dt>
            <dd className="font-medium">DuitNow QR</dd>
          </div>
        </dl>

        <div className="my-4 h-px bg-border" />

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="tabular-nums">{rm(amount)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Payment gateway fee</dt>
            <dd className="tabular-nums">{rm(fee)}</dd>
          </div>
          <div className="flex justify-between pt-1 text-base font-bold">
            <dt>Total to pay</dt>
            <dd className="tabular-nums">{rm(total)}</dd>
          </div>
        </dl>
      </section>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={onPay}
          disabled={pending}
          className="w-full rounded-xl bg-amber-500 py-3.5 font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
        >
          Proceed to pay
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="w-full rounded-xl border border-border py-3.5 font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {pending ? "Cancelling…" : "Cancel"}
        </button>
      </div>
    </main>
  );
}
```

> Match the exact card/border/color tokens the rest of the app uses if these differ (e.g. `bg-card` vs `bg-background`); the structure and copy are the requirement, the token names should follow the codebase.

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npx eslint "app/(customer)/checkout/pay/[token]/page.tsx" "app/(customer)/checkout/pay/[token]/actions.ts" components/payment-review.tsx`
Expected: EXIT 0, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(customer)/checkout/pay" components/payment-review.tsx
git commit -m "feat(payments): payment review screen + cancel action"
```

---

### Task 11: Checkout screen — CHIP QR UX + redirect

**Files:**
- Modify: `components/checkout-screen.tsx` (method block ~449-451 QR card; ~513-533 receipt upload; ~186-265 `placeOrder`; the place CTA)
- Modify: `app/(customer)/checkout/page.tsx` (pass CHIP-enabled flag)

**Background:** When CHIP is enabled and the customer picks DuitNow QR, the screen must NOT show the static QR card or the receipt upload, the CTA should read like a payment hand-off, and on submit it must redirect to the review screen instead of showing the "order confirmed" state.

**Interfaces:**
- Consumes: `placeOrderAction` now returns a `{ ok: true; redirectTo }` variant (Task 8); `PaymentSettings.chip.enabled` (Task 7).
- Produces: checkout screen conditionally hides QR/receipt UI and routes to `redirectTo`.

- [ ] **Step 1: Pass the CHIP-enabled flag into the screen**

In `app/(customer)/checkout/page.tsx`, pass `chipEnabled={payments.chip.enabled}` to `<CheckoutScreen ... />`.

In `components/checkout-screen.tsx`, add `chipEnabled: boolean;` to the props type and destructure it.

- [ ] **Step 2: Compute whether the CHIP path is active for the current method**

In `checkout-screen.tsx`, near `selectedMethod` (~131):

```ts
  // True when the selected method will be collected via the CHIP gateway (only
  // DuitNow QR this phase). Drives hiding the manual QR + receipt UI and the
  // redirect-to-review submit behaviour.
  const isChipPath = chipEnabled && selected === "duitnow-qr";
```

- [ ] **Step 3: Hide the static QR card on the CHIP path**

Change the QR block (~449):

```tsx
        {selected === "duitnow-qr" && !isChipPath && (
          <DuitnowQrCard src={duitnowQrUrl ?? undefined} />
        )}
```

- [ ] **Step 4: Hide the receipt upload on the CHIP path**

Change the receipt block guard (~513):

```tsx
        {selectedMethod?.requiresReceipt && !isChipPath && (
```

And in `placeOrder`, skip the receipt requirement + upload on the CHIP path — change the guard (~203):

```ts
    if (method.requiresReceipt && !isChipPath && !receiptFile) {
      setError("Please attach your payment receipt.");
      return;
    }
```

and the upload (~216):

```ts
      if (method.requiresReceipt && !isChipPath && receiptFile) {
        proofOfPaymentPath = await uploadReceipt(receiptFile, ownerId);
      }
```

- [ ] **Step 5: Handle the redirect result**

In `placeOrder`, after `const result = await placeOrderAction({...})` and the `!result.ok` check, handle the CHIP redirect variant BEFORE the existing "order confirmed" logic:

```ts
      if (!result.ok) {
        setError(result.error);
        return;
      }

      // CHIP path: go to the payment review screen instead of confirming.
      if ("redirectTo" in result) {
        clear();
        router.push(result.redirectTo);
        return;
      }
```

Ensure `useRouter` is imported and `const router = useRouter();` exists (add if not). `clear()` empties the cart (already used below).

- [ ] **Step 6: Change the CTA label on the CHIP path**

Where the place button label is rendered, show payment-handoff copy on the CHIP path. Find the submit button text and make it conditional:

```tsx
{isChipPath ? "Continue to payment" : "Place order"}
```

(Match the exact existing label variable/text; only add the `isChipPath` branch.)

- [ ] **Step 7: Verify build + lint**

Run: `npm run build && npx eslint components/checkout-screen.tsx "app/(customer)/checkout/page.tsx"`
Expected: EXIT 0, no lint errors.

- [ ] **Step 8: Commit**

```bash
git add components/checkout-screen.tsx "app/(customer)/checkout/page.tsx"
git commit -m "feat(payments): checkout QR UX routes to CHIP review screen"
```

---

### Task 12: Order status — "confirming payment" + webhook reconciliation

**Files:**
- Modify: `app/(customer)/profile/orders/[token]/page.tsx`
- Modify: `components/customer-order-live.tsx` (or wherever the tracker renders) — add an `awaiting_payment` state

**Background:** After paying on CHIP, the customer is redirected to their order page. The webhook may lag, so the page must (a) show a "confirming payment…" state while `awaiting_payment`, and (b) reconcile by calling `retrievePurchase` server-side on load, flipping the order if CHIP already says paid.

**Interfaces:**
- Consumes: `retrievePurchase` (Task 3); `markOrderPaid` (Task 6); `settlePaidOrder` (Task 8).
- Produces: reconciliation on the order detail page; a visible awaiting-payment state.

- [ ] **Step 1: Reconcile on load**

In `app/(customer)/profile/orders/[token]/page.tsx`, after fetching `order` and confirming ownership, if the order is `awaiting_payment` and has a `chipPurchaseId`, reconcile with CHIP before rendering:

```ts
  // Belt-and-braces: the webhook is the source of truth but can lag. If CHIP
  // already reports paid, flip + settle here so the customer sees confirmation
  // without waiting on the webhook. Safe against the webhook via markOrderPaid's
  // awaiting_payment guard (whichever runs first wins; the other no-ops).
  if (order.status === "awaiting_payment" && order.chipPurchaseId) {
    try {
      const purchase = await retrievePurchase(order.chipPurchaseId);
      if (purchase.status === "paid") {
        const paid = await markOrderPaid(order.chipPurchaseId);
        if (paid) {
          await settlePaidOrder(paid.token);
          order = paid;
        }
      }
    } catch {
      // Ignore — fall through to the awaiting_payment UI; webhook will settle.
    }
  }
```

(`order` must be a `let`; adjust the declaration. Import `retrievePurchase`, `markOrderPaid`, `settlePaidOrder`.)

- [ ] **Step 2: Render the awaiting-payment state**

Where the tracker/status renders, add a branch for `awaiting_payment` showing "Waiting for payment confirmation…" with a link back to `/checkout/pay/[token]` to resume paying. Reuse `statusDisplay.awaiting_payment` (label "Awaiting Payment", yellow) for the pill. Keep it simple — a centered message + resume button.

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npx eslint "app/(customer)/profile/orders/[token]/page.tsx" components/customer-order-live.tsx`
Expected: EXIT 0, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(customer)/profile/orders/[token]/page.tsx" components/customer-order-live.tsx
git commit -m "feat(payments): confirming-payment state + CHIP reconciliation on order page"
```

---

### Task 13: Admin settings — CHIP fee UI

**Files:**
- Modify: `app/(admin)/admin/settings/actions.ts` (`updatePaymentSettings` ~46-91)
- Modify: `app/(admin)/admin/settings/page.tsx` and the payment-settings form component (find via the `PaymentSettings` prop) — add a CHIP section

**Interfaces:**
- Consumes: `PaymentSettings.chip` (Task 7).
- Produces: admin can toggle `chip.enabled` and set flat fee (RM input → sen) + percent (% input → basis points), persisted to `payment_settings`.

- [ ] **Step 1: Persist CHIP fields in `updatePaymentSettings`**

In `app/(admin)/admin/settings/actions.ts`, add validation + persist inside `updatePaymentSettings`. Before the update, validate the fee inputs are non-negative integers:

```ts
  if (input.chip.feeFlat < 0 || !Number.isInteger(input.chip.feeFlat)) {
    return { ok: false, error: "Flat fee must be a whole number of sen." };
  }
  if (
    input.chip.feePercent < 0 ||
    input.chip.feePercent > 10000 ||
    !Number.isInteger(input.chip.feePercent)
  ) {
    return { ok: false, error: "Percentage fee must be between 0 and 100%." };
  }
```

Add to the `.update({...})` object:

```ts
      chip_enabled: input.chip.enabled,
      chip_fee_flat: input.chip.feeFlat,
      chip_fee_percent: input.chip.feePercent,
```

- [ ] **Step 2: Add the CHIP section to the settings form**

In the payment-settings form component (client), add a section with:
- A toggle bound to `chip.enabled` ("Collect DuitNow QR via CHIP gateway").
- A money input for the flat fee: display RM (value `feeFlat / 100`), store sen (`Math.round(rm * 100)`).
- A percentage input: display % (value `feePercent / 100`), store basis points (`Math.round(pct * 100)`).

Follow the existing toggle/input patterns in that form (e.g. how `payLaterEnabled` and the bank fields are rendered). Include a short helper line: "Fee is added on top of the order total and shown to the customer before they pay."

- [ ] **Step 3: Verify build + lint**

Run: `npm run build && npx eslint "app/(admin)/admin/settings/actions.ts" "app/(admin)/admin/settings/page.tsx"`
Expected: EXIT 0, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/settings"
git commit -m "feat(payments): admin CHIP gateway toggle + fee settings"
```

---

### Task 14: Auto-expire abandoned unpaid orders

**Files:**
- Create: `app/api/payments/chip/expire/route.ts`
- Create: `supabase/migrations/20260716130100_chip_expire_cron.sql`

**Background:** Abandoned `awaiting_payment` orders (customer bailed at CHIP) must be cleaned up. A cron-only route cancels those older than 45 minutes, scheduled by pg_cron → the App Service route (per the deployment pattern, mirroring the shift-reminder cron).

**Interfaces:**
- Consumes: `createAdminClient`.
- Produces: `POST` route that cancels stale `awaiting_payment` orders; pg_cron schedule that calls it.

- [ ] **Step 1: Write the expire route**

`app/api/payments/chip/expire/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const EXPIRE_AFTER_MS = 45 * 60_000; // 45 minutes

// Cron-only (Supabase pg_cron). Cancels awaiting_payment orders older than the
// window — the customer never completed the CHIP payment. Secret-gated like the
// shift reminder route so only the scheduler can call it.
export async function POST(req: Request) {
  const secret = process.env.CHIP_CRON_SECRET;
  if (!secret || req.headers.get("x-chip-cron-secret") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - EXPIRE_AFTER_MS).toISOString();
  const db = createAdminClient();
  const { data, error } = await db
    .from("orders")
    .update({ status: "cancelled" })
    .eq("status", "awaiting_payment")
    .lt("created_at", cutoff)
    .select("id");
  if (error) {
    console.error(`CHIP expire failed: ${error.message}`);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true, expired: data?.length ?? 0 });
}
```

- [ ] **Step 2: Write the pg_cron migration**

`supabase/migrations/20260716130100_chip_expire_cron.sql`. Mirror the shift-reminder cron migration (`20260716120300_shift_reminder_cron.sql`) — read that file first for the exact `cron.schedule` + `net.http_post` pattern, the app URL setting, and the secret header. Schedule every 15 minutes:

```sql
-- Auto-expire abandoned CHIP payment attempts. Every 15 min, pg_cron POSTs the
-- App Service expire route, which cancels awaiting_payment orders older than
-- 45 min. Follows the same net.http_post + secret-header pattern as the shift
-- reminder cron (see 20260716120300_shift_reminder_cron.sql).

select cron.schedule(
  'chip-expire-abandoned',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.site_url') || '/api/payments/chip/expire',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-chip-cron-secret', current_setting('app.settings.chip_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

> Adjust `current_setting(...)` keys to match whatever the shift-reminder migration actually uses for the site URL and secret (read that file — do not assume). Add `CHIP_CRON_SECRET` to `.env.example` and the Supabase DB settings alongside the existing `SHIFT_CRON_SECRET`.

- [ ] **Step 3: Apply migration + document secret**

Apply the migration. Add to `.env.example`:

```
# Shared secret guarding the CHIP auto-expire cron route (matches the pg_cron header).
CHIP_CRON_SECRET=
```

- [ ] **Step 4: Verify build + lint**

Run: `npm run build && npx eslint "app/api/payments/chip/expire/route.ts"`
Expected: EXIT 0, no lint errors.

- [ ] **Step 5: Commit**

```bash
git add "app/api/payments/chip/expire/route.ts" supabase/migrations/20260716130100_chip_expire_cron.sql .env.example
git commit -m "feat(payments): auto-expire abandoned CHIP payment attempts"
```

---

### Task 15: End-to-end sandbox verification

**Files:** none (verification only)

**Background:** Confirm the whole flow in CHIP test mode before considering the feature done. No JS test framework exists (by design) — this is manual verification against the sandbox.

- [ ] **Step 1: Enable CHIP in admin**

With test credentials in the env (`chip.env` / deploy env), open Admin → Settings → set the CHIP toggle ON, flat fee RM0.50, percent 1.00%. Save. Confirm the row persisted (`payment_settings.chip_enabled = true`).

- [ ] **Step 2: Place a QR order as a customer**

Menu → add a drink → checkout → pick DuitNow QR. Confirm: no static QR card, no receipt upload, CTA reads "Continue to payment". Submit.
Expected: redirected to `/checkout/pay/<token>`; review screen shows txn no, bill no, amount, RM0.50 + 1% fee, correct total.

- [ ] **Step 3: Pay in sandbox**

Click "Proceed to pay" → lands on CHIP's DuitNow QR test page. Complete the sandbox payment.
Expected: redirected back to the order page showing the normal tracker (not awaiting-payment), because the webhook (or the reconciliation on load) flipped it to `pending`.

- [ ] **Step 4: Confirm staff side**

On the manage board: the order appears only AFTER payment (never during awaiting_payment), Telegram "NEW ORDER!" fired once, and any voucher/Beans settled.

- [ ] **Step 5: Verify idempotency + duplicate webhook**

Re-trigger the webhook delivery from the CHIP portal (or re-POST the same payload). Expected: no duplicate Telegram, no double reward settlement, order stays `pending`.

- [ ] **Step 6: Verify cancel + abandon**

Place another QR order → on the review screen click Cancel → order becomes `cancelled`, back to checkout. Place another, close the tab at CHIP, wait for (or manually POST) the expire route → order flips to `cancelled`.

- [ ] **Step 7: Verify manual QR still works when CHIP is OFF**

Toggle CHIP OFF in admin. Place a QR order.
Expected: the old manual flow returns — static QR card + receipt upload + inline "order confirmed", no redirect. (Confirms the feature is cleanly gated.)

- [ ] **Step 8: Final build gate**

Run: `npm run build`
Expected: EXIT 0.

- [ ] **Step 9: Delete any throwaway scripts**

Remove the Task 3 smoke script if it still exists. Confirm `git status` is clean apart from intended changes.

---

## Self-Review Notes / Verify During Implementation

1. **RLS insert of `awaiting_payment` (verify in Task 8):** The CHIP path calls
   `createOrder` with the member cookie client and `status: "awaiting_payment"`.
   Before relying on it, check the `orders` INSERT policy (in the ordering-system
   migration) has no `WITH CHECK` that constrains `status` to `pending`. If it
   does, either relax it to allow `awaiting_payment` for the owner, or insert the
   CHIP pending order via the service-role admin client (like the kiosk path).
   Confirm with a real member insert during Task 8's build step.

2. **RLS read of own `awaiting_payment` order (already verified):** The customer
   detail page uses `getOrderByToken` (service-role) + an ownership check on
   `user_id`/`owner_id`, and is status-agnostic — so the review + status screens
   see the unpaid order with no new policy. No change needed.

3. **`payment_method_whitelist` value:** The client uses `duitnow_qr`. If CHIP's
   hosted page doesn't route correctly in test mode, the reference doc notes
   `dnqr` as the migration-fallback — try it before assuming a bug.

4. **Fee itemisation total:** CHIP computes `purchase.total` from products, so the
   fee must be a real product line (it is, in Task 8). Confirm in Task 15 Step 2
   that CHIP's displayed total equals amount + fee.

5. **Node runtime for the webhook (Task 9):** `node:crypto` requires
   `runtime = "nodejs"` — set in the route. Do not let it default to Edge.

6. **Voucher-unhonourable-at-webhook stance (locked):** settle-what's-possible +
   log, no auto-refund (Task 8 `settlePaidOrder`). Money is already captured; an
   unsettled reward is a staff concern, never a customer error.
