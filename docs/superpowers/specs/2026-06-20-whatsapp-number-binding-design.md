# WhatsApp Number Binding + WhatsApp-Ready Handoff (no OTP) — Design

**Date:** 2026-06-20
**Status:** Approved for planning

## Summary

Drop the planned WhatsApp-login / OTP feature. Google OAuth (via Supabase) remains
the only sign-in method. Instead of *verifying* a phone number, we *collect* an
**unverified** Malaysian phone number and bind it to the customer/order.

The number is:

1. Editable on the **Edit Profile** screen (members).
2. Requested via a one-time, **skippable** nudge at **checkout** — for **both
   members and guests** — if no number is on file for that order yet.
3. **Stamped onto the order** (and surfaced in the staff Telegram "NEW ORDER!"
   notice).
4. Used at **order completion** to message the customer on WhatsApp: when staff
   complete an order in `/manage/{token}`, instead of pushing the "ready" notice to
   Telegram, the UI shows a **`wa.me` deep link** pre-filled with the ready-message
   template. Staff tap it, WhatsApp opens at the customer's chat, and staff
   **manually press send**.

No verification, no OTP, no WhatsApp Business Platform / Cloud API, no always-on
server, no per-message cost, no automated sending. We trust the customer to type
their number correctly — they want the order updates — and a human stays in control
of the actual WhatsApp send.

### Why no OTP / no API

Automated WhatsApp messaging requires either the official WhatsApp Cloud API
(per-message fee, Meta business verification, migrating a number off the green app)
or an unofficial library (Baileys/whatsapp-web.js) that needs a 24/7 server and risks
a number ban. `wa.me` links need none of that: they open the staff member's *own*
WhatsApp with a pre-filled message, and the staff member sends it by hand. This was an
explicit product decision, not a technical blocker.

## Scope

### In scope

- Remove the mocked phone/OTP UI from the login screen.
- A single phone-normalization helper (accept `+60` and `01X` forms, store as `+60`).
- Persist `phone` on the `profiles` row (column already exists) — members.
- Phone field on Edit Profile.
- Skippable checkout nudge for **members and guests**.
- `contact_phone` on `orders`, plumbed from checkout, shown in the Telegram
  "NEW ORDER!" notice.
- WhatsApp-ready handoff in `/manage/{token}`: a `wa.me` link from the ready-message
  template; Telegram fallback when an order has no number.

### Out of scope

- Any verification of the number (no OTP, no proof of ownership).
- Automated WhatsApp sending. The `wa.me` flow is manual-send by staff.
- Internationalisation beyond Malaysia. Only `+60` mobile numbers are accepted.
- Editing `contact_phone` on an already-placed order from the manage screen.
- Persisting a guest's number anywhere except on the order (guests have no profile).

## Number format rules

Malaysian mobile numbers. The helper lives in `lib/phone.ts` as the single source of
truth.

**`normalizeMyPhone(input: string): string | null`**

1. Strip everything except digits.
2. If digits start with `60` → keep as-is.
   Else if digits start with `0` → replace the leading `0` with `60`.
   Else → assume a bare national number and prepend `60`.
3. Validate the result matches a plausible MY mobile: `60` followed by `1`,
   followed by 8–9 more digits (national part `01X…`, 9–10 digits total).
4. Valid → return `+` + digits (e.g. `+601125617058`).
   Invalid → return `null`.

Examples (all valid → `+601125617058`): `011-2561 7058`, `0112561 7058`,
`+60 11-2561 7058`, `60112561 7058`.
Invalid (→ `null`): `12345`, `+65 9123 4567`, empty-after-trim.

**`formatMyPhoneForDisplay(e164: string): string`** — render a stored `+60…` value
as `+60 11-2561 7058` for UI read-back. Best-effort; returns input unchanged on
mismatch.

**`toWaMeDigits(e164: string): string`** — strip the leading `+` (and any non-digits)
so a stored `+601125617058` becomes `601125617058` for a `wa.me/<digits>` URL.

Empty input is **allowed** at every collection site and means "no number". Only
non-empty-but-invalid input is rejected.

## Components & changes

### 1. `components/auth-screen.tsx` — remove the phone mock
Delete the "Continue with Phone" button, the phone/OTP `<form>`, the
`mode`/`otpSent`/`phone`/`otp`/`pending` phone branches, and
`onSendOtp`/`onVerifyOtp`/`finish`. Remove the now-unused `useAuth().signIn` usage
and the `Phone` import. The screen becomes Google-only. The real `onGoogle` OAuth
flow is untouched.

