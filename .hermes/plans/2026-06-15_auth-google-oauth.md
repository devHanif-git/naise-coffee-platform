# Auth + Google OAuth (Supabase) Implementation Plan

> **For Hermes:** Implement task-by-task. Each task is bite-sized. Verify after each. Commit per task.

**Goal:** Replace the mocked localStorage auth with real Supabase Auth using Google OAuth (SSR cookie flow), create a `profiles` table with a `role` defaulting to `customer`, and gate the staff `/manage` surface on the real role — login and logout working end to end.

**Architecture:** `@supabase/ssr` cookie-based sessions for the Next.js App Router. Three Supabase clients (browser, server, proxy). A `proxy.ts` (Next 16's renamed middleware) refreshes the session on every request. Google OAuth uses the PKCE redirect flow: app → Supabase `/auth/v1/callback` → our `/auth/callback` route handler exchanges the code for a session. A Postgres trigger auto-creates a `profiles` row on signup. RLS protects `profiles`; a `SECURITY DEFINER` helper avoids policy recursion. The existing `AuthProvider` public API is preserved so consuming components don't change — only its internals swap from localStorage to the Supabase session.

**Tech Stack:** Next.js 16.2.9 (App Router, `proxy.ts`), TypeScript (strict), `@supabase/supabase-js`, `@supabase/ssr`, Supabase Postgres + RLS, deployed via `@opennextjs/cloudflare` (nodejs runtime).

**Scope boundaries:**
- IN: Google OAuth sign-in/out, SSR session refresh, `profiles` table + trigger + RLS, real role gate for `/manage`, env wiring.
- OUT (later plans): WhatsApp/phone OTP (deferred until Meta WABA approved — phone UI stays mocked), moving orders/beans into Supabase, the guest `owner-id` → `auth.uid()` order migration (orders aren't in the DB yet, so there's nothing to migrate).

**Key facts established from the codebase:**
- Project root: `C:\Users\devHanif\Documents\Projects_n_Programming\Random Projects\naisecoffee`
- Next 16 renamed `middleware` → `proxy` (nodejs only, no edge). Use `proxy.ts` at project root.
- `lib/supabase/` is empty (only `.gitkeep`). No `@supabase/*` deps yet.
- `store/auth.tsx` exposes `{ hydrated, user, isAuthenticated, showWelcome, signIn, signOut, dismissWelcome }`. Consumed by `components/profile-screen.tsx` and `components/auth-screen.tsx`. **Preserve this interface.**
- `lib/auth/session.ts` reads role from a `naise_role` cookie (placeholder). Replace with a `profiles.role` lookup.
- `app/(customer)/profile/settings/page.tsx` has a dev-only `naise_role` cookie toggle — REMOVE it (Task 8.3); the real gate uses `profiles.role`, and staff/admin roles are assigned in Supabase.
- Roles enum: `admin | manager | staff | customer` (`types/auth.ts`). `MANAGE_ROLES = [admin, manager, staff]`.
- `AuthProvider` is mounted in BOTH `app/(customer)/layout.tsx` and `app/(auth)/layout.tsx`.
- Supabase project ref: `hodukwhqjhjzyfxlsovp`. Publishable key uses the NEW naming: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

---

## Phase 0 — Supabase Dashboard + Google Cloud (USER does this, no code)

### Task 0.1: Create Google OAuth credentials
**Owner:** devHanif (already has Client ID; **rotate the leaked secret first**).

1. Google Cloud Console → APIs & Services → Credentials → reset the OAuth client secret (the old one was pasted in chat — treat as compromised).
2. OAuth client (Web application) config:
   - **Authorized JavaScript origins:** `http://localhost:3000`, `https://naisecoffee.utemride.my`, `https://hodukwhqjhjzyfxlsovp.supabase.co`
   - **Authorized redirect URIs:** `https://hodukwhqjhjzyfxlsovp.supabase.co/auth/v1/callback`
3. Copy Client ID + the NEW secret.

### Task 0.2: Configure Supabase Auth
**Owner:** devHanif.

1. Dashboard → Authentication → Providers → **Google** → enable, paste Client ID + Client Secret. Save.
2. Dashboard → Authentication → URL Configuration:
   - **Site URL:** `http://localhost:3000` (swap to `https://naisecoffee.utemride.my` at launch)
   - **Redirect URLs (allow-list):** add `http://localhost:3000/**` and `https://naisecoffee.utemride.my/**`
3. Confirm Data API exposes the `public` schema (default on). Note the publishable key from Settings → API Keys.

**Verify:** Google appears as enabled under Providers; redirect allow-list contains both origins.

---

## Phase 1 — Dependencies & environment

### Task 1.1: Install Supabase packages (pinned)
**Files:** `package.json`, `package-lock.json`

Run (ask before installing — AGENTS.md rule; these are the required, expected deps):
```bash
npm install @supabase/supabase-js@^2 @supabase/ssr@^0.5
```
After install, pin exact versions in `package.json` (replace `^` with the resolved exact versions from the lockfile) per the user's "pin exact versions" convention. Commit the lockfile.

**Verify:** `npm ls @supabase/ssr @supabase/supabase-js` shows both resolved, no peer warnings that break the build.

### Task 1.2: Add env vars (three places)
**Files:** `.env.example`, `.env.local`, `.dev.vars.example`, `.dev.vars`

Append to `.env.example` (committed template — names only, no values):
```bash
# Supabase Auth — client-safe (exposed to the browser)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```
> Decision (devHanif): LEAVE the existing legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` lines in `.env.example` untouched. Just ADD the new `PUBLISHABLE_KEY` line alongside them. The code uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; the legacy lines stay as harmless template placeholders for future server-side work.

Add the real values to `.env.local` (gitignored):
```bash
NEXT_PUBLIC_SUPABASE_URL=https://hodukwhqjhjzyfxlsovp.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<paste publishable key from Supabase → Settings → API Keys>
```
> Do NOT paste real key values into this plan (or any tracked file). Keys belong only in the gitignored `.env.local` / `.dev.vars`.
Mirror both into `.dev.vars.example` (names) and `.dev.vars` (values) so the `opennextjs-cloudflare preview` Worker runtime sees them too.

**Verify:** `grep PUBLISHABLE .env.local .dev.vars` shows the key in both; `.env.example`/`.dev.vars.example` carry the names only.

---

## Phase 2 — Supabase clients

### Task 2.1: Browser client
**Files:** Create `lib/supabase/client.ts`
```ts
import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client for Client Components (realtime, OAuth kickoff).
// Reads only the publishable key — safe to ship to the browser.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
```

### Task 2.2: Server client
**Files:** Create `lib/supabase/server.ts`
```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side client for Server Components, Server Actions, and Route Handlers.
// Uses the request cookie store. The setAll try/catch is required: Server
// Components cannot write cookies, so writes there are no-ops (the proxy
// refreshes the session instead).
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — ignore; proxy handles refresh.
          }
        },
      },
    },
  );
}
```

### Task 2.3: Proxy session-refresh helper
**Files:** Create `lib/supabase/proxy.ts`
```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase session on every request and syncs cookies onto both
// the request (for Server Components downstream) and the response (for the
// browser). MUST call getClaims() — never getSession() — so the JWT signature
// is validated, not just decoded.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
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
          supabaseResponse = NextResponse.next({ request });
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

