# Store Mode as a Session Layer

**Date:** 2026-06-22
**Status:** Approved design, pending implementation plan

## Problem

Today, entering the in-store kiosk means signing in as a dedicated Supabase
account (`store@naise.coffee`) via `signInWithPassword`
(`components/store/store-login-form.tsx:28`). That swap **replaces** the current
browser session.

Consequences for a signed-in staff/admin:

1. To take a counter order on the kiosk, they must sign out of their own
   account, enter the store, order, sign out of the store, sign back into their
   account, then go to `/manage`.
2. A signed-in non-store user who navigates to `/store/login` is redirected to
   `/` (`app/(store)/store/login/page.tsx:12`), so there's no graceful way in.

We want store mode to **layer on top of whatever session already exists**
(admin, manager, staff, customer, or guest) instead of replacing it. Exiting the
store then drops the layer and returns the user to exactly where they were — no
re-login. Guests return to guest mode.

## Key Insight

Store-attributed order insertion already bypasses RLS through the service-role
admin client: `createOrder(draft, { userId: null })` selects
`createAdminClient()` whenever `userId` is null (`lib/orders/store.ts:36`). Kiosk
orders pass `userId: null` and `ownerId: STORE_OWNER_ID`
(`app/(store)/store/(kiosk)/actions.ts:87,95`).

Therefore **nobody needs to be authenticated as the store account to place a
store order.** The only runtime dependencies on the store session are guard
checks (`getSessionRole() === "store"`) and the kill-switch read. Both can be
decoupled. Store mode can become a verified flag, not a session.

## Decision

**Approach A — Store mode as a verified, signed httpOnly cookie.**

Entering the store verifies the passcode server-side (without signing anyone in)
and sets a signed httpOnly `naise_store` cookie. The user's real Supabase session
(or guest state) is never modified. Exiting clears the cookie. Because the
original session is never touched, return-to-app is automatic and reliable.

Rejected alternative — **Approach B** (swap to the store account, then stash and
restore the original session tokens on exit): keeps the kiosk internals
unchanged but requires juggling/restoring auth tokens and stashing a privileged
refresh token on the device. More failure modes, weaker guarantee. Not chosen.

## What Changes

### New: `lib/auth/store-mode.ts`

Server-only helpers for the store-mode cookie.

- `STORE_MODE_COOKIE = "naise_store"`.
- `signStoreToken()` / `verifyStoreToken(value)` — HMAC over a payload, keyed by
  the existing `SUPABASE_SERVICE_ROLE_KEY` (no new env var). The token's job is
  to prevent trivial client-side forgery of the cookie; the authoritative
  revocation path remains the `is_enabled` kill switch, re-checked every request.
- `inStoreMode(): Promise<boolean>` — reads the cookie from `next/headers` and
  returns whether it carries a valid signature. Cookie-only; does **not** check
  `is_enabled` (callers that need the kill switch call `getStoreAccountEnabled()`
  too, as the kiosk layout already does).
- Cookie attributes: `httpOnly`, `secure`, `sameSite: "lax"`, `path: "/"`,
  long-lived (so a dedicated kiosk tablet survives reboots; revocation is the
  kill switch, not expiry).

### New: server actions for enter/exit

Location: a server action module under the store route group (e.g.
`app/(store)/store/actions.ts`) or `lib/auth/store-mode-actions.ts`.

- `enterStoreMode(passcode: string): Promise<{ ok: true } | { ok: false; error: string }>`
  1. If `!(await getStoreAccountEnabled())` → `{ ok: false, error: "Store ordering is off." }`.
  2. Verify the passcode by calling `signInWithPassword({ email: STORE_ACCOUNT_EMAIL, password: passcode })`
     on a **non-persisting** client (`createPublicClient()`, which has
     `persistSession: false`, so no cookies are written and the caller's session
     is untouched). On auth error → `{ ok: false, error: "Incorrect passcode." }`.
  3. On success, set the signed `naise_store` cookie. Return `{ ok: true }`.
- `exitStoreMode(): Promise<void>` — delete the `naise_store` cookie.

Passcode verification reuses the admin-rotatable store account password — no new
secret and no change to the existing rotation/enable CMS flow. Brute-force risk
is unchanged from today (login and exit already call `signInWithPassword`); a
server-side throttle is out of scope for this change.

### New: shared `StorePasscodePrompt` UI

A single client component rendering the passcode entry (input + Enter + error +
optional Cancel + "ordering off" disabled state). Used in two places:

1. **Hidden enter gesture** — `components/store/store-enter.tsx` (mirrors
   `store-exit.tsx`): an invisible fixed **top-left** corner button on every
   customer screen; press-and-hold ~1.2s opens `StorePasscodePrompt` as a modal.
   On success → `router.push("/store")` + `router.refresh()`. **Cancel** closes
   the modal and leaves the user on their current screen. Mounted in
   `app/(customer)/layout.tsx`. Top-left avoids the customer header's right-side
   buttons; the store exit stays top-right.
