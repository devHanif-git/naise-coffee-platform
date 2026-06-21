# In-Store Order-Only "Store" Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a locked, tablet-optimized in-store ordering surface (`/store`) that a shared device signs into with an admin-managed passcode, runs only `menu → product → cart → checkout(cash/QR) → pay`, tags its orders `source = 'store'`, and never touches rewards.

**Architecture:** A new `app/(store)/` route group backed by a dedicated Supabase auth user whose role is `store` and whose password is the passcode. A nested `(kiosk)` layout gates access on `role === 'store'` AND a `store_account.is_enabled` flag. The store screens reuse the existing menu/product/cart components via a new `OrderMode` context that rewrites navigation hrefs (default `"customer"`, overridden to `"store"`), and a parameterized cart store key. Orders are written through the existing `createOrder` (service-role path, `user_id = null`) with a new `source` column; rewards are skipped because store orders have no `user_id`.

**Tech Stack:** Next.js App Router (Next 16) + TypeScript, Supabase (Postgres, Auth, RLS) via `@supabase/ssr` + `@supabase/supabase-js@2.108.2`, Tailwind CSS, shadcn/ui.

## Global Constraints

- **No new libraries.** AGENTS.md forbids adding dependencies without approval. No test framework is added; verification is `npm run lint`, `npx tsc --noEmit`, `npm run build`, SQL checks, and manual flows.
- **Money is integer sen** (1 MYR = 100 sen). Never use floats.
- **Service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is server-only.** Use `createAdminClient()` (`lib/supabase/admin.ts`) and never import it into a client component.
- **Every schema change is a migration** in `supabase/migrations/`, named `YYYYMMDDHHMMSS_snake_case.sql`. Use the date prefix `20260621` and ascending times for new files.
- **Strict TypeScript, no `any`.** Regenerate `types/database.ts` after migrations.
- **Roles** are the Postgres enum `public.user_role`. After this work: `'admin' | 'manager' | 'staff' | 'store' | 'customer'`.
- **`order_source`** values are exactly `'online'` and `'store'`.
- **Store passcode** is the auth user's password: minimum length 6 (Supabase requirement).
- **Tablet-first** styling for `/store/*` only; the rest of the app stays mobile-first.
- **Reuse `cn()`** from `lib/utils` and existing shadcn primitives; no new CSS files.

---

## Task 1: Migration — add the `store` role enum value

**Files:**
- Create: `supabase/migrations/20260621090000_store_role_enum.sql`

**Interfaces:**
- Produces: the `'store'` value on `public.user_role`, usable by all later migrations/policies.

> Postgres forbids using a newly-added enum value in the same transaction that adds it. This value MUST live in its own migration file (its own transaction), separate from any policy/column that references `'store'`.

- [ ] **Step 1: Write the migration**

```sql
-- Adds the 'store' role for the in-store kiosk account. MUST be isolated in its
-- own migration: Postgres cannot use a new enum value in the same transaction
-- that adds it, so anything referencing 'store' goes in a later migration file.
alter type public.user_role add value if not exists 'store';
```

- [ ] **Step 2: Apply and verify the value exists**

Run (via Supabase CLI if available): `supabase migration up`
Or apply the file's SQL through your Supabase SQL editor / MCP `apply_migration`.

Verify:
```sql
select enumlabel from pg_enum e
join pg_type t on t.oid = e.enumtypid
where t.typname = 'user_role' order by e.enumsortorder;
```
Expected: rows include `store` alongside `admin, manager, staff, customer`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260621090000_store_role_enum.sql
git commit -m "feat(store): add 'store' role enum value"
```

---

## Task 2: Migration — `order_source`, `orders.source`, and `store_account`

**Files:**
- Create: `supabase/migrations/20260621090100_store_mode.sql`
- Modify: `types/database.ts` (regenerate)

**Interfaces:**
- Produces:
  - `public.order_source` enum (`'online' | 'store'`).
  - `public.orders.source order_source not null default 'online'` + index.
  - `public.store_account` singleton: `is_enabled boolean`, `store_user_id uuid`, `last_rotated_at timestamptz`, `updated_at timestamptz`, with admin-write / admin+store-read RLS.

> `CREATE TYPE` for a brand-new enum and using it in the same migration is allowed (the same-transaction restriction only applies to `ALTER TYPE ... ADD VALUE`). Store orders keep `user_id = null`, so `apply_order_rewards()` already no-ops on them — we deliberately do NOT recreate that function.

- [ ] **Step 1: Write the migration**

```sql
-- Distinguishes in-store kiosk orders from online orders for reporting.
create type public.order_source as enum ('online', 'store');

alter table public.orders
  add column source public.order_source not null default 'online';

create index orders_source_idx on public.orders (source);

comment on column public.orders.source is
  'Channel the order came from: online storefront or in-store kiosk.';

-- Singleton state for the shared in-store ordering account. The passcode is the
-- auth user''s password and is NEVER stored here. is_enabled is the authoritative
-- server-side kill switch checked on every kiosk request.
create table public.store_account (
  id             boolean primary key default true check (id),
  is_enabled     boolean not null default false,
  store_user_id  uuid references auth.users (id) on delete set null,
  last_rotated_at timestamptz,
  updated_at     timestamptz not null default now()
);

comment on table public.store_account is
  'Single-row config for the in-store kiosk account. Admin-write; admin+store-read.';

create trigger store_account_set_updated_at before update on public.store_account
  for each row execute function public.set_updated_at();

alter table public.store_account enable row level security;

-- The kiosk layout reads is_enabled as the store user; admin reads it in the CMS.
create policy "store_account_read_admin_or_store" on public.store_account
  for select to authenticated
  using (public.current_user_role() in ('admin', 'store'));

create policy "store_account_write_admin" on public.store_account
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

insert into public.store_account (id) values (true) on conflict (id) do nothing;
```

- [ ] **Step 2: Apply the migration**

Run: `supabase migration up` (or apply via SQL editor / MCP `apply_migration`).

- [ ] **Step 3: Verify schema**

```sql
select column_name, data_type, udt_name, column_default
from information_schema.columns
where table_name = 'orders' and column_name = 'source';
-- Expected: one row, udt_name = order_source, default 'online'.

select is_enabled, store_user_id from public.store_account;
-- Expected: one row, is_enabled = false, store_user_id null.
```

- [ ] **Step 4: Regenerate database types**

Run: `supabase gen types typescript --linked > types/database.ts`
(If the CLI is unavailable, use the Supabase MCP `generate_typescript_types` and write the result to `types/database.ts`.)

Verify `types/database.ts` now contains a `store_account` table type and `source` on `orders`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260621090100_store_mode.sql types/database.ts
git commit -m "feat(store): add order_source, orders.source, store_account table"
```

---

## Task 3: Order type + `source` plumbing through create/message

