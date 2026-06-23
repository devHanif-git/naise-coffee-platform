# Login Required — Remove Guest Ordering

**Date:** 2026-06-23
**Status:** Approved (design)

## Background

Today the storefront is open: anyone can browse, build a cart, and check out via
WhatsApp without an account. Guest orders are attributed to an anonymous
`owner_id` (localStorage + cookie) that the account adopts when a guest later
registers (`claim_device_orders` RPC). A `GuestSignInModal` nudges guests at
Place Order, and the login screen offers "Continue as guest". Google OAuth is the
only real session; the Phone path is still a localStorage **mock** (no Supabase
session).

The owner wants login to be **required** so the flow is normal and systematic:
logged-out visitors are sent to the login screen, and the guest feature is
removed.

## Goals

- Require a real signed-in session to order.
- Keep the menu listing public and crawlable (SEO).
- Remove the guest-facing experience.
- Do not touch the in-store kiosk (store mode).

## Non-goals

- Wiring Phone login to a real session (deferred — Google-only for now).
- Ripping out `owner_id` / `claim_device_orders` end-to-end (left dormant).
- Any DB migration.
- Changes to admin/(admin) routes or role gating.

## Decisions (from brainstorming)

1. **Gate scope:** Menu listing + home stay public. Tapping a drink (product
   detail), cart, checkout, custom-order, profile, and rewards require login.
2. **Kiosk:** Store mode is exempt and untouched.
3. **Login methods:** Google-only for now; hide the Phone option.
4. **Cleanup:** Lean removal — remove the guest UX and stop relying on
   `owner_id` for new orders, but leave the claim RPC / `owner_id` plumbing
   dormant so legacy guest orders and history don't break.
5. **Tab bar (logged out):** Profile/Rewards tabs stay visible; tapping them
   redirects to login.

## Route classification

**Public** (no login; crawlable):
- `/` (splash → `/menu`), `/home`
- `/menu` (listing)
- `/login`, `/auth/callback`
- static / PWA / SEO files (manifest, robots, sitemap, sw, images)

**Gated** (require Supabase user; logged-out → `/login?redirect=<path>`):
- `/menu/[slug]` (product detail / customize)
- `/cart`, `/checkout`, `/custom-order`
- `/profile` + all subroutes
- `/rewards` + all subroutes

**Exempt / untouched:**
- Kiosk `/store` and all store-mode code. The customer layout already redirects
  store-mode devices to `/store` before any gated page renders, so kiosk
  walk-ins never reach the login wall.
- Admin/(admin) routes (already role-gated).

## Enforcement

Server-side, secure (blocks direct-URL access, not just clicks).

- **`requireUser()`** in `lib/auth/session.ts`: calls `auth.getUser()`; if no
  user, `redirect()` to `/login?redirect=<current path>`.
- The current path comes from an **`x-pathname` header** set by
  `middleware.ts` / `lib/supabase/proxy.ts` (one-line addition), so post-login
  returns the user to the exact page.
- A small **gated `layout.tsx`** at each gated subtree calls `await
  requireUser()` then renders children:
  - `app/(customer)/menu/[slug]/layout.tsx`
  - `app/(customer)/cart/layout.tsx`
  - `app/(customer)/checkout/layout.tsx`
  - `app/(customer)/custom-order/layout.tsx`
  - `app/(customer)/profile/layout.tsx`
  - `app/(customer)/rewards/layout.tsx`

  (If a layout already exists for one of these, add the call to it instead of
  creating a new file.)

This approach is chosen over middleware gating because store mode uses
`node:crypto` (awkward on the edge runtime) and Server Component layouts keep the
kiosk logic exactly where it is.

**Redirect safety:** the `redirect` param is sanitized to internal paths only
(must start with a single `/`, reject `//` and absolute URLs) before being used
for navigation after login.

## Login screen changes

- Hide/remove the **Phone** option (Google-only).
- Remove **"Continue as guest"** from `components/auth-screen.tsx`.
- Continue to honor `?redirect=` (already supported) with the sanitization above.

## Remove guest experience (lean)

- Delete `components/guest-signin-modal.tsx`.
- `components/checkout-screen.tsx`:
  - Remove `showGuestModal` state, the `GuestSignInModal` render, and the
    "continue as guest" handler.
  - Remove the "members-only method" guest branches — Cash is always available
    now.
  - Keep the number-prompt sheet **only** for a signed-in member with no saved
    phone; drop its guest framing.
- `app/(customer)/checkout/actions.ts`:
  - Every order now has a signed-in user — scope to the authenticated user.
  - Drop the "guests earn nothing" branch — always settle Beans / streak.
  - Stop requiring/passing `owner_id` for new orders (write `user_id`).
- Order reads (`lib/orders/store.ts`): use the member branch (match on
  `user_id`).

## owner_id / claim — left dormant

- Stop minting/relying on `owner_id` for new flows: the auth store
  (`store/auth.tsx`) no longer needs to mint it on every render, and checkout no
  longer passes it.
- **Keep** the `owner_id` constants, the guest fallback branch in order queries
  (`owner_id AND user_id IS NULL`), and the `claim_device_orders` RPC so any
  pre-existing guest orders / history still resolve. No migration.

## Untouched

- Store/kiosk mode (`lib/auth/store-mode.ts`, `/store` group, `StoreEnter`).
- Admin/(admin) routes and role gating.
- Realtime, Beans/rewards logic for members.

## SEO tradeoff (accepted)

The menu **listing** stays SSR/crawlable. Gating `/menu/[slug]` means **product
detail pages are no longer crawlable** — the direct consequence of "press a drink
→ sign in." If product-page indexing is wanted later, render the page publicly and
gate only the add/customize action. Proceeding gated as specified.

## Verification

- **Logged out:** `/menu` and `/` load; tapping a drink →
  `/login?redirect=/menu/<slug>`; after Google sign-in → back on that drink.
  `/cart`, `/checkout`, `/profile`, `/rewards`, `/custom-order` redirect to login
  even via direct URL. No "continue as guest"; no phone option.
- **Logged in:** full order flow works end-to-end; Beans/streak settle.
- **Kiosk:** store mode → `/store` flow unaffected, no login wall.

### Edge cases

- Direct URL to a gated route while logged out → server redirect (handled by
  `requireUser` in the layout).
- `redirect` param sanitized to internal paths.
- Tab bar Profile/Rewards while logged out → tap redirects to login.