**Verify (whole phase):** `npx tsc --noEmit` passes for these three files.

---

## Phase 3 — Proxy (session refresh on every request)

### Task 3.1: Create `proxy.ts` at project root
**Files:** Create `proxy.ts` (project root — Next 16 convention, replaces `middleware.ts`)
```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything except static assets and image files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
```
> Notes: Function MUST be named `proxy`. Runtime is nodejs (forced) — fine for `@opennextjs/cloudflare`. Do NOT create a `middleware.ts`.

**Verify:** `npm run dev`, hit `http://localhost:3000/home`, confirm no proxy errors in the terminal and the page renders.

---

## Phase 4 — Database: profiles table, trigger, RLS

> Per the supabase skill: iterate with `execute_sql` (MCP) or the SQL editor, NOT `apply_migration`. Once green, capture the final SQL into a migration file under `supabase/migrations/`. Run advisors before committing.

### Task 4.1: Create the role enum + profiles table
SQL:
```sql
-- Role set mirrors types/auth.ts.
create type public.user_role as enum ('admin', 'manager', 'staff', 'customer');

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  role         public.user_role not null default 'customer',
  display_name text,
  avatar_url   text,
  phone        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'One row per auth user. Identity + role. Beans/orders live elsewhere.';
```

### Task 4.2: updated_at trigger
```sql
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
```

### Task 4.3: Auto-create profile on signup
```sql
-- Runs as definer so it can insert into profiles regardless of RLS. Pulls
-- name/avatar from the Google identity payload. search_path pinned for safety.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

### Task 4.4: Role helper (avoids RLS recursion)
```sql
-- SECURITY DEFINER so reading the caller's role does NOT re-trigger profiles
-- RLS (which would recurse). Kept minimal and only ever returns the CALLER's
-- own role. search_path pinned. Not a general-purpose lookup.
create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
stable
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid());
$$;