**Files:**
- Modify: `types/order.ts`
- Modify: `lib/orders/store.ts` (the `createOrder` insert + row→Order mapping)
- Modify: `lib/orders/message.ts` (`buildOrderMessage`)

**Interfaces:**
- Consumes: `OrderDraft` (existing), `createOrder(draft, { userId })` (existing).
- Produces: `Order.source?: "online" | "store"`; `createOrder` persists `source` (default `'online'`) and returns it; the Telegram message shows a "Store Kiosk" line for store orders.

- [ ] **Step 1: Add `source` to the Order type**

In `types/order.ts`, inside the `Order` type (after `completedAt?`), add:

```typescript
  // Channel the order came from. Defaults to "online" for the storefront; the
  // in-store kiosk sets "store". Maps to orders.source.
  source?: "online" | "store";
```

`OrderDraft` is `Omit<Order, "token" | "orderNumber" | "status" | "createdAt" | "completedAt">`, so it now includes the optional `source` automatically.

- [ ] **Step 2: Persist and map `source` in `createOrder`**

In `lib/orders/store.ts`, in the `orders` insert object (the `.insert({ ... })` for the order row), add the line:

```typescript
      source: draft.source ?? "online",
```

Then, wherever `createOrder` maps the inserted row into the returned `Order` object, add `source` to that mapping, e.g.:

```typescript
    source: orderRow.source,
```

(If the function builds the `Order` via an existing `mapOrderRow`/spread, add `source: orderRow.source` there.)

- [ ] **Step 3: Show the source in the staff Telegram notice**

In `lib/orders/message.ts`, inside `buildOrderMessage`, immediately after the `Payment: ...` push in the `parts` array, add:

```typescript
  if (order.source === "store") {
    parts.push("Source: Store Kiosk");
  }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors related to `order.ts`, `orders/store.ts`, or `message.ts`.

- [ ] **Step 5: Commit**

```bash
git add types/order.ts lib/orders/store.ts lib/orders/message.ts
git commit -m "feat(store): plumb order source through create + staff notice"
```

---

## Task 4: Role type, session helpers, store-account helpers, constants

**Files:**
- Modify: `types/auth.ts`
- Modify: `lib/auth/session.ts`
- Create: `lib/settings/store-account.ts`
- Create: `constants/store.ts`

**Interfaces:**
- Produces:
  - `Role` includes `"store"`. `MANAGE_ROLES` is left UNCHANGED (`admin`, `manager`, `staff`) — the kiosk must NOT count as order-managing, or it could open the staff `/manage` board. Store orders are inserted via the service-role path and never read via RLS, so the store role needs no management perms.
  - `getStoreAccountEnabled(): Promise<boolean>` (fail-closed).
  - `getStoreAccountStatus(): Promise<{ isEnabled: boolean; isProvisioned: boolean; lastRotatedAt: string | null }>`.
  - Constants: `STORE_ACCOUNT_EMAIL`, `STORE_OWNER_ID`, `STORE_CART_KEY`, `STORE_CART_NOTES_KEY`, `STORE_IDLE_TIMEOUT_MS`, `STORE_CONFIRMATION_RESET_MS`.

- [ ] **Step 1: Extend the Role type**

In `types/auth.ts`, add `"store"` to `Role` ONLY. Leave `MANAGE_ROLES` exactly as it is (do not add `"store"` — the kiosk must stay out of the staff board):

```typescript
export type Role = "admin" | "manager" | "staff" | "store" | "customer";

// UNCHANGED — store is intentionally excluded so canManageOrders() is false for it.
export const MANAGE_ROLES: readonly Role[] = ["admin", "manager", "staff"];
```

- [ ] **Step 2: Add a store-mode session helper**

In `lib/auth/session.ts`, append:

```typescript
// Whether the current session is the shared in-store kiosk account.
export async function isStoreMode(): Promise<boolean> {
  return (await getSessionRole()) === "store";
}
```

- [ ] **Step 3: Add store-account read helpers**

Create `lib/settings/store-account.ts`:

```typescript
import { createClient } from "@/lib/supabase/server";

// Authoritative kill switch for the kiosk, read on every kiosk request as the
// store user. FAIL-CLOSED: any read error or missing row is treated as disabled
// so a transient glitch can never leave the kiosk open after it was turned off.
export async function getStoreAccountEnabled(): Promise<boolean> {
  const db = await createClient();
  const { data, error } = await db
    .from("store_account")
    .select("is_enabled")
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;
  return data.is_enabled;
}

// Admin CMS read: enabled flag, whether the auth user has been provisioned, and
// when the passcode was last set.
export async function getStoreAccountStatus(): Promise<{
  isEnabled: boolean;
  isProvisioned: boolean;
  lastRotatedAt: string | null;
}> {
  const db = await createClient();
  const { data } = await db
    .from("store_account")
    .select("is_enabled, store_user_id, last_rotated_at")
    .limit(1)
    .maybeSingle();
  return {
    isEnabled: data?.is_enabled ?? false,
    isProvisioned: Boolean(data?.store_user_id),
    lastRotatedAt: data?.last_rotated_at ?? null,
  };
}
```

- [ ] **Step 4: Add store constants**

Create `constants/store.ts`:

```typescript
// Fixed login identity for the shared in-store kiosk account. The passcode is
// this user's password (set/rotated from admin). Not a secret on its own.
export const STORE_ACCOUNT_EMAIL = "store@naise.coffee";

// owner_id stamped on every kiosk order. orders.owner_id is NOT NULL; kiosk
// orders have no per-browser identity, so they share this sentinel. A real
// customer can never have this value, so it never collides with order claiming.
export const STORE_OWNER_ID = "store-kiosk";

// Separate localStorage keys so the kiosk cart never collides with the
// customer-app cart on the same browser.
export const STORE_CART_KEY = "naise-store-cart";
export const STORE_CART_NOTES_KEY = "naise-store-cart-notes";

// Self-serve reset timings.
export const STORE_IDLE_TIMEOUT_MS = 90_000; // clear an abandoned cart after 90s idle
export const STORE_CONFIRMATION_RESET_MS = 6_000; // confirmation → back to menu
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (Adding `"store"` to `Role` may surface non-exhaustive `switch`/`Record` usages — if the compiler flags any, handle the `store` case the same as `staff` for management-context code, or as a no-op where roles map to customer UI. Fix each flagged site minimally.)

- [ ] **Step 6: Commit**

```bash
git add types/auth.ts lib/auth/session.ts lib/settings/store-account.ts constants/store.ts
git commit -m "feat(store): role, session, store-account helpers and constants"
```

---

## Task 5: OrderMode context + refactor reused nav components

**Files:**
- Create: `store/order-mode.tsx`
- Modify: `components/menu-card.tsx`
- Modify: `components/menu-browser.tsx`
- Modify: `components/product-customizer.tsx`

