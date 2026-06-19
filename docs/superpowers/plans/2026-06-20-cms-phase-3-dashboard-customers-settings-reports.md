# CMS Phase 3 — Dashboard, Customers, Settings, Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the final four admin CMS modules — Settings (store open/closed + feature toggles wired into the storefront), Customers (directory + role assignment + Beans adjustment), Dashboard (metric cards), and Reports (date-range analytics with a chart).

**Architecture:** Follow the established CMS pattern exactly — `lib/<module>/*` typed reads returning camelCase view types, `app/(admin)/admin/<module>/actions.ts` Server Actions returning `{ ok } | { ok:false, error }`, `components/admin/*` client UI, server-rendered admin pages gated by the existing `layout.tsx` `isAdmin()` check. Two genuinely-privileged cross-user writes (role, Beans) are SECURITY DEFINER SQL functions with an internal admin guard; everything else is plain RLS-backed reads. Analytics aggregate in the reads layer in JS over minimal selected columns (single-café data volume), with KL-day bucketing via `Intl` — matching the codebase's select-and-map convention.

**Tech Stack:** Next.js 16 (App Router, Server Components + Server Actions), React 19, TypeScript (strict, no `any`), Tailwind v4, shadcn/ui, Supabase (Postgres + RLS, migrations applied via the Supabase MCP tools), recharts (new — added in Stage 4).

## Global Constraints

- Money is integer **sen** (1 MYR = 100 sen) everywhere; never floats. Display via `formatPrice` from `lib/format.ts`.
- All time windows computed in **Asia/Kuala_Lumpur** (matches the rewards engine). Day keys via `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" })` → `YYYY-MM-DD` (lexicographically sortable/comparable).
- Revenue and Reports money totals count **`status = 'completed'` orders only**. Order *counts* (today/month) count all statuses; "in progress" = `pending|preparing|ready`.
- Every admin page is server-rendered and inherits `isAdmin()` gating from `app/(admin)/admin/layout.tsx`; every Server Action re-checks `await isAdmin()` and returns `{ ok:false, error:"Not authorized." }` if false.
- Every Server Action returns `{ ok: true } | { ok: false; error: string }` (`ActionResult`, mirroring `app/(admin)/admin/promotions/actions.ts`).
- Admin writes enforced in RLS via `public.current_user_role() = 'admin'`; privileged cross-user writes via SECURITY DEFINER functions with `set search_path = ''`, an internal `NOT_ADMIN` guard, `revoke execute … from public` + `grant execute … to authenticated`.
- TypeScript strict; **no `any`**. After each migration, regenerate `types/database.ts` via the Supabase MCP `generate_typescript_types` tool and overwrite the file.
- **No test runner exists** (no vitest/jest). Verify every task with `npx tsc --noEmit`, `npm run lint`, Supabase SQL/RLS checks via the MCP `execute_sql`/`get_advisors` tools, and manual storefront parity via `npm run dev`. Do **not** add a test runner.
- Migrations are applied with the Supabase MCP `apply_migration` tool (args: `name` in snake_case, `query` = the SQL) **and** saved verbatim to `supabase/migrations/<timestamp>_<name>.sql`.
- Mobile-first; admin screens live inside the existing `max-w-md` shell. Reuse `cn()` from `lib/utils`.

## Plan-level decisions (deviations from spec wording, same contract)

- **Analytics in JS, not SQL RPCs.** Spec Section F said "aggregations in SQL"; at single-café volume, JS aggregation over minimal selected columns is simpler, matches the codebase's read style, and keeps interfaces identical. Only `admin_set_role`/`admin_adjust_beans` are SQL functions.
- **No `AlertDialog`/`Select` primitives** (neither is installed). Role uses a native `<select>` (as `product-form.tsx` does); Beans adjustment uses a two-step inline confirm (click → "Confirm"/"Cancel") instead of a modal.
- **recharts added directly** with a small `revenue-chart.tsx`, rather than shadcn's `chart` wrapper.
- **Rewards-off gating** = Rewards tab hidden + `/rewards*` routes redirect to `/home` + home `RewardsBanner` hidden; `streak_enabled`/`referral_enabled` gate their subsections inside `rewards-screen.tsx`. The customizer's redeem mode is only reachable via a `?reward=` link from the (now-redirected) catalog; a hand-crafted URL stays server-validated at checkout (documented edge case, out of scope).

---

## File Structure

**Stage 1 — Settings**
- Create `supabase/migrations/20260620100000_store_settings.sql` — singleton table, RLS, seed.
- Create `lib/settings/types.ts` — `StoreSettings`.
- Create `lib/settings/store.ts` — `getStoreSettings()`.
- Create `app/(admin)/admin/settings/actions.ts` — `updateStoreSettings`.
- Create `components/admin/settings-form.tsx` — the CMS form.
- Modify `app/(admin)/admin/settings/page.tsx` — server page (replaces stub).
- Create `components/store-closed-banner.tsx` — storefront closed notice.
- Modify `app/(customer)/checkout/actions.ts` — hard closed block.
- Modify `app/(customer)/cart/page.tsx`, `app/(customer)/checkout/page.tsx` — closed banner.
- Modify `app/(customer)/layout.tsx` + `components/tab-bar.tsx` — gate Rewards tab.
- Modify `app/(customer)/home/page.tsx` — gate `RewardsBanner`.
- Modify `app/(customer)/rewards/page.tsx`, `app/(customer)/rewards/catalog/page.tsx`, `app/(customer)/rewards/activity/page.tsx` — redirect when rewards off.
- Modify `components/rewards-screen.tsx` — gate streak + referral subsections.

**Stage 2 — Customers**
- Create `supabase/migrations/20260620110000_admin_phase3_rpcs.sql` — `admin_set_role`, `admin_adjust_beans`.
- Create `lib/customers/types.ts` — view types.
- Create `lib/customers/admin.ts` — `listCustomers`, `getCustomerDetail`.
- Create `app/(admin)/admin/customers/actions.ts` — `setCustomerRole`, `adjustCustomerBeans`.
- Create `components/admin/customers-list.tsx`.
- Create `components/admin/customer-detail.tsx`.
- Modify `app/(admin)/admin/customers/page.tsx` — server page (replaces stub).
- Create `app/(admin)/admin/customers/[id]/page.tsx` — detail page.

**Stage 3 — Dashboard**
- Create `lib/analytics/types.ts` — `DashboardMetrics`, `ReportRange`, `ReportData`.
- Create `lib/analytics/dashboard.ts` — `getDashboardMetrics`.
- Modify `app/(admin)/admin/page.tsx` — dashboard cards (replaces stub).

**Stage 4 — Reports**
- Create `lib/analytics/reports.ts` — `getReportData`.
- Create `components/admin/revenue-chart.tsx` — recharts chart.
- Create `components/admin/reports-view.tsx` — range tabs + tables + chart.
- Modify `app/(admin)/admin/reports/page.tsx` — server page (replaces stub).
- Modify `package.json` — add `recharts`.

---

## Task 1: `store_settings` migration (table, RLS, seed)

**Files:**
- Create: `supabase/migrations/20260620100000_store_settings.sql`
- Modify: `types/database.ts` (regenerated)

**Interfaces:**
- Produces: table `public.store_settings` with columns `id, is_open, closed_message, rewards_enabled, referral_enabled, streak_enabled, created_at, updated_at`; one seeded row.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260620100000_store_settings.sql`:

```sql
-- Store-level settings: a single-row table (boolean PK) for the open/closed
-- switch + feature toggles. World-readable (storefront + CMS read it); admin
-- writes. Mirrors loyalty_settings. Reuses public.set_updated_at() and
-- public.current_user_role() (anon CANNOT execute current_user_role(), so the
-- anon SELECT policy never calls it).

