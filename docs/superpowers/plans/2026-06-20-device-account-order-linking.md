# Device → Account Order Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a guest signs in or registers, their device's guest orders are re-owned to the new account; after logout those orders no longer appear on the device because they now belong to the account.

**Architecture:** A `SECURITY DEFINER` Postgres RPC `claim_device_orders(p_owner_id)` re-owns unclaimed guest orders (`user_id IS NULL`) on a device to the caller (`auth.uid()`), called from the OAuth callback right after the session is established. The member order-history query is simplified to match only `user_id` (closing a shared-device leak), the guest query additionally requires `user_id IS NULL`, and logout rotates the device's `owner_id` to a fresh guest identity — but only when a real Supabase session existed (the phone/OTP path is still a mock and must keep its id).

**Tech Stack:** Next.js 16 (App Router), TypeScript (strict, no `any`), Supabase (Postgres + RLS + Auth, `@supabase/ssr`), plpgsql RPCs. Verification: Supabase MCP `apply_migration`/`execute_sql` for SQL, `npx tsc --noEmit` + `npm run lint` for TypeScript, manual QA on `npm run dev`.

## Global Constraints

- TypeScript strict mode; **no `any`**. (AGENTS.md)
- Money is stored as integers in sen. (AGENTS.md)
- **Do not add new libraries.** This repo has no JS test runner; do not introduce one. Verify SQL via the Supabase MCP, TypeScript via `tsc`/`lint`, behavior via manual QA. (AGENTS.md)
- Every schema change ships as a new migration in `supabase/migrations/`; never edit an existing migration. (AGENTS.md)
- `SECURITY DEFINER` functions: pin `set search_path = ''`, schema-qualify every object, `revoke execute ... from public, anon;` then `grant execute ... to authenticated;`. (matches `20260620110000_admin_phase3_rpcs.sql`)
- Never expose the service-role key to the client; privileged work runs in server routes/actions. (AGENTS.md)
- `orders.owner_id` is `text` but constrained to UUID format (`20260619093000_orders_owner_id_uuid_check.sql`) — only ever assign UUID-shaped values to it.

---

### Task 1: `claim_device_orders` RPC migration

**Files:**
- Create: `supabase/migrations/20260620130000_claim_device_orders.sql`

**Interfaces:**
- Consumes: existing `public.orders` table (`user_id uuid null`, `owner_id text not null`), `auth.uid()`.
- Produces: SQL function `public.claim_device_orders(p_owner_id text) returns integer` — claims this device's unclaimed guest orders to the calling user, returns the number of rows claimed. Raises `NOT_AUTHENTICATED` when `auth.uid()` is null. Granted to `authenticated` only.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260620130000_claim_device_orders.sql` with exactly:

```sql
-- Re-own (claim) a device's unclaimed guest orders to the caller's account.
-- Called right after a real session is established (OAuth callback, and the
-- phone/OTP completion path when it goes live) so orders placed as a guest on
-- this browser attach to the new account.
--
-- SECURITY DEFINER because the orders UPDATE policy is staff-only; this bypasses
-- it but is safe: it derives the owner from auth.uid() internally (the client
-- only supplies the device id) and only ever touches rows with user_id IS NULL,
-- so a caller can never claim another member's orders. Idempotent — after the
-- first run nothing on the device is unclaimed, so repeat calls match 0 rows.
-- Granted to authenticated only. Mirrors the admin-RPC pattern
-- (20260620110000_admin_phase3_rpcs.sql).
create or replace function public.claim_device_orders(p_owner_id text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_count integer;
begin
  if v_user is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if coalesce(btrim(p_owner_id), '') = '' then
    return 0;
  end if;

  update public.orders
     set user_id = v_user,
         updated_at = now()
   where owner_id = p_owner_id
     and user_id is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.claim_device_orders(text) from public, anon;
grant execute on function public.claim_device_orders(text) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool with name `claim_device_orders` and the SQL body above (or `supabase db push` if using the local CLI).
Expected: migration applies with no error.

- [ ] **Step 3: Verify grants (run via Supabase MCP `execute_sql`)**

```sql
select
  has_function_privilege('authenticated', 'public.claim_device_orders(text)', 'execute') as auth_can,
  has_function_privilege('anon',          'public.claim_device_orders(text)', 'execute') as anon_can;
