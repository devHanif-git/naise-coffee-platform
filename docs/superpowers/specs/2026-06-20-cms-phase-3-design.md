# NAISE COFFEE — Admin CMS Phase 3 Design

**Date:** 2026-06-20
**Status:** Approved (design); ready for implementation planning
**Predecessors:** `2026-06-19-cms-design.md` (master), Phase 1 (Foundation + Menu),
Phase 2A (Rewards), Phase 2B (Promotions) — all shipped.

---

## Context

Phase 3 is the **final CMS phase**. It fills the four remaining "Coming soon"
stub modules in the admin shell: **Settings, Customers, Dashboard, Reports**. The
nav slots already exist in `components/admin/admin-shell.tsx`; the pages
(`app/(admin)/admin/{settings,customers,page,reports}.tsx`) currently render
`<ComingSoon />`.

### What already exists and is reused

- **Admin gating:** `app/(admin)/admin/layout.tsx` redirects non-admins via
  `isAdmin()` (`lib/auth/session.ts`). Every Phase 3 page inherits this; actions
  re-check server-side.
- **Data sources (all RLS-backed, money in integer sen):**
  - `orders` — `status` (`pending|preparing|ready|completed|cancelled`),
    `subtotal`, `total`, `payment_method`, `user_id`, `owner_id`, `created_at`,
    `completed_at`.
  - `order_items` — snapshot `name`, `quantity`, `line_total`, `is_reward`,
    `reward_cost`, `status`.
  - `profiles` — `role` (`admin|manager|staff|customer`), `display_name`,
    `phone`, `avatar_url`, `created_at`.
  - `reward_accounts` — cached `balance`, `lifetime_earned`, `current_streak`,
    `longest_streak`.
  - `bean_transactions` — append-only Beans ledger; categories
    `earn|redeem|streak_bonus|referral|adjustment`. A trigger
    (`apply_bean_transaction`) maintains the cached balance on every insert.
- **Conventions (followed exactly):** `lib/<module>/admin.ts` (or
  `store.ts`/`dashboard.ts`/`reports.ts`) for typed reads returning camelCase
  view types; `app/(admin)/admin/<module>/actions.ts` server actions returning
  `{ ok: true } | { ok: false; error: string }`; `components/admin/<x>.tsx`
  client components; mobile-first `max-w-md` shell; admin writes gated by
  `current_user_role() = 'admin'`; privileged DB mutations via SECURITY DEFINER
  functions with pinned `search_path`.

### What is genuinely new in Phase 3