2. **Direct navigation** — `/store/login` (and any `/store/*` while not in store
   mode, which the kiosk layout redirects to `/store/login`) renders
   `StorePasscodePrompt` full-screen with a **Cancel / Back to app** that returns
   to `/`. No more redirect-to-`/` for signed-in users.

Both submit through `enterStoreMode`. The current `store-login-form.tsx` is
replaced/refactored into this shared prompt; it no longer calls client-side
`signInWithPassword`.

### Changed: exit gesture

`components/store/store-exit.tsx` keeps the press-and-hold + passcode gate (so a
customer on a dedicated tablet cannot escape the kiosk), but on confirm it calls
`exitStoreMode()` instead of `auth.signInWithPassword` + `auth.signOut()`. After
clearing the cookie it navigates to `/` (back to the app — the user's real
session if any, otherwise guest). Passcode verification on exit goes through a
dedicated `verifyStorePasscode` server path (the same non-persisting
verification used by `enterStoreMode`) so it never touches the user's session.

### Changed: guards (the swap from role to cookie)

- `lib/settings/store-account.ts` → `getStoreAccountEnabled()` reads via
  `createAdminClient()` (instead of the cookie/RLS client) so it works under any
  session or none.
- `app/(store)/store/(kiosk)/layout.tsx` → replace `role !== "store"` with
  `!(await inStoreMode())`; keep the `getStoreAccountEnabled()` check; both
  failures redirect to `/store/login`. When `is_enabled` is false, also clear the
  cookie so a stale flag never lingers.
- `app/(store)/store/(kiosk)/actions.ts` → `placeStoreOrder` replaces
  `getSessionRole() !== "store"` with `!(await inStoreMode())`. Order attribution
  is unchanged (`STORE_OWNER_ID`, `userId: null`).
- `app/(customer)/layout.tsx` → replace `getSessionRole() === "store"` redirect
  with `inStoreMode()` redirect to `/store`. This preserves the dedicated-kiosk
  lock: while the store cookie is set, customer routes bounce to `/store`.
  `/manage` and other `(admin)` routes are unaffected (different route group), so
  the staff kiosk→manage flow works without exiting store mode.
- `app/(store)/store/login/page.tsx` → if `inStoreMode()` and enabled →
  redirect `/store`; otherwise render the prompt (no signed-in-user redirect).
- `lib/auth/session.ts` → `isStoreMode()` re-points to the cookie
  (`inStoreMode()`), or its callers are updated; audit usages during
  implementation.

### Unchanged

- `store_account` table, provisioning, passcode rotation, and the enable toggle
  in admin.
- `STORE_OWNER_ID` attribution; store orders carry no `user_id` and earn no
  rewards.
- Kiosk cart keys, idle timeout, confirmation reset, and all kiosk UI.
- The `store` Postgres role and enum value remain (vestigial at runtime; no
  migration needed). The `store_account` RLS `read_admin_or_store` policy's store
  branch becomes dead but is left in place.

## Flows

**Staff on their own device:** signed in as admin/staff → hold top-left corner →
passcode → store mode (cookie set, admin session intact) → take counter order
(attributed to store) → hold top-right exit → passcode → cookie cleared → back on
admin session → navigate to `/manage`. No logout anywhere.

**Dedicated kiosk tablet (guest):** guest browser → `/store/login` or hold
gesture → passcode → store mode → orders all night → exit requires passcode →
back to guest customer app. While in store mode, customer routes redirect to
`/store` so a customer can't wander off.

**Wrong passcode / cancel:** wrong passcode → inline error, no state change.
Cancel → modal closes (gesture) or returns to `/` (direct nav); session
untouched in both cases.

## Security Notes

- The `naise_store` cookie is HMAC-signed and httpOnly; it cannot be forged
  without the server secret and is not readable by client JS.
- The kill switch (`store_account.is_enabled`) is re-read server-side on every
  kiosk request via the admin client and fails closed, so disabling ordering
  instantly closes the kiosk regardless of any cookie.
- The service-role key never reaches the client; all privileged reads/writes stay
  in server actions and server-only modules.
- Forging the cookie at most grants store-attributed (no-rewards) counter
  ordering while the kill switch is on — low blast radius — and the HMAC prevents
  even that without the secret.

## Out of Scope

- Server-side passcode rate limiting/throttling.
- Tying cookie validity to `last_rotated_at` (so rotation force-exits existing
  kiosks). Could be added later by including the rotation timestamp in the signed
  payload.
- Removing the vestigial `store` role/enum (separate cleanup migration if ever
  desired).