**Interfaces:**
- Consumes: existing `MenuCard`, `MenuBrowser`, `ProductCustomizer`.
- Produces:
  - `OrderModeProvider` (client) and `useOrderRoutes()` returning `{ mode, menu, cart, product(slug) }`.
  - Default mode is `"customer"` so every existing usage is unchanged with NO provider required.

- [ ] **Step 1: Create the context**

Create `store/order-mode.tsx`:

```typescript
"use client";

import { createContext, useContext } from "react";

export type OrderMode = "customer" | "store";

// Default "customer" so existing storefront usages need no provider; the store
// layout overrides to "store" for its subtree.
const OrderModeContext = createContext<OrderMode>("customer");

export function OrderModeProvider({
  mode,
  children,
}: {
  mode: OrderMode;
  children: React.ReactNode;
}) {
  return (
    <OrderModeContext.Provider value={mode}>
      {children}
    </OrderModeContext.Provider>
  );
}

export function useOrderMode(): OrderMode {
  return useContext(OrderModeContext);
}

// Navigation targets for the active mode. The kiosk lives under /store with the
// menu at /store and products at /store/<slug>; the storefront uses /menu.
export function useOrderRoutes() {
  const mode = useOrderMode();
  const isStore = mode === "store";
  return {
    mode,
    menu: isStore ? "/store" : "/menu",
    cart: isStore ? "/store/cart" : "/cart",
    product: (slug: string) => (isStore ? `/store/${slug}` : `/menu/${slug}`),
  };
}
```

- [ ] **Step 2: Refactor `MenuCard` to use route mode**

In `components/menu-card.tsx`:
1. Add `"use client";` as the first line.
2. Add the import: `import { useOrderRoutes } from "@/store/order-mode";`
3. Inside the component, add: `const routes = useOrderRoutes();`
4. Replace BOTH occurrences of `` href={`/menu/${product.slug}`} `` with `` href={routes.product(product.slug)} ``.

- [ ] **Step 3: Refactor `MenuBrowser` back link**

In `components/menu-browser.tsx`:
1. Add the import: `import { useOrderRoutes } from "@/store/order-mode";`
2. Inside the component, add: `const routes = useOrderRoutes();`
3. Replace the back-link block (the `<Link href="/" ...>` with the `ChevronLeft`) so it only renders in customer mode, keeping the layout balanced with the existing spacer:

```tsx
            {routes.mode === "customer" ? (
              <Link
                href="/"
                aria-label="Go back"
                className="flex size-9 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-white/40"
              >
                <ChevronLeft className="size-6" />
              </Link>
            ) : (
              <div className="size-9" aria-hidden />
            )}
```

- [ ] **Step 4: Refactor `ProductCustomizer` redirects**

In `components/product-customizer.tsx`:
1. Add the import: `import { useOrderRoutes } from "@/store/order-mode";`
2. Inside the component, add: `const routes = useOrderRoutes();`
3. In `addToCart`, replace the edit-merge redirect:

```typescript
    if (isEditing && editKey) {
      const merged = updateItem(editKey, input);
      router.push(
        merged ? `${routes.cart}?merged=${encodeURIComponent(product.name)}` : routes.cart,
      );
      return;
    }
```

4. Replace the final redirect (reward stays `/rewards`, which is never reached in store mode since the kiosk passes an empty catalog):

```typescript
    addItem(input);
    router.push(isReward ? "/rewards" : routes.menu);
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: pass. Manually confirm the customer storefront still navigates `/menu` → `/menu/[slug]` → `/cart` unchanged (default mode).

- [ ] **Step 6: Commit**

```bash
git add store/order-mode.tsx components/menu-card.tsx components/menu-browser.tsx components/product-customizer.tsx
git commit -m "feat(store): order-mode-aware navigation for reused menu components"
```

---

## Task 6: Parameterize the cart store key

**Files:**
- Modify: `store/cart.tsx`

**Interfaces:**
- Consumes: existing `CartProvider`, `useCart`.
- Produces: `CartProvider` accepts optional `storageKey` and `notesStorageKey` props, defaulting to the current `"naise-cart"` / `"naise-cart-notes"`. No behavior change for existing customer usage.

- [ ] **Step 1: Make the keys props**

In `store/cart.tsx`:
1. Keep the existing module constants as defaults:

```typescript
const DEFAULT_STORAGE_KEY = "naise-cart";
const DEFAULT_NOTES_STORAGE_KEY = "naise-cart-notes";
```

(Rename the existing `STORAGE_KEY` / `NOTES_STORAGE_KEY` constants to these `DEFAULT_` names.)

2. Update the provider signature and resolve the keys:

```typescript
export function CartProvider({
  children,
  storageKey = DEFAULT_STORAGE_KEY,
  notesStorageKey = DEFAULT_NOTES_STORAGE_KEY,
}: {
  children: React.ReactNode;
  storageKey?: string;
  notesStorageKey?: string;
}) {
```

3. In the load effect and the persist effect, replace `STORAGE_KEY` → `storageKey` and `NOTES_STORAGE_KEY` → `notesStorageKey`. Add `storageKey, notesStorageKey` to the persist effect's dependency array.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: pass; existing `<CartProvider>` callers compile unchanged (props optional).

- [ ] **Step 3: Commit**

```bash
git add store/cart.tsx
git commit -m "feat(store): parameterize cart storage keys"
```

---

## Task 7: Store-account provisioning + admin "Store Ordering" section

**Files:**
- Create: `app/(admin)/admin/settings/store-account-actions.ts`
- Create: `components/admin/store-account-form.tsx`
- Modify: `app/(admin)/admin/settings/page.tsx`

**Interfaces:**
- Consumes: `createAdminClient()` (`lib/supabase/admin.ts`), `createClient()` (server), `isAdmin()`, `getStoreAccountStatus()`, `STORE_ACCOUNT_EMAIL`.
- Produces:
  - `setStorePasscode(passcode: string): Promise<{ ok: true } | { ok: false; error: string }>` — provisions the auth user on first call, rotates the password thereafter, sets `role = 'store'`, stamps `last_rotated_at`.
  - `setStoreEnabled(enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }>`.
  - A CMS card to set the passcode and toggle enablement.

> Forcing logged-in tablets off: there is no admin "revoke sessions by user id" in supabase-js. Disabling the account bounces every kiosk request to `/store/login`, which signs the device's local session out (Task 8). So "disable → rotate → enable" forces the new passcode. A tablet that stays asleep across the whole disable window keeps its old session — documented, acceptable for a counter device.

- [ ] **Step 1: Write the server actions**

Create `app/(admin)/admin/settings/store-account-actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORE_ACCOUNT_EMAIL } from "@/constants/store";

type ActionResult = { ok: true } | { ok: false; error: string };

