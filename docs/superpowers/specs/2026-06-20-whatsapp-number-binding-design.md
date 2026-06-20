# WhatsApp Number Binding (no OTP) — Design

**Date:** 2026-06-20
**Status:** Approved for planning

## Summary

Drop the planned WhatsApp-login / OTP feature. Google OAuth (via Supabase) remains
the only sign-in method. Instead of *verifying* a phone number, we simply *collect*
an **unverified** Malaysian phone number and bind it to the customer.

The number is:

1. Editable on the **Edit Profile** screen.
2. Requested via a one-time, **skippable** nudge at **checkout** if a signed-in
   member has no number on file yet.
3. **Stamped onto the order** (and surfaced in the staff Telegram notification) so
   the store can reach the customer about that order on WhatsApp.

No verification, no OTP, no WhatsApp Business Platform / Cloud API, no always-on
server, no per-message cost. We trust the customer to type their own number
correctly — they want the order updates.

### Why no OTP

Automated WhatsApp OTP requires either the official WhatsApp Cloud API (per-message
fee, Meta business verification, migrating a number off the green app) or an
unofficial library (Baileys/whatsapp-web.js) that needs a 24/7 server and risks a
number ban. For a single café verifying a number the customer is motivated to enter
correctly, that infrastructure is not worth it. This was an explicit product
decision, not a technical blocker.

## Scope

### In scope

- Remove the mocked phone/OTP UI from the login screen.
- A single phone-normalization helper (accept `+60` and `01X` forms, store as `+60`).
- Persist `phone` on the `profiles` row (column already exists).
- Phone field on Edit Profile.
- Skippable checkout nudge for members with no number.
- `contact_phone` on `orders`, plumbed from checkout, shown in the Telegram message.

### Out of scope

- Any verification of the number (no OTP, no proof of ownership).
- Collecting a number from **guests** (guests have no profile; they keep using the
  existing guest sign-in modal). Guest orders carry `contact_phone = null`.
- Internationalisation beyond Malaysia. Only `+60` mobile numbers are accepted.
- Editing `contact_phone` on an already-placed order.

## Number format rules

Malaysian mobile numbers. The helper lives in `lib/phone.ts` as the single source of
truth.

**`normalizeMyPhone(input: string): string | null`**

1. Strip everything except digits.
2. If digits start with `60` → keep as-is.
   Else if digits start with `0` → replace the leading `0` with `60`.
   Else → assume a bare national number and prepend `60`.
3. Validate the result matches a plausible MY mobile: `60` followed by `1`,
   followed by 8–9 more digits (i.e. national part `01X…` of 9–10 digits total).
4. Valid → return `+` + digits (e.g. `+60112561705 8` → `+601125617058`).
   Invalid → return `null`.

Examples (all valid → `+601125617058`): `011-2561 7058`, `0112561 7058`,
`+60 11-2561 7058`, `60112561 7058`.
Invalid (→ `null`): `12345`, `+65 9123 4567`, empty-after-trim.

**`formatMyPhoneForDisplay(e164: string): string`** — render a stored `+60…` value
as `+60 11-2561 7058` for read-back in the UI. Best-effort; returns the input
unchanged if it doesn't match.

Empty input is **allowed** at every call site and means "no number" (clears it). Only
non-empty-but-invalid input is rejected.

## Components & changes

### 1. `components/auth-screen.tsx` — remove the phone mock
Delete: the "Continue with Phone" button, the phone/OTP `<form>`, the
`mode`/`otpSent`/`phone`/`otp`/`pending` phone branches, and the
`onSendOtp`/`onVerifyOtp`/`finish` mock functions. Remove the now-unused
`useAuth().signIn` usage and the `Phone` lucide import. The screen becomes
Google-only. The real `onGoogle` OAuth flow is untouched.

### 2. `lib/phone.ts` — new
Pure module exporting `normalizeMyPhone` and `formatMyPhoneForDisplay` as specified
above. No dependencies.

### 3. `types/profile.ts`
Add `phone` to `ProfileEdit`:
`ProfileEdit = Pick<CustomerProfile, "displayName" | "avatarUrl" | "phone">`.
`CustomerProfile.phone` already exists.

### 4. `store/profile.tsx` — persist phone
In `updateProfile`, add `phone: edit.phone ?? null` to the upsert payload, and merge
`phone` into the post-write local state (read it back from the returned row, which is
already selected). The self-update RLS policy already permits writing `phone`.

### 5. `components/profile-edit-screen.tsx` — phone field
Add a "WhatsApp Number" input below Display Name, using the existing `+60`-prefix
visual pattern. Initialise from `profile.phone` (display-formatted). On submit:
- Empty → save `phone: undefined` (clears).
- Non-empty → `normalizeMyPhone()`; if `null`, set the existing inline `error` and
  block save; otherwise pass the normalized `+60…` value into `updateProfile`.

