# WhatsApp Number Binding + wa.me Ready Handoff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect an unverified Malaysian phone number from members and guests, store it on the profile and the order, and let staff message the customer a "ready" notice via a `wa.me` deep link they send by hand — replacing the planned (mocked) WhatsApp OTP login.

**Architecture:** No OTP, no WhatsApp API, no server. A single `lib/phone.ts` helper normalizes input to E.164 (`+60…`). The number is collected in Edit Profile (members) and a skippable checkout sheet (members + guests), persisted to `profiles.phone` and a new `orders.contact_phone` column. At order completion in `/manage/{token}`, the UI builds a `wa.me/<digits>?text=<encoded ready template>` link from the existing ready-message text; staff tap it and press send. Telegram remains the fallback when an order has no number.

**Tech Stack:** Next.js 16 (App Router) + React 19, TypeScript (strict), Tailwind, Supabase (Postgres + Auth + RLS), lucide-react icons.

## Global Constraints

- **No new dependencies.** Use only what's already in `package.json`.
- **TypeScript strict, no `any`.** Every change must pass `npx tsc --noEmit`.
- **No automated test harness exists.** Verification per task = `npx tsc --noEmit`, `npm run lint` (for files with logic/JSX), plus the manual checks stated in the task. Task 13 is the full manual pass.
- **Money stays in sen** (untouched here).
- **Phone storage format is E.164 `+60…`** everywhere it is persisted (`profiles.phone`, `orders.contact_phone`).
- **Phone input accepts `+60`, `60`, `0`-prefixed, or bare national, with spaces/dashes.** Reject non-MY-mobile.
- **Never trust the client:** `placeOrder` re-normalizes the phone server-side.
- **The `wa.me` send is always manual.** Never auto-send.
- **Malaysia mobile only:** national subscriber part starts with `1` and is 9–10 digits.
- Commit after every task with the message shown. The current branch is `dev`; commit there.

---

### Task 1: Phone normalization helper

**Files:**
- Create: `lib/phone.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeMyPhone(input: string): string | null` — E.164 `+60…` or `null`.
  - `formatMyPhoneForDisplay(e164: string): string` — `"+60 11-2561 7058"`.
  - `toWaMeDigits(e164: string): string` — `"601125617058"`.

- [ ] **Step 1: Create `lib/phone.ts`**

```ts
// Malaysian (MY) mobile phone helpers — the single source of truth for turning
// user-typed numbers into a stored E.164 value (+60…) and back. No verification:
// we only collect and format. Nationally a mobile is 01X-XXXXXXX; in E.164 the
// leading 0 is dropped, e.g. 011-2561 7058 -> +601125617058.

// Accepts "+60…", "60…", "0…", or a bare national number, with spaces or dashes.
// Returns the E.164 string when it looks like a valid MY mobile, else null so the
// caller can show an error. Empty/whitespace returns null too — callers treat an
// empty field as "no number" and skip calling this.
export function normalizeMyPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (!digits) return null;

  // Reduce to the subscriber part (no country code, no leading 0).
  let national: string;
  if (digits.startsWith("60")) {
    national = digits.slice(2);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else {
    national = digits;
  }

  // MY mobile subscriber part: starts with 1, total 9–10 digits
  // (e.g. 12 345 6789 = 9, 11 2561 7058 = 10).
  if (!/^1\d{8,9}$/.test(national)) return null;

  return `+60${national}`;
}

// Renders a stored +60… value as "+60 11-2561 7058" for read-back in the UI.
// Best-effort: returns the input unchanged if it doesn't match the expected shape.
export function formatMyPhoneForDisplay(e164: string): string {
  const m = /^\+60(1\d)(\d{3,4})(\d{4})$/.exec(e164);
  if (!m) return e164;
  return `+60 ${m[1]}-${m[2]} ${m[3]}`;
}

// Strips to bare international digits for a wa.me/<digits> link (no +, no
// spaces): "+601125617058" -> "601125617058".
export function toWaMeDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Sanity-check the logic by hand (read-through)**

Confirm against these cases (no runner; reason through each):
- `"011-2561 7058"` → `+601125617058`
- `"0123456789"` → `+60123456789`
- `"+60 11-2561 7058"` → `+601125617058`
- `"60112561705 8"` (stray space) → `+601125617058`
- `"12345"` → `null` · `"+65 9123 4567"` → `null` (national `9123 4567` fails `^1…`) · `""` → `null`
- `formatMyPhoneForDisplay("+601125617058")` → `"+60 11-2561 7058"`
- `toWaMeDigits("+601125617058")` → `"601125617058"`

- [ ] **Step 4: Commit**

```bash
git add lib/phone.ts
git commit -m "feat(phone): add MY mobile normalize/format/wa.me helpers"
```

---

### Task 2: Add `orders.contact_phone` (migration + generated types)

**Files:**
- Create: `supabase/migrations/20260620140000_orders_contact_phone.sql`
- Modify: `types/database.ts` (the `orders` `Row`/`Insert`/`Update` blocks)

**Interfaces:**
- Consumes: nothing.
- Produces: `orders.contact_phone text` (nullable); `Tables<"orders">` gains `contact_phone: string | null`.

- [ ] **Step 1: Create the migration**

File: `supabase/migrations/20260620140000_orders_contact_phone.sql`

```sql
-- Add an optional contact phone to orders. Collected (unverified) at checkout
-- from members and guests; used for the WhatsApp-ready handoff and the staff
-- Telegram "NEW ORDER!" notice. Nullable; no backfill. Existing order RLS
-- policies already govern row access, so no policy change is needed.
alter table public.orders
  add column contact_phone text;

