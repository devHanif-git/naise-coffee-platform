# Device → Account Order Linking

**Date:** 2026-06-20
**Status:** Approved (design)

## Problem

Guest orders are tied to a stable per-device id (`orders.owner_id`). Today they
"stick" to the device permanently and are never re-owned to an account. When a
guest signs in or registers, their past device orders are not transferred to the
account, and the member order-history query (`user_id = me OR owner_id = device`)
keeps showing device orders forever — even after logout, and even orders placed
by other people on a shared device.

### Desired flow

1. A guest places orders → they stick to the device.
2. The guest signs in / registers → the device's guest orders link to the account.
3. The user logs out → those orders no longer show on the device, because they
   are now account orders.

## Scope

- **In scope:** re-owning (claiming) the device's unclaimed guest orders to the
  account on login/register; adjusting order-history queries; rotating the device
  guest identity on logout.
- **Out of scope (decided):**
  - **No retroactive Beans/rewards** for claimed past orders. Linking is for order
    history visibility/ownership only. Beans continue to earn normally on future
    member orders. The welcome bonus (`claimWelcome`) is unchanged.

## Current State (reference)

- Device id: `owner_id` (UUID) stored in localStorage key `naise-owner-id` and
  cookie `naise_owner_id` (1-year, non-HttpOnly correlation id, not a credential).
  - `lib/auth/owner-id.ts` (`getOrCreateOwnerId`, `setOwnerId`)
  - `lib/auth/owner-id-shared.ts` (key/cookie names)
  - `lib/auth/owner-id-server.ts` (`getOwnerIdFromCookie`)
- `orders` table: `user_id uuid null` (references `auth.users`), `owner_id text not null`.
  - `supabase/migrations/20260618052535_orders.sql`
  - Guest order: `user_id = NULL, owner_id = <device>`.
  - Member order: `user_id = auth.uid(), owner_id = <device>`.
- Order INSERT: `lib/orders/store.ts` `createOrder()` — guests use the admin
  client (RLS on orders is authenticated/staff-only), members use the cookie client.
- Order history: `lib/orders/store.ts` `listOrdersFor(ownerId, userId)`.
  - Member branch today: `user_id.eq.<me>,owner_id.eq.<device>` (the OR we are removing).
- Orders RLS: SELECT for own/staff; INSERT self; UPDATE staff-only.
- Auth callback: `app/(auth)/auth/callback/route.ts` (`exchangeCodeForSession`).
- Sign-in/out state: `store/auth.tsx`.
- Beans/rewards: account-only (`reward_accounts`, `bean_transactions` keyed by
  `user_id`); guest orders earn 0. Not modified by this feature.

## Design

### 1. Claim RPC (database)

A `SECURITY DEFINER` Postgres function, added as a new migration in
`supabase/migrations/`:

```sql
create or replace function public.claim_device_orders(p_owner_id text)
returns integer            -- number of orders claimed
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    return 0;               -- must be authenticated
  end if;
  if p_owner_id is null or length(p_owner_id) = 0 then
    return 0;
  end if;

  update public.orders
     set user_id = v_user,
         updated_at = now()
   where owner_id = p_owner_id
     and user_id is null;   -- only UNCLAIMED guest orders

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.claim_device_orders(text) to authenticated;
```

Properties:
- Derives the owner internally from `auth.uid()`; the client only supplies the
  device id, so it cannot claim orders for another account.
- `user_id is null` guard means it only ever claims *unclaimed guest* orders — it
  can never steal a different member's orders that share a device.
- Idempotent: after the first run there is nothing left to claim for that device,
  so repeat calls are no-ops and return 0.
- `security definer` is required because the orders UPDATE RLS policy is
  staff-only; a normal authenticated UPDATE cannot re-own guest rows.

### 2. Call site (server chokepoint)

Call the RPC right after a session is established:

- **OAuth callback** — `app/(auth)/auth/callback/route.ts`, after
  `exchangeCodeForSession` succeeds: read the device id via
  `getOwnerIdFromCookie()` and call `supabase.rpc("claim_device_orders", { p_owner_id })`.
  Failures are logged but must not block the redirect/login.
- **Phone/OTP completion** — reuse the same RPC at the point the OTP flow
  establishes a real Supabase session (currently mocked; wire in when live).

A thin server helper (e.g. `lib/orders/claim.ts` `claimDeviceOrders(ownerId)`)
wraps the RPC call so both paths share one implementation.

### 3. Order-history query changes (`lib/orders/store.ts`)

`listOrdersFor(ownerId, userId)`:

- **Member** (`userId` present): query `WHERE user_id = <me>` only. Remove the
  `OR owner_id` branch. After claiming, all of a member's orders carry `user_id`,
  so the OR is redundant and removing it also closes the shared-device leak.
- **Guest** (`userId` null): query `WHERE owner_id = <device> AND user_id IS NULL`.
  The `user_id IS NULL` clause is defensive — a claimed order must never reappear
  as a guest order even if a stale cookie lingers.

### 4. Logout rotation (`store/auth.tsx`)

In the sign-out path, after `supabase.auth.signOut()`:

- Rotate the device to a fresh guest identity: `setOwnerId(crypto.randomUUID())`.
- The new guest session starts empty. The just-claimed orders keep their old
  `owner_id` (now orphaned and harmless) and live under the account.

This is what fulfills the requirement: after logout the device shows no orders,
because the orders belong to the account.

## End-to-End Data Flow

1. Guest orders → `user_id=NULL, owner_id=A`. Shown on device (guest view).
2. Guest logs in/registers → callback calls `claim_device_orders(A)` →
   matching rows get `user_id=me`. Shown under the account.
3. While logged in → new orders save with `user_id=me` (unchanged).
4. Logs out → device rotates to `owner_id=B` (empty). Old orders stay with the
   account and are no longer on the device.

## Edge Cases

- **Shared device** (shop tablet / family phone): logout rotation + the
  `user_id IS NULL` claim guard keep each person's orders isolated.
- **Re-login**: restores only the account's own orders (`user_id` match, no
  `owner_id` OR), so other guests' in-between orders never leak in.
- **Repeat logins**: claim is idempotent (no-op after the first).
- **Beans**: untouched; no retroactive grant. Welcome bonus unchanged.
- **Order detail by token**: unchanged — still works via the secret token link for
  guests and members.
- **Claim failure**: logged, never blocks login; the user can retry by simply
  reloading/visiting (claim runs again on next authenticated entry if wired to a
  safe re-entry point, otherwise on next login).

## Files Touched

- `supabase/migrations/<new>_claim_device_orders.sql` — new RPC + grant.
- `lib/orders/claim.ts` — new thin server helper wrapping the RPC.
- `app/(auth)/auth/callback/route.ts` — call claim after session exchange.
- `lib/orders/store.ts` — `listOrdersFor` member/guest query changes.
- `store/auth.tsx` — rotate `owner_id` on logout.
- (Phone/OTP login completion path — wire claim when that flow goes live.)

## Testing

- Guest places order → appears in guest history.
- Guest logs in → order now appears under the account; row has `user_id` set.
- Member logs out → device history is empty; account retains the order on re-login.
- Shared device: guest B orders after user A logs out → A re-login does not show
  B's order; B (guest) sees only their own.
- Claim is idempotent: second login claims 0.
- Beans balance is unchanged by claiming.
- RLS: a member cannot claim another member's already-owned orders (guard).