revoke execute on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;
```

### Task 4.5: Enable RLS + policies
```sql
alter table public.profiles enable row level security;

-- Read: a user reads their own row; staff/manager/admin read all.
create policy "profiles_select_own_or_staff"
  on public.profiles for select
  to authenticated
  using (
    (select auth.uid()) = id
    or public.current_user_role() in ('admin', 'manager', 'staff')
  );

-- Insert: a user may insert only their own row (the trigger normally does this;
-- this policy covers any client-side upsert fallback).
create policy "profiles_insert_self"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- Update: a user updates only their own row. NOTE: this allows editing
-- display_name/avatar/phone but NOT role escalation — role changes are blocked
-- in app code (never write role from the client) and there is intentionally no
-- client-facing role-update policy. Admin role management is a future plan.
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
```
> Pitfall guarded: UPDATE needs both `USING` and `WITH CHECK`; SELECT policy is required for UPDATE to see the row; role lookup uses the definer function so the SELECT policy doesn't recurse.

### Task 4.6: Backfill existing users (if any)
```sql
insert into public.profiles (id, display_name, avatar_url)
select id,
       coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name'),
       raw_user_meta_data ->> 'avatar_url'
from auth.users
on conflict (id) do nothing;
```

### Task 4.7: Run advisors, then commit the migration
1. Run `supabase db advisors` (or MCP `get_advisors`) — fix any security/perf findings.
2. Create the migration file: `supabase migration new auth_profiles` then paste the finalized SQL (4.1–4.5) into `supabase/migrations/<timestamp>_auth_profiles.sql`. Keep 4.6 as a one-off (or include — it's idempotent).
3. `supabase migration list --local` to verify it's recorded.

**Verify:** In the SQL editor, `select * from public.profiles;` works; a test signup (next phase) creates a row with `role='customer'`.

---

## Phase 5 — OAuth callback route handler

### Task 5.1: Create the code-exchange route
**Files:** Create `app/(auth)/auth/callback/route.ts`
```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase redirects here after Google. Exchange the PKCE code for a session
// (cookies are set by the server client), then send the user to `next`.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/home";
  // Only allow same-site relative redirects.
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/home";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
```
> Route lives in the `(auth)` group so it shares that segment but route handlers ignore layouts. Final URL is `/auth/callback`.

**Verify:** `npx tsc --noEmit` passes. Full flow tested in Phase 7.

---

## Phase 6 — Wire the Google button to real OAuth

### Task 6.1: Replace the mock Google handler in AuthScreen
**Files:** Modify `components/auth-screen.tsx`

- Import the browser client: `import { createClient } from "@/lib/supabase/client";`
- Replace `onGoogle` so it calls real OAuth instead of the `finish("google", …)` mock:
```ts
async function onGoogle() {
  setPending("google");
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirect)}`,
    },
  });
  if (error) {
    setPending(null);
    // TODO: surface a toast; for now log.
    console.error("Google sign-in failed", error);
  }
  // On success the browser navigates away to Google — no further work here.
}
```
- Leave the phone/OTP branch (`onSendOtp`/`onVerifyOtp`) as the existing mock for now (WhatsApp/phone OTP is a later plan). Add a short comment noting it's still mocked.

**Verify:** Clicking "Continue with Google" redirects to the Google consent screen.

---

## Phase 7 — Swap AuthProvider internals to the real session

> This is the highest-risk task. The public API of `useAuth()` must not change (ProfileScreen and AuthScreen depend on `hydrated`, `user`, `isAuthenticated`, `showWelcome`, `signOut`, `dismissWelcome`). Only the source of truth changes: localStorage mock → Supabase session.

### Task 7.1: Rewrite `store/auth.tsx` to read the Supabase session
**Files:** Modify `store/auth.tsx`

Behavior:
- On mount, create the browser client, call `supabase.auth.getClaims()` (or `getUser()`) to seed `user`, set `hydrated = true`.
- Subscribe with `supabase.auth.onAuthStateChange((event, session) => …)` to keep `user` live; unsubscribe on unmount.
- Map the Supabase user → existing `AuthUser` shape:
  - `id` = `session.user.id` (real UUID — replaces the owner-id mock)
  - `method` = `"google"` (from `session.user.app_metadata.provider`)
  - `email` = `session.user.email`
  - `name` = `user_metadata.full_name ?? user_metadata.name ?? email`
