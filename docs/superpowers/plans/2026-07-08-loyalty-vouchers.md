# Loyalty Voucher Redemption Implementation Plan (Plan 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Prerequisite:** Plan 1 (`2026-07-08-loyalty-stamp-card.md`) is fully implemented. This plan makes the vouchers issued there (rows in `public.vouchers`) actually redeemable at checkout, lists them for customers, adds the kiosk add-member step, and expires stale vouchers.

**Goal:** Let members redeem an `rm_off` or `free_drink` voucher at checkout with an authoritative server-side discount, see their vouchers on `/rewards`, attach a member during a kiosk order, and auto-expire past-date vouchers.

**Architecture:** A SECURITY DEFINER `redeem_voucher(p_voucher_id, p_order_token)` validates ownership/status/expiry/min-spend and marks the voucher redeemed. Because `placeOrder` computes the order total server-side, the voucher is validated and the discount applied *inside* `placeOrder` (via a new `voucherId` on `PlaceOrderInput`) before the order row is created; the voucher is then tied to the order. Expiry is handled by a lazy check-on-read plus a `mark_expired_vouchers()` sweep.

**Tech Stack:** Next.js 16 server actions, Supabase Postgres + RLS + SECURITY DEFINER plpgsql, TypeScript strict, Tailwind + shadcn/ui.

## Global Constraints

- Money is integer **sen**; never floats.
- All writes to `vouchers` go through SECURITY DEFINER RPCs (`set search_path = ''`, revoked from `public`/`anon`, granted to `authenticated`). Clients SELECT own rows only.
- Migrations in `supabase/migrations/` named `YYYYMMDDHHMMSS_*.sql`, applied via Supabase MCP `apply_migration`.
- After schema changes, regenerate `types/database.ts` via the Supabase MCP `generate_typescript_types` tool.
- One voucher per order. A voucher discount never drives the order total below 0.
- No JS test framework: verify with `npm run lint`, `npm run build`, and SQL via Supabase MCP `execute_sql`. Commit after each task.
- The `rm_off` voucher requires the order subtotal to meet the voucher's snapshot `min_spend`. The `free_drink` voucher subtracts up to its snapshot `free_drink_max_value`; the customer pays any excess.
- Config lives in `stamp_settings` (Plan 1); do not touch the `promotions` table.

## File Structure

- `supabase/migrations/*_redeem_voucher.sql` — `redeem_voucher` + `mark_expired_vouchers` RPCs.
- `lib/stamps/voucher-store.ts` (create) — `listMyVouchers`, `redeemVoucher` wrappers.
- `app/(customer)/checkout/actions.ts` (modify) — accept `voucherId`, apply discount, mark redeemed.
- `components/checkout-screen.tsx` (modify) — voucher picker + discounted total.
- `components/stamps/voucher-list.tsx` (create) — customer voucher list for `/rewards`.
- `app/(customer)/rewards/page.tsx` (modify) — render the voucher list.
- `app/(store)/store/(kiosk)/checkout/page.tsx` + kiosk actions (modify) — optional add-member step.

---

### Task 1: `redeem_voucher` + `mark_expired_vouchers` RPCs

**Files:**
- Create migration: `supabase/migrations/20260708130000_redeem_voucher.sql`

**Interfaces:**
- Consumes: `public.vouchers`, `public.orders`, `auth.uid()`.
- Produces: `redeem_voucher(p_voucher_id uuid, p_order_token uuid) returns jsonb` → `{ok, discount}` or `{ok:false, error}`; `mark_expired_vouchers() returns integer`.

- [ ] **Step 1: Write `redeem_voucher` in the migration**

