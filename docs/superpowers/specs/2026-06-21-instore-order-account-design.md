# In-Store Order-Only "Store" Account — Design

**Date:** 2026-06-21
**Status:** Approved (design)
**Author:** brainstorming session

---

## 1. Summary

Add an **order-only "store mode"** to NAISE COFFEE for in-store ordering on a shared
tablet at the counter. A device signs in once with an admin-managed **passcode** and is
then locked to a single flow: **menu → product (full customization) → cart → checkout →
pay**. No home, profile, rewards, or customer sign-in are reachable in this mode.

In-store orders flow into the **same** staff `/manage` board and Telegram alerts as online
orders, but are tagged `source = 'in_store'` so reports can split in-store vs online.
**In-store orders never earn or redeem beans/rewards.**

The screen is **self-serve-first** (a stranger may tap it) but also usable by staff, and the
UI is **optimized for tablet** (the rest of the app stays mobile-first).

---

## 2. Goals & non-goals

### Goals
- One shared, admin-managed **passcode login** for the store device (enable / disable / rotate).
- A locked kiosk surface: only the order flow, no customer/admin surfaces.
- Full product customization (size, ice, sugar, add-ons) reused from the customer app.
- Cash or QR payment only; QR just displays the store DuitNow QR (nothing saved/uploaded).
- Order identified by **order number only** (no name, phone, or WhatsApp "ready" message).
- Orders tracked on the existing board + Telegram, tagged `in_store`, split in reports.
- Auto-reset + idle timeout so an abandoned order never greets the next customer.
- Tablet-optimized layout.

### Non-goals
- No rewards/beans, referrals, or streaks for in-store orders (ever).
- No proof-of-payment upload or receipt storage for in-store orders.
- No customer accounts, names, phones, or notifications for in-store orders.
- No new auth framework — reuse Supabase Auth.
- No push notifications (out of scope, as in the rest of the app).

---

## 3. Decisions (locked during brainstorming)

| Topic | Decision |
| --- | --- |
| Operator | Either customer self-serve or staff; **design for the stricter self-serve case**. |
| Access model | **Shared store login with a passcode**, admin-managed (enable / disable / rotate). |
| Auth implementation | A real Supabase auth user with a new `store` role; **passcode = the user's password**. |
| Payment | **Cash or QR only**. QR displays the store DuitNow QR; nothing saved, no proof upload. |
| Order identity | **Order number only** — no name/phone/WhatsApp. |
| Tracking | Same `/manage` board + Telegram, tagged `source = 'in_store'`; reports split online vs in-store; **never any beans**. |
| Customization | **Full** product customization, reusing existing components. |
| Reset | **Auto-reset to menu + clear cart after pay, plus idle timeout** for abandoned carts. |
| Layout | **Tablet-optimized** for `/store/*` only; rest of app stays mobile-first. |

---

## 4. Chosen approach

**Approach A — dedicated `store` role as a real Supabase account.**

- Add `store` to the role set used by `profiles`.
- Admin "enables" the store account by setting a passcode; a service-role server action
  provisions a single Supabase auth user (e.g. `store@naise.local`) whose **password is the
  passcode**, with a `profiles` row `role = 'store'`. Rotating = updating that password.
- The tablet signs in once via a passcode screen; the Supabase session cookie persists and
  is refreshed by the existing middleware. Rotating the passcode (plus "sign out devices")
  forces re-login.
- Reuses Supabase Auth + RLS instead of a hand-rolled session, satisfying the project rule
  "use Supabase Auth, don't build custom auth."

Rejected:
- **B — cookie kiosk with hashed passcode in a table:** effectively custom auth; weaker
  security; re-implements session/expiry.
- **C — public kiosk URL reusing guest checkout:** doesn't deliver the shared passcode login
  or strong lockdown; anyone with the URL could order.

---

## 5. Architecture

New route group with a locked kiosk shell:

```
app/(store)/
  layout.tsx           # gate: session role must be 'store', else redirect to /store/login
  store/
    login/page.tsx     # passcode entry (only screen an un-authed store device sees)
    page.tsx           # THE menu screen (reuses MenuBrowser)
    [slug]/page.tsx    # product customization (reuses existing product flow)
    cart/page.tsx      # cart review (no rewards UI)
    checkout/page.tsx  # cash / QR pay step
    actions.ts         # placeStoreOrder() server action
```

### Lockdown (defense in depth)
- `middleware.ts`: if the session role is `store`, force every path into `/store/*`; block
  `/admin`, `/profile`, `/rewards`, `/home`, and the customer `/checkout`.
- Conversely, non-`store` roles visiting `/store/*` are redirected back to their normal app.
- The kiosk shell exposes **no nav** beyond the order flow. No customer-visible sign-out;
  exiting store mode is a discreet staff gesture (see §8).