### 2. `lib/phone.ts` — new
Pure module exporting `normalizeMyPhone`, `formatMyPhoneForDisplay`, and
`toWaMeDigits`. No dependencies.

### 3. `types/profile.ts`
`ProfileEdit = Pick<CustomerProfile, "displayName" | "avatarUrl" | "phone">`.
`CustomerProfile.phone` already exists.

### 4. `store/profile.tsx` — persist phone
In `updateProfile`, add `phone: edit.phone ?? null` to the upsert payload and merge
`phone` into the post-write local state (read back from the returned row). The
self-update RLS policy already permits writing `phone`.

### 5. `components/profile-edit-screen.tsx` — phone field
Add a "WhatsApp Number" input below Display Name, using the `+60`-prefix visual
pattern. Initialise from `profile.phone` (display-formatted). On submit: empty →
save `undefined` (clears); non-empty → `normalizeMyPhone()`; `null` → inline error,
block save; valid → pass normalized `+60…` into `updateProfile`.

### 6. `components/phone-prompt-sheet.tsx` — new
Small bottom-sheet/modal reused by both member and guest checkout: heading "Add your
WhatsApp number", one phone input (`+60` prefix), "Save & continue", and a "Skip"
text button. Props: `onSubmit(phone: string)`, `onSkip()`, `onClose()`. Validates
with `normalizeMyPhone`; invalid → inline error. Visual language matches existing
modals (e.g. `GuestSignInModal`). The sheet itself does **not** decide where the
number is persisted — the checkout screen does (profile for members, order-only for
guests).

### 7. `components/checkout-screen.tsx` — checkout nudge (members + guests)
Local state holds an optional `enteredPhone` for this checkout attempt.

- **Member, no `profile.phone`** → on Place Order, open `PhonePromptSheet`.
  - Save & continue → `updateProfile({ phone })` **and** carry it as `enteredPhone`,
    then `placeOrderAction`.
  - Skip → proceed with no number.
- **Member, has `profile.phone`** → no sheet; number flows from profile.
- **Guest** → existing `GuestSignInModal` first (sign in vs continue as guest). On
  "continue as guest", open `PhonePromptSheet` (unless `enteredPhone` already set
  this attempt).
  - Save & continue → set `enteredPhone` (order-only; **no** profile write — guests
    have none), then `placeOrderAction`.
  - Skip → proceed with no number.

The number passed to `placeOrderAction` is: `enteredPhone`, else `profile.phone`,
else undefined. The sheet is advisory only — never a hard gate on completing the
order.

### 8. Order plumbing — carry `contact_phone`

**Migration** `supabase/migrations/<ts>_orders_contact_phone.sql`:
`alter table public.orders add column contact_phone text;` (nullable; no backfill,
no RLS change — existing order policies already govern the row).

**`types/order.ts`** — add `contactPhone?: string` to `Order` (flows into
`OrderDraft`).

**`lib/orders/store.ts` `createOrder`** — add
`contact_phone: draft.contactPhone ?? null` to the insert payload.

**`lib/orders/mappers.ts`** — map `contactPhone: order.contact_phone ?? undefined`.

**`app/(customer)/checkout/actions.ts` `placeOrder`** — add optional
`contactPhone?: string` to `PlaceOrderInput`; **re-normalize server-side** with
`normalizeMyPhone` (never trust the client), drop if invalid, pass the normalized
value into `createOrder`. Applies to members and guests alike.

**`lib/orders/message.ts` `buildOrderMessage`** — if `order.contactPhone` is set, add
a `Contact: <phone>` line near `Payment:` so staff see it in the "NEW ORDER!" notice.

### 9. WhatsApp-ready handoff at completion (`/manage/{token}`)

**`lib/orders/message.ts` — new `buildWhatsAppReadyLink(order): string | null`.**
Returns `null` if `order.contactPhone` is absent. Otherwise returns
`https://wa.me/${toWaMeDigits(order.contactPhone)}?text=${encodeURIComponent(buildOrderReadyMessage(order))}`.
Reuses the existing customer-facing ready text verbatim, so the template stays in one
place.

**`app/(admin)/manage/actions.ts` `markReadyAndNotify`** — unchanged guard +
`completeOrder` first (DB is source of truth). Then branch on the number:
- `completed.contactPhone` present → **skip** the Telegram ready notice (staff will
  send via `wa.me`). Return `{ ok: true, orderStatus }`.
- absent → send the Telegram ready notice as today (fallback).

