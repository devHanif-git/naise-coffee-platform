# Login Required — Remove Guest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a signed-in Supabase session to open a drink, cart, checkout, custom-order, profile, and rewards; keep the menu listing public; and remove the guest-ordering experience.

**Architecture:** Gate each protected route subtree with a tiny server `layout.tsx` that calls a new `requireUser()` helper, which reads the current path from an `x-pathname` request header (set in the Supabase session proxy) and redirects logged-out visitors to `/login?redirect=<path>`. Remove the guest UI (modal, "continue as guest") and tie orders to the authenticated user's id. Store/kiosk mode and admin routes are untouched.

**Tech Stack:** Next.js 16 (App Router, Server Components), TypeScript (strict), Supabase SSR auth (`@supabase/ssr`), Tailwind.

## Global Constraints

- Server Components by default; `"use client"` only for interactive components. (AGENTS.md)
- TypeScript strict, **no `any`**. (AGENTS.md)
- **Do not add any new library** without approval — no test framework is installed; verify with `npx tsc --noEmit` and `npm run lint`. (AGENTS.md)
- Security enforced server-side; never rely on client checks. (AGENTS.md)
- Never expose the service-role key to the client. (AGENTS.md)
- Do not modify store/kiosk mode (`lib/auth/store-mode.ts`, `/store` group, `StoreEnter`) or admin/(admin) routes. (spec §Non-goals, §Untouched)
- `redirect` params must be sanitized to internal paths (start with a single `/`). (spec §Enforcement)
- Leave `owner_id` constants, the guest fallback branch in order reads, and `claim_device_orders` RPC dormant — no DB migration. (spec §"owner_id / claim — left dormant")
- `orders.owner_id` is `text NOT NULL` with a UUID-format check constraint — any value written must be a UUID (the authenticated user's id qualifies).

---

### Task 1: Add `requireUser()` gate helper + `x-pathname` header

Creates the server-side gate used by every protected layout, and makes the proxy expose the request path so post-login can return the user to where they were.

**Files:**
- Modify: `lib/supabase/proxy.ts`
- Modify: `lib/auth/session.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server` (existing async cookie client).
- Produces: `requireUser(): Promise<User>` exported from `@/lib/auth/session` — redirects (never returns) when no user; otherwise returns the Supabase `User`.

- [ ] **Step 1: Thread an `x-pathname` request header through the proxy**

Edit `lib/supabase/proxy.ts`. Replace the body of `updateSession` so the request carries `x-pathname` (so Server Components can read the current path). Full updated file:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";

// Refreshes the Supabase session on every request and syncs cookies onto both
// the request (for Server Components downstream) and the response (for the
// browser). MUST call getClaims() — never getSession() — so the JWT signature
// is validated, not just decoded. Also stamps `x-pathname` on the request so
// server-side gates (requireUser) can build an accurate post-login redirect.
export async function updateSession(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Validates and refreshes the token. Do not remove.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
```

- [ ] **Step 2: Add `requireUser()` to `lib/auth/session.ts`**

Add these imports at the top of `lib/auth/session.ts` (alongside the existing imports):

```ts
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
```

Then append this function to the end of `lib/auth/session.ts`:

```ts
// Server-side route gate. Returns the signed-in user, or redirects logged-out
// visitors to the login screen with a sanitized return path (read from the
// `x-pathname` header the proxy stamps on every request). Call this at the top
// of a protected route's layout — it enforces auth on the server, so direct-URL
// access is blocked, not just clicks.
export async function requireUser(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return user;

  const hdrs = await headers();
  const raw = hdrs.get("x-pathname") || "/menu";
  // Only internal paths — never an absolute or protocol-relative URL.
  const safe = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/menu";
  redirect(`/login?redirect=${encodeURIComponent(safe)}`);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the new `requireUser` symbol resolves; `User` type imported).

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/proxy.ts lib/auth/session.ts
git commit -m "feat(auth): add requireUser gate + x-pathname header"
```

---

### Task 2: Gate the protected route subtrees with layouts

Adds one server layout per protected subtree. Each just enforces auth then renders children — nested routes are covered automatically. The menu listing (`/menu`) and home stay public.

**Files:**
- Create: `app/(customer)/menu/[slug]/layout.tsx`
- Create: `app/(customer)/cart/layout.tsx`
- Create: `app/(customer)/checkout/layout.tsx`
- Create: `app/(customer)/custom-order/layout.tsx`
- Create: `app/(customer)/profile/layout.tsx`
- Create: `app/(customer)/rewards/layout.tsx`

**Interfaces:**
- Consumes: `requireUser` from `@/lib/auth/session` (Task 1).
- Produces: nothing imported elsewhere.

- [ ] **Step 1: Create the product-detail gate**

Create `app/(customer)/menu/[slug]/layout.tsx`:

```tsx
import { requireUser } from "@/lib/auth/session";

// Tapping a drink opens its detail/customize page — members only. The menu
// listing (/menu) stays public; this gate covers /menu/<slug> and below.
export default async function ProductGateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return <>{children}</>;
}
```

- [ ] **Step 2: Create the remaining five gates**

Create `app/(customer)/cart/layout.tsx`, `app/(customer)/checkout/layout.tsx`, `app/(customer)/custom-order/layout.tsx`, `app/(customer)/profile/layout.tsx`, and `app/(customer)/rewards/layout.tsx`. Each file has identical contents (repeated here in full — do not abbreviate):

```tsx
import { requireUser } from "@/lib/auth/session";

// Members-only subtree. Logged-out visitors are redirected to /login with a
// return path; this also covers every nested route below.
export default async function GatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return <>{children}</>;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification (logged out)**

Run `npm run dev`. In a logged-out browser (or private window), confirm:
- `/menu` loads (public).
- Visiting `/menu/<any-slug>` directly → redirects to `/login?redirect=%2Fmenu%2F<slug>`.
- `/cart`, `/checkout`, `/custom-order`, `/profile`, `/rewards` each redirect to `/login?redirect=…` even via direct URL.
- After Google sign-in you land back on the originally requested path.

- [ ] **Step 5: Manual verification (kiosk untouched)**

With store mode active on the device, confirm the storefront still redirects to `/store` (the `(customer)` layout's store-mode redirect runs before these gates) — no login wall on the kiosk.

- [ ] **Step 6: Commit**

```bash
git add "app/(customer)/menu/[slug]/layout.tsx" "app/(customer)/cart/layout.tsx" "app/(customer)/checkout/layout.tsx" "app/(customer)/custom-order/layout.tsx" "app/(customer)/profile/layout.tsx" "app/(customer)/rewards/layout.tsx"
git commit -m "feat(auth): gate product/cart/checkout/custom-order/profile/rewards"
```

---

### Task 3: Remove "Continue as guest" from the login screen

The login UI is already Google-only (no phone option present). Only the guest escape hatch needs removing.

**Files:**
- Modify: `components/auth-screen.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing.

- [ ] **Step 1: Remove the "Continue as guest" link**

In `components/auth-screen.tsx`, delete this block (the trailing `<Link>` before the closing `</div>`):

```tsx
        <Link
          href={redirect}
          className="mt-1 text-center text-xs font-semibold text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline"
        >
          Continue as guest
        </Link>
```

- [ ] **Step 2: Remove the now-unused `Link` import**

`Link` is only used by the deleted block. Remove its import line:

```tsx
import Link from "next/link";
```

(The back button still uses `router.push(redirect)`, so the `redirect` variable and `useRouter` stay.)

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors, no "unused `Link`" warning.

- [ ] **Step 4: Commit**

```bash
git add components/auth-screen.tsx
git commit -m "feat(auth): remove continue-as-guest from login"
```

---

### Task 4: Strip guest logic from the checkout screen

Removes the guest sign-in nudge and members-only-method gating (every checkout visitor is now authenticated via Task 2's gate), and uses the authenticated user's id where the per-browser owner id was used.

**Files:**
- Modify: `components/checkout-screen.tsx`
- Delete: `components/guest-signin-modal.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `@/store/auth` — now reads `user` (has `user.id: string`) in addition to `isAuthenticated`.
- Produces: calls `placeOrderAction({ ..., ownerId: user.id })` (the action in Task 5 expects `ownerId` to be the authenticated user's id).

- [ ] **Step 1: Delete the guest modal component**

```bash
git rm components/guest-signin-modal.tsx
```

- [ ] **Step 2: Remove guest imports in `components/checkout-screen.tsx`**

Delete these two import lines:

```tsx
import { GuestSignInModal } from "@/components/guest-signin-modal";
```
```tsx
import { getOrCreateOwnerId } from "@/lib/auth/owner-id";
```

- [ ] **Step 3: Read `user` from the auth store**

Replace this line:

```tsx
  const { isAuthenticated, hydrated: authHydrated } = useAuth();
```

with:

```tsx
  const { user } = useAuth();
```

(`isAuthenticated` and `authHydrated` are no longer needed — the route is gated, so every visitor here is signed in.)

- [ ] **Step 4: Remove guest-only state**

Delete these two state hooks:

```tsx
  // Guest nudge shown at Place Order (or when a guest taps a members-only
  // method like Cash). Dismissed by signing in or choosing to continue.
  const [showGuestModal, setShowGuestModal] = useState(false);
```
```tsx
  // Beans this order would earn if the customer were signed in — drives the
  // guest nudge's headline. Mirrors the store's earn rule (floor of RM × rate).
  const beansAtStake = Math.floor((totalPrice / 100) * earnRate);
```

(After removing `beansAtStake`, `earnRate` from `useBeans()` may become unused — if `npm run lint` later flags it, drop `earnRate` from the `useBeans()` destructure. `canAfford` is still used.)

- [ ] **Step 5: Remove the guest method-reconcile effect**

Delete this whole effect:

```tsx
  // A guest can't keep a members-only method (Cash) selected. Once the auth
  // state has loaded, move them to the first non-gated enabled method so the
  // selector never sits on a locked option.
  useEffect(() => {
    if (!authHydrated || isAuthenticated) return;
    const current = methods.find((m) => m.id === selected);
    if (current?.requiresAuth) {
      const fallback = methods.find((m) => !m.requiresAuth);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile selection once auth state is known
      setSelected(fallback ? fallback.id : null);
    }
  }, [authHydrated, isAuthenticated, selected, methods]);
```

- [ ] **Step 6: Simplify `selectMethod` (no guest lock)**

Replace:

```tsx
  // Selecting a members-only method (Cash) as a guest opens the sign-in nudge
  // instead of switching to it; otherwise it's a normal selection.
  function selectMethod(id: PaymentMethodId) {
    const method = methods.find((m) => m.id === id);
    if (!isAuthenticated && method?.requiresAuth) {
      setShowGuestModal(true);
      return;
    }
    setSelected(id);
  }
```

with:

```tsx
  // Every checkout visitor is signed in (the route is gated), so any enabled
  // method — including members-only ones like Cash — is selectable.
  function selectMethod(id: PaymentMethodId) {
    setSelected(id);
  }
```

- [ ] **Step 7: Simplify `onPlaceOrder` (drop guest branch)**

Replace:

```tsx
  function onPlaceOrder() {
    if (submitting) return;
    if (!selected) {
      setError("No payment method is available right now.");
      return;
    }
    if (!isAuthenticated) {
      setShowGuestModal(true);
      return;
    }
    // Member with no number on file (and none entered yet): nudge first.
    if (!resolveContactPhone()) {
      setShowPhonePrompt(true);
      return;
    }
    void placeOrder();
  }
```

with:

```tsx
  function onPlaceOrder() {
    if (submitting) return;
    if (!selected) {
      setError("No payment method is available right now.");
      return;
    }
    // No number on file (and none entered yet): nudge first.
    if (!resolveContactPhone()) {
      setShowPhonePrompt(true);
      return;
    }
    void placeOrder();
  }
```

- [ ] **Step 8: Simplify `placeOrder` and use `user.id` as the owner id**

In `placeOrder(phoneOverride?: string)`, replace this guard:

```tsx
    // Cash is members-only (pay-at-counter); a guest should never reach here
    // with it selected, but guard server-side intent anyway.
    const method = methods.find((m) => m.id === selected);
    if (!method) return;
    if (method.requiresAuth && !isAuthenticated) {
      setShowGuestModal(true);
      return;
    }
```

with:

```tsx
    const method = methods.find((m) => m.id === selected);
    if (!method) return;
    // The route is gated, so a user is always present; guard for types.
    if (!user) return;
```

Then replace the owner-id mint:

```tsx
      // Mint/read the owner id once so the receipt's path prefix matches the
      // ownerId sent to the action (the server validates they agree).
      const ownerId = getOrCreateOwnerId();
```

with:

```tsx
      // Scope the order and receipt path to the signed-in user's id (a UUID,
      // satisfying orders.owner_id). The server validates the receipt path
      // prefix matches this id.
      const ownerId = user.id;
```

And in the `placeOrderAction({...})` call, replace the `ownerId` field comment + value:

```tsx
        // Per-browser stable id; minted on first call and reused thereafter.
        // Same id is adopted by the auth store on sign-in, so guest orders
        // automatically belong to the registered account afterwards.
        ownerId,
```

with:

```tsx
        // The signed-in user's id — scopes the order to their account.
        ownerId,
```

- [ ] **Step 9: Remove the guest modal render block**

Delete this entire block (the `{showGuestModal && (...)}` JSX near the end of the returned markup):

```tsx
      {showGuestModal && (
        <GuestSignInModal
          beansAtStake={beansAtStake}
          redirect="/checkout"
          onClose={() => setShowGuestModal(false)}
          onContinueAsGuest={() => {
            setShowGuestModal(false);
            // Ask the guest for a number first (order-only), unless one was
            // already entered this attempt.
            if (!resolveContactPhone()) {
              setShowPhonePrompt(true);
              return;
            }
            void placeOrder();
          }}
        />
      )}
```

- [ ] **Step 10: Simplify the phone-prompt save (always a member now)**

Replace:

```tsx
          onSubmit={(phone) => {
            setEnteredPhone(phone);
            setShowPhonePrompt(false);
            // Members: also save to their profile for next time. Guests have no
            // profile, so updateProfile no-ops (it early-returns for guests).
            if (isAuthenticated) void updateProfile({ phone });
            // Pass the number explicitly — setEnteredPhone hasn't re-rendered yet.
            void placeOrder(phone);
          }}
```

with:

```tsx
          onSubmit={(phone) => {
            setEnteredPhone(phone);
            setShowPhonePrompt(false);
            // Save to the member's profile for next time.
            void updateProfile({ phone });
            // Pass the number explicitly — setEnteredPhone hasn't re-rendered yet.
            void placeOrder(phone);
          }}
```

- [ ] **Step 11: Typecheck + lint, and resolve any unused symbols**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If lint flags `earnRate`, `useEffect`, or `Lock` (the lock icon was only for the guest-locked method state) as unused, remove them:
- Drop `earnRate` from `const { canAfford, earnRate } = useBeans();` → `const { canAfford } = useBeans();`
- If `useEffect` is still used by the cart-empty redirect effect, keep it; otherwise remove from the React import.
- The `locked` variable and `Lock` icon in the method cards are now always derived from `requiresAuth && !isAuthenticated`; since `isAuthenticated` is removed, delete the `const locked = ...` lines and the `{locked && !active && (...)}` lock-badge JSX in both the featured and "others" method renders, then drop `Lock` from the lucide import.

- [ ] **Step 12: Manual verification**

Logged in: open `/checkout` with items in cart → select Cash (no lock), place order with and without a saved phone number → order succeeds, confirmation shows. No "continue as guest" anywhere.

- [ ] **Step 13: Commit**

```bash
git add components/checkout-screen.tsx
git commit -m "feat(checkout): remove guest flow, scope order to signed-in user"
```

---

### Task 5: Simplify the place-order action for members-only

Every order now has a signed-in user. Reject anonymous calls, always settle Beans/streak, and write the authenticated user's id into `owner_id`.

**Files:**
- Modify: `app/(customer)/checkout/actions.ts`

**Interfaces:**
- Consumes: `createOrder(draft, { userId })` from `@/lib/orders/store` (unchanged signature); `applyOrderRewards`, `cancelOrderAsSystem` (unchanged).
- Produces: `placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>` (unchanged exported shape).

- [ ] **Step 1: Require an authenticated user**

In `app/(customer)/checkout/actions.ts`, find the identity derivation:

```ts
  // Derive identity server-side — never trust a user id from the client.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? null;
```

Immediately after it, add:

```ts
  // Login is required to order. The checkout route is gated, but enforce it
  // here too so the action can never create an unowned order.
  if (!userId) {
    return { ok: false, error: "Please sign in to place your order." };
  }
```

- [ ] **Step 2: Remove the now-redundant stale-reward guest guard**

Delete this block (its case — a reward line with no user — can no longer happen after Step 1, which already returned):

```ts
  // A reward line is a member entitlement, settled against their Bean balance.
  // The cart lives in per-browser localStorage and can outlive the member who
  // redeemed it (sign-out, or a different person on the same device), leaving a
  // stale RM0.00 reward line a guest could otherwise check out for free — no
  // Beans charged, no redemption recorded. Block it. The client also strips
  // these on any identity change, but this is the authoritative guard.
  if (!userId && input.items.some((i) => i.isReward)) {
    return {
      ok: false,
      error: "Please sign in to redeem a reward, or remove it from your cart.",
    };
  }
```

- [ ] **Step 3: Write the user's id into `owner_id`**

In the `createOrder(...)` call, change the `ownerId` passed in the draft from the client value to the server-derived user id. Replace:

```ts
    order = await createOrder(
      {
        ownerId: input.ownerId,
        paymentMethod: input.paymentMethod,
```

with:

```ts
    order = await createOrder(
      {
        // Scope the order to the authenticated user (a UUID, satisfying the
        // orders.owner_id NOT NULL + uuid-format constraint). user_id below is
        // the source of truth; owner_id mirrors it for legacy compatibility.
        ownerId: userId,
        paymentMethod: input.paymentMethod,
```

(The receipt-path validation a few lines above still uses `input.ownerId`, which the client sets to `user.id` — they agree.)

- [ ] **Step 4: Always settle rewards**

Replace:

```ts
  // Settle rewards for members (earn + redeem + streak). Guests earn nothing.
  // If it fails (e.g. a redemption the live balance can't cover after a race),
  // roll the order back so we never keep an unsettled free-drink order, and
  // bail before notifying the store.
  let rewards: OrderRewardsResult | undefined;
  if (userId) {
    const applied = await applyOrderRewards(order.token);
    if (!applied.ok) {
      // The reward RPC raises before inserting any ledger rows, so nothing to
      // reverse — just cancel the just-created order so it never lingers as
      // `pending`. Members can't UPDATE orders under RLS (staff-only), so this
      // rollback must run via the service-role client.
      await cancelOrderAsSystem(order.token);
      return {
        ok: false,
        error: applied.insufficient
          ? "You don't have enough Beans to redeem the reward in your cart. Remove it and try again."
          : "Couldn't apply your rewards. Please try again.",
      };
    }
    rewards = applied.rewards;
  }
```

with:

```ts
  // Settle rewards (earn + redeem + streak). If it fails (e.g. a redemption the
  // live balance can't cover after a race), roll the order back so we never keep
  // an unsettled free-drink order, and bail before notifying the store.
  let rewards: OrderRewardsResult | undefined;
  {
    const applied = await applyOrderRewards(order.token);
    if (!applied.ok) {
      // The reward RPC raises before inserting any ledger rows, so nothing to
      // reverse — just cancel the just-created order so it never lingers as
      // `pending`. Members can't UPDATE orders under RLS (staff-only), so this
      // rollback must run via the service-role client.
      await cancelOrderAsSystem(order.token);
      return {
        ok: false,
        error: applied.insufficient
          ? "You don't have enough Beans to redeem the reward in your cart. Remove it and try again."
          : "Couldn't apply your rewards. Please try again.",
      };
    }
    rewards = applied.rewards;
  }
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (`createOrder`'s `opts.userId` is now always a string here, still valid for its `string | null` parameter.)

- [ ] **Step 6: Manual verification (end to end)**

Logged in, place a normal order and a reward-redemption order:
- Normal order → succeeds; Beans earned (check `/rewards/activity`).
- Reward in cart with enough Beans → succeeds, Beans deducted.
- Reward with insufficient Beans → blocked with the insufficient-Beans message, no lingering `pending` order on the manage board.

- [ ] **Step 7: Commit**

```bash
git add "app/(customer)/checkout/actions.ts"
git commit -m "feat(checkout): require auth in place-order, always settle rewards"
```

---

### Task 6: Final full-flow verification

No code changes — a consolidated pass confirming the whole feature and that untouched areas still work.

**Files:** none.

- [ ] **Step 1: Static checks**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 2: Logged-out matrix**

In a private window: `/menu` and `/` load and are crawlable (view source shows menu content). Tapping a drink → `/login?redirect=/menu/<slug>`. Direct visits to `/cart`, `/checkout`, `/custom-order`, `/profile`, `/rewards` all redirect to `/login`. Tapping the Profile or Rewards tab while logged out → redirects to login. No "Continue as guest"; no phone option on the login screen.

- [ ] **Step 3: Login return**

From a gated redirect, sign in with Google → land back on the originally requested path.

- [ ] **Step 4: Logged-in flow**

Browse → open a drink → customize → add to cart → checkout → place order (with and without saved phone; cash and DuitNow-QR-with-receipt) → confirmation. Beans/streak settle.

- [ ] **Step 5: Kiosk untouched**

Store mode on → storefront redirects to `/store`, no login wall; an in-store order still works.

- [ ] **Step 6: Legacy guest orders intact**

Confirm any pre-existing guest orders still display on the manage board / reports (the dormant `owner_id` read path and `claim_device_orders` RPC were left in place).

---

## Self-Review

**Spec coverage:**
- Public vs gated routes → Task 2 (menu listing public; `[slug]`, cart, checkout, custom-order, profile, rewards gated). ✓
- Server-side enforcement via `requireUser()` + `x-pathname` header + per-subtree layouts → Tasks 1–2. ✓
- Redirect param sanitization → Task 1 Step 2 (`safe` check) and the existing auth-screen guard. ✓
- Google-only / hide phone → already Google-only; Task 3 removes the guest link. ✓
- Remove GuestSignInModal + "continue as guest" + guest checkout branches → Tasks 3–4. ✓
- Action scopes to authenticated user, always settles rewards, stops relying on client owner id → Task 5. ✓
- owner_id/claim left dormant, no migration → owner_id column still written (now = user.id), reads unchanged, RPC untouched; verified Task 6 Step 6. ✓
- Kiosk untouched → no store-mode files modified; verified Task 2 Step 5 & Task 6 Step 5. ✓
- SEO: menu listing stays SSR/public; product pages intentionally gated → Task 2 (accepted tradeoff). ✓
- Tab bar logged-out Profile/Rewards tap → login → covered by the gates (Task 6 Step 2); no tab-bar code change needed. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — all code shown in full. ✓

**Type consistency:** `requireUser(): Promise<User>` defined in Task 1, consumed in Task 2 (awaited, return unused). `useAuth()` `user.id` used in Task 4 matches the `AuthUser` shape in `store/auth.tsx`. `createOrder(draft, { userId })` call in Task 5 unchanged signature; `ownerId` field is `string`. `placeOrderAction` input `ownerId` is `user.id` (Task 4) and the action writes `userId` to the DB (Task 5) — consistent, and the receipt prefix check (`input.ownerId`) equals `user.id`. ✓