comment on column public.orders.contact_phone is
  'Unverified MY mobile in E.164 (+60…), collected at checkout. Used for the wa.me ready handoff and the staff order notice.';
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` tool (name: `orders_contact_phone`, the SQL above), or `supabase db push` if using the CLI. Confirm the column exists:
`select column_name from information_schema.columns where table_name='orders' and column_name='contact_phone';`
Expected: one row, `contact_phone`.

- [ ] **Step 3: Patch generated types in `types/database.ts`**

In the `orders` table type, add the column to all three blocks.

In `Row` (after the `completed_at: string | null` line — keep alphabetical-ish ordering near the other text columns; exact position is not significant):

```ts
          contact_phone: string | null
```

In `Insert`:

```ts
          contact_phone?: string | null
```

In `Update`:

```ts
          contact_phone?: string | null
```

(If you prefer, regenerate the whole file with `supabase gen types typescript` instead of hand-editing — either is fine as long as `contact_phone` appears in all three blocks.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260620140000_orders_contact_phone.sql types/database.ts
git commit -m "feat(orders): add contact_phone column + types"
```

---

### Task 3: Carry `contactPhone` through the order domain

**Files:**
- Modify: `types/order.ts` (the `Order` type)
- Modify: `lib/orders/store.ts` (`createOrder` insert payload)
- Modify: `lib/orders/mappers.ts` (`rowToOrder`)

**Interfaces:**
- Consumes: `Tables<"orders">.contact_phone` (Task 2).
- Produces: `Order.contactPhone?: string`; `createOrder` persists it; `rowToOrder` reads it back.

- [ ] **Step 1: Add `contactPhone` to `Order` in `types/order.ts`**

Insert this field in the `Order` type, immediately after the `proofOfPaymentUrl?: string;` block and before `createdAt`:

```ts
  // Unverified MY mobile (+60…) collected at checkout from the member or guest.
  // Used for the WhatsApp-ready handoff and the staff "NEW ORDER!" notice.
  // Absent when the customer skipped the prompt. Maps to orders.contact_phone.
  contactPhone?: string;
```

(`OrderDraft` is `Omit<Order, …>` that does not omit `contactPhone`, so it inherits the field automatically.)

- [ ] **Step 2: Persist it in `createOrder` (`lib/orders/store.ts`)**

In the `.from("orders").insert({ … })` object, add a line after `notes: draft.notes ?? null,`:

```ts
      contact_phone: draft.contactPhone ?? null,
```

- [ ] **Step 3: Map it in `rowToOrder` (`lib/orders/mappers.ts`)**

In the returned object, add after `notes: order.notes ?? undefined,`:

```ts
    contactPhone: order.contact_phone ?? undefined,
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add types/order.ts lib/orders/store.ts lib/orders/mappers.ts
git commit -m "feat(orders): thread contactPhone through draft/create/mapper"
```

---

### Task 4: Stamp the number into checkout + the staff notice

**Files:**
- Modify: `lib/orders/message.ts` (`buildOrderMessage`)
- Modify: `app/(customer)/checkout/actions.ts` (`PlaceOrderInput`, `placeOrder`)