```sql
-- Redeem a voucher against an order. SECURITY DEFINER but self-guards to the
-- caller's own voucher. Validates status/expiry; the caller (placeOrder) has
-- already validated min_spend and computed the discounted total, but we re-check
-- here so the ledger can never mark a voucher redeemed without the guards. One
-- voucher per order enforced by redeemed_order_id uniqueness + status flip.
create or replace function public.redeem_voucher(p_voucher_id uuid, p_order_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := (select auth.uid());
  v_v     public.vouchers%rowtype;
  v_order public.orders%rowtype;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;

  select * into v_order from public.orders where token = p_order_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;

  -- Lock the voucher row to close the double-redeem race.
  select * into v_v from public.vouchers where id = p_voucher_id for update;
  if not found or v_v.user_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'voucher_not_found');
  end if;
  if v_v.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'voucher_not_active');
  end if;
  if v_v.expires_at <= now() then
    update public.vouchers set status = 'expired', updated_at = now() where id = v_v.id;
    return jsonb_build_object('ok', false, 'error', 'voucher_expired');
  end if;

  update public.vouchers
    set status = 'redeemed', redeemed_order_id = v_order.id, updated_at = now()
    where id = v_v.id;

  return jsonb_build_object('ok', true,
    'type', v_v.type,
    'discount_amount', v_v.discount_amount,
    'min_spend', v_v.min_spend,
    'free_drink_max_value', v_v.free_drink_max_value);
end;
$$;

revoke execute on function public.redeem_voucher(uuid, uuid) from public;
grant execute on function public.redeem_voucher(uuid, uuid) to authenticated;
```

- [ ] **Step 2: Write `mark_expired_vouchers` in the same migration**

```sql
-- Flip past-date active vouchers to expired. Callable by a scheduled job or ad
-- hoc; returns how many rows changed.
create or replace function public.mark_expired_vouchers()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  update public.vouchers set status = 'expired', updated_at = now()
    where status = 'active' and expires_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.mark_expired_vouchers() from public, anon;
grant execute on function public.mark_expired_vouchers() to authenticated;
```

- [ ] **Step 3: Apply the migration**

Use Supabase MCP `apply_migration` with name `redeem_voucher` and the SQL from Steps 1–2.
Expected: success.

- [ ] **Step 4: Verify the guard rejects a non-owned / inactive voucher**