```

Expected: `auth_can = true`, `anon_can = false`.

- [ ] **Step 4: Verify claim + idempotency (run via Supabase MCP `execute_sql`)**

This wraps everything in a transaction and rolls back, so no test rows persist. It picks an existing auth user (claiming sets the FK `orders.user_id`, which must reference a real user) and simulates that user via the JWT claim that `auth.uid()` reads.

```sql
begin;
do $$
declare
  v_user  uuid;
  v_owner text := gen_random_uuid()::text;   -- UUID-shaped, satisfies owner_id check
  v_order uuid;
  v_count integer;
begin
  select id into v_user from auth.users limit 1;
  if v_user is null then raise exception 'TEST NEEDS >=1 auth user'; end if;

  insert into public.orders (owner_id, payment_method, subtotal, total)
  values (v_owner, 'cash', 0, 0) returning id into v_order;

  -- Make auth.uid() resolve to v_user for the RPC call.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);

  v_count := public.claim_device_orders(v_owner);
  assert v_count = 1, 'first claim must claim exactly 1 row';
  assert (select user_id from public.orders where id = v_order) = v_user,
         'row must now belong to the user';

  v_count := public.claim_device_orders(v_owner);
  assert v_count = 0, 'repeat claim must be a no-op';

  raise notice 'claim_device_orders verification PASSED';
end $$;
rollback;
```

Expected: notice `claim_device_orders verification PASSED`; the trailing `rollback` discards the temp order. If any `assert` fails the statement errors and the transaction aborts (no rows persist) — fix the migration and re-run.

- [ ] **Step 5: Verify the unauthenticated guard (run via Supabase MCP `execute_sql`)**

```sql
do $$
begin
  perform set_config('request.jwt.claims', '', true);   -- auth.uid() -> null
  begin
    perform public.claim_device_orders(gen_random_uuid()::text);
    raise exception 'guard FAILED: expected NOT_AUTHENTICATED';
  exception
    when others then
      if sqlerrm = 'NOT_AUTHENTICATED' then
        raise notice 'unauth guard PASSED';
      else
        raise;
      end if;
  end;
end $$;
```

Expected: notice `unauth guard PASSED`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260620130000_claim_device_orders.sql
git commit -m "feat(orders): add claim_device_orders RPC to re-own guest orders on login"
```

---

### Task 2: Claim helper + wire into OAuth callback

**Files:**
- Create: `lib/orders/claim.ts`
- Modify: `app/(auth)/auth/callback/route.ts`

**Interfaces:**
- Consumes: `public.claim_device_orders(text)` RPC (Task 1); `createClient` from `@/lib/supabase/server`; `getOwnerIdFromCookie` from `@/lib/auth/owner-id-server`.
- Produces: `claimDeviceOrders(ownerId: string | null): Promise<number>` in `lib/orders/claim.ts` — best-effort, never throws, returns rows claimed (0 on any error or null ownerId).

- [ ] **Step 1: Write the helper**

Create `lib/orders/claim.ts`:

```ts
import { createClient } from "@/lib/supabase/server";

// Re-own this browser's unclaimed guest orders to the now-authenticated user.
// Calls the claim_device_orders RPC under the caller's cookie session (the RPC
// derives the user from auth.uid()). Best-effort: never throws — a failure here
// must not block login. Returns the number of orders claimed (0 on any error).
export async function claimDeviceOrders(
  ownerId: string | null,
): Promise<number> {
  if (!ownerId) return 0;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_device_orders", {
    p_owner_id: ownerId,
  });
  if (error) {
    console.error("claim_device_orders failed:", error.message);
    return 0;
  }
  return data ?? 0;
}
```

- [ ] **Step 2: Call it from the OAuth callback**

