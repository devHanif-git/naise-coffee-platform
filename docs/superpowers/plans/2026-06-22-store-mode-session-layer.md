# Store Mode as a Session Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make in-store kiosk mode a verified cookie layered on top of the user's existing session (or guest), so staff/admin can enter and exit the kiosk without ever logging out of their own account.

**Architecture:** Replace the "sign in as `store@naise.coffee`" session swap with a signed, httpOnly `naise_store` cookie set by a server action after server-side passcode verification. Kiosk guards switch from `role === "store"` to "cookie present + kill-switch on". Store orders already insert via the service-role admin client (`lib/orders/store.ts:36`), so no auth identity is needed to place them.

**Tech Stack:** Next.js 16 (App Router), TypeScript (strict), Supabase (`@supabase/ssr`, `@supabase/supabase-js`), `node:crypto` (HMAC), Tailwind CSS, Radix/shadcn.

## Global Constraints

- TypeScript strict; **no `any`** (copy from AGENTS.md).
- Server Components by default; add `"use client"` only for interactivity/state/browser APIs.
- The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) is **server-only**; never import `lib/supabase/admin.ts` or `lib/auth/store-mode.ts` (which uses the key for HMAC) into a client component.
- Do not add new dependencies (no test framework, no new libs) — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, plus manual end-to-end checks.
- Tailwind utilities for styling; use the `cn()` helper from `lib/utils` for conditional classes; reuse the existing prompt styling rather than copy-pasting.
- Passcode source is unchanged: the `store@naise.coffee` account password, rotatable from admin. No new secret/env var.
- Money is in sen as integers (not touched by this change).

---

### Task 1: Store-mode cookie helpers

**Files:**
- Create: `lib/auth/store-mode.ts`

**Interfaces:**
- Consumes: `next/headers` `cookies()`; `process.env.SUPABASE_SERVICE_ROLE_KEY`.
- Produces:
  - `STORE_MODE_COOKIE: "naise_store"`
  - `inStoreMode(): Promise<boolean>` — true iff the request carries a validly-signed `naise_store` cookie.
  - `setStoreModeCookie(): Promise<void>` — sign + set the cookie (call only from a Server Action or Route Handler).
  - `clearStoreModeCookie(): Promise<void>` — delete the cookie (call only from a Server Action or Route Handler).

- [ ] **Step 1: Create the module**

```ts
// lib/auth/store-mode.ts
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

// Store mode is a signed, httpOnly cookie layered on top of whatever session
// (or guest) the browser already has. It NEVER swaps the Supabase session, so
// exiting returns the user to exactly where they were. The HMAC stops trivial
// client-side forgery; the authoritative kill switch stays `store_account.
// is_enabled`, re-checked server-side on every kiosk request (fail-closed).
export const STORE_MODE_COOKIE = "naise_store";

function secret(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Store mode requires SUPABASE_SERVICE_ROLE_KEY.");
  return key;
}

// token = "<issuedAtMs>.<hex hmac of issuedAtMs>". issuedAt is informational
// (no expiry — a dedicated kiosk tablet must survive reboots); revocation is the
// kill switch, not the cookie lifetime.
function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function makeToken(): string {
  const issued = String(Date.now());
  return `${issued}.${sign(issued)}`;
}