The client already has `order.contactPhone` from the page load, so it builds the link
itself; the action does not need to return it.

**`components/order-complete-modal.tsx`** — copy adapts to whether a number exists:
- number present → primary button "Complete order"; subtext mentions the customer
  will be messaged on WhatsApp next.
- no number → unchanged "Complete & Notify" (Telegram).
Add an optional `hasContactPhone: boolean` prop to drive the copy.

**`components/order-detail.tsx`** — in the completed-state ("Order Complete") panel,
when `order.contactPhone` exists, render a prominent WhatsApp CTA:
`<a href={waLink} target="_blank" rel="noopener noreferrer">📲 Send ready message on
WhatsApp</a>` (styled like other primary buttons; `waLink` from
`buildWhatsAppReadyLink`). It **persists** in the completed view so staff can re-open
WhatsApp and re-send if needed. When there is no number, the panel keeps its current
"buyer will be notified" text (Telegram path).

## Data flow

```
Edit Profile field ─┐
                    ├─ normalizeMyPhone ─→ profiles.phone (+60…)   [members]
Checkout nudge ─────┤
 (members+guests)   └─ enteredPhone ─→ placeOrder(contactPhone) ─→ normalizeMyPhone (server)
                                                 │
                                                 ▼
                                       orders.contact_phone (+60…)
                                                 │
                  ┌──────────────────────────────┴───────────────────────────┐
                  ▼                                                            ▼
   buildOrderMessage → Telegram "Contact:" line              completion in /manage/{token}:
   (at placement)                                            number? → wa.me button (manual send)
                                                             none?   → Telegram ready notice
```

## Error handling & edge cases

- **Invalid number** (any collection site): inline error; save/continue blocked; no
  crash.
- **Profile save failure** at checkout: still let the order proceed (number is a
  nice-to-have, never a blocker); reuse existing try/catch + error text.
- **Guest skips the prompt**: order has `contact_phone = null` → completion falls back
  to the Telegram ready notice; no WhatsApp button shown.
- **Member with number**: no nudge; number stamped on order; WhatsApp button at
  completion.
- **Server-side**: `placeOrder` re-normalizes and silently drops an invalid number
  rather than failing the order.
- **`wa.me` on desktop**: opens WhatsApp Web / the desktop app; the link target and
  `rel="noopener"` keep the manage tab intact.
- **Re-send**: the completed order detail keeps the WhatsApp button, so staff can
  open the chat again.

## Testing (manual — no test harness in this repo)

1. Login screen shows **only** Google; no phone option; no console errors.
2. Edit Profile: `011-2561 7058` → save → `profiles.phone` = `+601125617058`;
   reopen shows `+60 11-2561 7058`. `12345` → inline error. Clear → null.
3. Member, no number → checkout → sheet → Save → order places; profile + order both
   get the number; "NEW ORDER!" Telegram shows `Contact:`.
4. Member with number → no sheet; order carries it.
5. Guest → Place Order → guest modal → continue as guest → phone sheet → Save →
   order places with `contact_phone` set; **no** profile created.
6. Guest → Skip → order places with `contact_phone = null`.
7. Complete an order **with** a number in `/manage/{token}` → completion modal copy
   references WhatsApp → after completing, "📲 Send ready message on WhatsApp" button
   appears → tapping opens WhatsApp at that number with the ready template
   pre-filled; **no** Telegram ready notice sent.
8. Complete an order **without** a number → Telegram ready notice sent as before; no
   WhatsApp button.
9. Re-open a completed order with a number → WhatsApp button still present and works.

## Files touched

- `components/auth-screen.tsx` (remove mock)
- `lib/phone.ts` (new)
- `types/profile.ts`
- `store/profile.tsx`
- `components/profile-edit-screen.tsx`
- `components/phone-prompt-sheet.tsx` (new)
- `components/checkout-screen.tsx` (owns the guest `onContinueAsGuest` → phone-sheet wiring; `GuestSignInModal` itself likely needs no change)
- `supabase/migrations/<ts>_orders_contact_phone.sql` (new)
- `types/order.ts`
- `lib/orders/store.ts`
- `lib/orders/mappers.ts`
- `app/(customer)/checkout/actions.ts`
- `lib/orders/message.ts` (Contact line + `buildWhatsAppReadyLink`)
- `app/(admin)/manage/actions.ts` (skip Telegram when a number exists)
- `components/order-complete-modal.tsx` (copy adapts to number presence)
- `components/order-detail.tsx` (WhatsApp CTA in completed panel)