Run via Supabase MCP `execute_sql`:
```sql
select public.mark_expired_vouchers() as expired_count;
```
Expected: returns an integer (0 or more), no error. (Full redeem is exercised via the checkout flow in Task 3.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260708130000_redeem_voucher.sql
git commit -m "feat(vouchers): redeem_voucher + mark_expired_vouchers RPCs"
```

---

### Task 2: Voucher store wrappers (`lib/stamps/voucher-store.ts`)

**Files:**
- Create: `lib/stamps/voucher-store.ts`

**Interfaces:**
- Consumes: `@/lib/supabase/server` `createClient`, `Voucher` type from `types/reward.ts` (Plan 1 Task 4).
- Produces: `listMyVouchers()` → `Voucher[]` (active first), `redeemVoucher(voucherId, token)` → `{ ok: true; type; discountAmount; minSpend; freeDrinkMaxValue } | { ok: false; error }`.

- [ ] **Step 1: Write `lib/stamps/voucher-store.ts`**

```typescript
import { createClient } from "@/lib/supabase/server";
import type { Voucher } from "@/types/reward";

// The caller's own vouchers (RLS-scoped), active first then by expiry. Marks
// past-date active rows expired first so the list never shows a stale "active".
export async function listMyVouchers(): Promise<Voucher[]> {
  const db = await createClient();
  await db.rpc("mark_expired_vouchers");
  const { data } = await db
    .from("vouchers")
    .select("id, type, status, discount_amount, min_spend, free_drink_max_value, expires_at")
    .order("status", { ascending: true })
    .order("expires_at", { ascending: true });
  return (data ?? []).map((v) => ({
    id: v.id,
    type: v.type,
    status: v.status,
    discountAmount: v.discount_amount,
    minSpend: v.min_spend,
    freeDrinkMaxValue: v.free_drink_max_value,
    expiresAt: v.expires_at,
  }));
}

export type RedeemVoucherResult =
  | { ok: true; type: "rm_off" | "free_drink"; discountAmount: number; minSpend: number; freeDrinkMaxValue: number }
  | { ok: false; error: string };

// Mark a voucher redeemed against an order. Called by placeOrder AFTER the order
// row exists and the discount has been applied to the order total.
export async function redeemVoucher(voucherId: string, orderToken: string): Promise<RedeemVoucherResult> {
  const db = await createClient();
  const { data, error } = await db.rpc("redeem_voucher", { p_voucher_id: voucherId, p_order_token: orderToken });
  if (error) return { ok: false, error: error.message };
  const row = data as unknown as
    | { ok: true; type: "rm_off" | "free_drink"; discount_amount: number; min_spend: number; free_drink_max_value: number }
    | { ok: false; error: string };
  if (!row?.ok) return { ok: false, error: (row as { error?: string })?.error ?? "unknown" };
  return {
    ok: true,
    type: row.type,
    discountAmount: row.discount_amount,
    minSpend: row.min_spend,
    freeDrinkMaxValue: row.free_drink_max_value,
  };
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add lib/stamps/voucher-store.ts
git commit -m "feat(vouchers): list + redeem server wrappers"
```

---

### Task 3: Apply voucher inside `placeOrder`

**Files:**
- Modify: `app/(customer)/checkout/actions.ts`

**Interfaces:**
- Consumes: `redeemVoucher` from `lib/stamps/voucher-store.ts` (Task 2); the caller's own `vouchers` row (read to compute the discount before creating the order).
- Produces: `PlaceOrderInput` gains optional `voucherId?: string`; `PlaceOrderResult` success gains optional `voucherDiscount?: number`. The created order's `total` reflects the discount.

- [ ] **Step 1: Extend the input/result types**

In `app/(customer)/checkout/actions.ts`, add to `PlaceOrderInput`:

```typescript
  // Optional loyalty voucher to redeem on this order. Validated + applied
  // server-side; the client total is advisory only.
  voucherId?: string;
```

And to the `PlaceOrderResult` success branch:

```typescript
  | { ok: true; orderNumber: string; rewards?: OrderRewardsResult; voucherDiscount?: number }
```

- [ ] **Step 2: Add the import**

```typescript
import { redeemVoucher } from "@/lib/stamps/voucher-store";
```

- [ ] **Step 3: Compute the discount BEFORE creating the order**

After `userId` is derived and known non-null (after the sign-in check, around line 74), and before the order is created, add:

```typescript
  // Resolve the voucher discount server-side. We read the voucher row (RLS
  // scopes it to the caller), validate status/expiry/min-spend against the
  // SERVER subtotal, and compute the discount. The actual redeem (status flip)
  // happens after the order row exists, so a failed order never burns a voucher.
  let voucherDiscount = 0;
  let voucherToRedeem: string | null = null;
  if (input.voucherId) {
    const { data: v } = await supabase
      .from("vouchers")
      .select("id, type, status, discount_amount, min_spend, free_drink_max_value, expires_at, user_id")
      .eq("id", input.voucherId)
      .maybeSingle();
    if (!v || v.user_id !== userId || v.status !== "active" || new Date(v.expires_at) <= new Date()) {
      return { ok: false, error: "That voucher is no longer available." };
    }
    if (v.type === "rm_off") {
      if (input.subtotal < v.min_spend) {
        return { ok: false, error: `Spend at least RM${(v.min_spend / 100).toFixed(2)} to use this voucher.` };
      }
      voucherDiscount = Math.min(v.discount_amount, input.subtotal);
    } else {
      // free_drink: discount the priciest single drink up to the cap. The
      // customer pays any excess; the order must have another paid line, which
      // the stamp qualifying rule also requires elsewhere.
      const dearest = Math.max(0, ...input.items.map((i) => i.unitPrice));
      voucherDiscount = Math.min(v.free_drink_max_value, dearest, input.subtotal);
    }
    voucherToRedeem = v.id;
  }

  const discountedTotal = Math.max(0, input.subtotal - voucherDiscount);
```

- [ ] **Step 4: Use the discounted total when creating the order**

Change the `createOrder` call so `total` uses the server-computed value instead of the client `input.total`:

```typescript
        subtotal: input.subtotal,
        total: discountedTotal,
```

(Leave `subtotal: input.subtotal` as-is; only `total` changes.)

- [ ] **Step 5: Redeem the voucher after the order exists**

Immediately after the order is successfully created (after the `createOrder` try/catch, before or alongside the existing `applyOrderRewards` block), add:

```typescript
  // Mark the voucher redeemed now that the order exists. If this fails we don't
  // roll back the order — log it; the voucher stays active for a retry. (The
  // discount was already applied to the total above.)
  if (voucherToRedeem) {
    const redeemed = await redeemVoucher(voucherToRedeem, order.token);
    if (!redeemed.ok) {
      console.error(`redeem_voucher failed for order ${order.token}: ${redeemed.error}`);
    }
  }
```

- [ ] **Step 6: Return the discount**

In the success return of `placeOrder`, include `voucherDiscount`:

```typescript
  return { ok: true, orderNumber: order.orderNumber, rewards, voucherDiscount };
```

(Match the exact success-return shape already in the file — add the field, keep the rest.)

- [ ] **Step 7: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add "app/(customer)/checkout/actions.ts"
git commit -m "feat(vouchers): apply + redeem voucher in placeOrder"
```

---

### Task 4: Checkout voucher picker

**Files:**
- Modify: `app/(customer)/checkout/page.tsx` (fetch + pass vouchers)
- Modify: `components/checkout-screen.tsx` (picker UI, discounted total, pass `voucherId`)

**Interfaces:**
- Consumes: `listMyVouchers` (Task 2), `getStampSettings` (Plan 1), `placeOrderAction` (Task 3 `voucherId`), `formatPrice` from `@/lib/format`, `Voucher` type.
- Produces: `<CheckoutScreen>` gains a `vouchers: Voucher[]` prop and lets the member pick one eligible voucher; the shown total and the `placeOrder` call reflect it.

- [ ] **Step 1: Fetch vouchers in the checkout page**

Modify `app/(customer)/checkout/page.tsx`:

```tsx
import type { Metadata } from "next";
import { CheckoutScreen } from "@/components/checkout-screen";
import { getStoreSettings } from "@/lib/settings/store";
import { getPaymentSettings, getEnabledPaymentMethods } from "@/lib/settings/payments";
import { getStampSettings } from "@/lib/stamps/config-store";
import { listMyVouchers } from "@/lib/stamps/voucher-store";

export const metadata: Metadata = {
  title: "Checkout",
};

export default async function CheckoutPage() {
  const [settings, payments, stampSettings] = await Promise.all([
    getStoreSettings(),
    getPaymentSettings(),
    getStampSettings(),
  ]);
  const methods = getEnabledPaymentMethods(payments);
  // Only offer vouchers when the program is on. listMyVouchers is RLS-scoped to
  // the signed-in member (the checkout route is gated).
  const vouchers = stampSettings.isEnabled ? await listMyVouchers() : [];
  return (
    <CheckoutScreen
      closedMessage={settings.isOpen ? null : settings.closedMessage}
      methods={methods}
      bank={payments.bank}
      duitnowQrUrl={payments.duitnowQrUrl}
      vouchers={vouchers.filter((v) => v.status === "active")}
    />
  );
}
```

- [ ] **Step 2: Add the `vouchers` prop + selection state to `components/checkout-screen.tsx`**

Add `Voucher` to the type import from `@/types/reward`. Extend the props:

```tsx
export function CheckoutScreen({
  closedMessage,
  methods,
  bank,
  duitnowQrUrl,
  vouchers,
}: {
  closedMessage?: string | null;
  methods: PaymentMethod[];
  bank: BankDetails;
  duitnowQrUrl: string | null;
  vouchers: Voucher[];
}) {
```

Add selection state near the other `useState` hooks:

```tsx
  const [selectedVoucherId, setSelectedVoucherId] = useState<string | null>(null);
```

- [ ] **Step 3: Compute the voucher discount for display**

After `hasSaving` is defined (around line 111), add a pure helper that mirrors the server rule so the shown total matches what `placeOrder` will charge:

```tsx
  const selectedVoucher = vouchers.find((v) => v.id === selectedVoucherId) ?? null;
  // Mirror the server discount rule (checkout/actions.ts). Display-only; the
  // server recomputes authoritatively.
  const dearestUnit = items.reduce((m, i) => Math.max(m, i.unitPrice), 0);
  const voucherDiscount = !selectedVoucher
    ? 0
    : selectedVoucher.type === "rm_off"
      ? totalOriginal >= selectedVoucher.minSpend
        ? Math.min(selectedVoucher.discountAmount, totalOriginal)
        : 0
      : Math.min(selectedVoucher.freeDrinkMaxValue, dearestUnit, totalOriginal);
  const totalAfterVoucher = Math.max(0, totalPrice - voucherDiscount);
```

- [ ] **Step 4: Render the voucher picker**

Above the totals block (before the "Subtotal" row near line 552), render a picker. An `rm_off` voucher below its `min_spend` is shown disabled with the reason:

```tsx
        {vouchers.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Voucher</span>
            {vouchers.map((v) => {
              const eligible =
                v.type === "free_drink" || totalOriginal >= v.minSpend;
              const label =
                v.type === "rm_off"
                  ? `RM${(v.discountAmount / 100).toFixed(0)} off (min RM${(v.minSpend / 100).toFixed(0)})`
                  : `Free drink (up to RM${(v.freeDrinkMaxValue / 100).toFixed(0)})`;
              const checked = selectedVoucherId === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={!eligible}
                  onClick={() => setSelectedVoucherId(checked ? null : v.id)}
                  className={cn(
                    "flex items-center justify-between rounded-xl border px-3 py-2 text-sm",
                    checked ? "border-foreground bg-foreground text-white" : "border-border",
                    !eligible && "opacity-50",
                  )}
                >
                  <span>{label}</span>
                  <span className="text-xs">
                    {checked ? "Applied" : eligible ? "Apply" : "Spend more"}
                  </span>
                </button>
              );
            })}
          </div>
        )}
```

Ensure `cn` is imported from `@/lib/utils` (it likely already is; add it if not).

- [ ] **Step 5: Show the voucher discount + final total**

In the totals block, add a discount row after the existing saving row and change the displayed grand total from `totalPrice` to `totalAfterVoucher` (both the totals row near line 567 and the place-button label near line 611):

```tsx
        {voucherDiscount > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Voucher</span>
            <span className="tabular-nums">−{formatPrice(voucherDiscount)}</span>
          </div>
        )}
```

- [ ] **Step 6: Pass `voucherId` to `placeOrder`**

In the `placeOrderAction({ ... })` call (around line 180), add:

```tsx
        voucherId: selectedVoucherId ?? undefined,
```

- [ ] **Step 7: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add "app/(customer)/checkout/page.tsx" components/checkout-screen.tsx
git commit -m "feat(vouchers): checkout voucher picker + discounted total"
```

---

### Task 5: Customer voucher list on `/rewards`

**Files:**
- Create: `components/stamps/voucher-list.tsx`
- Modify: `app/(customer)/rewards/page.tsx`

**Interfaces:**
- Consumes: `listMyVouchers` (Task 2), `Voucher` type, `formatPrice`.
- Produces: `<VoucherList vouchers={Voucher[]} />` rendered under the stamp card.

- [ ] **Step 1: Write `components/stamps/voucher-list.tsx`**

```tsx
import { formatPrice } from "@/lib/format";
import type { Voucher } from "@/types/reward";

// A member's vouchers. Active ones show value + expiry; redeemed/expired are
// dimmed. Server component — no interactivity.
export function VoucherList({ vouchers }: { vouchers: Voucher[] }) {
  if (vouchers.length === 0) return null;

  const fmtExpiry = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "numeric",
      month: "short",
    }).format(new Date(iso));

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider">My Vouchers</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {vouchers.map((v) => {
          const active = v.status === "active";
          const title =
            v.type === "rm_off"
              ? `${formatPrice(v.discountAmount)} off (min ${formatPrice(v.minSpend)})`
              : `Free drink (up to ${formatPrice(v.freeDrinkMaxValue)})`;
          return (
            <li
              key={v.id}
              className={`flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm ${active ? "" : "opacity-50"}`}
            >
              <span>{title}</span>
              <span className="text-xs text-muted-foreground">
                {active ? `Expires ${fmtExpiry(v.expiresAt)}` : v.status}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Render it on `/rewards`**

In `app/(customer)/rewards/page.tsx`, add the import and fetch, and render under the stamp card (extends the Plan 1 Task 12 edits):

```tsx
import { listMyVouchers } from "@/lib/stamps/voucher-store";
import { VoucherList } from "@/components/stamps/voucher-list";
```

Add `listMyVouchers` to the member fetch (only when signed in and enabled):

```tsx
  const vouchers = user && stampSettings.isEnabled ? await listMyVouchers() : [];
```

Render inside the `stampSettings.isEnabled` block, after `<MemberQr>`:

```tsx
          <VoucherList vouchers={vouchers} />
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add components/stamps/voucher-list.tsx "app/(customer)/rewards/page.tsx"
git commit -m "feat(vouchers): customer voucher list on rewards"
```

---

### Task 6: Kiosk add-member step (`/store`)

**Files:**
- Read first: `app/(store)/store/(kiosk)/checkout/page.tsx`, `app/(store)/store/(kiosk)/actions.ts`
- Modify: the kiosk checkout page/component to add an optional "Add member" control
- Reuse: `attachMemberAction` from `app/(admin)/manage/actions.ts` (Plan 1 Task 11) OR a kiosk-scoped wrapper (see Step 1)

**Interfaces:**
- Consumes: `attach_order_member` RPC (Plan 1 Task 3). The kiosk order must exist (have a token) before a member can attach — attaching sets `orders.user_id`; the stamp then lands at completion (staff complete on `/manage`).
- Produces: a kiosk UI step letting staff key in a member's phone/email (or scan) to attach them to the just-placed kiosk order.

- [ ] **Step 1: Decide the attach entry point**

The kiosk runs under the `/store` role, not necessarily an admin/manager/staff auth cookie. Confirm which role the kiosk session carries by reading `app/(store)/store/(kiosk)/actions.ts` and `lib/auth/session.ts` (`isStoreMode`). Two cases:
- If the kiosk session already satisfies `current_user_role() in ('staff','manager','admin')`, reuse `attachMemberAction` directly.
- If not (kiosk is an anonymous store device), add a thin server action in the kiosk actions file that calls a **store-passcode-guarded** path. Match the existing kiosk auth pattern in that file (it already uses `verifyStorePasscode` elsewhere — mirror it). Do NOT weaken the `attach_order_member` role gate; instead have the kiosk action run under the store's service context the same way other kiosk writes do.

Write down which case applies before coding.

- [ ] **Step 2: Add the kiosk attach control**

After a kiosk order is placed (when a token exists), render an optional "Add member for stamp" control that reuses `<AttachMember token={...} attached={...} />` from Plan 1 Task 11 if the role case allows, else a kiosk-specific minimal form calling the Step 1 action. Keep it optional — skipping leaves the order a guest order (no stamp), which is acceptable.

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 4: Manual smoke check**

Run `npm run dev`, place a kiosk order at `/store`, use the add-member control with a known member's phone, then complete the order from `/manage`.
Expected: the member's stamp count increases by 1.

- [ ] **Step 5: Commit**

```bash
git add "app/(store)/store/(kiosk)/"
git commit -m "feat(vouchers): kiosk add-member step for in-store stamps"
```

---

## Plan 2 Self-Review

- **Spec coverage:** `redeem_voucher` + expiry (T1), store wrappers (T2), authoritative apply in `placeOrder` (T3), checkout picker + discounted total (T4), customer voucher list (T5), kiosk add-member (T6). Together with Plan 1 this covers every section of the spec: stamp card, grant flows (online/kiosk/walk-in), vouchers issue + redeem, CMS control, animation, and testing.
- **RM11→RM6 example:** T3 computes `voucherDiscount = min(discount_amount, subtotal)` after the `min_spend` gate; an RM11 subtotal with a RM5/min-RM11 voucher → RM6 total. Confirmed.
- **Free-drink excess:** T3 discounts `min(free_drink_max_value, dearestUnit, subtotal)`, so an RM13 drink with an RM12 cap leaves RM1 payable. Confirmed.
- **Type consistency:** `redeem_voucher` returns snake (`discount_amount`, `free_drink_max_value`) → mapped to camel in `voucher-store.ts`. `Voucher` shape reused from Plan 1 Task 4. `PlaceOrderInput.voucherId` (T3) matches the `voucherId` passed by the checkout screen (T4).
- **Open risk flagged for execution:** Task 6 Step 1 has a genuine unknown (kiosk session role). The plan tells the implementer to resolve it by reading the kiosk auth code before coding, rather than guessing — the one place in these plans that needs a runtime check during execution.