function isValid(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = sign(payload);
  if (mac.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

export async function inStoreMode(): Promise<boolean> {
  const store = await cookies();
  return isValid(store.get(STORE_MODE_COOKIE)?.value);
}

export async function setStoreModeCookie(): Promise<void> {
  const store = await cookies();
  store.set(STORE_MODE_COOKIE, makeToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year; revocation is the kill switch
  });
}

export async function clearStoreModeCookie(): Promise<void> {
  const store = await cookies();
  store.delete(STORE_MODE_COOKIE);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors/warnings for `lib/auth/store-mode.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/auth/store-mode.ts
git commit -m "feat(store): signed naise_store cookie helpers for store mode"
```

---

### Task 2: Enter/exit server actions

**Files:**
- Create: `app/(store)/store/actions.ts`

**Interfaces:**
- Consumes: `createPublicClient` (`lib/supabase/public.ts`), `getStoreAccountEnabled` (`lib/settings/store-account.ts`), `setStoreModeCookie`/`clearStoreModeCookie` (`lib/auth/store-mode.ts`), `STORE_ACCOUNT_EMAIL` (`constants/store.ts`).
- Produces:
  - `enterStoreMode(passcode: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - `exitStoreMode(passcode: string): Promise<{ ok: true } | { ok: false; error: string }>`

Both verify the passcode server-side against the store account on a **non-persisting** client, so the caller's real session/cookies are never touched.

- [ ] **Step 1: Create the actions module**

```ts
// app/(store)/store/actions.ts
"use server";

import { createPublicClient } from "@/lib/supabase/public";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";
import { setStoreModeCookie, clearStoreModeCookie } from "@/lib/auth/store-mode";
import { STORE_ACCOUNT_EMAIL } from "@/constants/store";

type Result = { ok: true } | { ok: false; error: string };

// Verify the passcode WITHOUT signing anyone in: createPublicClient uses
// persistSession:false, so signInWithPassword writes no cookies and the caller's
// session is left intact. We only care whether the credentials are valid.
async function passcodeOk(passcode: string): Promise<boolean> {
  if (passcode.length < 6) return false;
  const supabase = createPublicClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: STORE_ACCOUNT_EMAIL,
    password: passcode,
  });
  return !error;
}

export async function enterStoreMode(passcode: string): Promise<Result> {
  if (!(await getStoreAccountEnabled())) {
    return { ok: false, error: "Store ordering is off." };
  }
  if (!(await passcodeOk(passcode))) {
    return { ok: false, error: "Incorrect passcode." };
  }
  await setStoreModeCookie();
  return { ok: true };
}

export async function exitStoreMode(passcode: string): Promise<Result> {
  // Passcode-gated so a customer on a dedicated tablet can't escape the kiosk.
  if (!(await passcodeOk(passcode))) {
    return { ok: false, error: "Incorrect passcode." };
  }
  await clearStoreModeCookie();
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(store)/store/actions.ts"
git commit -m "feat(store): enterStoreMode/exitStoreMode server actions (passcode-verified)"
```

---

### Task 3: Read the kill switch via the admin client

**Files:**
- Modify: `lib/settings/store-account.ts:6-15` (`getStoreAccountEnabled`)

**Interfaces:**
- Consumes: `createAdminClient` (`lib/supabase/admin.ts`).
- Produces: `getStoreAccountEnabled(): Promise<boolean>` (signature unchanged; now works under any session or none).

**Why:** Store mode now runs under the user's own session (or a guest with no session). The current RLS-scoped read (`createClient`) would fail for non-store users and fail-close the kiosk. The admin client is server-only and already used elsewhere in this file's neighbors.

- [ ] **Step 1: Switch the client in `getStoreAccountEnabled`**

Change the import line at the top of `lib/settings/store-account.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
```

Replace the body of `getStoreAccountEnabled` (keep `getStoreAccountStatus` as-is — it is an admin-only CMS read under RLS):

```ts
// Authoritative kill switch for the kiosk, read on every kiosk request. Uses the
// service-role client because store mode now runs under the user's own session
// (or a guest with none), which cannot read store_account under RLS. FAIL-CLOSED:
// any read error or missing row is treated as disabled.
export async function getStoreAccountEnabled(): Promise<boolean> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("store_account")
    .select("is_enabled")
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;
  return data.is_enabled;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `createClient` is now unused in the file, remove its import to satisfy lint.)

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean (no unused-import warning).

- [ ] **Step 4: Commit**

```bash
git add lib/settings/store-account.ts
git commit -m "feat(store): read kiosk kill switch via service-role admin client"
```

---

### Task 4: Shared passcode prompt component

**Files:**
- Create: `components/store/store-passcode-prompt.tsx`