Edit `app/(auth)/auth/callback/route.ts`. Add the two imports at the top (after the existing `createClient` import):

```ts
import { getOwnerIdFromCookie } from "@/lib/auth/owner-id-server";
import { claimDeviceOrders } from "@/lib/orders/claim";
```

Then replace the success branch inside `if (code)`:

```ts
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Re-own any guest orders placed on this browser before signing in, so
      // they move under the new account. Best-effort; never blocks the redirect.
      const ownerId = await getOwnerIdFromCookie();
      await claimDeviceOrders(ownerId);
      return NextResponse.redirect(`${publicOrigin}${next}`);
    }
  }
```

- [ ] **Step 3: Type-check and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no errors. (If `claim_device_orders` is not in the generated Supabase types, `rpc()` still type-checks because the arg/return are inferred loosely; do not regenerate types as part of this task unless `tsc` actually fails on it.)

- [ ] **Step 4: Manual end-to-end check**

1. `npm run dev`. In a clean browser (no session), place an order as a guest. Confirm it shows under Profile → Orders.
2. Sign in with Google (same browser).
3. Run via Supabase MCP `execute_sql`:
   ```sql
   select order_number, user_id, owner_id
   from public.orders
   order by created_at desc limit 5;
   ```
   Expected: the just-placed guest order now has `user_id` set (no longer null), `owner_id` unchanged.

- [ ] **Step 5: Commit**

```bash
git add lib/orders/claim.ts "app/(auth)/auth/callback/route.ts"
git commit -m "feat(auth): claim device guest orders on OAuth sign-in"
```

---

### Task 3: Simplify member / guest order-history queries

**Files:**
- Modify: `lib/orders/store.ts:169-197` (the `listOrdersFor` function)

**Interfaces:**
- Consumes: nothing new.
- Produces: updated `listOrdersFor(ownerId, userId)` — member (`userId` set) matches `user_id` only; guest matches `owner_id` AND `user_id IS NULL`.

- [ ] **Step 1: Replace the function body**

In `lib/orders/store.ts`, replace the current comment + function (lines 169–197) with:

```ts
// One customer's orders, newest first, via the admin client (these run
// server-side only). Members match on user_id alone: their guest orders were
// re-owned to the account at sign-in (claim_device_orders), so user_id is the
// single source of truth — and matching owner_id too would leak other guests'
// orders on a shared device. Guests match on owner_id AND user_id IS NULL, so a
// claimed order never reappears as a guest order from a stale cookie.
export async function listOrdersFor(
  ownerId: string | null | undefined,
  userId: string | null,
): Promise<Order[]> {
  if (!userId && !ownerId) return [];

  const db = createAdminClient();
  let query = db
    .from("orders")
    .select("*, order_items(*)")
    .order("created_at", { ascending: false });

  if (userId) {
    query = query.eq("user_id", userId);
  } else {
    query = query.eq("owner_id", ownerId!).is("user_id", null);
  }

  const { data: orderRows, error } = await query;
  if (error || !orderRows) return [];
  return orderRows.map((row) =>
    rowToOrder(row, (row.order_items as OrderItemRow[]) ?? []),
  );
}
```

- [ ] **Step 2: Type-check and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no errors.

- [ ] **Step 3: Manual check**

1. As the member from Task 2, open Profile → Orders. Expected: the claimed order is listed (matched via `user_id`).
2. In a fresh incognito window (new device, no session), place a guest order, then via Supabase MCP set it claimed to simulate another member:
   ```sql
   -- run, then ROLL BACK manually if desired; this is a read-after check
   select count(*) from public.orders where owner_id = '<that-incognito-owner-id>' and user_id is null;
   ```
   The guest profile should show only rows where `user_id is null`. Confirm a claimed row with the same `owner_id` would NOT appear (guest query now has `.is("user_id", null)`).

- [ ] **Step 4: Commit**

```bash
git add lib/orders/store.ts
git commit -m "feat(orders): member history matches user_id only; guest excludes claimed orders"
```

---