// Provisions the kiosk auth user on first call, rotates its password after.
export async function setStorePasscode(passcode: string): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const code = passcode.trim();
  if (code.length < 6) return { ok: false, error: "Passcode must be at least 6 characters." };

  const db = await createClient();
  const { data: row } = await db
    .from("store_account")
    .select("store_user_id")
    .limit(1)
    .maybeSingle();

  const admin = createAdminClient();
  let userId = row?.store_user_id ?? null;

  if (!userId) {
    // Try to create the user; if the email already exists (partial prior run),
    // find it and treat this as a rotation instead.
    const created = await admin.auth.admin.createUser({
      email: STORE_ACCOUNT_EMAIL,
      password: code,
      email_confirm: true,
    });
    if (created.error) {
      const { data: list } = await admin.auth.admin.listUsers();
      const existing = list?.users.find((u) => u.email === STORE_ACCOUNT_EMAIL);
      if (!existing) return { ok: false, error: created.error.message };
      userId = existing.id;
      const upd = await admin.auth.admin.updateUserById(userId, { password: code });
      if (upd.error) return { ok: false, error: upd.error.message };
    } else {
      userId = created.data.user.id;
    }
  } else {
    const upd = await admin.auth.admin.updateUserById(userId, { password: code });
    if (upd.error) return { ok: false, error: upd.error.message };
  }

  // Ensure the role is 'store' (the signup trigger created the profile as
  // 'customer'). Service-role client bypasses the role-guard trigger.
  const roleErr = (await admin.from("profiles").update({ role: "store" }).eq("id", userId)).error;
  if (roleErr) return { ok: false, error: roleErr.message };

  const accErr = (
    await admin
      .from("store_account")
      .update({ store_user_id: userId, last_rotated_at: new Date().toISOString() })
      .eq("id", true)
  ).error;
  if (accErr) return { ok: false, error: accErr.message };

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function setStoreEnabled(enabled: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("store_account").update({ is_enabled: enabled }).eq("id", true);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings");
  return { ok: true };
}
```

- [ ] **Step 2: Write the CMS form**

Create `components/admin/store-account-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/input";
import {
  setStorePasscode,
  setStoreEnabled,
} from "@/app/(admin)/admin/settings/store-account-actions";

export function StoreAccountForm({
  initial,
}: {
  initial: { isEnabled: boolean; isProvisioned: boolean; lastRotatedAt: string | null };
}) {
  const [enabled, setEnabled] = useState(initial.isEnabled);
  const [passcode, setPasscode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function savePasscode() {
    setMsg(null);
    startTransition(async () => {
      const res = await setStorePasscode(passcode);
      setMsg(res.ok ? "Passcode updated." : res.error);
      if (res.ok) setPasscode("");
    });
  }

  function toggleEnabled(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      const res = await setStoreEnabled(next);
      if (!res.ok) {
        setEnabled(!next);
        setMsg(res.error);
      }
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-base font-semibold">Store Ordering</h2>
        <p className="text-xs text-muted-foreground">
          A shared passcode login for the in-store kiosk tablet. Orders placed here
          earn no rewards and are tagged as in-store.
        </p>
      </div>

      <label className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Enabled</span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) => toggleEnabled(e.target.checked)}
          className="size-5"
          aria-label="Enable store ordering"
        />
      </label>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor="store-passcode">
          {initial.isProvisioned ? "Rotate passcode" : "Set passcode"}
        </label>
        <Input
          id="store-passcode"
          type="password"
          autoComplete="new-password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="At least 6 characters"
        />
        <button
          type="button"
          onClick={savePasscode}
          disabled={pending || passcode.trim().length < 6}
          className="h-10 rounded-xl bg-black px-4 text-sm font-semibold text-white disabled:opacity-40"
        >
          Save passcode
        </button>
        <p className="text-[0.6875rem] text-muted-foreground">
          To force tablets onto a new passcode: disable, save the new passcode, then
          enable again.
        </p>
        {initial.lastRotatedAt && (
          <p className="text-[0.6875rem] text-muted-foreground">
            Last rotated: {new Date(initial.lastRotatedAt).toLocaleString()}
          </p>
        )}
      </div>

      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </section>
  );
}
```

- [ ] **Step 3: Mount it on the settings page**

In `app/(admin)/admin/settings/page.tsx`:
1. Add imports:

```typescript
import { getStoreAccountStatus } from "@/lib/settings/store-account";
import { StoreAccountForm } from "@/components/admin/store-account-form";
```

2. Add `getStoreAccountStatus()` to the `Promise.all`:

```typescript
  const [settings, payments, storeAccount] = await Promise.all([
    getStoreSettings(),
    getPaymentSettings(),
    getStoreAccountStatus(),
  ]);
```

3. Render the form after `<PaymentSettingsForm ... />`:

```tsx
      <StoreAccountForm initial={storeAccount} />
```

- [ ] **Step 4: Typecheck + lint, then manual test**

Run: `npx tsc --noEmit && npm run lint`
Manual: as an admin, open `/admin/settings`, set a 6-digit passcode, confirm "Passcode updated." Verify in SQL:

```sql
select is_enabled, store_user_id, last_rotated_at from public.store_account;
select role from public.profiles where id = (select store_user_id from public.store_account);
-- Expected: store_user_id populated, role = 'store'.
```

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/settings/store-account-actions.ts" components/admin/store-account-form.tsx "app/(admin)/admin/settings/page.tsx"
git commit -m "feat(store): admin provisioning + Store Ordering settings section"
```

---

## Task 8: Store route group — shell, login, gate, menu, product

**Files:**
- Create: `app/(store)/layout.tsx`
- Create: `components/store/store-shell.tsx`
- Create: `app/(store)/store/login/page.tsx`
- Create: `components/store/store-login-form.tsx`
- Create: `app/(store)/store/(kiosk)/layout.tsx`
- Create: `app/(store)/store/(kiosk)/page.tsx`
- Create: `app/(store)/store/(kiosk)/[slug]/page.tsx`
- Modify: `app/(customer)/layout.tsx` (lock store sessions out of the storefront)

**Interfaces:**
- Consumes: `AuthProvider`, `BeansProvider`, `CartProvider` (now keyed), `OrderModeProvider`, `getLoyaltySettings`, `getSessionRole`, `getStoreAccountEnabled`, `getStoreSettings`, `listCategories`, `listProducts`, `getProductBySlug`, `MenuBrowser`, `ProductCustomizer`, store constants.
- Produces: the `/store` surface — ungated `/store/login`, and gated `/store`, `/store/[slug]`. `StoreShell` provides idle-reset + auto-reset behavior.

> Routing note: `/store/cart` and `/store/checkout` (Task 9) are static segments and take priority over `[slug]`, so a product can't shadow them. The `(kiosk)` group adds the auth gate without adding a URL segment.