### Why passcode maps cleanly to Supabase
The passcode **is** the account password, so we get a real session, cookie refresh via the
existing middleware, and RLS role gating — with no custom session mechanism.

---

## 6. Database changes (one reversible migration)

1. **Extend the role set.** Add `store` to the roles used by `profiles`. Follow the existing
   pattern (enum vs check constraint — see `*_profiles_guard_role` migration). The signup
   trigger / role guard must prevent `store` from being self-assigned; only the admin
   provisioning action may set it.

2. **`orders.source` column.**
   ```sql
   alter table orders
     add column source text not null default 'online'
     check (source in ('online','in_store'));
   create index orders_source_idx on orders (source);
   ```
   Existing rows backfill to `'online'` via the default. Store checkout writes `'in_store'`.

3. **Store-account state.** A small singleton (`store_account`, or a section of
   `store_settings`) holding `is_enabled boolean`, `last_rotated_at timestamptz`,
   `updated_at`. **The passcode is never stored here** — it lives only as the Supabase auth
   user's password.

4. **Provisioning via service-role server action.** Create/rotate/disable and "sign out all
   store devices" use the Supabase Admin API (`auth.admin.createUser` /
   `updateUserById` / session revocation) inside a server-only action. Service-role key stays
   server-side.

5. **RLS for the `store` role.**
   - **Read catalog:** reuse existing public/anon-readable policies (products, categories,
     variants, addons, payment_settings, store_settings) — likely no change needed.
   - **Orders:** `store` may `insert` only with `source = 'in_store'` and `user_id IS NULL`,
     and `select` its own in-store orders for the confirmation screen. No access to other
     orders or any profile/beans data.
   - **Everything else** (rewards, bean_transactions, customers, admin tables): no `store`
     grants → denied by default.

6. **Rewards hard-skip.** `apply_order_rewards()` already returns early when
   `user_id IS NULL`. In-store orders also have `source = 'in_store'`. Add an explicit
   `source = 'in_store'` guard in the function for intent, and `placeStoreOrder()` simply
   never calls the rewards step.

---

## 7. Admin CMS controls

A "Store Ordering" section in admin (under `/admin/settings`, matching existing
store/payment settings styling). Gated by `isAdmin()` (managers/staff cannot touch it),
consistent with `setCustomerRole` / `adjustCustomerBeans`.

- **Enable / disable store ordering.** Disabled = passcode login refuses and active store
  sessions are rejected on next request (role check + `is_enabled`).
- **Set / rotate passcode.** Write-only input ("Set new passcode"); creates the auth user on
  first set, updates its password on rotate. Min length ≥ 6 (Supabase requirement). Current
  passcode is never displayed back.
- **Status readout:** enabled/disabled, last rotated at, and a hint to sign the tablet out to
  force the new passcode.
- **Sign out all store devices.** Revokes the store user's sessions so rotation actually kicks
  logged-in tablets.
- Service-role key stays server-only inside the actions; never imported client-side.

**Reports:** add an in-store vs online split to `/admin/reports` using the `source` column
(revenue + order counts), extending the existing `revenue-chart.tsx` and totals rather than a
separate report.

---

## 8. Kiosk UX & order flow

**Passcode login (`/store/login`)** — minimal full-screen pad: logo + passcode input +
"Enter". On success the Supabase session is set and the device lands on the menu. If store
ordering is disabled: "Store ordering is currently off — ask a manager." Only screen an
un-authed device can reach.

**Menu (`/store`)** — the single home screen. Reuses `MenuBrowser` (categories, product grid,
search). No home/profile/rewards/nav. Persistent slim cart bar (count + total + "View cart")
when the cart is non-empty. Respects `store_settings.is_open` (closed → "We're closed").

**Product customization (`/store/[slug]`)** — reuses the existing full customizer (size, ice,
sugar, add-ons). "Add to order" returns to the menu.

**Cart (`/store/cart`)** — reuses cart rendering: edit qty, remove, notes. **No rewards/beans
UI.** "Checkout" → pay step.

**Checkout / pay (`/store/checkout`)**
- Payment choice driven by `payment_settings`: show **Cash** only if enabled; show **QR** only
  if `qr_enabled` and a `duitnow_qr_url` exists.
- **Cash** → "Place order".
- **QR** → display the store DuitNow QR fullscreen to scan, then "I've paid / Place order".
  Nothing uploaded or saved.
- On place → `placeStoreOrder()` writes the order: `source = 'in_store'`, `user_id NULL`,
  payment method, no contact phone, no proof. Hits the same `/manage` board + Telegram alert.
  **No rewards call.**

**Confirmation + reset** — large **order number** (NAISE-xxxxxx) + "Show this number at the
counter." Auto-returns to the menu and clears the cart after a few seconds (or "Start new
order" tap, whichever first).