- `signOut` → `await supabase.auth.signOut()` then clear local state (keep `getOrCreateOwnerId` behavior for guests untouched — still mint an owner id so guest order attribution keeps working).
- `signIn` (the old mock) → **remove from the public type** OR keep as a no-op stub that throws "use OAuth". Cleanest: drop `signIn` from `AuthContextValue` and delete its only caller path in AuthScreen (already replaced in Task 6.1). Confirm no other callers: `search_files("signIn", path="...")` → only `auth-screen.tsx`.
- Welcome modal: preserve the one-time new-user celebration. Replace the localStorage `known-identities` heuristic with: show welcome when `onAuthStateChange` fires `SIGNED_IN` AND the user's `created_at` is within the last ~60s (brand-new account). Keep `WELCOME_KEY`/`dismissWelcome` as-is for the dismiss flow.
- Keep `getOrCreateOwnerId()` call on mount (guest attribution unchanged).

> Because `AuthProvider` is mounted in two layouts, both the `(auth)` and `(customer)` trees get the live session. The Supabase client reads the same cookies the proxy refreshes, so the session is consistent across the redirect.

**Verify:** `npx tsc --noEmit` passes; `useAuth()` consumers still compile.

### Task 7.2: Confirm no stale mock imports
Run `search_files("naise-auth-known|naise-auth-welcome|setOwnerId", path=<root>)` and reconcile: owner-id stays; the known-identities localStorage block is removed if no longer used.

---

## Phase 8 — Sign-out (profile screen) + real role gate

### Task 8.1: Verify sign-out works through the new provider
**Files:** `components/profile-screen.tsx` (likely no change)

The screen already calls `signOut()` from `useAuth()` via `SignOutConfirmModal`. Since Task 7.1 makes `signOut` call `supabase.auth.signOut()`, this should work unchanged. Confirm by reading the file; only touch it if the `signOut` signature changed.

**Verify:** Manual — sign in, open `/profile`, tap Sign Out, confirm modal → session cleared, UI flips to the guest state, and a refresh stays signed out.

### Task 8.2: Replace the role gate with a profiles lookup
**Files:** Modify `lib/auth/session.ts`
```ts
import { createClient } from "@/lib/supabase/server";
import { MANAGE_ROLES, type Role } from "@/types/auth";

// Reads the signed-in user's role from profiles (RLS-backed). Returns null for
// guests. Replaces the old naise_role cookie placeholder.
export async function getSessionRole(): Promise<Role | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (error || !data) return null;
  return data.role as Role;
}

export async function canManageOrders(): Promise<boolean> {
  const role = await getSessionRole();
  return role !== null && MANAGE_ROLES.includes(role);
}
```
> Decision (devHanif): REMOVE the dev `naise_role` cookie toggle entirely. Staff/admin roles are assigned in Supabase (`profiles.role`), which is what grants `/manage` access. See Task 8.3.

**Verify:** A `customer` hitting `/manage` is blocked; after `update … set role='staff'`, the same user can open it.

### Task 8.3: Remove the dev `naise_role` toggle from settings
**Files:** Modify `app/(customer)/profile/settings/page.tsx`

Delete the `toggleAdminRole` server action (lines ~16–34), the `cookies()` read of `naise_role` and the `isAdmin` constant in the page body, and the entire `process.env.NODE_ENV !== "production"` "Developer" section that renders the Grant/Remove Staff Access button. Drop the now-unused `cookies` import. The page should render only the Security section.

To test staff access going forward, set the role directly in the DB:
```sql
update public.profiles set role = 'staff' where id = '<user-uuid>';
```
(A proper admin role-management UI is a future plan.)

**Verify:** `npx tsc --noEmit` and `npm run lint` pass; `/profile/settings` renders without the Developer section; `grep -r naise_role .` returns nothing.

---

## Phase 9 — Generate DB types

### Task 9.1: Supabase types for `profiles`
**Files:** Create `types/database.ts`
```bash
supabase gen types typescript --project-id hodukwhqjhjzyfxlsovp > types/database.ts
```
Wire the server/browser clients to the generated `Database` generic if low-effort (`createServerClient<Database>(...)`). Keep it simple — only if it compiles cleanly.

**Verify:** `npx tsc --noEmit` passes; `profiles.role` is typed as the enum.

---

## Phase 10 — Full verification