- [ ] **Step 1: Store group layout (providers + tablet shell)**

Create `app/(store)/layout.tsx`:

```tsx
import { AuthProvider } from "@/store/auth";
import { BeansProvider } from "@/store/beans";
import { CartProvider } from "@/store/cart";
import { OrderModeProvider } from "@/store/order-mode";
import { StoreShell } from "@/components/store/store-shell";
import { getLoyaltySettings } from "@/lib/rewards/config-store";
import { STORE_CART_KEY, STORE_CART_NOTES_KEY } from "@/constants/store";

export const dynamic = "force-dynamic";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  // BeansProvider is required by ProductCustomizer's useBeans(); the kiosk never
  // shows beans, and the empty reward catalog keeps reward mode permanently off.
  const { beansPerRinggit } = await getLoyaltySettings();
  return (
    <AuthProvider>
      <BeansProvider earnRate={beansPerRinggit}>
        <OrderModeProvider mode="store">
          <CartProvider storageKey={STORE_CART_KEY} notesStorageKey={STORE_CART_NOTES_KEY}>
            <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col bg-background">
              <StoreShell>{children}</StoreShell>
            </div>
          </CartProvider>
        </OrderModeProvider>
      </BeansProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 2: StoreShell (idle reset + auto-reset)**

Create `components/store/store-shell.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCart } from "@/store/cart";
import { STORE_IDLE_TIMEOUT_MS } from "@/constants/store";

// Clears an abandoned cart and returns to the menu after inactivity, so one
// customer's half-order never greets the next. Disabled on the login screen.
export function StoreShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { clear, items } = useCart();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onLogin = pathname === "/store/login";

  useEffect(() => {
    if (onLogin) return;
    function reset() {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (items.length > 0 || pathname !== "/store") {
          clear();
          router.push("/store");
        }
      }, STORE_IDLE_TIMEOUT_MS);
    }
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [onLogin, pathname, items, clear, router]);

  return <>{children}</>;
}
```

- [ ] **Step 3: Login page (server) + form (client)**

Create `app/(store)/store/login/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth/session";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";
import { StoreLoginForm } from "@/components/store/store-login-form";

export const dynamic = "force-dynamic";

export default async function StoreLoginPage() {
  const role = await getSessionRole();
  if (role === "store" && (await getStoreAccountEnabled())) redirect("/store");
  // A non-store signed-in user (admin/customer) shouldn't sit on the kiosk login.
  if (role && role !== "store") redirect("/");

  const disabled = role === "store" && !(await getStoreAccountEnabled());
  return <StoreLoginForm disabled={disabled} />;
}
```

Create `components/store/store-login-form.tsx`:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STORE_ACCOUNT_EMAIL } from "@/constants/store";

// `disabled` = a store session exists but admin turned ordering off. We sign the
// device's local session out so re-enabling forces a fresh passcode entry.
export function StoreLoginForm({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (disabled) {
      createClient().auth.signOut();
    }
  }, [disabled]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: STORE_ACCOUNT_EMAIL,
        password: passcode,
      });
      if (error) {
        setError("Incorrect passcode.");
        return;
      }
      router.push("/store");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8">
      <h1 className="font-heading text-2xl font-bold uppercase tracking-[0.2em]">
        Naise Store
      </h1>
      {disabled ? (
        <p className="text-center text-sm text-muted-foreground">
          Store ordering is currently off. Ask a manager.
        </p>
      ) : (
        <div className="flex w-full max-w-xs flex-col gap-3">
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Enter passcode"
            aria-label="Store passcode"
            className="h-14 rounded-2xl border border-border bg-white px-4 text-center text-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <button
            type="button"
            onClick={submit}
            disabled={pending || passcode.length < 6}
            className="h-14 rounded-2xl bg-black text-base font-semibold text-white disabled:opacity-40"
          >
            Enter
          </button>
          {error && <p className="text-center text-sm text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Kiosk gate layout**

Create `app/(store)/store/(kiosk)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth/session";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";

export const dynamic = "force-dynamic";

export default async function KioskLayout({ children }: { children: React.ReactNode }) {
  const role = await getSessionRole();
  if (role !== "store") redirect("/store/login");
  if (!(await getStoreAccountEnabled())) redirect("/store/login");
  return <>{children}</>;
}
```

- [ ] **Step 5: Menu page**

Create `app/(store)/store/(kiosk)/page.tsx`:

```tsx
import { MenuBrowser } from "@/components/menu-browser";
import { listCategories, listProducts } from "@/lib/menu/store";
import { getStoreSettings } from "@/lib/settings/store";

export const dynamic = "force-dynamic";

export default async function StoreMenuPage() {
  const [categories, products, settings] = await Promise.all([
    listCategories(),
    listProducts(),
    getStoreSettings(),
  ]);

  if (!settings.isOpen) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">{settings.closedMessage}</p>
      </div>
    );
  }

  return <MenuBrowser categories={categories} products={products} />;
}
```

> Verify the exact import names/paths for `listCategories`/`listProducts` against `app/(customer)/menu/page.tsx` and match them (they are the same data functions that page uses).

- [ ] **Step 6: Product page**

Create `app/(store)/store/(kiosk)/[slug]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { SmartImage } from "@/components/ui/smart-image";
import { ProductCustomizer } from "@/components/product-customizer";
import { getProductBySlug } from "@/lib/menu/store";

export const dynamic = "force-dynamic";

export default async function StoreProductPage(props: PageProps<"/store/[slug]">) {
  const { slug } = await props.params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  return (
    <article className="flex flex-col p-5">
      <div className="relative mx-auto mb-4 h-56 w-44 overflow-hidden rounded-3xl bg-black p-3">
        <SmartImage src={product.image} alt={product.name} fill sizes="176px" className="object-contain" />
      </div>
      <h1 className="font-heading text-xl font-bold">{product.name}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{product.description}</p>
      {/* Empty catalog => reward mode can never engage in the kiosk. */}
      <ProductCustomizer product={product} catalog={[]} />
    </article>
  );
}
```

> Match `getProductBySlug`'s import path to the one used in `app/(customer)/menu/[slug]/page.tsx`. Match the `PageProps<...>` generic usage to that file's Next 16 convention; if that file uses a different params signature, mirror it exactly.

- [ ] **Step 7: Lock store sessions out of the customer storefront**

A `store` session must never see the customer UI. In `app/(customer)/layout.tsx`, at the top of the async component body (before building providers), add:

```tsx
import { redirect } from "next/navigation";
import { getSessionRole } from "@/lib/auth/session";
```

and inside `CustomerLayout`, as the first statements:

```tsx
  if ((await getSessionRole()) === "store") redirect("/store");