**Idle handling** — a global idle timer in the kiosk shell: after N seconds (default ~90s,
defined as a constant) of inactivity with a non-empty cart / mid-flow, clear the cart and
return to the menu. The timer does **not** fire mid-confirmation in a way that could lose a
just-placed order (it pauses once an order is successfully placed; only the confirmation
auto-advances).

**Cart isolation** — the kiosk reuses the cart store under a **separate localStorage key**
(e.g. `naise-store-cart`) so it never collides with the customer-app cart, and the
reward-stripping effects are irrelevant here.

**Exit / sign-out** — no customer-visible sign-out. A discreet long-press / hidden corner tap
reveals a staff "Exit store mode" prompt (re-enter passcode or admin confirm) to sign the
device out, preventing customers from logging the tablet out.

### 8b. Tablet-optimized layout (store UI only)
- Target the **tablet first** for `/store/*` (≈768–1280px, landscape and portrait); the rest
  of the app stays mobile-first. The kiosk shell uses its own width constraints, not the
  narrow customer container.
- **Menu grid scales up:** 2 columns on small tablets → 3–4 on larger/landscape, with bigger
  cards and imagery.
- **Bigger touch targets:** larger buttons, qty steppers, size/ice/sugar/add-on chips, and the
  cart bar — sized for finger taps at arm's length.
- **Two-pane where it helps:** on wide tablets, cart/checkout can sit as a side panel next to
  the menu (master–detail) so the order builds live; portrait/smaller tablets fall back to the
  stacked full-page flow.
- **Fullscreen, chrome-free:** kiosk shell fills the viewport; QR and confirmation screens
  render large and centered for scanning/reading across the counter.
- Pure Tailwind responsive utilities + shared components composed in a tablet-width shell; no
  separate CSS files.

---

## 9. Error handling & edge cases

- **Place-order failure** (network/RLS): keep the cart intact; show a retryable "Couldn't
  place order, try again." Never silently lose the order or auto-reset on failure.
- **Store closed mid-session** (`store_settings.is_open` flips closed): checkout fails closed
  (same guard as customer `placeOrder()`); menu shows the closed state.
- **Store ordering disabled while logged in:** next server request / checkout rejects; device
  falls back to the login screen.
- **Passcode rotated while logged in:** existing session works until "sign out all store
  devices" / session revocation — hence the admin button.
- **Unavailable item** added then archived before checkout: re-validate availability
  server-side at place time (existing pattern) and report which item dropped.
- **QR selected but no `duitnow_qr_url`:** hide QR; if both methods disabled, show "Ordering
  temporarily unavailable" rather than a dead checkout.
- **Role isolation both ways:** a `store` device cannot reach `/admin`/`/profile`; admins and
  customers cannot get stuck in `/store`.
- **No beans, guaranteed:** guarded in the action, in `apply_order_rewards()`, and by
  `user_id IS NULL`.

---

## 10. Testing

- **Migration:** apply on a Supabase branch; verify the role addition, `source` column, and
  policies; confirm backfill = `'online'`.
- **RLS:** as the `store` user, assert it can insert `in_store` orders and read its own, but
  **cannot** read other orders, profiles, or bean tables, and cannot self-assign the role.
- **Provisioning action:** create → rotate → disable → "sign out devices", asserting the auth
  user/password/flag changes each step.
- **Flow (manual on tablet / emulated touch):** login → customize → cart → cash & QR
  checkout → confirmation → auto-reset; idle-timeout clears an abandoned cart; closed-store and
  disabled-store states.
- **Rewards:** place an in-store order; assert **zero** `bean_transactions` and no
  `reward_accounts` change.
- **Reports:** seeded online + in-store orders split correctly in `/admin/reports`.

---

## 11. Affected / new files (indicative)

**New**
- `app/(store)/layout.tsx`, `app/(store)/store/login/page.tsx`,
  `app/(store)/store/page.tsx`, `app/(store)/store/[slug]/page.tsx`,
  `app/(store)/store/cart/page.tsx`, `app/(store)/store/checkout/page.tsx`,
  `app/(store)/store/actions.ts`
- Store kiosk shell + tablet layout components under `components/store/`
- Admin "Store Ordering" UI under `app/(admin)/admin/settings/` + a server action module
- One migration in `supabase/migrations/` (role, `orders.source`, store-account state, RLS,
  rewards guard)
- A constant for the idle timeout and the store cart localStorage key (`constants/`)

**Modified**
- `middleware.ts` (store-role routing/lockdown)
- `lib/auth/session.ts` (recognize `store` role)
- `apply_order_rewards()` (explicit `in_store` guard)
- `/admin/reports` + `components/admin/revenue-chart.tsx` (online vs in-store split)
- `types/` (regenerate Supabase types after the migration)

> File list is indicative; the implementation plan (writing-plans) will finalize it against
> the actual code.