1. **`store_settings`** — there is no settings table yet.
2. **Privileged writes to other users' data** — assigning roles and adjusting
   Beans. `auth_profiles.sql` deliberately ships **no client-facing role-update
   policy** ("app code never writes role… intentionally no client-facing
   role-update policy"). Phase 3 adds two SECURITY DEFINER RPCs instead of
   weakening that.

---

## Decisions

1. **Packaging:** One spec (this doc), one staged plan. Four self-contained,
   independently testable/committable stages in order: **Settings → Customers →
   Dashboard → Reports**. Settings is first (introduces `store_settings` +
   storefront wiring that nothing else depends on); Customers second (adds the
   privileged RPCs); Dashboard and Reports share a `lib/analytics/` reads layer.
2. **Revenue basis:** Revenue = sum of `orders.total` for `status = 'completed'`
   only. Pending/preparing/ready are surfaced as a separate "in progress" count;
   cancelled is excluded. Reward (free) lines already contribute 0.
3. **Time bucketing:** All date ranges and "today/this month" windows are
   computed in **Asia/Kuala_Lumpur**, matching the rewards engine
   (`apply_order_rewards`). Bucket on `created_at` for order counts/revenue.
4. **Dashboard/Reports are static server reads** (recomputed on navigation). No
   realtime — correct for a single small shop; avoids subscription overhead.
5. **Settings toggles wire into the storefront.** Store open/closed is a **hard,
   server-enforced** block on checkout. The three feature toggles
   (rewards/referral/streak) are **presentation gates** — they hide storefront
   entry points but the server-side rewards ledger keeps running, so balances
   never go inconsistent and flipping a toggle back on is seamless.
6. **Role + Beans writes go through SECURITY DEFINER RPCs**, not the service-role
   client. Co-locates the admin check and invariants (last-admin / negative
   balance) in SQL, consistent with `apply_order_rewards`/`reverse_order_rewards`.
7. **Charts:** Reports uses shadcn's `chart` component (wraps **recharts**) for a
   lightweight bar/line revenue trend. recharts is the **one new dependency**;
   added with explicit approval at plan time per AGENTS.md.
8. **No hard deletes, no role escalation loopholes.** Customers module never
   deletes a profile. `admin_set_role` refuses to demote the caller or remove the
   last admin.

---

## Global Constraints

- Money is integer **sen** (1 MYR = 100 sen) everywhere; never floats.
- All time windows computed in **Asia/Kuala_Lumpur**.
- Revenue/Reports totals count **`status = 'completed'` orders only** (Decision 2).
- Every admin page is server-rendered and inherits `isAdmin()` gating from
  `app/(admin)/admin/layout.tsx`; every action re-checks `role === 'admin'`
  server-side.
- Every server action returns `{ ok: true; … } | { ok: false; error: string }`.
- Admin writes enforced in RLS via `current_user_role() = 'admin'`; privileged
  cross-user writes via SECURITY DEFINER functions with `set search_path = ''`.
- `npm run lint` and `tsc` must be clean before any task is considered done.
- TypeScript strict; no `any`. Regenerate `types/database.ts` after the migration.

---

## Section A — Database schema, RPCs & RLS

One new table and two new SECURITY DEFINER functions. All reuse
`public.set_updated_at()` and `public.current_user_role()`.

### A1. `store_settings` (singleton)

Mirrors `loyalty_settings`: a fixed-boolean primary key enforces exactly one row.

| column | type | notes |
|---|---|---|
| `id` | boolean primary key default true check (id) | single-row guard |
| `is_open` | boolean not null default true | store open/closed |
| `closed_message` | text not null default 'We''re currently closed. Please check back soon.' | shown on storefront + returned by `placeOrder` when closed |
| `rewards_enabled` | boolean not null default true | gates Beans/redeem storefront surfaces |
| `referral_enabled` | boolean not null default true | gates referral card/modal |
| `streak_enabled` | boolean not null default true | gates streak widget |
| `created_at` | timestamptz not null default now() | |
| `updated_at` | timestamptz not null default now() | |

- `updated_at` trigger via `public.set_updated_at()`.
- **RLS:** `select` to `anon, authenticated` `using (true)`; `all` to
  `authenticated` `using (current_user_role() = 'admin') with check
  (current_user_role() = 'admin')`.
- **Seed:** one row with all defaults (`insert … on conflict (id) do nothing`).

### A2. `admin_set_role(p_user uuid, p_role public.user_role)` → `void`

SECURITY DEFINER, `set search_path = ''`. Logic:

1. If `current_user_role() <> 'admin'` → `raise exception 'NOT_ADMIN'`.
2. If `p_user = auth.uid()` → `raise exception 'CANNOT_CHANGE_OWN_ROLE'` (an
   admin cannot demote themselves; prevents accidental lockout).
3. If the target is currently `admin` and `p_role <> 'admin'` and the count of
   admins `= 1` → `raise exception 'LAST_ADMIN'` (never remove the last admin).
4. `update public.profiles set role = p_role, updated_at = now() where id =
   p_user`. If no row updated → `raise exception 'NO_SUCH_USER'`.

Grants: `revoke execute … from public; grant execute … to authenticated`.

### A3. `admin_adjust_beans(p_user uuid, p_amount integer, p_reason text)` → `integer`

SECURITY DEFINER, `set search_path = ''`. Returns the **new balance**. Logic:

1. If `current_user_role() <> 'admin'` → `raise exception 'NOT_ADMIN'`.
2. If `p_amount = 0` → `raise exception 'ZERO_AMOUNT'`.
3. If `trim(p_reason) = ''` → `raise exception 'REASON_REQUIRED'`.
4. Ensure a `reward_accounts` row exists for `p_user`
   (`insert … on conflict do nothing`).
5. Read current `balance`; if `balance + p_amount < 0` → `raise exception
   'NEGATIVE_BALANCE'` (an adjustment can never overdraw).
6. `insert into public.bean_transactions (user_id, category, amount, label)
   values (p_user, 'adjustment', p_amount, 'Admin adjustment: ' || p_reason)`.
   The existing `bean_transactions_apply` trigger updates the cached balance.
7. Return the updated `balance`.

Grants: `revoke execute … from public; grant execute … to authenticated`.

> Both RPCs gate internally on the caller's role, so the `authenticated` grant is
> safe — a non-admin caller always hits the `NOT_ADMIN` exception. Actions map
> these exception codes to friendly inline errors (Section F).

---

## Section B — Settings module + storefront wiring

### B1. Reads layer — `lib/settings/store.ts`, `lib/settings/types.ts`

```ts
// lib/settings/types.ts
export type StoreSettings = {
  isOpen: boolean;
  closedMessage: string;
  rewardsEnabled: boolean;
  referralEnabled: boolean;
  streakEnabled: boolean;
};
```

`lib/settings/store.ts` exposes `getStoreSettings(): Promise<StoreSettings>`,
reading the singleton with the server client and falling back to safe defaults
(`isOpen: true`, all features enabled) if the row is missing. Used by both the
CMS and the storefront.

### B2. CMS screen — `components/admin/settings-form.tsx`

A single form (shadcn `Switch` + `Input`/`Textarea`):
- Store **Open / Closed** switch.
- **Closed message** textarea (shown when closed; editable always).
- **Rewards**, **Referral**, **Streak** feature switches.
- One **Save** button → `updateStoreSettings` action; inline success/error.

`app/(admin)/admin/settings/page.tsx` becomes a server component: reads current
settings, renders the form. `app/(admin)/admin/settings/actions.ts` exposes
`updateStoreSettings(input: StoreSettings)` — re-checks admin, updates the
singleton, `revalidatePath('/admin/settings')` plus storefront paths
(`/home`, `/menu`, `/cart`, `/checkout`, `/rewards`).

### B3. Storefront wiring

- **Store closed (hard block):** in `app/(customer)/checkout/actions.ts`
  `placeOrder`, after the empty-cart/owner checks, call `getStoreSettings()`; if
  `!isOpen` return `{ ok: false, error: closedMessage }`. Additionally render a
  closed banner on `/home` and `/cart`/`/checkout` and disable the checkout CTA
  when closed (read in the server components).
- **Feature gates (presentation only):**
  - `rewards_enabled = false` → hide the Rewards entry in `components/tab-bar.tsx`,
    hide `components/rewards-banner.tsx`, hide redeem affordances in
    `components/product-customizer.tsx` and the checkout redeem path, and
    redirect `/rewards`, `/rewards/catalog`, `/rewards/activity` to `/home`.
  - `referral_enabled = false` → hide the referral entry point
    (`components/rewards-referral-modal.tsx` trigger).
  - `streak_enabled = false` → hide the streak widget on home/rewards.
- **Server-side rewards engine is untouched:** `apply_order_rewards` keeps
  running regardless of toggles. This is the accepted tradeoff (Decision 5):
  toggles are visibility gates, not engine kill-switches, so the ledger stays
  consistent.

---

## Section C — Customers module

### C1. Reads — `lib/customers/admin.ts`, `lib/customers/types.ts`

```ts
// lib/customers/types.ts
export type CustomerRole = 'admin' | 'manager' | 'staff' | 'customer';

export type CustomerSummary = {
  id: string;
  displayName: string | null;
  phone: string | null;
  role: CustomerRole;
  beansBalance: number;
  ordersCount: number;
  joinedAt: string; // ISO
};

export type CustomerLedgerEntry = {
  id: string;
  category: 'earn' | 'redeem' | 'streak_bonus' | 'referral' | 'adjustment';
  amount: number;
  label: string;
  isReversal: boolean;
  createdAt: string;
};

export type CustomerOrderSummary = {
  id: string;
  orderNumber: string;
  status: 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';
  total: number;
  createdAt: string;
};

export type CustomerDetail = {
  summary: CustomerSummary;
  orders: CustomerOrderSummary[];
  ledger: CustomerLedgerEntry[];
};
```

- `listCustomers(search?: string): Promise<CustomerSummary[]>` — joins
  `profiles` + `reward_accounts` + a per-user orders count; optional
  case-insensitive filter on `display_name`/`phone`; ordered by `created_at`
  desc. Orders count via a grouped query keyed by `user_id` (not N+1).
- `getCustomerDetail(userId: string): Promise<CustomerDetail | null>` — the
  profile summary plus that user's orders (newest first) and Beans ledger.

### C2. Screens

- `app/(admin)/admin/customers/page.tsx` (server) → `listCustomers` →
  `components/admin/customers-list.tsx` (client): search box, rows showing
  display name, role badge, Beans balance, orders count, join date. Each row
  links to detail.
- `app/(admin)/admin/customers/[id]/page.tsx` (server) → `getCustomerDetail` →
  `components/admin/customer-detail.tsx` (client): read-only order history + Beans
  ledger, plus two admin actions:
  - **Assign role:** `Select` of the four roles → `setCustomerRole` action.
  - **Adjust Beans:** amount (signed) + required reason → `adjustCustomerBeans`
    action, behind an `AlertDialog` confirm.

### C3. Actions — `app/(admin)/admin/customers/actions.ts`

- `setCustomerRole(userId: string, role: CustomerRole)` → calls `admin_set_role`
  RPC; maps exceptions to inline errors:
  `CANNOT_CHANGE_OWN_ROLE` → "You can't change your own role.";
  `LAST_ADMIN` → "There must be at least one admin.";
  `NO_SUCH_USER` → "Customer not found."; default → generic.
  `revalidatePath('/admin/customers')` and the detail path.
- `adjustCustomerBeans(userId: string, amount: number, reason: string)` → calls
  `admin_adjust_beans`; maps `NEGATIVE_BALANCE` → "Adjustment would make the
  balance negative.", `REASON_REQUIRED`/`ZERO_AMOUNT` → field errors. Revalidate
  the detail path on success.

---

## Section D — Dashboard

### D1. Reads — `lib/analytics/dashboard.ts`, `lib/analytics/types.ts`

```ts
// lib/analytics/types.ts
export type DashboardMetrics = {
  today: { orders: number; revenue: number; inProgress: number };
  month: { orders: number; revenue: number; activeCustomers: number };
  topSellers: { name: string; quantity: number }[]; // this month, top 5
  statusBreakdown: { status: string; count: number }[]; // all-time open snapshot
};

export function getDashboardMetrics(): Promise<DashboardMetrics>;
```

Definitions (Asia/Kuala_Lumpur; revenue = completed only):
- `today.orders` / `today.revenue` — orders created today / their completed total.
- `today.inProgress` — orders with status in `(pending, preparing, ready)`
  created today.
- `month.orders` / `month.revenue` — current calendar month.
- `month.activeCustomers` — distinct `user_id` (non-null) with an order in the
  last 30 days.
- `topSellers` — `order_items` joined to this month's **completed** orders
  (consistent with the revenue basis), grouped by `name`, summed `quantity`,
  top 5.
- `statusBreakdown` — count of orders per `status` (current snapshot).

Aggregations run as grouped SQL queries (or a single `get_dashboard_metrics`
SQL helper) — never by pulling rows into JS.

### D2. Screen

`app/(admin)/admin/page.tsx` becomes a server component rendering metric cards
(Today row, This-month row), a Top Sellers list, and a compact status breakdown.
Cards are plain Tailwind/shadcn — no chart here.

---

## Section E — Reports

### E1. Reads — `lib/analytics/reports.ts`

```ts
export type ReportRange = 'today' | '7d' | '30d' | 'month';

export type ReportData = {
  range: ReportRange;
  totals: { orders: number; revenue: number; redemptionBeans: number; rewardLines: number };
  trend: { date: string; revenue: number; orders: number }[]; // per-day buckets in range
  topItems: { name: string; quantity: number; revenue: number }[]; // top 10
  paymentBreakdown: { method: string; orders: number; revenue: number }[];
};

export function getReportData(range: ReportRange): Promise<ReportData>;
```

- `totals.revenue`/`totals.orders` — completed orders in range.
- `totals.redemptionBeans` — sum of redeemed Beans in range (from
  `bean_transactions` category `'redeem'`, absolute value); `rewardLines` —
  count of `order_items` with `is_reward = true` on in-range orders.
- `trend` — per-day buckets (KL date) across the range: revenue + order count.
- `topItems` — `order_items` on in-range completed orders grouped by `name`,
  summed quantity and `line_total`, top 10.
- `paymentBreakdown` — completed orders grouped by `payment_method`.

### E2. Screen + chart

- Add shadcn `chart` (`npx shadcn@latest add chart`) → `components/ui/chart.tsx`,
  pulling in **recharts** (the one new dependency — confirm before adding).
- `app/(admin)/admin/reports/page.tsx` (server) reads a default range;
  `components/admin/reports-view.tsx` (client) renders range-preset tabs (Today /
  7d / 30d / Month), the revenue/orders trend as a small bar or line chart, and
  three tables: top items, payment breakdown, and a redemption-cost summary card.
  Range changes re-fetch via the server action / route segment.

---

## Section F — Data layer, error handling, testing

### Data layer

- All Phase 3 reads run under the caller's admin RLS; pages render only behind the
  layout's `isAdmin()` gate.
- Analytics aggregations are SQL-side grouped queries (or thin SQL helpers), not
  JS-side reductions over full tables.
- `store_settings` reads are shared by CMS and storefront via
  `lib/settings/store.ts`.

### Error handling

- Actions return `{ ok: false; error }`; the RPC exception codes (Section A) map
  to friendly, specific messages (Section C3). No silent failures.
- Destructive/privileged actions (role change, Beans adjustment) confirm via
  shadcn `AlertDialog` and preserve form state on error.
- `getStoreSettings()` degrades to safe defaults if the row is unreadable, so the
  storefront never hard-fails on a settings read.

### Testing & verification

- **DB/RLS:** apply migration to a branch/local. Confirm: anon can `select`
  `store_settings`; a `customer` cannot write it; an `admin` can. `admin_set_role`
  rejects a non-admin caller, rejects self-demotion, rejects removing the last
  admin, and succeeds for a valid promotion. `admin_adjust_beans` rejects
  non-admin, zero amount, empty reason, and an overdraw; a valid grant updates the
  cached balance and writes one `adjustment` ledger row.
- **Settings parity:** with the store closed, `placeOrder` returns the closed
  message and the storefront shows the closed banner + disabled CTA; with each
  feature toggle off, its storefront surface is hidden and the routes redirect as
  specified; turning a toggle back on restores the surface with balances intact.
- **Customers round-trip:** promote a customer to staff and back; grant and deduct
  Beans with reasons; confirm ledger + balance + the customer's storefront view
  reflect each change.
- **Dashboard/Reports correctness:** seed a few orders across statuses/days;
  confirm revenue counts only completed, "today/this month" honor KL time, top
  items rank correctly, and the trend buckets sum to the range total.
- `npm run lint` + `tsc` clean before finishing (AGENTS.md rule).

---

## Out of scope (YAGNI)

Manager role activation; realtime dashboards; CSV/PDF export; per-customer notes;
cohort/retention analytics; push notifications; turning a feature toggle into an
earning kill-switch (toggles are presentation gates only — Decision 5).

---

## Plan staging (for the implementation plan)

1. **Stage 1 — Settings:** `store_settings` migration + seed + RLS; reads layer;
   CMS form + action; storefront wiring (closed block + feature gates). Testable:
   close store blocks checkout; toggles hide surfaces.
2. **Stage 2 — Customers:** `admin_set_role` + `admin_adjust_beans` RPCs; reads
   layer; list + detail screens; role + Beans actions. Testable: round-trip role
   and Beans changes with guards enforced.
3. **Stage 3 — Dashboard:** analytics reads + metric cards on `/admin`. Testable:
   metrics match seeded data under KL time / completed-only revenue.
4. **Stage 4 — Reports:** add shadcn chart (recharts), reports reads, range tabs,
   trend chart + tables. Testable: range totals and trend buckets reconcile.