```

This covers `/home`, `/menu`, `/cart`, `/checkout`, `/profile`, `/rewards` (all under the `(customer)` group). `/admin` is already blocked for non-admins by `isAdmin()`, and `/manage` is blocked because `store` is not in `MANAGE_ROLES`.

- [ ] **Step 8: Typecheck + lint, then manual flow**

Run: `npx tsc --noEmit && npm run lint`
Manual (with the kiosk account enabled + passcode set, and Email provider enabled in Supabase Auth — see Task 11 prerequisites):
1. Visit `/store` while logged out → redirected to `/store/login`.
2. Enter the passcode → land on `/store` menu.
3. Tap a drink → `/store/[slug]`, customize, "Add to Cart" → returns to `/store`.
4. Idle ~90s with an item in cart → returns to `/store` with cart cleared.
5. As the store session, manually visit `/menu` → redirected back to `/store`.

- [ ] **Step 9: Commit**

```bash
git add "app/(store)/layout.tsx" components/store/store-shell.tsx "app/(store)/store/login/page.tsx" components/store/store-login-form.tsx "app/(store)/store/(kiosk)/layout.tsx" "app/(store)/store/(kiosk)/page.tsx" "app/(store)/store/(kiosk)/[slug]/page.tsx" "app/(customer)/layout.tsx"
git commit -m "feat(store): kiosk route group, passcode login, gate, menu, product"
```

---

## Task 9: Store cart, checkout (cash/QR), place-order action, confirmation

**Files:**
- Create: `app/(store)/store/(kiosk)/cart/page.tsx`
- Create: `components/store/store-cart.tsx`
- Create: `app/(store)/store/(kiosk)/checkout/page.tsx`
- Create: `components/store/store-checkout.tsx`
- Create: `app/(store)/store/(kiosk)/actions.ts`

**Interfaces:**
- Consumes: `useCart`, `formatPrice` (`lib/format`), `getPaymentSettings`, `getStoreSettingsForCheckout`, `getSessionRole`, `getStoreAccountEnabled`, `createOrder`, `buildOrderMessage`, `sendTelegramMessage`, store constants, `images` (`constants/images`).
- Produces:
  - `placeStoreOrder(input): Promise<{ ok: true; orderNumber: string } | { ok: false; error: string }>`.
  - Lean store cart + cash/QR checkout + confirmation that auto-resets to `/store`.

- [ ] **Step 1: Place-order server action**

Create `app/(store)/store/(kiosk)/actions.ts`:

```typescript
"use server";

import { createOrder } from "@/lib/orders/store";
import { createClient } from "@/lib/supabase/server";
import { getSessionRole } from "@/lib/auth/session";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";
import { getStoreSettingsForCheckout } from "@/lib/settings/store";
import { getPaymentSettings } from "@/lib/settings/payments";
import { buildOrderMessage } from "@/lib/orders/message";
import { sendTelegramMessage } from "@/lib/telegram";
import type { OrderLine } from "@/types/order";
import { STORE_OWNER_ID } from "@/constants/store";

type StoreOrderItem = {
  productId: string;
  name: string;
  quantity: number;
  sizeName?: string;
  addonNames: string[];
  unitPrice: number;
};

export type PlaceStoreOrderInput = {
  items: StoreOrderItem[];
  paymentMethod: "cash" | "duitnow-qr";
  notes?: string;
  subtotal: number;
  total: number;
};

export type PlaceStoreOrderResult =
  | { ok: true; orderNumber: string }
  | { ok: false; error: string };

export async function placeStoreOrder(
  input: PlaceStoreOrderInput,
): Promise<PlaceStoreOrderResult> {
  if (input.items.length === 0) return { ok: false, error: "The order is empty." };

  // Defense in depth (the kiosk layout already gates these).
  if ((await getSessionRole()) !== "store") return { ok: false, error: "Not authorized." };
  if (!(await getStoreAccountEnabled())) return { ok: false, error: "Store ordering is off." };

  const settings = await getStoreSettingsForCheckout();
  if (!settings.isOpen) return { ok: false, error: settings.closedMessage };

  // The chosen method must be enabled server-side.
  const payments = await getPaymentSettings();
  const cashOk = payments.categories.cash && payments.methods.cash;
  const qrOk = payments.categories.qr && payments.methods["duitnow-qr"];
  if (input.paymentMethod === "cash" && !cashOk)
    return { ok: false, error: "Cash is not available." };
  if (input.paymentMethod === "duitnow-qr" && !qrOk)
    return { ok: false, error: "QR is not available." };

  // Re-validate availability against the live catalogue.
  const supabase = await createClient();
  const productIds = [...new Set(input.items.map((i) => i.productId).filter(Boolean))];
  if (productIds.length > 0) {
    const { data: prods, error } = await supabase
      .from("products")
      .select("id, is_available")
      .in("id", productIds);
    if (error) return { ok: false, error: "Couldn't verify availability. Try again." };
    const ok = new Map((prods ?? []).map((p) => [p.id, p.is_available]));
    const blocked = [
      ...new Set(input.items.filter((i) => ok.get(i.productId) !== true).map((i) => i.name)),
    ];
    if (blocked.length > 0)
      return { ok: false, error: `No longer available: ${blocked.join(", ")}.` };
  }

  const lines: OrderLine[] = input.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    sizeName: item.sizeName,
    addonNames: item.addonNames,
    unitPrice: item.unitPrice,
    lineTotal: item.unitPrice * item.quantity,
    status: "pending",
  }));

  let order;
  try {
    order = await createOrder(
      {
        ownerId: STORE_OWNER_ID,
        paymentMethod: input.paymentMethod,
        items: lines,
        subtotal: input.subtotal,
        total: input.total,
        notes: input.notes?.trim() || undefined,
        source: "store",
      },
      { userId: null },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: `Couldn't save the order: ${reason}` };
  }

  // No rewards for store orders (no user_id). Notify staff best-effort.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const manageUrl = `${baseUrl}/manage/${order.token}`;
  const canUseButton = /^https:\/\//i.test(manageUrl) && !/localhost|127\.0\.0\.1/.test(manageUrl);
  try {
    await sendTelegramMessage(
      buildOrderMessage(order, manageUrl, !canUseButton),
      canUseButton ? { buttons: [[{ text: "📋 Manage Order", url: manageUrl }]] } : {},
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    console.error(`Store order ${order.orderNumber} placed but Telegram notice failed: ${reason}`);
  }

  return { ok: true, orderNumber: order.orderNumber };
}
```

> Confirm `sendTelegramMessage`'s import path and options shape against `app/(customer)/checkout/actions.ts` (it uses the same helper); mirror exactly.

- [ ] **Step 2: Store cart page + component**

Create `app/(store)/store/(kiosk)/cart/page.tsx`:

```tsx
import { StoreCart } from "@/components/store/store-cart";

export const dynamic = "force-dynamic";