### Task 4: Rotate device owner_id on real-session logout

**Files:**
- Modify: `store/auth.tsx:196-209` (the `signOut` callback)

**Interfaces:**
- Consumes: `setOwnerId` from `@/lib/auth/owner-id` (already imported in this file), `crypto.randomUUID()`.
- Produces: updated `signOut` — rotates to a fresh `owner_id` only when a real Supabase session existed.

- [ ] **Step 1: Replace the `signOut` callback**

In `store/auth.tsx`, replace the existing `signOut` callback (lines 196–209) with:

```ts
  const signOut = useCallback(async () => {
    // Did a real Supabase session exist? The phone path is still a local mock
    // with no Supabase session — only real members had their device's guest
    // orders re-owned to their account at sign-in, so only they need a fresh
    // guest identity here.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const hadRealSession = session !== null;

    // Clear the real Supabase session (no-op if only the phone mock is active).
    await supabase.auth.signOut();
    setUser(null);
    setShowWelcome(false);
    try {
      localStorage.removeItem(PHONE_MOCK_KEY);
    } catch {
      // Non-fatal.
    }
    // A real member's device orders were re-owned to their account at sign-in,
    // so this browser must start a fresh guest identity — otherwise the claimed
    // orders would still surface here, and a later sign-in could merge another
    // guest's orders into the account. The phone mock keeps its id so its guest
    // orders stay visible.
    if (hadRealSession) {
      setOwnerId(crypto.randomUUID());
    }
  }, [supabase]);
```

- [ ] **Step 2: Type-check and lint**

```bash
npx tsc --noEmit && npm run lint
```

Expected: no errors.

- [ ] **Step 3: Manual end-to-end check (the whole feature)**

1. `npm run dev`. Clean browser → place a guest order → it shows in Profile → Orders.
2. Sign in with Google → the order still shows (now under the account, `user_id` set).
3. Note the current `naise-owner-id` value in DevTools → Application → Local Storage.
4. Sign out. Expected: `naise-owner-id` is now a **different** UUID; Profile → Orders shows **no** orders (fresh guest identity).
5. Sign back in. Expected: the account's order is shown again (restored via `user_id`).
6. Shared-device check: while signed out (post-rotation), place a new guest order; sign back into the original account. Expected: the new guest order does **not** appear under the account.

- [ ] **Step 4: Commit**

```bash
git add store/auth.tsx
git commit -m "feat(auth): rotate device guest id on real-session logout"
```

---

## Self-Review

**Spec coverage:**
- Claim RPC with `user_id IS NULL` guard → Task 1. ✅
- Callback chokepoint calling the RPC → Task 2. ✅
- Member query = `user_id` only; guest query adds `user_id IS NULL` → Task 3. ✅
- Logout rotation to fresh `owner_id` → Task 4 (gated on real session, per the phone-mock wrinkle found during planning). ✅
- No retroactive Beans → nothing touches rewards; confirmed none of the tasks modify `apply_order_rewards`, `reward_accounts`, or `bean_transactions`. ✅
- Phone/OTP reuse of the RPC when live → noted in Task 1/spec; no code today because that path has no real session. ✅
- Order-detail-by-token unchanged → `getOrderByToken` untouched. ✅

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code and SQL step is complete and literal. ✅

**Type/name consistency:** `claimDeviceOrders(ownerId)` (Task 2) ↔ `claim_device_orders(p_owner_id text)` RPC (Task 1) — arg name `p_owner_id` matches the `.rpc("claim_device_orders", { p_owner_id })` call. `setOwnerId` and `getOwnerIdFromCookie` match their real exports. `listOrdersFor(ownerId, userId)` signature unchanged. ✅

**Notes for the implementer:**
- Apply Task 1's migration to the database **before** running Task 2's manual check (the RPC must exist).
- If `tsc` complains that `claim_device_orders` is unknown on `.rpc(...)`, regenerate Supabase types (`mcp__supabase__generate_typescript_types`) into `types/` and re-run — do this only if `tsc` actually fails.