**Interfaces:**
- Consumes: `enterStoreMode` (`app/(store)/store/actions.ts`).
- Produces:
  - `StorePasscodePrompt(props: { disabled?: boolean; onCancel?: () => void; onSuccess: () => void })` — owns passcode/error/pending state, calls `enterStoreMode`, and on success calls `onSuccess`. Renders the "ordering off" message when `disabled`. Shows a Cancel button only when `onCancel` is provided.

This single component backs both the direct-navigation login screen (Task 5) and the hidden enter gesture (Task 6).

- [ ] **Step 1: Create the component**

```tsx
// components/store/store-passcode-prompt.tsx
"use client";

import { useState, useTransition } from "react";
import { enterStoreMode } from "@/app/(store)/store/actions";

// Shared passcode entry for unlocking store mode. Used full-screen on
// /store/login and inside the hidden enter-gesture modal. enterStoreMode sets a
// signed cookie server-side WITHOUT touching the user's session.
export function StorePasscodePrompt({
  disabled,
  onCancel,
  onSuccess,
}: {
  disabled?: boolean;
  onCancel?: () => void;
  onSuccess: () => void;
}) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await enterStoreMode(passcode);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSuccess();
    });
  }

  if (disabled) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Store ordering is currently off. Ask a manager.
      </p>
    );
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={passcode}
        onChange={(e) => setPasscode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && passcode.length >= 6 && submit()}
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
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="h-12 rounded-2xl border border-border text-sm font-semibold disabled:opacity-40"
        >
          Cancel
        </button>
      )}
      {error && <p className="text-center text-sm text-rose-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "components/store/store-passcode-prompt.tsx"
git commit -m "feat(store): shared StorePasscodePrompt backed by enterStoreMode"
```

---

### Task 5: Login screen + page (no more redirect-to-/)

**Files:**
- Create: `components/store/store-login-screen.tsx`
- Modify: `app/(store)/store/login/page.tsx` (whole file)
- Delete: `components/store/store-login-form.tsx`

**Interfaces:**
- Consumes: `StorePasscodePrompt` (Task 4), `inStoreMode` (Task 1), `getStoreAccountEnabled` (Task 3).
- Produces: `StoreLoginScreen(props: { disabled: boolean })` — full-screen wrapper with the "Naise Store" heading and a Back-to-app control; renders `StorePasscodePrompt`.

- [ ] **Step 1: Create the full-screen login wrapper**

```tsx
// components/store/store-login-screen.tsx
"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { StorePasscodePrompt } from "@/components/store/store-passcode-prompt";

// Full-screen unlock prompt shown on direct navigation to /store/login (and any
// /store/* the kiosk layout redirects here when not in store mode). Cancel/Back
// returns to the app WITHOUT signing anyone out — the user keeps their session.
export function StoreLoginScreen({ disabled }: { disabled: boolean }) {
  const router = useRouter();

  function backToApp() {
    router.push("/");
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8">
      <button
        type="button"
        onClick={backToApp}
        className="absolute left-5 top-5 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Back to app
      </button>
      <h1 className="font-heading text-2xl font-bold uppercase tracking-[0.2em]">
        Naise Store
      </h1>
      <StorePasscodePrompt
        disabled={disabled}
        onSuccess={() => {
          router.push("/store");
          router.refresh();
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Rewrite the login page**

Replace the entire contents of `app/(store)/store/login/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { inStoreMode } from "@/lib/auth/store-mode";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";
import { StoreLoginScreen } from "@/components/store/store-login-screen";

export const dynamic = "force-dynamic";