**Interfaces:**
- Consumes: `normalizeMyPhone` (Task 1), `Order.contactPhone` (Task 3), `createOrder` draft field (Task 3).
- Produces: `PlaceOrderInput.contactPhone?: string`; the Telegram "NEW ORDER!" message shows a `Contact:` line when present.

- [ ] **Step 1: Add the `Contact:` line in `buildOrderMessage` (`lib/orders/message.ts`)**

Replace the existing `const parts = [ … ];` block in `buildOrderMessage` (the one starting `"NEW ORDER!"`) with:

```ts
  const parts = [
    "NEW ORDER!",
    "",
    `Order: ${order.orderNumber}`,
    `Payment: ${order.paymentMethod}`,
  ];

  if (order.contactPhone) {
    parts.push(`Contact: ${order.contactPhone}`);
  }

  parts.push(
    "",
    "Items:",
    ...itemLines,
    "",
    `Total: ${formatPrice(order.total)}`,
  );
```

(Leave the later `if (order.notes?.trim())` and `if (includeLink)` blocks unchanged — they still `parts.push(...)`.)

- [ ] **Step 2: Accept + normalize the phone in `placeOrder` (`app/(customer)/checkout/actions.ts`)**

At the top of the file, add the import (next to the other `@/lib` imports):

```ts
import { normalizeMyPhone } from "@/lib/phone";
```

In `PlaceOrderInput`, add an optional field (after `proofOfPaymentPath?: string;`):

```ts
  // Unverified MY phone collected at checkout (member profile value or a number
  // entered in the prompt). Re-normalized server-side; dropped if invalid.
  contactPhone?: string;
```

In `placeOrder`, just before the `const lines: OrderLine[] = …` line, compute the normalized value:

```ts
  // Re-normalize the contact phone server-side — never trust the client. An
  // invalid value is dropped (the number is optional and must never fail the order).
  const contactPhone = input.contactPhone
    ? (normalizeMyPhone(input.contactPhone) ?? undefined)
    : undefined;
```

Then in the `createOrder({ … }, { userId })` call, add to the draft object (after `notes: input.notes?.trim() || undefined,`):

```ts
        contactPhone,
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/orders/message.ts "app/(customer)/checkout/actions.ts"
git commit -m "feat(checkout): accept contactPhone, normalize server-side, show in staff notice"
```

---

### Task 5: Remove the mocked WhatsApp/phone login

**Files:**
- Modify: `components/auth-screen.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: a Google-only auth screen. No phone state/handlers remain.

- [ ] **Step 1: Trim imports**

Change the lucide import line:

```ts
import { ChevronLeft, Coffee, Flame, Loader2, Phone, Star } from "lucide-react";
```

to:

```ts
import { ChevronLeft, Coffee, Flame, Loader2, Star } from "lucide-react";
```

Delete this import line entirely (it becomes unused):

```ts
import { useAuth } from "@/store/auth";
```

- [ ] **Step 2: Remove the `signIn` hook usage**

Delete this line:

```ts
  const { signIn } = useAuth();
```

- [ ] **Step 3: Collapse the phone state to just `pending`**

Replace this block (the comment + five `useState` lines):

```ts
  // Phone flow is two steps: enter number, then the 6-digit OTP. `null` = the
  // method chooser is showing; "phone" = the number/OTP form.
  const [mode, setMode] = useState<"choose" | "phone">("choose");
  const [otpSent, setOtpSent] = useState(false);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState<"google" | "phone" | null>(null);
```

with:

```ts
  const [pending, setPending] = useState<"google" | null>(null);
```

- [ ] **Step 4: Delete the mock handlers**

Remove the entire `finish(...)` function (including its `// MOCKED —` comment block) and the `onSendOtp` and `onVerifyOtp` functions. Leave `onGoogle` untouched.

- [ ] **Step 5: Replace the method ternary with a Google-only button**

In the JSX, replace the whole ternary expression `{mode === "choose" ? ( … ) : ( … )}` (it starts at `{mode === "choose" ? (` and ends at the matching `)}` immediately before the `<p>…By continuing you agree…` paragraph) with:

```tsx
        <div className="flex flex-col gap-3 naise-rise [animation-delay:160ms]">
          <button
            type="button"
            onClick={onGoogle}
            disabled={pending !== null}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-border bg-white text-sm font-semibold text-foreground outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {pending === "google" ? (
              <Loader2 className="size-5 animate-spin" strokeWidth={2.5} aria-hidden />
            ) : (
              <GoogleIcon className="size-5" />
            )}
            Continue with Google
          </button>
        </div>
```