### Task 10.1: Type + lint
```bash
npx tsc --noEmit
npm run lint
```
Expected: no errors. Fix any before proceeding (AGENTS.md: fix lint/type errors before finishing).

### Task 10.2: Build
```bash
npm run build
```
Expected: clean production build.

### Task 10.3: Manual end-to-end (dev)
1. `npm run dev`
2. Visit `/login`, click **Continue with Google**, complete consent.
3. Land back on `/home` signed in. Check Supabase → Auth → Users (new user) and `select * from public.profiles` (new row, `role='customer'`, display_name/avatar populated).
4. Open `/profile` — avatar, name, member-since render from the session/profile.
5. Tap **Sign Out** → confirm → guest state; refresh stays signed out.
6. `/manage` blocked as customer. `update public.profiles set role='staff' where id='<uuid>';`, re-sign-in, `/manage` opens.
7. Confirm phone/OTP button still shows the (mocked) flow without crashing.

### Task 10.4: Cloudflare preview smoke test (optional but recommended)
```bash
npm run preview
```
Confirm OAuth works under the Workers runtime (proxy is nodejs; ensure `.dev.vars` has the Supabase vars). Watch for cookie/domain issues.

### Task 10.5: Commit
```bash
git add -A
git commit -m "feat(auth): real Supabase Google OAuth, profiles table + RLS, role gate"
```
> Do NOT commit `.env.local` or `.dev.vars` (already gitignored). Confirm with `git status` before committing.

---

## Files likely to change

| Action | Path |
|---|---|
| Create | `lib/supabase/client.ts` |
| Create | `lib/supabase/server.ts` |
| Create | `lib/supabase/proxy.ts` |
| Create | `proxy.ts` (project root) |
| Create | `app/(auth)/auth/callback/route.ts` |
| Create | `supabase/migrations/<ts>_auth_profiles.sql` |
| Create | `types/database.ts` |
| Modify | `components/auth-screen.tsx` (real Google OAuth) |
| Modify | `store/auth.tsx` (Supabase session internals) |
| Modify | `lib/auth/session.ts` (profiles role lookup) |
| Modify | `.env.example`, `.env.local`, `.dev.vars.example`, `.dev.vars` |
| Modify | `package.json`, `package-lock.json` |
| Modify | `app/(customer)/profile/settings/page.tsx` (remove dev `naise_role` toggle — Task 8.3) |

## Risks, tradeoffs, open questions

1. **Two `AuthProvider` mounts.** Both layouts wrap children in their own `AuthProvider`. With localStorage that was fine; with Supabase each provider instance subscribes independently — acceptable (both read the same cookies), but confirm there's no double welcome-modal fire across the redirect boundary.
2. **`getClaims()` vs `getUser()`.** The proxy uses `getClaims()` (validates JWT signature). Server role lookups use `getUser()` (round-trips to Supabase, always fresh) — slightly slower but correct for authz. Acceptable for this app's traffic.
3. **Welcome-modal heuristic.** Switching from the localStorage known-identities list to a `created_at < 60s` check is simpler but time-based. Edge case: a brand-new user who dawdles on the consent screen >60s won't see the celebration. Low stakes; revisit if it matters.
4. **Cloudflare Workers + proxy.** Next 16 `proxy` is nodejs-runtime; `@opennextjs/cloudflare` supports it, but verify cookies set in the proxy survive the Worker response (Task 10.4). If issues appear, the OpenNext docs cover middleware/proxy adaptation.
5. **Role escalation.** No client-facing role-update policy exists, and app code never writes `role`. Admin role management (granting staff) is manual SQL for now — a deliberate deferral.
6. **Phone/OTP still mocked.** Per devHanif's decision the phone button STAYS, showing the existing localStorage mock until WhatsApp/WABA is approved. It must not crash now that `signIn` is removed from the provider — Task 7.1 must keep a minimal phone-mock path that satisfies the new provider interface (e.g. a local-only `mockPhoneSignIn` the AuthScreen calls, isolated from the real Supabase session). Add a clear "mocked — not wired to Supabase yet" comment in the phone branch.

## Decisions confirmed (resolved before execution)
- **Q1 — RESOLVED:** Do NOT touch the existing legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` lines in `.env.example`. Just ADD the new `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` line. (Task 1.2)
- **Q2 — RESOLVED:** Keep the phone/OTP button, showing the mock flow, labeled clearly. (Task 7.1, risk #6)
- **Q3 — RESOLVED:** REMOVE the dev `naise_role` toggle from settings entirely. Staff/admin roles are assigned in Supabase (`profiles.role`). (Task 8.3)