export default async function StoreLoginPage() {
  const enabled = await getStoreAccountEnabled();
  // Already unlocked and ordering on -> straight into the kiosk.
  if (enabled && (await inStoreMode())) redirect("/store");
  // Otherwise show the unlock prompt (or the "ordering off" message). We do NOT
  // redirect signed-in users away anymore — anyone with the passcode can enter.
  return <StoreLoginScreen disabled={!enabled} />;
}
```

- [ ] **Step 3: Delete the old form**

```bash
git rm "components/store/store-login-form.tsx"
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors, and no remaining references to `StoreLoginForm`. If any reference remains, the typecheck will report it — fix it before continuing.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add "components/store/store-login-screen.tsx" "app/(store)/store/login/page.tsx"
git commit -m "feat(store): passcode unlock screen that never logs the user out"
```

---

### Task 6: Hidden enter gesture in the customer app

**Files:**
- Create: `components/store/store-enter.tsx`
- Modify: `app/(customer)/layout.tsx` (add import + mount; update the lock — see Task 7 note below)

**Interfaces:**
- Consumes: `StorePasscodePrompt` (Task 4).
- Produces: `StoreEnter()` — an invisible press-and-hold target (top-left) that opens `StorePasscodePrompt` in a modal; on success routes to `/store`.

> Note: this task mounts the component. The customer-layout *redirect guard* swap (`role === "store"` → `inStoreMode()`) is done in Task 7. Mounting here is safe because `StoreEnter` renders nothing visible until held.

- [ ] **Step 1: Create the enter gesture**

```tsx
// components/store/store-enter.tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StorePasscodePrompt } from "@/components/store/store-passcode-prompt";