create table public.store_settings (
  id               boolean primary key default true check (id),
  is_open          boolean not null default true,
  closed_message   text not null default 'We''re currently closed. Please check back soon.',
  rewards_enabled  boolean not null default true,
  referral_enabled boolean not null default true,
  streak_enabled   boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.store_settings is 'Single-row store settings: open/closed + feature toggles. World-readable; admin-write.';

create trigger store_settings_set_updated_at before update on public.store_settings
  for each row execute function public.set_updated_at();

alter table public.store_settings enable row level security;

create policy "store_settings_read_all" on public.store_settings for select
  to anon, authenticated using (true);
create policy "store_settings_write_admin" on public.store_settings for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

-- Seed the single row with defaults.
insert into public.store_settings (id) values (true) on conflict (id) do nothing;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with `name: "store_settings"` and `query` = the full file contents above.

- [ ] **Step 3: Verify table + RLS + seed**

Use the MCP `execute_sql` tool:

```sql
select count(*) as rows from public.store_settings;
select relrowsecurity from pg_class where relname = 'store_settings';
select polname from pg_policies where tablename = 'store_settings';
```

Expected: `rows = 1`; `relrowsecurity = true`; two policies (`store_settings_read_all`, `store_settings_write_admin`).

- [ ] **Step 4: Regenerate types**

Run the MCP `generate_typescript_types` tool and overwrite `types/database.ts` with the result. Then:

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260620100000_store_settings.sql types/database.ts
git commit -m "feat(cms): store_settings table + RLS + seed"
```

---

## Task 2: Settings reads layer

**Files:**
- Create: `lib/settings/types.ts`
- Create: `lib/settings/store.ts`

**Interfaces:**
- Consumes: `createClient` from `lib/supabase/server`; `store_settings` table (Task 1).
- Produces:
  - `type StoreSettings = { isOpen: boolean; closedMessage: string; rewardsEnabled: boolean; referralEnabled: boolean; streakEnabled: boolean }`
  - `getStoreSettings(): Promise<StoreSettings>` — reads the singleton, falls back to safe defaults (open, all features on) if missing/unreadable.

- [ ] **Step 1: Write the types**

Create `lib/settings/types.ts`:

```ts
// Store-level settings shared by the CMS (edit) and the storefront (read).
export type StoreSettings = {
  isOpen: boolean;
  closedMessage: string;
  rewardsEnabled: boolean;
  referralEnabled: boolean;
  streakEnabled: boolean;
};

// Safe defaults if the row is missing or unreadable — the storefront must never
// hard-fail on a settings read, so it degrades to "open, all features on".
export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  isOpen: true,
  closedMessage: "We're currently closed. Please check back soon.",
  rewardsEnabled: true,
  referralEnabled: true,
  streakEnabled: true,
};
```

- [ ] **Step 2: Write the reads helper**

Create `lib/settings/store.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_STORE_SETTINGS, type StoreSettings } from "@/lib/settings/types";