export default function StoreCartPage() {
  return <StoreCart />;
}
```

Create `components/store/store-cart.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useCart } from "@/store/cart";
import { formatPrice } from "@/lib/format";

export function StoreCart() {
  const router = useRouter();
  const { items, totalPrice, incrementItem, decrementItem, removeItem, hydrated } = useCart();

  if (hydrated && items.length === 0) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-muted-foreground">No items yet.</p>
        <Link href="/store" className="h-12 rounded-2xl bg-black px-6 py-3 text-sm font-semibold text-white">
          Browse menu
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <h1 className="font-heading text-lg font-bold uppercase tracking-wider">Order</h1>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-3 py-3">
            <div className="flex-1">
              <p className="text-sm font-semibold">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {[item.sizeName, ...item.addonNames].filter(Boolean).join(", ")}
              </p>
              <p className="text-xs font-medium">{formatPrice(item.unitPrice * item.quantity)}</p>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-neutral-100 p-1">
              <button type="button" aria-label="Decrease" onClick={() => decrementItem(item.key)} className="flex size-9 items-center justify-center rounded-full hover:bg-white">
                <Minus className="size-4" />
              </button>
              <span className="w-6 text-center text-sm font-bold tabular-nums">{item.quantity}</span>
              <button type="button" aria-label="Increase" onClick={() => incrementItem(item.key)} className="flex size-9 items-center justify-center rounded-full hover:bg-white">
                <Plus className="size-4" />
              </button>
            </div>
            <button type="button" aria-label="Remove" onClick={() => removeItem(item.key)} className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:text-rose-600">
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-border bg-background py-4">
        <span className="text-base font-bold">{formatPrice(totalPrice)}</span>
        <button type="button" onClick={() => router.push("/store/checkout")} className="h-12 flex-1 rounded-2xl bg-black text-sm font-semibold text-white">
          Checkout
        </button>
      </div>
    </div>
  );
}
```

> Confirm `useCart` exposes `totalPrice`, `incrementItem`, `decrementItem`, `removeItem`, `hydrated` (it does per `store/cart.tsx`). If a name differs, match the store's actual API.

- [ ] **Step 3: Checkout page + component**

Create `app/(store)/store/(kiosk)/checkout/page.tsx`:

```tsx
import { getPaymentSettings } from "@/lib/settings/payments";
import { getStoreSettingsForCheckout } from "@/lib/settings/store";
import { StoreCheckout } from "@/components/store/store-checkout";

export const dynamic = "force-dynamic";

export default async function StoreCheckoutPage() {
  const [payments, settings] = await Promise.all([
    getPaymentSettings(),
    getStoreSettingsForCheckout(),
  ]);
  const cashOk = payments.categories.cash && payments.methods.cash;
  const qrOk = payments.categories.qr && payments.methods["duitnow-qr"];
  return (
    <StoreCheckout
      cashOk={cashOk}
      qrOk={qrOk}
      qrUrl={payments.duitnowQrUrl}
      closedMessage={settings.isOpen ? null : settings.closedMessage}
    />
  );
}
```

Create `components/store/store-checkout.tsx`:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SmartImage } from "@/components/ui/smart-image";
import { useCart } from "@/store/cart";
import { formatPrice } from "@/lib/format";
import { images } from "@/constants/images";
import { STORE_CONFIRMATION_RESET_MS } from "@/constants/store";
import { placeStoreOrder } from "@/app/(store)/store/(kiosk)/actions";

type Method = "cash" | "duitnow-qr";

export function StoreCheckout({
  cashOk,
  qrOk,
  qrUrl,
  closedMessage,
}: {
  cashOk: boolean;
  qrOk: boolean;
  qrUrl: string | null;
  closedMessage: string | null;
}) {
  const router = useRouter();
  const { items, totalPrice, notes, clear } = useCart();
  const [method, setMethod] = useState<Method | null>(cashOk ? "cash" : qrOk ? "duitnow-qr" : null);
  const [showQr, setShowQr] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Confirmation auto-resets to the menu for the next customer.
  useEffect(() => {
    if (!placed) return;
    const t = setTimeout(() => {
      clear();
      router.push("/store");
    }, STORE_CONFIRMATION_RESET_MS);
    return () => clearTimeout(t);
  }, [placed, clear, router]);

  if (placed) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm uppercase tracking-wider text-muted-foreground">Order placed</p>
        <p className="font-heading text-4xl font-bold">{placed}</p>
        <p className="text-sm text-muted-foreground">Show this number at the counter.</p>
        <button type="button" onClick={() => { clear(); router.push("/store"); }} className="mt-4 h-12 rounded-2xl bg-black px-6 text-sm font-semibold text-white">
          Start new order
        </button>
      </div>
    );
  }

  function submit() {
    if (!method) return;
    if (method === "duitnow-qr" && !showQr) {
      setShowQr(true);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await placeStoreOrder({
        items: items.map((i) => ({
          productId: i.productId,
          name: i.name,
          quantity: i.quantity,
          sizeName: i.sizeName,
          addonNames: i.addonNames,
          unitPrice: i.unitPrice,
        })),
        paymentMethod: method,
        notes: notes || undefined,
        subtotal: totalPrice,
        total: totalPrice,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPlaced(res.orderNumber);
    });
  }

  if (closedMessage) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">{closedMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      <h1 className="font-heading text-lg font-bold uppercase tracking-wider">Pay</h1>

      <div className="flex flex-col gap-2">
        {cashOk && (
          <button type="button" onClick={() => { setMethod("cash"); setShowQr(false); }} aria-pressed={method === "cash"} className={`h-14 rounded-2xl border text-sm font-semibold ${method === "cash" ? "border-black bg-black text-white" : "border-border bg-white"}`}>
            Cash
          </button>
        )}
        {qrOk && (
          <button type="button" onClick={() => setMethod("duitnow-qr")} aria-pressed={method === "duitnow-qr"} className={`h-14 rounded-2xl border text-sm font-semibold ${method === "duitnow-qr" ? "border-black bg-black text-white" : "border-border bg-white"}`}>
            DuitNow QR
          </button>
        )}
        {!cashOk && !qrOk && (
          <p className="text-sm text-muted-foreground">Ordering is temporarily unavailable.</p>
        )}
      </div>

      {method === "duitnow-qr" && showQr && (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-neutral-50 p-6">
          <div className="relative size-64">
            <SmartImage src={qrUrl ?? images.qrDuitnow} alt="DuitNow QR" fill sizes="256px" className="object-contain" />
          </div>
          <p className="text-sm text-muted-foreground">Scan to pay, then tap Place order.</p>
        </div>
      )}

      <div className="flex items-center justify-between text-base font-bold">
        <span>Total</span>
        <span>{formatPrice(totalPrice)}</span>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <button type="button" onClick={submit} disabled={pending || !method || items.length === 0} className="h-14 rounded-2xl bg-black text-base font-semibold text-white disabled:opacity-40">
        {method === "duitnow-qr" && !showQr ? "Show QR" : "Place order"}
      </button>
    </div>
  );
}
```