### 6. `components/phone-prompt-sheet.tsx` — new
Small bottom-sheet/modal: heading "Add your WhatsApp number", one phone input
(`+60` prefix), a "Save & continue" button, and a "Skip" text button. Props:
`onSaved(phone: string)`, `onSkip()`, `onClose()`. Validates with
`normalizeMyPhone`; invalid shows inline error. Visual language matches existing
modals (e.g. `GuestSignInModal`).

### 7. `components/checkout-screen.tsx` — checkout nudge
In the place-order path, after the guest check passes and the user **is
authenticated**, if `profile.phone` is empty, open `PhonePromptSheet` instead of
submitting immediately:
- **Save & continue** → `updateProfile({ phone })`, then proceed to
  `placeOrderAction` with that number.
- **Skip** → proceed with no number.
Members who already have a number never see the sheet. Guests never see it (they hit
the existing `GuestSignInModal`). The sheet is advisory only — it is never a hard
gate on completing the order.

The number passed to `placeOrderAction` is: the just-entered number, else
`profile.phone`, else undefined.

### 8. Order plumbing — carry `contact_phone`

**Migration** `supabase/migrations/<ts>_orders_contact_phone.sql`:
`alter table public.orders add column contact_phone text;` (nullable; no backfill).
No RLS change — existing order policies already govern row access; the column is
covered by them.

**`types/order.ts`** — add `contactPhone?: string` to `Order` (and therefore it
flows into `OrderDraft`).

**`lib/orders/store.ts` `createOrder`** — add
`contact_phone: draft.contactPhone ?? null` to the insert payload.

**`lib/orders/mappers.ts`** — map `contactPhone: order.contact_phone ?? undefined`.

**`app/(customer)/checkout/actions.ts` `placeOrder`** — add optional
`contactPhone?: string` to `PlaceOrderInput`; **re-normalize server-side** with
`normalizeMyPhone` (never trust the client), drop it if invalid, and pass the
normalized value into `createOrder`. Members' numbers should already be normalized;
this is defence in depth.

**`lib/orders/message.ts` `buildOrderMessage`** — if `order.contactPhone` is set, add
a `Contact: <phone>` line near the `Payment:` line so staff see it in the Telegram
"NEW ORDER!" notice.

## Data flow

```
Edit Profile field ─┐
                    ├─ normalizeMyPhone ─→ profiles.phone (+60…)
Checkout nudge ─────┘                          │
                                               ▼
Checkout place-order ─→ placeOrder(contactPhone) ─→ normalizeMyPhone (server)
   ─→ orders.contact_phone ─→ buildOrderMessage ─→ Telegram "Contact:" line
```

## Error handling & edge cases

- **Invalid number**: inline error at the input; save/continue blocked; no crash.
- **Profile save failure**: reuse existing try/catch + error text. At checkout, a
  failed save must still let the order proceed (the number is a nice-to-have, never a
  blocker).
- **Guest checkout**: unchanged; no phone prompt; `contact_phone = null`.
- **Member with number**: no nudge; their stored number is stamped on the order.
- **Cleared number**: profile stores `null`; future checkout will nudge again.
- **Server-side**: `placeOrder` re-normalizes and silently drops an invalid number
  rather than failing the order.

## Testing (manual — no test harness in this repo)

1. Login screen shows **only** Google; no phone option; no console errors.
2. Edit Profile: enter `011-2561 7058` → save → Supabase `profiles.phone` =
   `+601125617058`. Reopen → shows `+60 11-2561 7058`.
3. Edit Profile: enter `12345` → inline error, not saved.
4. Edit Profile: clear field → save → `phone` becomes null.
5. Member with no number → checkout → sheet appears → Save → order places, profile
   updated, `orders.contact_phone` set, Telegram shows `Contact:` line.
6. Same member, second order → no sheet; `contact_phone` still stamped.
7. Member taps **Skip** → order places with `contact_phone = null`, no Telegram
   contact line.
8. Guest checkout → existing guest modal only; order has no contact phone.

## Files touched

- `components/auth-screen.tsx` (remove mock)
- `lib/phone.ts` (new)
- `types/profile.ts`
- `store/profile.tsx`
- `components/profile-edit-screen.tsx`
- `components/phone-prompt-sheet.tsx` (new)
- `components/checkout-screen.tsx`
- `supabase/migrations/<ts>_orders_contact_phone.sql` (new)
- `types/order.ts`
- `lib/orders/store.ts`
- `lib/orders/mappers.ts`
- `app/(customer)/checkout/actions.ts`
- `lib/orders/message.ts`