// Reads the single store_settings row. Degrades to DEFAULT_STORE_SETTINGS so a
// transient read failure never blocks the storefront.
export async function getStoreSettings(): Promise<StoreSettings> {
  const db = await createClient();
  const { data } = await db
    .from("store_settings")
    .select("is_open, closed_message, rewards_enabled, referral_enabled, streak_enabled")
    .limit(1)
    .maybeSingle();
  if (!data) return DEFAULT_STORE_SETTINGS;
  return {
    isOpen: data.is_open,
    closedMessage: data.closed_message,
    rewardsEnabled: data.rewards_enabled,
    referralEnabled: data.referral_enabled,
    streakEnabled: data.streak_enabled,
  };
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/settings/types.ts lib/settings/store.ts
git commit -m "feat(cms): store settings reads layer"
```

---

## Task 3: Settings CMS screen (page, action, form)

**Files:**
- Create: `app/(admin)/admin/settings/actions.ts`
- Create: `components/admin/settings-form.tsx`
- Modify: `app/(admin)/admin/settings/page.tsx`

**Interfaces:**
- Consumes: `getStoreSettings`, `StoreSettings` (Task 2); `isAdmin` from `lib/auth/session`; `Switch` from `components/ui/switch`, `Label`, `Textarea`.
- Produces: `updateStoreSettings(input: StoreSettings): Promise<ActionResult>`.

- [ ] **Step 1: Write the action**

Create `app/(admin)/admin/settings/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";
import type { StoreSettings } from "@/lib/settings/types";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function updateStoreSettings(input: StoreSettings): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };

  const closedMessage = input.closedMessage.trim();
  if (!closedMessage) return { ok: false, error: "Closed message is required." };

  const db = await createClient();
  const { error } = await db
    .from("store_settings")
    .update({
      is_open: input.isOpen,
      closed_message: closedMessage,
      rewards_enabled: input.rewardsEnabled,
      referral_enabled: input.referralEnabled,
      streak_enabled: input.streakEnabled,
    })
    .eq("id", true);
  if (error) return { ok: false, error: error.message };

  // Revalidate the CMS page and every storefront surface a toggle can change.
  revalidatePath("/admin/settings");
  revalidatePath("/home");
  revalidatePath("/menu");
  revalidatePath("/cart");
  revalidatePath("/checkout");
  revalidatePath("/rewards");
  return { ok: true };
}
```

- [ ] **Step 2: Write the form component**

Create `components/admin/settings-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { StoreSettings } from "@/lib/settings/types";
import { updateStoreSettings } from "@/app/(admin)/admin/settings/actions";

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function SettingsForm({ initial }: { initial: StoreSettings }) {
  const [s, setS] = useState<StoreSettings>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setMsg(null);
    startTransition(async () => {
      const res = await updateStoreSettings(s);
      setMsg(res.ok ? { ok: true, text: "Saved." } : { ok: false, text: res.error });
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        <h2 className="font-heading text-base font-bold tracking-tight">Store status</h2>
        <ToggleRow
          label="Store open"
          hint="When off, checkout is blocked and customers see the closed message."
          checked={s.isOpen}
          onChange={(v) => setS({ ...s, isOpen: v })}
        />
        <div className="flex flex-col gap-1.5">
          <Label>Closed message</Label>
          <Textarea
            value={s.closedMessage}
            onChange={(e) => setS({ ...s, closedMessage: e.target.value })}
            rows={2}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-border p-4">
        <h2 className="font-heading text-base font-bold tracking-tight">Features</h2>
        <ToggleRow
          label="Rewards"
          hint="Show the Rewards tab, page, and Beans banner."
          checked={s.rewardsEnabled}
          onChange={(v) => setS({ ...s, rewardsEnabled: v })}
        />
        <ToggleRow
          label="Referral"
          hint="Show the referral card on the Rewards page."
          checked={s.referralEnabled}
          onChange={(v) => setS({ ...s, referralEnabled: v })}
        />
        <ToggleRow
          label="Daily streak"
          hint="Show the streak widget on the Rewards page."
          checked={s.streakEnabled}
          onChange={(v) => setS({ ...s, streakEnabled: v })}
        />
      </section>

      {msg && (
        <p className={msg.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>{msg.text}</p>
      )}
      <button
        onClick={save}
        disabled={pending}
        className="self-start rounded-2xl bg-black px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save settings"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Replace the page stub**

Overwrite `app/(admin)/admin/settings/page.tsx`:

```tsx
import { getStoreSettings } from "@/lib/settings/store";
import { SettingsForm } from "@/components/admin/settings-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getStoreSettings();
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Settings</h1>
      <SettingsForm initial={settings} />
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
Run `npm run dev`, sign in as the admin, open `/admin/settings`: toggles + closed message render, "Save settings" shows "Saved.", and reloading reflects the saved values.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/settings/actions.ts" components/admin/settings-form.tsx "app/(admin)/admin/settings/page.tsx"
git commit -m "feat(cms): settings module (store status + feature toggles)"
```

---

## Task 4: Storefront — store-closed hard block + banner

**Files:**
- Create: `components/store-closed-banner.tsx`
- Modify: `app/(customer)/checkout/actions.ts` (insert after the `ownerId` guard, ~line 47)
- Modify: `app/(customer)/cart/page.tsx`, `app/(customer)/checkout/page.tsx`

**Interfaces:**
- Consumes: `getStoreSettings` (Task 2).
- Produces: `<StoreClosedBanner message={string} />`; `placeOrder` returns the closed message when the store is closed.

- [ ] **Step 1: Write the banner component**

Create `components/store-closed-banner.tsx`:

```tsx
// Storefront notice shown when the store is closed (store_settings.is_open=false).
export function StoreClosedBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="mx-4 mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      {message}
    </div>
  );
}
```

- [ ] **Step 2: Add the server-side block to `placeOrder`**

In `app/(customer)/checkout/actions.ts`, add the import near the top (with the other `@/lib` imports):

```ts
import { getStoreSettings } from "@/lib/settings/store";
```

Then, immediately after the existing `ownerId` guard:

```ts
  if (!input.ownerId) {
    return { ok: false, error: "Missing session id. Refresh and try again." };
  }
```

insert:

```ts
  // Hard block: an admin can close the store from the CMS.
  const settings = await getStoreSettings();
  if (!settings.isOpen) {
    return { ok: false, error: settings.closedMessage };
  }
```

- [ ] **Step 3: Show the banner on cart + checkout pages**

In `app/(customer)/cart/page.tsx` and `app/(customer)/checkout/page.tsx`, import the helper + banner:

```ts
import { getStoreSettings } from "@/lib/settings/store";
import { StoreClosedBanner } from "@/components/store-closed-banner";
```

Read settings in the page component (these are server components), and render the banner as the first child of the page's top-level wrapper element when closed:

```tsx
const settings = await getStoreSettings();
// …inside the returned JSX, as the first child:
{!settings.isOpen && <StoreClosedBanner message={settings.closedMessage} />}
```

(If a page is not already `async`, make it `async`. Do not otherwise change the existing layout.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
Run `npm run dev`. In the CMS set the store **Closed**. On the storefront: the banner shows on `/cart` and `/checkout`; attempting to place an order returns the closed message (no order is created). Set it **Open** again: ordering works and the banner is gone.

- [ ] **Step 5: Commit**

```bash
git add components/store-closed-banner.tsx "app/(customer)/checkout/actions.ts" "app/(customer)/cart/page.tsx" "app/(customer)/checkout/page.tsx"
git commit -m "feat(storefront): block checkout + show banner when store is closed"
```

---

## Task 5: Storefront — feature toggle gates (rewards / referral / streak)

**Files:**
- Modify: `app/(customer)/layout.tsx`
- Modify: `components/tab-bar.tsx`
- Modify: `app/(customer)/home/page.tsx`
- Modify: `app/(customer)/rewards/page.tsx`, `app/(customer)/rewards/catalog/page.tsx`, `app/(customer)/rewards/activity/page.tsx`
- Modify: `components/rewards-screen.tsx`

**Interfaces:**
- Consumes: `getStoreSettings` (Task 2); `redirect` from `next/navigation`.
- Produces: `TabBar` accepts `showRewards: boolean`; `RewardsScreen` accepts `streakEnabled: boolean` and `referralEnabled: boolean`.

- [ ] **Step 1: Gate the Rewards tab — `tab-bar.tsx`**

Change the `TabBar` signature and filter the Rewards tab. Replace the component declaration line:

```tsx
export function TabBar() {
```

with:

```tsx
export function TabBar({ showRewards = true }: { showRewards?: boolean }) {
```

Then, where the tabs are mapped, filter first. Replace `{tabs.map((tab) => {` with:

```tsx
{tabs
  .filter((tab) => showRewards || tab.href !== "/rewards")
  .map((tab) => {
```

- [ ] **Step 2: Pass the flag from the layout — `app/(customer)/layout.tsx`**

Add the import:

```ts
import { getStoreSettings } from "@/lib/settings/store";
```

In the component body, read settings alongside the existing loyalty read:

```ts
  const { beansPerRinggit } = await getLoyaltySettings();
  const { rewardsEnabled } = await getStoreSettings();
```

Change `<TabBar />` to:

```tsx
<TabBar showRewards={rewardsEnabled} />
```

- [ ] **Step 3: Gate the home Beans banner — `app/(customer)/home/page.tsx`**

Add the import:

```ts
import { getStoreSettings } from "@/lib/settings/store";
```

In `HomePage`, read settings:

```ts
  const bestSellers = await getBestSellers();
  const { rewardsEnabled } = await getStoreSettings();
```

Wrap the existing `<RewardsBanner … />` usage so it only renders when rewards are on:

```tsx
{rewardsEnabled && <RewardsBanner />}
```

(Keep whatever props `RewardsBanner` already receives; only add the `rewardsEnabled &&` guard.)

- [ ] **Step 4: Redirect the rewards routes when rewards are off**

In each of `app/(customer)/rewards/page.tsx`, `app/(customer)/rewards/catalog/page.tsx`, `app/(customer)/rewards/activity/page.tsx`, add imports:

```ts
import { redirect } from "next/navigation";
import { getStoreSettings } from "@/lib/settings/store";
```

As the first statement inside each page component (before the existing data fetches), add:

```ts
  const store = await getStoreSettings();
  if (!store.rewardsEnabled) redirect("/home");
```

- [ ] **Step 5: Pass streak/referral flags into `RewardsScreen` — `app/(customer)/rewards/page.tsx`**

This page already reads `getStoreSettings()` from Step 4 as `store`. Pass two props to `<RewardsScreen …>`:

```tsx
      streakEnabled={store.streakEnabled}
      referralEnabled={store.referralEnabled}
```

- [ ] **Step 6: Gate the subsections — `components/rewards-screen.tsx`**

Add the two props to the component's prop type (alongside the existing props such as `milestones`, `referral`):

```ts
  streakEnabled: boolean;
  referralEnabled: boolean;
```

and to the destructured params (alongside `referral`):

```ts
  streakEnabled,
  referralEnabled,
```

Then wrap the two streak `<section>` blocks (the "Streak + Tier summary row" at the `grid grid-cols-2` section and the `aria-label="Weekly streak"` section) so they render only when `streakEnabled`:

```tsx
{streakEnabled && (
  <section className="grid grid-cols-2 naise-rise [animation-delay:80ms]">
    {/* …existing streak summary… */}
  </section>
)}
{streakEnabled && (
  <section aria-label="Weekly streak" className="-mt-3 naise-rise [animation-delay:140ms]">
    {/* …existing weekly streak… */}
  </section>
)}
```

Wrap the referral `<section aria-labelledby="invite-heading" …>` and the `{referralOpen && <RewardsReferralModal … />}` mount so both render only when `referralEnabled`:

```tsx
{referralEnabled && (
  <section aria-labelledby="invite-heading" className="naise-rise [animation-delay:320ms]">
    {/* …existing referral card… */}
  </section>
)}
{/* …later… */}
{referralEnabled && referralOpen && (
  <RewardsReferralModal onClose={() => setReferralOpen(false)} />
)}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
Run `npm run dev`. In the CMS:
- Turn **Rewards off** → the Rewards tab disappears, `/rewards`, `/rewards/catalog`, `/rewards/activity` redirect to `/home`, and the home Beans banner is gone. Turn back on → all return.
- With Rewards **on**, turn **Streak off** → the streak summary + weekly streak sections vanish from `/rewards`; turn **Referral off** → the referral card vanishes. Toggle back on → both return.

- [ ] **Step 8: Commit**

```bash
git add "app/(customer)/layout.tsx" components/tab-bar.tsx "app/(customer)/home/page.tsx" "app/(customer)/rewards/page.tsx" "app/(customer)/rewards/catalog/page.tsx" "app/(customer)/rewards/activity/page.tsx" components/rewards-screen.tsx
git commit -m "feat(storefront): gate rewards/referral/streak surfaces on settings"
```

---

## Task 6: Customers — privileged write RPCs

**Files:**
- Create: `supabase/migrations/20260620110000_admin_phase3_rpcs.sql`
- Modify: `types/database.ts` (regenerated)

**Interfaces:**
- Produces:
  - `public.admin_set_role(p_user uuid, p_role public.user_role) returns void`
  - `public.admin_adjust_beans(p_user uuid, p_amount integer, p_reason text) returns integer` (new balance)
  - Exception codes: `NOT_ADMIN`, `CANNOT_CHANGE_OWN_ROLE`, `LAST_ADMIN`, `NO_SUCH_USER`, `ZERO_AMOUNT`, `REASON_REQUIRED`, `NEGATIVE_BALANCE`.

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260620110000_admin_phase3_rpcs.sql`:

```sql
-- Phase 3 privileged admin writes. SECURITY DEFINER so they bypass profiles /
-- rewards RLS, but each gates internally on current_user_role()='admin' and is
-- granted to authenticated only (revoked from public/anon). search_path pinned.
-- Mirrors the rewards-function pattern (20260618081000_rewards_functions.sql).

-- Assign a role to another user. Guards: caller must be admin; cannot change own
-- role; cannot remove the last remaining admin; user must exist.
create or replace function public.admin_set_role(p_user uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'NOT_ADMIN';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'CANNOT_CHANGE_OWN_ROLE';
  end if;
  if p_role <> 'admin'
     and exists (select 1 from public.profiles where id = p_user and role = 'admin')
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'LAST_ADMIN';
  end if;
  update public.profiles set role = p_role, updated_at = now() where id = p_user;
  if not found then
    raise exception 'NO_SUCH_USER';
  end if;
end;
$$;

revoke execute on function public.admin_set_role(uuid, public.user_role) from public;
grant execute on function public.admin_set_role(uuid, public.user_role) to authenticated;

-- Manually grant/deduct Beans with a reason. Writes one 'adjustment' ledger row;
-- the existing bean_transactions_apply trigger updates the cached balance.
-- Guards: caller must be admin; non-zero amount; non-empty reason; never overdraw.
-- Returns the new balance.
create or replace function public.admin_adjust_beans(p_user uuid, p_amount integer, p_reason text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance integer;
begin
  if public.current_user_role() <> 'admin' then
    raise exception 'NOT_ADMIN';
  end if;
  if p_amount = 0 then
    raise exception 'ZERO_AMOUNT';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED';
  end if;

  insert into public.reward_accounts (user_id) values (p_user)
    on conflict (user_id) do nothing;

  select balance into v_balance from public.reward_accounts where user_id = p_user;
  if v_balance + p_amount < 0 then
    raise exception 'NEGATIVE_BALANCE';
  end if;

  insert into public.bean_transactions (user_id, category, amount, label)
  values (p_user, 'adjustment', p_amount, 'Admin adjustment: ' || p_reason);

  select balance into v_balance from public.reward_accounts where user_id = p_user;
  return v_balance;
end;
$$;

revoke execute on function public.admin_adjust_beans(uuid, integer, text) from public;
grant execute on function public.admin_adjust_beans(uuid, integer, text) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Use the MCP `apply_migration` tool with `name: "admin_phase3_rpcs"` and `query` = the full file above.

- [ ] **Step 3: Verify guards via SQL**

Use the MCP `execute_sql` tool. With no admin session (SQL runs as the service/owner role, so `current_user_role()` is null), every call must raise `NOT_ADMIN`:

```sql
do $$ begin
  perform public.admin_adjust_beans('00000000-0000-0000-0000-000000000000'::uuid, 100, 'x');
  raise exception 'SHOULD_HAVE_FAILED';
exception when others then
  if sqlerrm <> 'NOT_ADMIN' then raise; end if;
end $$;
```

Expected: completes with no error (the inner `NOT_ADMIN` was caught; `SHOULD_HAVE_FAILED` never reached). Also confirm grants:

```sql
select proname, proacl::text from pg_proc where proname in ('admin_set_role','admin_adjust_beans');
```

Expected: `proacl` shows `authenticated=X` and **not** `public`/`anon` execute.

- [ ] **Step 4: Regenerate types + typecheck**

Run the MCP `generate_typescript_types` tool, overwrite `types/database.ts`. Then `npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260620110000_admin_phase3_rpcs.sql types/database.ts
git commit -m "feat(cms): admin_set_role + admin_adjust_beans RPCs"
```

---

## Task 7: Customers reads layer

**Files:**
- Create: `lib/customers/types.ts`
- Create: `lib/customers/admin.ts`

**Interfaces:**
- Consumes: `createClient` from `lib/supabase/server`; tables `profiles`, `reward_accounts`, `orders`, `bean_transactions`.
- Produces:
  - `type CustomerSummary = { id; displayName: string|null; phone: string|null; role: Role; beansBalance: number; ordersCount: number; joinedAt: string }`
  - `type CustomerLedgerEntry`, `type CustomerOrderSummary`, `type CustomerDetail`
  - `listCustomers(search?: string): Promise<CustomerSummary[]>`
  - `getCustomerDetail(userId: string): Promise<CustomerDetail | null>`

- [ ] **Step 1: Write the view types**

Create `lib/customers/types.ts`:

```ts
import type { Role } from "@/types/auth";

export type CustomerSummary = {
  id: string;
  displayName: string | null;
  phone: string | null;
  role: Role;
  beansBalance: number;
  ordersCount: number;
  joinedAt: string; // ISO
};

export type CustomerLedgerEntry = {
  id: string;
  category: "earn" | "redeem" | "streak_bonus" | "referral" | "adjustment";
  amount: number;
  label: string;
  isReversal: boolean;
  createdAt: string;
};

export type CustomerOrderSummary = {
  id: string;
  orderNumber: string;
  status: "pending" | "preparing" | "ready" | "completed" | "cancelled";
  total: number;
  createdAt: string;
};

export type CustomerDetail = {
  summary: CustomerSummary;
  orders: CustomerOrderSummary[];
  ledger: CustomerLedgerEntry[];
};
```

- [ ] **Step 2: Write the reads**

Create `lib/customers/admin.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/types/auth";
import type {
  CustomerDetail,
  CustomerLedgerEntry,
  CustomerOrderSummary,
  CustomerSummary,
} from "@/lib/customers/types";

// All reads run under the caller's RLS; the admin SELECT policies on profiles /
// reward_accounts / orders / bean_transactions return every row. Callers gate
// with isAdmin (the admin layout) before rendering.

export async function listCustomers(search?: string): Promise<CustomerSummary[]> {
  const db = await createClient();
  const [profilesRes, accountsRes, ordersRes] = await Promise.all([
    db.from("profiles").select("id, display_name, phone, role, created_at").order("created_at", { ascending: false }),
    db.from("reward_accounts").select("user_id, balance"),
    db.from("orders").select("user_id"),
  ]);
  if (profilesRes.error) throw new Error(`listCustomers failed: ${profilesRes.error.message}`);
  if (accountsRes.error) throw new Error(`listCustomers failed: ${accountsRes.error.message}`);
  if (ordersRes.error) throw new Error(`listCustomers failed: ${ordersRes.error.message}`);

  const balanceByUser = new Map((accountsRes.data ?? []).map((a) => [a.user_id, a.balance]));
  const ordersByUser = new Map<string, number>();
  for (const o of ordersRes.data ?? []) {
    if (o.user_id) ordersByUser.set(o.user_id, (ordersByUser.get(o.user_id) ?? 0) + 1);
  }

  const term = search?.trim().toLowerCase();
  return (profilesRes.data ?? [])
    .map((p) => ({
      id: p.id,
      displayName: p.display_name,
      phone: p.phone,
      role: p.role as Role,
      beansBalance: balanceByUser.get(p.id) ?? 0,
      ordersCount: ordersByUser.get(p.id) ?? 0,
      joinedAt: p.created_at,
    }))
    .filter((c) =>
      !term ||
      (c.displayName?.toLowerCase().includes(term) ?? false) ||
      (c.phone?.toLowerCase().includes(term) ?? false),
    );
}

export async function getCustomerDetail(userId: string): Promise<CustomerDetail | null> {
  const db = await createClient();
  const [profileRes, accountRes, ordersRes, ledgerRes] = await Promise.all([
    db.from("profiles").select("id, display_name, phone, role, created_at").eq("id", userId).maybeSingle(),
    db.from("reward_accounts").select("balance").eq("user_id", userId).maybeSingle(),
    db.from("orders").select("id, order_number, status, total, created_at").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("bean_transactions").select("id, category, amount, label, is_reversal, created_at").eq("user_id", userId).order("created_at", { ascending: false }),
  ]);
  if (profileRes.error) throw new Error(`getCustomerDetail failed: ${profileRes.error.message}`);
  if (!profileRes.data) return null;
  if (ordersRes.error) throw new Error(`getCustomerDetail failed: ${ordersRes.error.message}`);
  if (ledgerRes.error) throw new Error(`getCustomerDetail failed: ${ledgerRes.error.message}`);

  const p = profileRes.data;
  const orders: CustomerOrderSummary[] = (ordersRes.data ?? []).map((o) => ({
    id: o.id,
    orderNumber: o.order_number,
    status: o.status,
    total: o.total,
    createdAt: o.created_at,
  }));
  const ledger: CustomerLedgerEntry[] = (ledgerRes.data ?? []).map((t) => ({
    id: t.id,
    category: t.category,
    amount: t.amount,
    label: t.label,
    isReversal: t.is_reversal,
    createdAt: t.created_at,
  }));

  return {
    summary: {
      id: p.id,
      displayName: p.display_name,
      phone: p.phone,
      role: p.role as Role,
      beansBalance: accountRes.data?.balance ?? 0,
      ordersCount: orders.length,
      joinedAt: p.created_at,
    },
    orders,
    ledger,
  };
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/customers/types.ts lib/customers/admin.ts
git commit -m "feat(cms): customers reads layer (list + detail)"
```

---

## Task 8: Customers actions (role + Beans)

**Files:**
- Create: `app/(admin)/admin/customers/actions.ts`

**Interfaces:**
- Consumes: `admin_set_role`, `admin_adjust_beans` RPCs (Task 6); `isAdmin`; `Role`.
- Produces:
  - `setCustomerRole(userId: string, role: Role): Promise<ActionResult>`
  - `adjustCustomerBeans(userId: string, amount: number, reason: string): Promise<{ ok: true; balance: number } | { ok: false; error: string }>`

- [ ] **Step 1: Write the actions**

Create `app/(admin)/admin/customers/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";
import type { Role } from "@/types/auth";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type AdjustResult = { ok: true; balance: number } | { ok: false; error: string };

// Map a Postgres exception message (our RAISE codes) to a friendly string.
function friendly(message: string, fallback: string): string {
  if (message.includes("CANNOT_CHANGE_OWN_ROLE")) return "You can't change your own role.";
  if (message.includes("LAST_ADMIN")) return "There must be at least one admin.";
  if (message.includes("NO_SUCH_USER")) return "Customer not found.";
  if (message.includes("NEGATIVE_BALANCE")) return "Adjustment would make the balance negative.";
  if (message.includes("ZERO_AMOUNT")) return "Enter a non-zero amount.";
  if (message.includes("REASON_REQUIRED")) return "A reason is required.";
  if (message.includes("NOT_ADMIN")) return "Not authorized.";
  return fallback;
}

export async function setCustomerRole(userId: string, role: Role): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.rpc("admin_set_role", { p_user: userId, p_role: role });
  if (error) return { ok: false, error: friendly(error.message, "Couldn't update the role.") };
  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${userId}`);
  return { ok: true };
}

export async function adjustCustomerBeans(
  userId: string,
  amount: number,
  reason: string,
): Promise<AdjustResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  if (!Number.isInteger(amount)) return { ok: false, error: "Enter a whole number of Beans." };
  const db = await createClient();
  const { data, error } = await db.rpc("admin_adjust_beans", {
    p_user: userId,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) return { ok: false, error: friendly(error.message, "Couldn't adjust Beans.") };
  revalidatePath(`/admin/customers/${userId}`);
  return { ok: true, balance: data as number };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/customers/actions.ts"
git commit -m "feat(cms): customers actions (role assignment + beans adjustment)"
```

---

## Task 9: Customers list screen

**Files:**
- Create: `components/admin/customers-list.tsx`
- Modify: `app/(admin)/admin/customers/page.tsx`

**Interfaces:**
- Consumes: `listCustomers`, `CustomerSummary` (Task 7); `formatPrice`/`formatOrderTime` not needed here; `Link`.
- Produces: `<CustomersList initial={CustomerSummary[]} />`.

- [ ] **Step 1: Write the list component**

Create `components/admin/customers-list.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import type { CustomerSummary } from "@/lib/customers/types";

const ROLE_STYLE: Record<string, string> = {
  admin: "bg-black text-white",
  manager: "bg-indigo-100 text-indigo-800",
  staff: "bg-amber-100 text-amber-800",
  customer: "bg-neutral-100 text-neutral-700",
};

export function CustomersList({ initial }: { initial: CustomerSummary[] }) {
  const [term, setTerm] = useState("");
  const t = term.trim().toLowerCase();
  const rows = !t
    ? initial
    : initial.filter(
        (c) =>
          (c.displayName?.toLowerCase().includes(t) ?? false) ||
          (c.phone?.toLowerCase().includes(t) ?? false),
      );

  return (
    <div className="flex flex-col gap-3">
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search name or phone"
        className="rounded-2xl border border-border px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-black/20"
      />
      <ul className="flex flex-col gap-2">
        {rows.map((c) => (
          <li key={c.id}>
            <Link
              href={`/admin/customers/${c.id}`}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border p-3 transition-colors hover:bg-muted"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold">
                  {c.displayName ?? "(no name)"}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {c.phone ?? "—"} · {c.ordersCount} orders
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{c.beansBalance} 🫘</span>
                <span className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold ${ROLE_STYLE[c.role] ?? ROLE_STYLE.customer}`}>
                  {c.role}
                </span>
              </div>
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No customers found.
          </li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Replace the page stub**

Overwrite `app/(admin)/admin/customers/page.tsx`:

```tsx
import { listCustomers } from "@/lib/customers/admin";
import { CustomersList } from "@/components/admin/customers-list";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  const customers = await listCustomers();
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Customers</h1>
      <CustomersList initial={customers} />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
Run `npm run dev`, open `/admin/customers`: the list renders with names, phone, orders count, Beans, and role badges; search filters live.

- [ ] **Step 4: Commit**

```bash
git add components/admin/customers-list.tsx "app/(admin)/admin/customers/page.tsx"
git commit -m "feat(cms): customers list screen"
```

---

## Task 10: Customer detail screen (role + Beans actions)

**Files:**
- Create: `components/admin/customer-detail.tsx`
- Create: `app/(admin)/admin/customers/[id]/page.tsx`

**Interfaces:**
- Consumes: `getCustomerDetail`, `CustomerDetail` (Task 7); `setCustomerRole`, `adjustCustomerBeans` (Task 8); `formatPrice`, `formatOrderTime` from `lib/format`; `Role`.
- Produces: detail UI at `/admin/customers/[id]`.

- [ ] **Step 1: Write the detail component**

Create `components/admin/customer-detail.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerDetail } from "@/lib/customers/types";
import type { Role } from "@/types/auth";
import { formatPrice, formatOrderTime } from "@/lib/format";
import { setCustomerRole, adjustCustomerBeans } from "@/app/(admin)/admin/customers/actions";

const ROLES: Role[] = ["customer", "staff", "manager", "admin"];

export function CustomerDetail({ detail }: { detail: CustomerDetail }) {
  const router = useRouter();
  const { summary, orders, ledger } = detail;

  const [role, setRole] = useState<Role>(summary.role);
  const [roleMsg, setRoleMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rolePending, startRole] = useTransition();

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [beansMsg, setBeansMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [beansPending, startBeans] = useTransition();

  function saveRole() {
    setRoleMsg(null);
    startRole(async () => {
      const res = await setCustomerRole(summary.id, role);
      if (res.ok) {
        setRoleMsg({ ok: true, text: "Role updated." });
        router.refresh();
      } else {
        setRole(summary.role); // revert the picker on failure
        setRoleMsg({ ok: false, text: res.error });
      }
    });
  }

  function applyBeans() {
    setBeansMsg(null);
    startBeans(async () => {
      const res = await adjustCustomerBeans(summary.id, Number(amount), reason);
      if (res.ok) {
        setBeansMsg({ ok: true, text: `Done. New balance: ${res.balance} Beans.` });
        setAmount("");
        setReason("");
        setConfirming(false);
        router.refresh();
      } else {
        setBeansMsg({ ok: false, text: res.error });
        setConfirming(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Identity + balance */}
      <section className="rounded-2xl border border-border p-4">
        <h2 className="text-base font-bold">{summary.displayName ?? "(no name)"}</h2>
        <p className="text-xs text-muted-foreground">
          {summary.phone ?? "—"} · joined {formatOrderTime(summary.joinedAt)}
        </p>
        <p className="mt-2 text-sm">
          <span className="font-semibold">{summary.beansBalance}</span> Beans ·{" "}
          <span className="font-semibold">{summary.ordersCount}</span> orders
        </p>
      </section>

      {/* Role assignment */}
      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h3 className="text-sm font-bold">Role</h3>
        <div className="flex items-center gap-2">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="rounded-2xl border border-border px-3 py-2 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button
            onClick={saveRole}
            disabled={rolePending || role === summary.role}
            className="rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {rolePending ? "Saving…" : "Save role"}
          </button>
        </div>
        {roleMsg && (
          <p className={roleMsg.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>{roleMsg.text}</p>
        )}
      </section>

      {/* Beans adjustment */}
      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h3 className="text-sm font-bold">Adjust Beans</h3>
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (e.g. 100 or -50)"
          className="rounded-2xl border border-border px-3 py-2 text-sm"
        />
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required)"
          className="rounded-2xl border border-border px-3 py-2 text-sm"
        />
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            disabled={!amount || !reason.trim() || Number(amount) === 0}
            className="self-start rounded-2xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Adjust
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm">
              {Number(amount) > 0 ? "Grant" : "Deduct"} {Math.abs(Number(amount))} Beans?
            </span>
            <button
              onClick={applyBeans}
              disabled={beansPending}
              className="rounded-2xl bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {beansPending ? "Applying…" : "Confirm"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={beansPending}
              className="rounded-2xl border border-border px-3 py-1.5 text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        )}
        {beansMsg && (
          <p className={beansMsg.ok ? "text-sm text-emerald-600" : "text-sm text-rose-600"}>{beansMsg.text}</p>
        )}
      </section>

      {/* Order history */}
      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h3 className="text-sm font-bold">Orders</h3>
        {orders.length === 0 && <p className="text-sm text-muted-foreground">No orders yet.</p>}
        {orders.map((o) => (
          <div key={o.id} className="flex items-center justify-between text-sm">
            <span className="font-medium">{o.orderNumber}</span>
            <span className="text-muted-foreground">{o.status}</span>
            <span>{formatPrice(o.total)}</span>
          </div>
        ))}
      </section>

      {/* Beans ledger */}
      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h3 className="text-sm font-bold">Beans ledger</h3>
        {ledger.length === 0 && <p className="text-sm text-muted-foreground">No Beans activity yet.</p>}
        {ledger.map((t) => (
          <div key={t.id} className="flex items-center justify-between text-sm">
            <span className="truncate">{t.label}</span>
            <span className={t.amount >= 0 ? "text-emerald-600" : "text-rose-600"}>
              {t.amount >= 0 ? "+" : ""}{t.amount}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Write the detail page**

Create `app/(admin)/admin/customers/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { getCustomerDetail } from "@/lib/customers/admin";
import { CustomerDetail } from "@/components/admin/customer-detail";
import { AdminBackLink } from "@/components/admin/admin-back-link";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getCustomerDetail(id);
  if (!detail) notFound();
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <AdminBackLink href="/admin/customers" label="Customers" />
      <CustomerDetail detail={detail} />
    </div>
  );
}
```

> Note: `AdminBackLink` already exists (`components/admin/admin-back-link.tsx`). If its prop names differ from `href`/`label`, open the file and pass whatever props it actually declares; the goal is a back link to `/admin/customers`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
Run `npm run dev`. Open a customer from the list:
- Order history + Beans ledger render.
- Promote `customer` → `staff` (Save role) → "Role updated."; the list badge updates.
- Try to change your **own** admin role → "You can't change your own role."
- Grant `+100` Beans with a reason → Confirm → "New balance: …"; a `+100` adjustment row appears in the ledger.
- Try to deduct more than the balance → "Adjustment would make the balance negative."

- [ ] **Step 4: Commit**

```bash
git add components/admin/customer-detail.tsx "app/(admin)/admin/customers/[id]/page.tsx"
git commit -m "feat(cms): customer detail screen with role + beans actions"
```

---

## Task 11: Dashboard reads layer

**Files:**
- Create: `lib/analytics/types.ts`
- Create: `lib/analytics/dashboard.ts`

**Interfaces:**
- Consumes: `createClient`; tables `orders`, `order_items`.
- Produces:
  - `type DashboardMetrics = { today: {orders; revenue; inProgress}; month: {orders; revenue; activeCustomers}; topSellers: {name; quantity}[]; statusBreakdown: {status; count}[] }`
  - `type ReportRange = "today" | "7d" | "30d" | "month"` and `type ReportData` (defined here so Stage 4 reuses the file)
  - `getDashboardMetrics(): Promise<DashboardMetrics>`
  - Helpers `klDate(iso)`, `klToday()` are file-local to `dashboard.ts`; Stage 4 re-declares its own (kept simple — no shared util needed).

- [ ] **Step 1: Write the analytics types**

Create `lib/analytics/types.ts`:

```ts
export type DashboardMetrics = {
  today: { orders: number; revenue: number; inProgress: number };
  month: { orders: number; revenue: number; activeCustomers: number };
  topSellers: { name: string; quantity: number }[]; // this month, completed, top 5
  statusBreakdown: { status: string; count: number }[]; // current snapshot, all orders
};

export type ReportRange = "today" | "7d" | "30d" | "month";

export type ReportData = {
  range: ReportRange;
  totals: { orders: number; revenue: number; redemptionBeans: number; rewardLines: number };
  trend: { date: string; revenue: number; orders: number }[]; // per KL day, completed
  topItems: { name: string; quantity: number; revenue: number }[]; // top 10, completed
  paymentBreakdown: { method: string; orders: number; revenue: number }[]; // completed
};
```

- [ ] **Step 2: Write the dashboard reads**

Create `lib/analytics/dashboard.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { DashboardMetrics } from "@/lib/analytics/types";

// KL-day key (YYYY-MM-DD) for an ISO timestamp — matches the rewards engine TZ.
const KL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
function klDate(iso: string): string {
  return KL.format(new Date(iso));
}
function klToday(): string {
  return KL.format(new Date());
}

const IN_PROGRESS = new Set(["pending", "preparing", "ready"]);

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const db = await createClient();
  const { data: orders, error } = await db
    .from("orders")
    .select("id, status, total, created_at, user_id");
  if (error) throw new Error(`getDashboardMetrics failed: ${error.message}`);

  const today = klToday();
  const month = today.slice(0, 7); // YYYY-MM
  const cutoff30 = KL.format(new Date(Date.now() - 30 * 86_400_000));

  let todayOrders = 0, todayRevenue = 0, todayInProgress = 0;
  let monthOrders = 0, monthRevenue = 0;
  const activeUsers = new Set<string>();
  const statusCounts = new Map<string, number>();
  const monthCompletedIds: string[] = [];

  for (const o of orders ?? []) {
    const d = klDate(o.created_at);
    const m = d.slice(0, 7);
    statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1);

    if (d === today) {
      todayOrders++;
      if (o.status === "completed") todayRevenue += o.total;
      if (IN_PROGRESS.has(o.status)) todayInProgress++;
    }
    if (m === month) {
      monthOrders++;
      if (o.status === "completed") {
        monthRevenue += o.total;
        monthCompletedIds.push(o.id);
      }
    }
    if (d >= cutoff30 && o.user_id) activeUsers.add(o.user_id);
  }

  let topSellers: { name: string; quantity: number }[] = [];
  if (monthCompletedIds.length > 0) {
    const { data: items, error: itemsErr } = await db
      .from("order_items")
      .select("name, quantity, order_id")
      .in("order_id", monthCompletedIds);
    if (itemsErr) throw new Error(`getDashboardMetrics failed: ${itemsErr.message}`);
    const byName = new Map<string, number>();
    for (const it of items ?? []) {
      byName.set(it.name, (byName.get(it.name) ?? 0) + it.quantity);
    }
    topSellers = [...byName.entries()]
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }

  return {
    today: { orders: todayOrders, revenue: todayRevenue, inProgress: todayInProgress },
    month: { orders: monthOrders, revenue: monthRevenue, activeCustomers: activeUsers.size },
    topSellers,
    statusBreakdown: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
  };
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/analytics/types.ts lib/analytics/dashboard.ts
git commit -m "feat(cms): dashboard analytics reads"
```

---

## Task 12: Dashboard screen

**Files:**
- Modify: `app/(admin)/admin/page.tsx`

**Interfaces:**
- Consumes: `getDashboardMetrics` (Task 11); `formatPrice` from `lib/format`.

- [ ] **Step 1: Replace the page stub**

Overwrite `app/(admin)/admin/page.tsx`:

```tsx
import { getDashboardMetrics } from "@/lib/analytics/dashboard";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-2xl border border-border p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-bold tracking-tight">{value}</span>
    </div>
  );
}

export default async function AdminDashboardPage() {
  const m = await getDashboardMetrics();
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Dashboard</h1>

      <h2 className="text-sm font-semibold text-muted-foreground">Today</h2>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Orders" value={String(m.today.orders)} />
        <Metric label="Revenue" value={formatPrice(m.today.revenue)} />
        <Metric label="In progress" value={String(m.today.inProgress)} />
      </div>

      <h2 className="text-sm font-semibold text-muted-foreground">This month</h2>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Orders" value={String(m.month.orders)} />
        <Metric label="Revenue" value={formatPrice(m.month.revenue)} />
        <Metric label="Active" value={String(m.month.activeCustomers)} />
      </div>

      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h2 className="text-sm font-bold">Top sellers (this month)</h2>
        {m.topSellers.length === 0 && (
          <p className="text-sm text-muted-foreground">No completed orders yet.</p>
        )}
        {m.topSellers.map((s, i) => (
          <div key={s.name} className="flex items-center justify-between text-sm">
            <span className="truncate">{i + 1}. {s.name}</span>
            <span className="font-medium">{s.quantity}</span>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h2 className="text-sm font-bold">Orders by status</h2>
        {m.statusBreakdown.map((s) => (
          <div key={s.status} className="flex items-center justify-between text-sm">
            <span className="capitalize">{s.status}</span>
            <span className="font-medium">{s.count}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.
Run `npm run dev`, open `/admin` (Dashboard): metric cards, top sellers, and status breakdown render. Place/complete a test order and confirm revenue counts only the completed one.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/page.tsx"
git commit -m "feat(cms): dashboard screen (metric cards)"
```

---

## Task 13: Add recharts (new dependency)

**Files:**
- Modify: `package.json` (+ `package-lock.json`)

**Interfaces:**
- Produces: `recharts` available for import.

> **Approval gate:** AGENTS.md requires approval before adding a library. The user approved a charting library (recharts) during design. Confirm before running install.

- [ ] **Step 1: Install recharts**

Run: `npm install recharts`
Expected: `recharts` added to `dependencies`; `package-lock.json` updated.

- [ ] **Step 2: Verify the build still works**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(cms): add recharts for reports charts"
```

---

## Task 14: Reports reads layer

**Files:**
- Create: `lib/analytics/reports.ts`

**Interfaces:**
- Consumes: `createClient`; `ReportRange`, `ReportData` (Task 11); tables `orders`, `order_items`.
- Produces: `getReportData(range: ReportRange): Promise<ReportData>`.

- [ ] **Step 1: Write the reports reads**

Create `lib/analytics/reports.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { ReportData, ReportRange } from "@/lib/analytics/types";

const KL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
function klDate(iso: string): string {
  return KL.format(new Date(iso));
}
function klToday(): string {
  return KL.format(new Date());
}

// Inclusive start day (YYYY-MM-DD) for a range, in KL time.
function rangeStart(range: ReportRange, today: string): string {
  if (range === "today") return today;
  if (range === "month") return `${today.slice(0, 7)}-01`;
  const days = range === "7d" ? 6 : 29; // inclusive of today
  return KL.format(new Date(Date.now() - days * 86_400_000));
}

export async function getReportData(range: ReportRange): Promise<ReportData> {
  const db = await createClient();
  const start = rangeStart(range, klToday());

  const { data: orders, error } = await db
    .from("orders")
    .select("id, status, total, payment_method, created_at");
  if (error) throw new Error(`getReportData failed: ${error.message}`);

  const completed = (orders ?? []).filter(
    (o) => klDate(o.created_at) >= start && o.status === "completed",
  );

  const totalsRevenue = completed.reduce((s, o) => s + o.total, 0);

  const trendMap = new Map<string, { revenue: number; orders: number }>();
  const payMap = new Map<string, { orders: number; revenue: number }>();
  for (const o of completed) {
    const d = klDate(o.created_at);
    const t = trendMap.get(d) ?? { revenue: 0, orders: 0 };
    t.revenue += o.total; t.orders += 1;
    trendMap.set(d, t);

    const p = payMap.get(o.payment_method) ?? { orders: 0, revenue: 0 };
    p.orders += 1; p.revenue += o.total;
    payMap.set(o.payment_method, p);
  }

  const trend = [...trendMap.entries()]
    .map(([date, v]) => ({ date, revenue: v.revenue, orders: v.orders }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const paymentBreakdown = [...payMap.entries()]
    .map(([method, v]) => ({ method, orders: v.orders, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const ids = completed.map((o) => o.id);
  let topItems: { name: string; quantity: number; revenue: number }[] = [];
  let redemptionBeans = 0;
  let rewardLines = 0;
  if (ids.length > 0) {
    const { data: items, error: itemsErr } = await db
      .from("order_items")
      .select("name, quantity, line_total, is_reward, reward_cost, order_id")
      .in("order_id", ids);
    if (itemsErr) throw new Error(`getReportData failed: ${itemsErr.message}`);
    const map = new Map<string, { quantity: number; revenue: number }>();
    for (const it of items ?? []) {
      const cur = map.get(it.name) ?? { quantity: 0, revenue: 0 };
      cur.quantity += it.quantity; cur.revenue += it.line_total;
      map.set(it.name, cur);
      if (it.is_reward) { rewardLines += 1; redemptionBeans += it.reward_cost; }
    }
    topItems = [...map.entries()]
      .map(([name, v]) => ({ name, quantity: v.quantity, revenue: v.revenue }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
  }

  return {
    range,
    totals: { orders: completed.length, revenue: totalsRevenue, redemptionBeans, rewardLines },
    trend,
    topItems,
    paymentBreakdown,
  };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/analytics/reports.ts
git commit -m "feat(cms): reports analytics reads"
```

---

## Task 15: Reports screen (chart + tables + range tabs)

**Files:**
- Create: `components/admin/revenue-chart.tsx`
- Create: `components/admin/reports-view.tsx`
- Modify: `app/(admin)/admin/reports/page.tsx`

**Interfaces:**
- Consumes: `getReportData`, `ReportData`, `ReportRange` (Tasks 11/14); `recharts` (Task 13); `formatPrice`.
- Produces: a Server Action `loadReport(range: ReportRange): Promise<ReportData>` (defined in the page file) so range tabs re-fetch on the server.

- [ ] **Step 1: Write the chart component**

Create `components/admin/revenue-chart.tsx`:

```tsx
"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Revenue per day. `data` dates are YYYY-MM-DD; revenue is sen → shown as RM.
export function RevenueChart({ data }: { data: { date: string; revenue: number }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No completed sales in this range.</p>;
  }
  const chartData = data.map((d) => ({ date: d.date.slice(5), revenue: d.revenue / 100 }));
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} width={40} />
          <Tooltip
            formatter={(v: number) => [`RM ${v.toFixed(2)}`, "Revenue"]}
            labelStyle={{ fontSize: 12 }}
            contentStyle={{ fontSize: 12, borderRadius: 12 }}
          />
          <Bar dataKey="revenue" fill="#000000" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Write the reports view**

Create `components/admin/reports-view.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import type { ReportData, ReportRange } from "@/lib/analytics/types";
import { formatPrice } from "@/lib/format";
import { RevenueChart } from "@/components/admin/revenue-chart";

const RANGES: { value: ReportRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "month", label: "Month" },
];

export function ReportsView({
  initial,
  load,
}: {
  initial: ReportData;
  load: (range: ReportRange) => Promise<ReportData>;
}) {
  const [data, setData] = useState(initial);
  const [pending, startTransition] = useTransition();

  function pick(range: ReportRange) {
    if (range === data.range) return;
    startTransition(async () => setData(await load(range)));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => pick(r.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              data.range === r.value ? "bg-black text-white" : "border border-border"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className={pending ? "opacity-50 transition-opacity" : "transition-opacity"}>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-border p-4">
            <span className="text-xs text-muted-foreground">Revenue</span>
            <p className="text-xl font-bold">{formatPrice(data.totals.revenue)}</p>
          </div>
          <div className="rounded-2xl border border-border p-4">
            <span className="text-xs text-muted-foreground">Completed orders</span>
            <p className="text-xl font-bold">{data.totals.orders}</p>
          </div>
        </div>

        <section className="mt-4 rounded-2xl border border-border p-4">
          <h2 className="mb-2 text-sm font-bold">Revenue trend</h2>
          <RevenueChart data={data.trend} />
        </section>

        <section className="mt-4 rounded-2xl border border-border p-4">
          <h2 className="mb-2 text-sm font-bold">Top items</h2>
          {data.topItems.length === 0 && (
            <p className="text-sm text-muted-foreground">No sales in this range.</p>
          )}
          {data.topItems.map((it, i) => (
            <div key={it.name} className="flex items-center justify-between text-sm">
              <span className="truncate">{i + 1}. {it.name}</span>
              <span className="text-muted-foreground">{it.quantity} · {formatPrice(it.revenue)}</span>
            </div>
          ))}
        </section>

        <section className="mt-4 rounded-2xl border border-border p-4">
          <h2 className="mb-2 text-sm font-bold">Payment methods</h2>
          {data.paymentBreakdown.map((p) => (
            <div key={p.method} className="flex items-center justify-between text-sm">
              <span className="capitalize">{p.method}</span>
              <span className="text-muted-foreground">{p.orders} · {formatPrice(p.revenue)}</span>
            </div>
          ))}
        </section>

        <section className="mt-4 rounded-2xl border border-border p-4">
          <h2 className="text-sm font-bold">Reward redemptions</h2>
          <p className="text-sm text-muted-foreground">
            {data.totals.rewardLines} free drink{data.totals.rewardLines === 1 ? "" : "s"} ·{" "}
            {data.totals.redemptionBeans} Beans redeemed
          </p>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Replace the page stub (with the load Server Action)**

Overwrite `app/(admin)/admin/reports/page.tsx`:

```tsx
import { getReportData } from "@/lib/analytics/reports";
import type { ReportRange } from "@/lib/analytics/types";
import { ReportsView } from "@/components/admin/reports-view";
import { isAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Server Action used by the range tabs to re-fetch on the server. Re-checks
// admin since Server Actions are independently callable endpoints.
async function loadReport(range: ReportRange) {
  "use server";
  if (!(await isAdmin())) throw new Error("Not authorized.");
  return getReportData(range);
}

export default async function ReportsPage() {
  const initial = await getReportData("7d");
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Reports</h1>
      <ReportsView initial={initial} load={loadReport} />
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS. `npm run build` → succeeds (confirms recharts bundles in the client component cleanly).
Run `npm run dev`, open `/admin/reports`: the chart renders, range tabs (Today/7d/30d/Month) re-fetch and update totals/tables, and revenue matches completed orders only.

- [ ] **Step 5: Commit**

```bash
git add components/admin/revenue-chart.tsx components/admin/reports-view.tsx "app/(admin)/admin/reports/page.tsx"
git commit -m "feat(cms): reports screen (chart, range tabs, tables)"
```

---

## Task 16: Final verification (RLS advisors, build, parity)

**Files:** none (verification + empty marker commit).

- [ ] **Step 1: Security advisors**

Run the MCP `get_advisors` tool with `type: "security"`. Expected: no new "RLS disabled" or "function search_path mutable" findings for `store_settings`, `admin_set_role`, `admin_adjust_beans`. Address any that appear.

- [ ] **Step 2: Confirm write policies are admin-only**

Use the MCP `execute_sql` tool:

```sql
select tablename, polname, cmd, roles::text
from pg_policies where tablename = 'store_settings';
```

Expected: a read policy open to `anon`/`authenticated` and exactly one `ALL` admin-only write policy; no other write policy.

- [ ] **Step 3: Full build + lint + typecheck**

Run: `npx tsc --noEmit` → PASS. `npm run lint` → PASS. `npm run build` → succeeds.

- [ ] **Step 4: End-to-end manual parity (`npm run dev`)**

- Settings: close store → checkout blocked + banner; toggle each feature off → its surface hides and rewards routes redirect; toggle back on → restored.
- Customers: search; promote/demote a customer; self-role change blocked; last-admin demotion blocked; grant/deduct Beans with reason; overdraw blocked.
- Dashboard: metrics reflect seeded orders; revenue = completed only; KL "today/month".
- Reports: range tabs switch; trend chart + top items + payment breakdown + redemption summary reconcile with the dashboard.

- [ ] **Step 5: Commit**

```bash
git commit -m "test(cms): verify Phase 3 RLS, RPC guards, and storefront parity" --allow-empty
```

---

## Self-Review

**1. Spec coverage**
- Section A (DB & RLS): `store_settings` (Task 1); `admin_set_role` + `admin_adjust_beans` with all guard codes (Task 6). ✓
- Section B (Settings + storefront wiring): reads (Task 2), CMS form/action (Task 3), closed block + banner (Task 4), feature gates incl. streak/referral subsections (Task 5). ✓
- Section C (Customers): reads list+detail (Task 7), actions (Task 8), list screen (Task 9), detail screen with role + Beans + history + ledger (Task 10). ✓
- Section D (Dashboard): reads (Task 11), cards/top sellers/status (Task 12). ✓
- Section E (Reports): recharts (Task 13), reads (Task 14), chart + range tabs + top items + payment + redemption (Task 15). ✓
- Section F (data layer / errors / testing): SECURITY DEFINER + admin guards, `ActionResult`, friendly error mapping, two-step confirm, advisors + parity (Tasks 6, 8, 10, 16). ✓
- Global Constraints (sen, KL time, completed-only revenue, regenerate types, no test runner): encoded in constraints + each task. ✓

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" — every code step shows complete code; the only "read the file" notes (cart/checkout banner placement, `AdminBackLink` props) point at exact, named insertions with the code to insert. ✓

**3. Type consistency:** `StoreSettings` (Task 2) consumed identically in Tasks 3/4/5. `ActionResult` matches the promotions shape across Tasks 3/8. `DashboardMetrics`/`ReportData`/`ReportRange` defined once in `lib/analytics/types.ts` (Task 11) and consumed in Tasks 12/14/15. RPC arg names (`p_user`, `p_role`, `p_amount`, `p_reason`) match between the SQL (Task 6) and the `.rpc()` calls (Task 8). `CustomerSummary`/`CustomerDetail` defined in Task 7, consumed in Tasks 9/10. ✓

**Deviations from spec wording** (documented under "Plan-level decisions"): analytics in JS not SQL; native `<select>` + two-step confirm instead of `Select`/`AlertDialog`; recharts direct instead of shadcn chart; customizer redeem manual-URL edge case out of scope.