Keep the `<p>…By continuing…</p>` and the `<Link href={redirect}>Continue as guest</Link>` that follow.

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS. If lint flags an unused `signIn`/`Phone`/`useState` import, you missed a deletion above — remove it.

- [ ] **Step 7: Manual check**

Run `npm run dev`, open `/login`. Expect: only "Continue with Google" + "Continue as guest"; no phone button/form; no console errors.

- [ ] **Step 8: Commit**

```bash
git add components/auth-screen.tsx
git commit -m "refactor(auth): remove mocked phone/OTP login, Google-only"
```

---

### Task 6: Persist `phone` from the profile store

**Files:**
- Modify: `types/profile.ts` (`ProfileEdit`)
- Modify: `store/profile.tsx` (`updateProfile`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ProfileEdit` includes `phone?: string`; `updateProfile({ phone })` writes `profiles.phone` and mirrors it locally.

- [ ] **Step 1: Widen `ProfileEdit` (`types/profile.ts`)**

Replace:

```ts
export type ProfileEdit = Pick<CustomerProfile, "displayName" | "avatarUrl">;
```

with:

```ts
export type ProfileEdit = Pick<
  CustomerProfile,
  "displayName" | "avatarUrl" | "phone"
>;
```

- [ ] **Step 2: Write `phone` in `updateProfile` (`store/profile.tsx`)**

In the `.upsert({ … })` call inside `updateProfile`, add a line after `avatar_url: edit.avatarUrl ?? null,`:

```ts
          phone: edit.phone ?? null,
```

The `.select("display_name, avatar_url, phone, created_at")` already includes `phone`, and the local `setProfile` merge already maps `phone: data.phone ?? prev.phone`, so no further change is needed there.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add types/profile.ts store/profile.tsx
git commit -m "feat(profile): allow editing + persisting phone"
```

---

### Task 7: Phone field on Edit Profile

**Files:**
- Modify: `components/profile-edit-screen.tsx`

**Interfaces:**
- Consumes: `normalizeMyPhone`, `formatMyPhoneForDisplay` (Task 1); `updateProfile` with `phone` (Task 6); `profile.phone`.
- Produces: an editable WhatsApp number field that saves `+60…` or clears it.

- [ ] **Step 1: Import the phone helpers**

Add near the top imports:

```ts
import { normalizeMyPhone, formatMyPhoneForDisplay } from "@/lib/phone";
```

- [ ] **Step 2: Seed phone state from the profile**

After the existing `const [displayName, setDisplayName] = useState(profile.displayName);` line, add:

```ts
  // WhatsApp number, shown in human format; normalized to +60… on save.
  const [phone, setPhone] = useState(
    profile.phone ? formatMyPhoneForDisplay(profile.phone) : "",
  );
```

- [ ] **Step 3: Validate + include phone in `onSave`**

Inside `onSave`, after `setSaving(true);` and `setError(null);` and before the avatar upload, add the normalization guard:

```ts
    // Empty = clear the number. Non-empty must be a valid MY mobile.
    const trimmedPhone = phone.trim();
    let normalizedPhone: string | undefined;
    if (trimmedPhone) {
      const normalized = normalizeMyPhone(trimmedPhone);
      if (!normalized) {
        setError("Enter a valid Malaysian mobile number, e.g. 011-2561 7058.");
        setSaving(false);
        return;
      }
      normalizedPhone = normalized;
    }
```

Then change the `updateProfile({ … })` call to include the phone:

```ts
      await updateProfile({
        displayName: displayName.trim() || profile.displayName,
        avatarUrl,
        phone: normalizedPhone,
      });
```

- [ ] **Step 4: Add the input to the form**

Directly after the Display Name `</section>` (the section whose label is "Display Name"), add a new section:

```tsx
        {/* WhatsApp number — unverified; used for order updates. */}
        <section className="flex flex-col gap-2 naise-rise [animation-delay:100ms]">
          <label
            htmlFor="phone"
            className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
          >
            WhatsApp Number
          </label>
          <div className="flex items-center gap-2">
            <span className="flex h-12 shrink-0 items-center rounded-2xl border border-border bg-neutral-50 px-3 text-sm font-semibold text-muted-foreground">
              +60
            </span>
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="11-2561 7058"
              className="h-12 flex-1 rounded-2xl border border-border bg-white px-4 text-sm font-medium outline-none transition-colors focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <p className="text-[0.6875rem] text-muted-foreground">
            We&rsquo;ll use this to message you about your orders on WhatsApp.
          </p>
        </section>
```

(The `+60` prefix is cosmetic; `normalizeMyPhone` accepts a `+60`/`0`/bare value typed into the field, so users may also paste a full `011…` number.)

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 6: Manual check**

`/profile/edit`: type `011-2561 7058`, Save → returns to `/profile`. Reopen → field shows `+60 11-2561 7058`. In Supabase, `profiles.phone` = `+601125617058`. Type `12345` → inline error, not saved. Clear field, Save → `profiles.phone` becomes null.

- [ ] **Step 7: Commit**

```bash
git add components/profile-edit-screen.tsx
git commit -m "feat(profile): add WhatsApp number field to Edit Profile"
```

---

### Task 8: `PhonePromptSheet` component

**Files:**
- Create: `components/phone-prompt-sheet.tsx`

**Interfaces:**
- Consumes: `normalizeMyPhone` (Task 1).
- Produces: `PhonePromptSheet` with props
  `{ onSubmit(phone: string): void; onSkip(): void; onClose(): void; busy?: boolean }`.
  `onSubmit` receives the **normalized `+60…`** value.

- [ ] **Step 1: Create the component**

File: `components/phone-prompt-sheet.tsx`

```tsx
"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { normalizeMyPhone } from "@/lib/phone";

// Skippable prompt shown at checkout when no number is on file for this order.
// Collects an unverified MY mobile so the store can message the customer on
// WhatsApp when the order is ready. The caller decides where the number is
// persisted (member profile vs order-only for guests); this sheet only
// validates and hands back the normalized +60… value. Hand-rolled modal like
// the others: closes on backdrop/Esc, locks body scroll.
export function PhonePromptSheet({
  onSubmit,
  onSkip,
  onClose,
  busy = false,
}: {
  onSubmit: (phone: string) => void;
  onSkip: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [busy, onClose]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeMyPhone(phone);
    if (!normalized) {
      setError("Enter a valid Malaysian mobile number, e.g. 011-2561 7058.");
      return;
    }
    setError(null);
    onSubmit(normalized);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="phone-prompt-title"
      onClick={() => !busy && onClose()}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 naise-fade sm:items-center"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="relative flex w-full max-w-sm flex-col rounded-3xl bg-white px-6 pb-6 pt-7 naise-pop"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <MessageCircle className="size-6" strokeWidth={2} aria-hidden />
        </span>

        <h2
          id="phone-prompt-title"
          className="mt-4 font-heading text-xl font-bold tracking-tight"
        >
          Add your WhatsApp number
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          So we can message you on WhatsApp when your order is ready. Optional —
          you can skip this.
        </p>

        <div className="mt-5 flex items-center gap-2">
          <span className="flex h-12 shrink-0 items-center rounded-2xl border border-border bg-neutral-50 px-3 text-sm font-semibold text-muted-foreground">
            +60
          </span>
          <input
            id="phone-prompt-input"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="11-2561 7058"
            disabled={busy}
            className="h-12 flex-1 rounded-2xl border border-border bg-white px-4 text-sm font-medium outline-none transition-colors focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          />
        </div>

        {error && (
          <p className="mt-2 text-xs font-medium text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Save &amp; continue
        </button>

        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="mt-2 h-12 w-full rounded-2xl text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground outline-none transition-colors hover:bg-neutral-100 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        >
          Skip
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/phone-prompt-sheet.tsx
git commit -m "feat(checkout): add skippable PhonePromptSheet"
```

---

### Task 9: Wire the checkout nudge (members + guests)

**Files:**
- Modify: `components/checkout-screen.tsx`

**Interfaces:**
- Consumes: `useProfile` (`profile.phone`, `updateProfile`) (Task 6), `PhonePromptSheet` (Task 8), `placeOrderAction` `contactPhone` (Task 4).
- Produces: phone collection before `placeOrder`, for members without a number and for guests.

- [ ] **Step 1: Import the sheet and the profile store**

Add near the other imports:

```ts
import { useProfile } from "@/store/profile";
import { PhonePromptSheet } from "@/components/phone-prompt-sheet";
```

- [ ] **Step 2: Read the profile and add nudge state**

After the existing `const { canAfford, earnRate } = useBeans();` line, add:

```ts
  const { profile, updateProfile } = useProfile();
```

Near the other `useState` calls (e.g. after `const [showGuestModal, setShowGuestModal] = useState(false);`), add:

```ts
  // The number to stamp on this order: a value entered in the prompt this
  // attempt, else the member's saved profile number. Guests have no profile, so
  // theirs only ever comes from the prompt.
  const [enteredPhone, setEnteredPhone] = useState<string | null>(null);
  // Controls the phone prompt sheet shown before placing when no number is known.
  const [showPhonePrompt, setShowPhonePrompt] = useState(false);
```

- [ ] **Step 3: Add a resolver + gate before placing**

Add this helper above `onPlaceOrder` (it returns the best-known number for the order):

```ts
  // The number to attach to this order, if any.
  function resolveContactPhone(): string | undefined {
    return enteredPhone ?? profile.phone ?? undefined;
  }
```

Replace the existing `onPlaceOrder` function:

```ts
  function onPlaceOrder() {
    if (submitting) return;
    if (!isAuthenticated) {
      setShowGuestModal(true);
      return;
    }
    void placeOrder();
  }
```

with one that opens the prompt when a member has no number yet:

```ts
  function onPlaceOrder() {
    if (submitting) return;
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

- [ ] **Step 4: Pass the number into the action**

In `placeOrder`, in the `placeOrderAction({ … })` argument object, add after `proofOfPaymentPath,`:

```ts
        contactPhone: resolveContactPhone(),
```

- [ ] **Step 5: Send the guest through the prompt after "continue as guest"**

In the JSX, replace the `GuestSignInModal`'s `onContinueAsGuest` handler:

```tsx
          onContinueAsGuest={() => {
            setShowGuestModal(false);
            void placeOrder();
          }}
```

with one that asks for a number first (unless one was already entered this attempt):

```tsx
          onContinueAsGuest={() => {
            setShowGuestModal(false);
            if (!resolveContactPhone()) {
              setShowPhonePrompt(true);
              return;
            }
            void placeOrder();
          }}
```

- [ ] **Step 6: Render the prompt sheet**

Immediately after the `{showGuestModal && ( … )}` block, add:

```tsx
      {showPhonePrompt && (
        <PhonePromptSheet
          busy={submitting}
          onClose={() => setShowPhonePrompt(false)}
          onSkip={() => {
            setShowPhonePrompt(false);
            void placeOrder();
          }}
          onSubmit={(phone) => {
            setEnteredPhone(phone);
            setShowPhonePrompt(false);
            // Members: also save to their profile for next time. Guests have no
            // profile, so updateProfile is a no-op (it early-returns for guests).
            if (isAuthenticated) void updateProfile({ phone });
            void placeOrder();
          }}
        />
      )}
```

Note: `placeOrder` reads `resolveContactPhone()`, which reads `enteredPhone`. Because `setEnteredPhone` is async, pass the value through directly instead of relying on the re-render. To make this robust, change `placeOrder` to accept an optional override — see Step 7.

- [ ] **Step 7: Make `placeOrder` accept an explicit phone (avoids the setState race)**

Change the signature and the action call. Replace `async function placeOrder() {` with:

```ts
  async function placeOrder(phoneOverride?: string) {
```

and change the `contactPhone` line in the action call (from Step 4) to:

```ts
        contactPhone: phoneOverride ?? resolveContactPhone(),
```

Then update the three callers to pass the freshly-entered number where relevant:
- Step 6 `onSubmit`: `void placeOrder(phone);`
- Step 6 `onSkip`: `void placeOrder();` (unchanged)
- Step 5 guest `onContinueAsGuest`: `void placeOrder();` (unchanged)
- Step 3 `onPlaceOrder`: `void placeOrder();` (unchanged)
- The `GuestSignInModal` direct path and the member path stay `void placeOrder();`.

- [ ] **Step 8: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 9: Manual check**

- Member with **no** number → Place Order → sheet appears → Save → order places; profile + order get the number.
- Member with a number → Place Order → no sheet.
- Guest → Place Order → guest modal → Continue as guest → sheet → Save → order places with number; no profile row created.
- Guest → sheet → Skip → order places with no number.

- [ ] **Step 10: Commit**

```bash
git add components/checkout-screen.tsx
git commit -m "feat(checkout): nudge members + guests for a WhatsApp number"
```

---

### Task 10: `buildWhatsAppReadyLink` helper

**Files:**
- Modify: `lib/orders/message.ts`

**Interfaces:**
- Consumes: `toWaMeDigits` (Task 1), `buildOrderReadyMessage` (existing), `Order.contactPhone` (Task 3).
- Produces: `buildWhatsAppReadyLink(order: Order): string | null`.

- [ ] **Step 1: Add the import**

At the top of `lib/orders/message.ts`, add to the existing imports:

```ts
import { toWaMeDigits } from "@/lib/phone";
```

- [ ] **Step 2: Add the helper at the end of the file**

```ts
// Builds a wa.me deep link that opens WhatsApp at the customer's chat with the
// "ready" notice pre-filled. Staff tap it and press send by hand (no API). Reuses
// buildOrderReadyMessage so the wording lives in one place. Returns null when the
// order has no contact number (caller falls back to the Telegram notice).
export function buildWhatsAppReadyLink(order: Order): string | null {
  if (!order.contactPhone) return null;
  const digits = toWaMeDigits(order.contactPhone);
  const text = encodeURIComponent(buildOrderReadyMessage(order));
  return `https://wa.me/${digits}?text=${text}`;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/orders/message.ts
git commit -m "feat(orders): add buildWhatsAppReadyLink for manual ready handoff"
```

---

### Task 11: Skip Telegram when the order has a number

**Files:**
- Modify: `app/(admin)/manage/actions.ts` (`markReadyAndNotify`)

**Interfaces:**
- Consumes: `completed.contactPhone` (Task 3).
- Produces: `markReadyAndNotify` sends Telegram only when there is no number; the client renders the wa.me button otherwise (Task 12).

- [ ] **Step 1: Guard the Telegram send on the absence of a number**

In `markReadyAndNotify`, replace the existing `try { await sendTelegramMessage(buildOrderReadyMessage(completed)); } catch { … }` block with:

```ts
  // If we have the customer's number, staff will send the ready notice over
  // WhatsApp by hand (wa.me button on the completed order). Only fall back to the
  // Telegram notice when there is no number to message. The order is already
  // completed above regardless.
  if (!completed.contactPhone) {
    try {
      await sendTelegramMessage(buildOrderReadyMessage(completed));
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      console.error(
        `Order ${completed.orderNumber} completed but ready-notice failed: ${reason}`,
      );
    }
  }
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/manage/actions.ts"
git commit -m "feat(manage): skip Telegram ready notice when order has a number"
```

---

### Task 12: WhatsApp CTA at completion

**Files:**
- Modify: `components/order-complete-modal.tsx` (copy adapts to number presence)
- Modify: `components/order-detail.tsx` (WhatsApp button in the completed panel)

**Interfaces:**
- Consumes: `buildWhatsAppReadyLink` (Task 10), `order.contactPhone` (Task 3).
- Produces: a persistent "Send ready message on WhatsApp" link in the completed order view; modal copy that matches the path.

- [ ] **Step 1: Add a `hasContactPhone` prop to the complete modal**

In `components/order-complete-modal.tsx`, add the prop to the function signature object (after `orderNumber,` and its type `orderNumber: string;`):

```ts
  hasContactPhone,
```

and in the props type:

```ts
  hasContactPhone: boolean;
```

- [ ] **Step 2: Adapt the modal copy**

Replace the description paragraph:

```tsx
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          This marks the order complete and notifies the buyer that their order
          is ready for pickup.
        </p>
```

with:

```tsx
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {hasContactPhone
            ? "This marks the order complete. Next, send the buyer their ready notice on WhatsApp."
            : "This marks the order complete and notifies the buyer that their order is ready for pickup."}
        </p>
```

Replace the confirm button's label expression:

```tsx
          {busy ? "Notifying…" : "Complete & Notify"}
```

with:

```tsx
          {busy
            ? "Completing…"
            : hasContactPhone
              ? "Complete order"
              : "Complete & Notify"}
```

- [ ] **Step 3: Pass the prop from `order-detail.tsx`**

In `components/order-detail.tsx`, find the `<OrderCompleteModal … />` render and add the prop:

```tsx
          hasContactPhone={Boolean(order.contactPhone)}
```

- [ ] **Step 4: Import the link builder**

In `components/order-detail.tsx`, add to the existing `@/lib/orders/message` imports — if there is no such import yet, add a new line:

```ts
import { buildWhatsAppReadyLink } from "@/lib/orders/message";
```

Also add the WhatsApp glyph to the lucide import on line 6:

```ts
import { Ban, ChevronLeft, ChevronRight, Loader2, MessageCircle, Receipt, TriangleAlert } from "lucide-react";
```

- [ ] **Step 5: Compute the link once**

Inside the component, after the `const allDone = …` line, add:

```ts
  // wa.me deep link for the manual ready handoff; null when no number on file.
  const waReadyLink = buildWhatsAppReadyLink(order);
```

- [ ] **Step 6: Render the CTA in the completed panel**

In the `{justCompleted && ( … )}` block inside the "Order Complete" `<section>`, the current content is a single `<p>`. Wrap so the WhatsApp button appears under it. Replace:

```tsx
        {justCompleted && (
          <p className="text-xs font-medium text-emerald-700">
            All drinks ready — buyer will be notified for pickup.
            {completedAt && (
              <>
                {" "}
                <span className="text-emerald-700/70">
                  Completed{" "}
                  <time dateTime={completedAt} className="tabular-nums">
                    {formatOrderTime(completedAt)}
                  </time>
                  .
                </span>
              </>
            )}
          </p>
        )}
```

with:

```tsx
        {justCompleted && (
          <div className="flex flex-col gap-2.5">
            <p className="text-xs font-medium text-emerald-700">
              {waReadyLink
                ? "All drinks ready — send the buyer their pickup notice on WhatsApp."
                : "All drinks ready — buyer will be notified for pickup."}
              {completedAt && (
                <>
                  {" "}
                  <span className="text-emerald-700/70">
                    Completed{" "}
                    <time dateTime={completedAt} className="tabular-nums">
                      {formatOrderTime(completedAt)}
                    </time>
                    .
                  </span>
                </>
              )}
            </p>
            {waReadyLink && (
              <a
                href={waReadyLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <MessageCircle className="size-4" strokeWidth={2} aria-hidden />
                Send ready message on WhatsApp
              </a>
            )}
          </div>
        )}
```

- [ ] **Step 7: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 8: Manual check**

- Order **with** a number: open `/manage/{token}`, mark all drinks done → modal says "Complete order" + WhatsApp hint → confirm → green panel shows "Send ready message on WhatsApp"; tapping opens WhatsApp at that number with the ready text pre-filled; no Telegram ready notice arrives.
- Order **without** a number: modal says "Complete & Notify"; on confirm a Telegram ready notice arrives; no WhatsApp button.
- Re-open a completed order with a number → button still present.

- [ ] **Step 9: Commit**

```bash
git add components/order-complete-modal.tsx components/order-detail.tsx
git commit -m "feat(manage): WhatsApp ready CTA at completion"
```

---

### Task 13: Full manual verification pass

**Files:** none (verification only).

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: build succeeds (type + lint clean).

- [ ] **Step 2: Walk the full matrix** (`npm run dev`)

1. `/login` shows only Google + guest; no console errors.
2. Edit Profile: `011-2561 7058` → saves as `+601125617058`; reopen shows `+60 11-2561 7058`; `12345` rejected; clearing saves null.
3. Member, no number → checkout sheet → Save → order places; `profiles.phone` and `orders.contact_phone` both set; Telegram "NEW ORDER!" shows `Contact:`.
4. Member with number → no sheet; order carries the number.
5. Guest → guest modal → continue as guest → sheet → Save → order places with `contact_phone`; **no** profile row.
6. Guest → Skip → order places with `contact_phone = null`.
7. Complete an order with a number → no Telegram ready notice; WhatsApp button opens chat with pre-filled ready text.
8. Complete an order without a number → Telegram ready notice sent; no button.
9. Re-open a completed order with a number → button still works.

- [ ] **Step 3: Final commit (if any docs/notes changed)**

```bash
git add -A
git commit -m "test(whatsapp-binding): manual verification pass" --allow-empty
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** login mock removal (T5), `lib/phone.ts` (T1), profile persistence (T6) + field (T7), checkout nudge members+guests (T8–T9), `orders.contact_phone` + plumbing + Telegram `Contact:` (T2–T4), wa.me handoff + Telegram fallback + completion UI (T10–T12). All spec sections map to a task.
- **Type consistency:** `Order.contactPhone` / `orders.contact_phone` / `PlaceOrderInput.contactPhone` / `ProfileEdit.phone` are the only new fields; `normalizeMyPhone` / `formatMyPhoneForDisplay` / `toWaMeDigits` / `buildWhatsAppReadyLink` are the only new functions, used with the exact signatures defined in Tasks 1 and 10.
- **Order of work matters:** Tasks 1–4 (data + helpers) precede the UI (5–12). Task 9 depends on 6 and 8; Task 12 depends on 10 and 11.