// Discreet staff entry to the kiosk from the customer app: press-and-hold the
// top-LEFT corner for ~1.2s to open the passcode prompt (the customer header
// keeps its buttons on the right; the store EXIT gesture is top-right). Invisible
// so a customer never trips it, and passcode-gated either way.
export function StoreEnter() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function start() {
    timer.current = setTimeout(() => setOpen(true), 1200);
  }
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
  }

  return (
    <>
      <button
        type="button"
        aria-label="Enter store mode (press and hold)"
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onContextMenu={(e) => e.preventDefault()}
        className="fixed left-0 top-0 z-50 size-12 opacity-0"
      />
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6">
          <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl bg-white p-5 text-center">
            <h2 className="font-heading text-base font-semibold">Enter store mode?</h2>
            <p className="text-xs text-muted-foreground">
              Enter the store passcode to open the kiosk on this device.
            </p>
            <StorePasscodePrompt
              onCancel={() => setOpen(false)}
              onSuccess={() => {
                router.push("/store");
                router.refresh();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Mount it in the customer layout**

In `app/(customer)/layout.tsx`, add the import near the other component imports:

```tsx
import { StoreEnter } from "@/components/store/store-enter";
```

Mount it inside the existing centered container, right after `{children}` (line ~29):

```tsx
            <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background pb-[calc(4rem+env(safe-area-inset-bottom))]">
              {children}
              <StoreEnter />
              <CartFab />
              <TabBar showRewards={rewardsEnabled} />
            </div>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "components/store/store-enter.tsx" "app/(customer)/layout.tsx"
git commit -m "feat(store): hidden press-and-hold enter gesture in customer app"
```

---

### Task 7: Swap guards from store role to store-mode cookie

**Files:**
- Modify: `app/(store)/store/(kiosk)/layout.tsx` (whole file)
- Modify: `app/(store)/store/(kiosk)/actions.ts:41` (the authz guard)
- Modify: `app/(customer)/layout.tsx:18-20` (the lock redirect)
- Modify: `lib/auth/session.ts:35-38` (`isStoreMode`)

**Interfaces:**
- Consumes: `inStoreMode` (`lib/auth/store-mode.ts`).
- Produces: no new exports; `isStoreMode()` keeps its signature but now reflects the cookie.

- [ ] **Step 1: Kiosk layout — gate on the cookie**

Replace the entire contents of `app/(store)/store/(kiosk)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { inStoreMode } from "@/lib/auth/store-mode";
import { getStoreAccountEnabled } from "@/lib/settings/store-account";

export const dynamic = "force-dynamic";

export default async function KioskLayout({ children }: { children: React.ReactNode }) {
  if (!(await inStoreMode())) redirect("/store/login");
  if (!(await getStoreAccountEnabled())) redirect("/store/login");
  return <>{children}</>;
}
```

- [ ] **Step 2: Order action — gate on the cookie**

In `app/(store)/store/(kiosk)/actions.ts`, remove the `getSessionRole` import (line 5) and change the guard at line 41.

Delete:

```ts
import { getSessionRole } from "@/lib/auth/session";
```

Add near the other imports:

```ts
import { inStoreMode } from "@/lib/auth/store-mode";
```

Replace line 41:

```ts
  // Defense in depth (the kiosk layout already gates these).
  if (!(await inStoreMode())) return { ok: false, error: "Not authorized." };
```

(Leave the `getStoreAccountEnabled()` check on the next line unchanged. Order attribution stays `STORE_OWNER_ID` / `userId: null`.)

- [ ] **Step 3: Customer layout — lock on the cookie**

In `app/(customer)/layout.tsx`, replace the `getSessionRole` import with `inStoreMode`:

```ts
import { inStoreMode } from "@/lib/auth/store-mode";
```

Replace the guard (lines 18-20):

```tsx
  // While the device is in store mode, lock the customer storefront to the
  // kiosk so a customer can't wander off the /store flow. /manage and other
  // (admin) routes are a different group and are unaffected, so staff can still
  // jump to the order board without exiting store mode.
  if (await inStoreMode()) redirect("/store");
```

(If `getSessionRole` is no longer used elsewhere in this file, its import is now removed by the line above. Verify no other usage remains.)

- [ ] **Step 4: Re-point `isStoreMode`**

In `lib/auth/session.ts`, replace the `isStoreMode` function (lines 35-38). Add the import at the top:

```ts
import { inStoreMode } from "@/lib/auth/store-mode";
```

Replace the function:

```ts
// Whether this device is in kiosk/store mode (signed naise_store cookie). No
// longer tied to a Supabase role — store mode layers on the user's own session.
export async function isStoreMode(): Promise<boolean> {
  return inStoreMode();
}
```

- [ ] **Step 5: Verify no stale `role === "store"` runtime checks remain**

Run: `git grep -n '=== "store"' -- "app" "lib" "components"`
Expected: no matches in runtime guard code (the `Role` type definition in `types/auth.ts` and the `store_account` SQL policy may still mention `store`; those are fine). If a runtime guard remains, convert it to `inStoreMode()`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (no unused `getSessionRole` imports).

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add "app/(store)/store/(kiosk)/layout.tsx" "app/(store)/store/(kiosk)/actions.ts" "app/(customer)/layout.tsx" "lib/auth/session.ts"
git commit -m "feat(store): gate kiosk on naise_store cookie instead of store role"
```

---

### Task 8: Exit gesture clears the cookie (no sign-out)

**Files:**
- Modify: `components/store/store-exit.tsx` (whole file)

**Interfaces:**
- Consumes: `exitStoreMode` (`app/(store)/store/actions.ts`).
- Produces: no new exports.

**Why:** Exit must drop the store layer and return to the underlying session (staff/admin) or guest — never sign anyone out.

- [ ] **Step 1: Rewrite the exit gesture**

Replace the entire contents of `components/store/store-exit.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { exitStoreMode } from "@/app/(store)/store/actions";

// Discreet staff escape hatch for the kiosk: press-and-hold the top-right corner
// for ~1.2s to open the exit prompt, then enter the store passcode to drop store
// mode. Clearing the naise_store cookie returns the device to whatever session
// it already had (staff/admin) or to guest — it NEVER signs anyone out.
export function StoreExit() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function start() {
    timer.current = setTimeout(() => setOpen(true), 1200);
  }
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
  }

  function close() {
    setOpen(false);
    setPasscode("");
    setError(null);
  }

  async function exit() {
    setPending(true);
    setError(null);
    const res = await exitStoreMode(passcode);
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        aria-label="Exit store mode (press and hold)"
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onContextMenu={(e) => e.preventDefault()}
        className="fixed right-0 top-0 z-50 size-12 opacity-0"
      />
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6">
          <div className="flex w-full max-w-xs flex-col gap-4 rounded-2xl bg-white p-5 text-center">
            <h2 className="font-heading text-base font-semibold">Exit store mode?</h2>
            <p className="text-xs text-muted-foreground">
              Enter the store passcode to leave the kiosk on this device.
            </p>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && passcode.length >= 6 && exit()}
              placeholder="Store passcode"
              aria-label="Store passcode"
              className="h-12 rounded-xl border border-border bg-white px-4 text-center text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {error && <p className="text-xs text-rose-600">{error}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="h-11 flex-1 rounded-xl border border-border text-sm font-semibold disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={exit}
                disabled={pending || passcode.length < 6}
                className="h-11 flex-1 rounded-xl bg-black text-sm font-semibold text-white disabled:opacity-40"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (no remaining `createClient`/`STORE_ACCOUNT_EMAIL` imports in this file).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "components/store/store-exit.tsx"
git commit -m "feat(store): exit kiosk by clearing the cookie, not signing out"
```

---

### Task 9: Full build + manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: build succeeds with no type or lint errors.

- [ ] **Step 2: Confirm the store account is provisioned and enabled**

In Supabase (or the admin CMS Store settings), ensure the `store@naise.coffee`
account exists with a known passcode and `store_account.is_enabled = true`. Note
the passcode for the manual checks below.

- [ ] **Step 3: Manual — staff keeps their session**

1. `npm run dev`, sign in as an admin/staff account.
2. On any customer screen, press-and-hold the **top-left** corner ~1.2s → the passcode modal appears.
3. Enter the correct passcode → you land on `/store` (kiosk menu).
4. Place a counter order → it succeeds; the staff Telegram notice points at `/manage/<token>`.
5. Press-and-hold the **top-right** corner ~1.2s → enter passcode → you return to the app **still signed in as the same admin/staff account** (check Profile). No re-login.
6. Navigate to `/manage` → it opens (still your session).

Expected: all steps pass; at no point are you asked to sign in again.

- [ ] **Step 4: Manual — guest round-trip**

1. Open the app in a fresh/incognito window (guest, not signed in).
2. Enter store mode via the top-left hold + passcode → `/store`.
3. Exit via top-right hold + passcode → back in the **guest** customer app (still not signed in).

Expected: guest stays guest after the round-trip.

- [ ] **Step 5: Manual — direct navigation + cancel**

1. As a signed-in user (or guest), go directly to `/store` (or `/store/login`).
2. You see the passcode unlock screen (NOT a redirect to `/`).
3. Click **Back to app** → returns to `/` with your session intact.
4. Go back to `/store/login`, enter a **wrong** passcode → inline "Incorrect passcode." error, no navigation.
5. Enter the correct passcode → `/store`.

Expected: cancel returns to the app; wrong passcode is rejected; correct passcode enters.

- [ ] **Step 6: Manual — kill switch closes the kiosk**

1. While in store mode, have an admin set `store_account.is_enabled = false` (admin CMS).
2. Reload `/store` → redirected to `/store/login`, which shows "Store ordering is currently off."
3. Attempting to place an order via `placeStoreOrder` is refused server-side.

Expected: disabling ordering closes the kiosk regardless of the cookie (fail-closed).

- [ ] **Step 7: Commit any final touch-ups**

If steps surfaced a fix, commit it:

```bash
git add -A
git commit -m "fix(store): address store-mode E2E findings"
```

---

## Notes / Deliberate Deviations from the Spec

- **No disabled-state cookie clearing.** The spec mentioned optionally clearing the cookie when `is_enabled` flips to false. A Server Component (the kiosk layout / login page) cannot write cookies, and access is already fail-closed on every request, so a lingering cookie grants nothing while ordering is off. Kiosks therefore auto-resume when ordering is re-enabled. This is simpler and not a security regression. To force a fresh passcode after a disable, exit explicitly (top-right gesture) — out of scope to automate here.
- **Exit navigates to `/`.** Both staff (real session) and guest land on the app home; staff reach `/manage` from there.
- The `store` Postgres role/enum and the `store_account` `read_admin_or_store` RLS policy are left untouched (vestigial at runtime); no migration is part of this plan.