> Confirm `useCart` exposes `notes`. It does (`store/cart.tsx`). Confirm `images.qrDuitnow` exists in `constants/images.ts` (it does).

- [ ] **Step 4: Typecheck + lint, then manual end-to-end**

Run: `npx tsc --noEmit && npm run lint`
Manual: build an order → `/store/cart` → "Checkout" → choose Cash → "Place order" → see order number → auto-returns to `/store` with empty cart. Repeat choosing DuitNow QR → "Show QR" shows the image → "Place order".

Verify persistence + no rewards:
```sql
select order_number, source, payment_method, user_id from public.orders order by created_at desc limit 3;
-- Expected: newest rows source = 'store', user_id null.
select count(*) from public.bean_transactions
where created_at > now() - interval '10 minutes';
-- Expected: 0 (store orders never touch beans).
```
Confirm the order also appears on the staff `/manage` board with the "Source: Store Kiosk" line in the Telegram notice.

- [ ] **Step 5: Commit**

```bash
git add "app/(store)/store/(kiosk)/cart/page.tsx" components/store/store-cart.tsx "app/(store)/store/(kiosk)/checkout/page.tsx" components/store/store-checkout.tsx "app/(store)/store/(kiosk)/actions.ts"
git commit -m "feat(store): kiosk cart, cash/QR checkout, place-order, confirmation"
```

---

## Task 10: Reports — online vs in-store split

**Files:**
- Modify: `lib/analytics/reports.ts`
- Modify: `lib/analytics/types.ts`
- Modify: `components/admin/reports-view.tsx`

**Interfaces:**
- Consumes: `getReportData` (existing), `ReportData` (existing).
- Produces: `ReportData.totalsBySource: { online: { orders: number; revenue: number }; store: { orders: number; revenue: number } }`, surfaced as two summary stats in the reports view.

> Scope: a totals split (revenue + order count) by source. A per-day trend split is out of scope and intentionally omitted.

- [ ] **Step 1: Read the current shapes**

Read `lib/analytics/reports.ts`, `lib/analytics/types.ts`, and `components/admin/reports-view.tsx` to confirm field names (`ReportData`, the orders `.select(...)`, the completed-order filter, and how `totals` is rendered).

- [ ] **Step 2: Add `source` to the query + compute the split**

In `lib/analytics/reports.ts`:
1. Add `source` to the orders select:

```typescript
    .select("id, status, total, payment_method, source, created_at");
```

2. After the existing `completed` array is computed, add:

```typescript
  const bySource = (src: "online" | "store") => {
    const rows = completed.filter((o) => (o.source ?? "online") === src);
    return { orders: rows.length, revenue: rows.reduce((s, o) => s + o.total, 0) };
  };
  const totalsBySource = { online: bySource("online"), store: bySource("store") };
```

3. Add `totalsBySource` to the returned object:

```typescript
    totalsBySource,
```

- [ ] **Step 3: Extend the type**

In `lib/analytics/types.ts`, add to the `ReportData` type:

```typescript
  totalsBySource: {
    online: { orders: number; revenue: number };
    store: { orders: number; revenue: number };
  };
```

- [ ] **Step 4: Surface it in the view**

In `components/admin/reports-view.tsx`, find where `totals` is displayed and add two stat cards near it (use the existing `formatPrice`/currency helper that file already imports; if it formats sen elsewhere, reuse that exact helper):

```tsx
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Online</p>
          <p className="text-lg font-bold">{data.totalsBySource.online.orders} orders</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">In-store</p>
          <p className="text-lg font-bold">{data.totalsBySource.store.orders} orders</p>
        </div>
      </div>
```

(Match the variable name the component uses for the report data — it may be `initial`, `report`, or `data`. Use whatever that file already binds.)

- [ ] **Step 5: Typecheck + lint, then manual check**

Run: `npx tsc --noEmit && npm run lint`
Manual: with at least one online order and one store order completed, open `/admin/reports` and confirm the Online vs In-store counts are correct.

- [ ] **Step 6: Commit**

```bash
git add lib/analytics/reports.ts lib/analytics/types.ts components/admin/reports-view.tsx
git commit -m "feat(store): split reports totals by order source"
```

---

## Task 11: Prerequisites check, full build, end-to-end verification

**Files:** none (configuration + verification).

**Interfaces:** none.

- [ ] **Step 1: Confirm Supabase Auth prerequisites**

In the Supabase dashboard (Authentication → Providers/Settings), confirm:
- **Email provider is enabled** with **password sign-in allowed** (the kiosk logs in with email+password). It is enabled by default; if it was disabled, enable it.
- Email confirmations don't block the kiosk user (we create it with `email_confirm: true`, so no email step is required).

Confirm env vars exist: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SITE_URL`.

- [ ] **Step 2: Full build**

Run: `npm run lint && npx tsc --noEmit && npm run build`
Expected: all pass, no type/lint errors.

- [ ] **Step 3: Role-isolation checks (manual)**

1. As the **store** account, try to visit `/admin` and `/profile` → confirm you cannot use the CMS/customer surfaces (gated/redirected). (Store role is not admin, so `/admin` redirects via `isAdmin()`.)
2. As a **customer/admin**, visit `/store` → confirm you're redirected to `/store/login`, and `/store/login` redirects you back to `/` (non-store signed-in users).
3. **Disable** store ordering in `/admin/settings`, then on the kiosk tablet navigate/refresh → confirm it bounces to `/store/login` showing "off" and that re-enabling requires re-entering the passcode (the device was signed out).

- [ ] **Step 4: Rewards-isolation check (manual + SQL)**

Place a store order, then:
```sql
select count(*) from public.bean_transactions where order_id in (
  select id from public.orders where source = 'store'
);
-- Expected: 0.
```

- [ ] **Step 5: Final commit (if any docs/notes changed)**

```bash
git add -A
git commit -m "chore(store): verify build + end-to-end kiosk flow" --allow-empty
```

---

## Notes / known limitations (by design)

- **Sleeping-tablet edge case:** "Disable" signs out tablets that make a request while disabled. A tablet that stays fully asleep across the entire disable→enable window keeps its old session. Acceptable for a staff-controlled counter device; documented for operators.
- **Shared credential:** anyone who knows the passcode can sign in from anywhere. "In-store only" is enforced operationally (passcode secrecy) plus the locked, nav-free UI — matching the chosen access model.
- **No automated tests:** the repo has no test runner and AGENTS.md forbids adding libraries without approval, so verification is lint + typecheck + build + SQL + manual flows. If automated coverage is later desired, propose a framework first.
```
