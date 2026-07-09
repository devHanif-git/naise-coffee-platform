# Loyalty Stamp Card Implementation Plan (Plan 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app stamp card that grants one stamp per completed order (member-attached), issues milestone vouchers at 4 and 8, resets at 8, all CMS-controlled.

**Architecture:** Mirrors the existing rewards system — cached aggregate (`stamp_cards`) + append-only ledger (`stamp_transactions`) + singleton config (`stamp_settings`), all written only by SECURITY DEFINER RPCs. A stamp is granted by `grant_order_stamp(token)` at order completion; `reverse_order_stamp(token)` claws back on cancel. Staff attach a member to in-store orders via `attach_order_member`. Voucher *rows* are created here; *redeeming* them at checkout is Plan 2.

**Tech Stack:** Next.js 16 (App Router) server actions, Supabase Postgres + RLS + SECURITY DEFINER plpgsql, TypeScript strict, Tailwind + shadcn/ui, `qrcode` (member QR) + `@zxing/browser` (staff scanner).

## Global Constraints

- Money is stored as integer **sen**; never floats.
- All new tables get RLS: read own rows or `current_user_role() in ('admin','manager','staff')`; **no client writes** — all writes via SECURITY DEFINER RPCs (`language plpgsql`, `set search_path = ''`, revoked from `public`/`anon`, granted to `authenticated`).
- Schema changes ship as migrations in `supabase/migrations/` named `YYYYMMDDHHMMSS_*.sql`. Apply via Supabase MCP `apply_migration`.
- Timezone for "today"/dates is `Asia/Kuala_Lumpur` (match existing rewards RPCs).
- TypeScript strict, no `any`. Regenerate `types/database.ts` after schema changes via the Supabase MCP `generate_typescript_types` tool and paste the result over the file.
- No JS test framework is installed. Verify each task with: `npm run lint`, `npm run build`, and SQL assertions run through the Supabase MCP `execute_sql` tool. Commit after each task.
- Do NOT overload the existing percent-off `promotions` table. Stamp/voucher config lives in `stamp_settings`.
- Reuse `public.set_updated_at()` and `public.current_user_role()` — both already exist.

## File Structure

- `supabase/migrations/*_stamp_schema.sql` — tables, enums, indexes, RLS, cache trigger.
- `supabase/migrations/*_stamp_functions.sql` — `grant_order_stamp`, `reverse_order_stamp`, `attach_order_member`.
- `types/reward.ts` (modify) — add stamp/voucher TS types.
- `lib/stamps/store.ts` (create) — server wrappers: `grantOrderStamp`, `reverseOrderStamp`, `getStampCard`.
- `lib/stamps/config-store.ts` (create) — cached `getStampSettings`.
- `lib/stamps/member.ts` (create) — `attachOrderMember` wrapper.
- `app/(admin)/manage/actions.ts` (modify) — call grant on complete, reverse on cancel, add attach action.
- `app/(admin)/admin/promotions/*` (modify) — stamp settings panel + save action.
- `components/stamps/stamp-card.tsx` (create) — customer 8-slot card + animation.
- `components/stamps/member-qr.tsx` (create) — customer member QR.
- `components/stamps/attach-member.tsx` (create) — staff scan/keyed-in attach UI on `/manage`.
- `app/(customer)/rewards/page.tsx` (modify) — render the stamp card + member QR (gated by `is_enabled`).
- `app/globals.css` (modify) — stamp-press keyframes.

---

### Task 1: Stamp schema (tables, enums, RLS, cache trigger)

**Files:**
- Create migration: `supabase/migrations/20260708120000_stamp_schema.sql`

**Interfaces:**
- Consumes: existing `public.set_updated_at()`, `public.current_user_role()`, `public.orders`, `auth.users`.
- Produces: tables `stamp_cards`, `stamp_transactions`, `vouchers`, `stamp_settings`; enums `voucher_type` (`rm_off`,`free_drink`), `voucher_status` (`active`,`redeemed`,`expired`); trigger fn `apply_stamp_transaction()`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- Loyalty stamp card + voucher tables. Server-authoritative: clients SELECT only
-- (own rows or staff); all writes go through SECURITY DEFINER functions (see the
-- stamp_functions migration). Money is integer sen. Mirrors the rewards schema.

create type public.voucher_type as enum ('rm_off', 'free_drink');
create type public.voucher_status as enum ('active', 'redeemed', 'expired');

-- Singleton config (one row, fixed boolean PK — same trick as loyalty_settings).
create table public.stamp_settings (
  id                   boolean primary key default true check (id),
  is_enabled           boolean not null default true,
  card_size            integer not null default 8   check (card_size between 2 and 20),
  milestone_small      integer not null default 4   check (milestone_small >= 1),
  rm_off_amount        integer not null default 500 check (rm_off_amount >= 0),
  rm_off_min_spend     integer not null default 1100 check (rm_off_min_spend >= 0),
  free_drink_max_value integer not null default 1200 check (free_drink_max_value >= 0),
  voucher_expiry_days  integer not null default 30  check (voucher_expiry_days >= 1),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
insert into public.stamp_settings (id) values (true);

-- Cached per-member state. Source of truth is stamp_transactions; recomputable.
create table public.stamp_cards (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  current_count integer not null default 0,
  cycle         integer not null default 0,
  total_stamps  integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Append-only ledger. One stamp per order (per receipt); +1 earn, -1 reversal.
create table public.stamp_transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  order_id    uuid not null references public.orders (id),
  amount      integer not null,
  is_reversal boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index stamp_transactions_order_once
  on public.stamp_transactions (order_id) where is_reversal = false;
create index stamp_transactions_user_created_idx
  on public.stamp_transactions (user_id, created_at desc);

-- Vouchers issued at milestones. Amount/min_spend snapshot at issue time.
create table public.vouchers (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  type                 public.voucher_type not null,
  status               public.voucher_status not null default 'active',
  discount_amount      integer not null default 0,
  min_spend            integer not null default 0,
  free_drink_max_value integer not null default 0,
  expires_at           timestamptz not null,
  source_order_id      uuid references public.orders (id),
  redeemed_order_id    uuid references public.orders (id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index vouchers_user_status_idx on public.vouchers (user_id, status);
create index vouchers_source_order_idx on public.vouchers (source_order_id);

-- updated_at triggers (reuse existing fn).
create trigger stamp_settings_set_updated_at before update on public.stamp_settings
  for each row execute function public.set_updated_at();
create trigger stamp_cards_set_updated_at before update on public.stamp_cards
  for each row execute function public.set_updated_at();
create trigger vouchers_set_updated_at before update on public.vouchers
  for each row execute function public.set_updated_at();

-- Maintain the cached card on every ledger insert.
create or replace function public.apply_stamp_transaction()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.stamp_cards (user_id, current_count, total_stamps)
  values (new.user_id, new.amount, greatest(new.amount, 0))
  on conflict (user_id) do update set
    current_count = public.stamp_cards.current_count + new.amount,
    total_stamps  = public.stamp_cards.total_stamps + greatest(new.amount, 0),
    updated_at    = now();
  return new;
end;
$$;
create trigger stamp_transactions_apply
  after insert on public.stamp_transactions
  for each row execute function public.apply_stamp_transaction();
revoke execute on function public.apply_stamp_transaction() from anon, authenticated, public;
```

- [ ] **Step 2: Append RLS to the same migration file**

```sql
alter table public.stamp_settings enable row level security;
alter table public.stamp_cards enable row level security;
alter table public.stamp_transactions enable row level security;
alter table public.vouchers enable row level security;

-- stamp_settings: world-readable single row; admin writes.
create policy "stamp_settings_read_all" on public.stamp_settings for select
  to anon, authenticated using (true);
create policy "stamp_settings_write_admin" on public.stamp_settings for all to authenticated
  using (public.current_user_role() = 'admin') with check (public.current_user_role() = 'admin');

-- stamp_cards / stamp_transactions / vouchers: read own or staff; no client writes.
create policy "stamp_cards_select_own_or_staff" on public.stamp_cards for select to authenticated
  using ((select auth.uid()) = user_id or public.current_user_role() in ('admin','manager','staff'));
create policy "stamp_transactions_select_own_or_staff" on public.stamp_transactions for select to authenticated
  using ((select auth.uid()) = user_id or public.current_user_role() in ('admin','manager','staff'));
create policy "vouchers_select_own_or_staff" on public.vouchers for select to authenticated
  using ((select auth.uid()) = user_id or public.current_user_role() in ('admin','manager','staff'));

-- Realtime: live stamp card on the member's own row.
alter publication supabase_realtime add table public.stamp_cards;
alter table public.stamp_cards replica identity full;
```

- [ ] **Step 3: Apply the migration**

Use the Supabase MCP `apply_migration` tool with name `stamp_schema` and the full SQL from Steps 1–2.
Expected: success, no error.

- [ ] **Step 4: Verify tables and the seeded settings row**

Run via Supabase MCP `execute_sql`:
```sql
select is_enabled, card_size, milestone_small, rm_off_min_spend from public.stamp_settings;
```
Expected: one row — `is_enabled=true, card_size=8, milestone_small=4, rm_off_min_spend=1100`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260708120000_stamp_schema.sql
git commit -m "feat(stamps): stamp card + voucher schema, RLS, cache trigger"
```

---

### Task 2: Stamp RPCs (grant, reverse)

**Files:**
- Create migration: `supabase/migrations/20260708121000_stamp_functions.sql`

**Interfaces:**
- Consumes: `public.orders` (columns `id, token, user_id, total, status`), `public.order_items` (columns `is_reward, voided_at, line_total`), `stamp_settings`, `stamp_transactions`, `stamp_cards`, `vouchers`.
- Produces: `grant_order_stamp(p_token uuid) returns jsonb`, `reverse_order_stamp(p_token uuid) returns void`. Grant returns `{stamped, count, cycle, vouchers_issued:[{type}]}` or null.

- [ ] **Step 1: Write `grant_order_stamp` in the migration**

```sql
-- Stamp mutations: the ONLY way stamps/vouchers change. SECURITY DEFINER, granted
-- to authenticated. Idempotent per order via the unique index. Mirrors
-- apply_order_rewards. A "paid line" is is_reward=false AND voided_at IS NULL AND
-- line_total > 0 — a fully-free order (only a redeemed drink) earns no stamp.

create or replace function public.grant_order_stamp(p_token uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order   public.orders%rowtype;
  v_cfg     public.stamp_settings%rowtype;
  v_count   integer;
  v_cycle   integer;
  v_issued  jsonb := '[]'::jsonb;
begin
  select * into v_cfg from public.stamp_settings where id = true;
  if not found or not v_cfg.is_enabled then return null; end if;

  select * into v_order from public.orders where token = p_token;
  if not found or v_order.user_id is null then return null; end if;

  -- Idempotency: bail if this order already earned a (non-reversal) stamp.
  if exists (
    select 1 from public.stamp_transactions
    where order_id = v_order.id and is_reversal = false
  ) then return null; end if;

  -- Qualifying check: at least one paid, non-voided, non-reward line.
  if not exists (
    select 1 from public.order_items oi
    where oi.order_id = v_order.id
      and oi.is_reward = false
      and oi.voided_at is null
      and oi.line_total > 0
  ) then return null; end if;

  -- Ensure a card row exists, then insert the +1 (trigger updates the cache).
  insert into public.stamp_cards (user_id) values (v_order.user_id)
    on conflict (user_id) do nothing;
  insert into public.stamp_transactions (user_id, order_id, amount)
    values (v_order.user_id, v_order.id, 1);

  select current_count, cycle into v_count, v_cycle
    from public.stamp_cards where user_id = v_order.user_id;

  -- Milestone: small reward at milestone_small.
  if v_count = v_cfg.milestone_small then
    insert into public.vouchers (user_id, type, discount_amount, min_spend, expires_at, source_order_id)
    values (v_order.user_id, 'rm_off', v_cfg.rm_off_amount, v_cfg.rm_off_min_spend,
            now() + make_interval(days => v_cfg.voucher_expiry_days), v_order.id);
    v_issued := v_issued || jsonb_build_object('type', 'rm_off');
  end if;

  -- Milestone: full card at card_size -> free drink, then reset + bump cycle.
  if v_count >= v_cfg.card_size then
    insert into public.vouchers (user_id, type, free_drink_max_value, expires_at, source_order_id)
    values (v_order.user_id, 'free_drink', v_cfg.free_drink_max_value,
            now() + make_interval(days => v_cfg.voucher_expiry_days), v_order.id);
    v_issued := v_issued || jsonb_build_object('type', 'free_drink');
    update public.stamp_cards
      set current_count = 0, cycle = cycle + 1, updated_at = now()
      where user_id = v_order.user_id;
    v_count := 0; v_cycle := v_cycle + 1;
  end if;

  return jsonb_build_object('stamped', true, 'count', v_count, 'cycle', v_cycle, 'vouchers_issued', v_issued);
end;
$$;
```

- [ ] **Step 2: Write `reverse_order_stamp` in the same migration**

```sql
-- Reverse a cancelled order's stamp: offsetting -1 row, recompute the cache from
-- the ledger (handles reset boundaries), and expire any still-active voucher this
-- order issued. A redeemed voucher is left intact (can't claw back a used one).
create or replace function public.reverse_order_stamp(p_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_cfg   public.stamp_settings%rowtype;
  v_net   integer;
begin
  select * into v_order from public.orders where token = p_token;
  if not found or v_order.user_id is null then return; end if;

  -- Nothing to reverse, or already reversed.
  if not exists (select 1 from public.stamp_transactions
                 where order_id = v_order.id and is_reversal = false) then return; end if;
  if exists (select 1 from public.stamp_transactions
             where order_id = v_order.id and is_reversal = true) then return; end if;

  insert into public.stamp_transactions (user_id, order_id, amount, is_reversal)
    values (v_order.user_id, v_order.id, -1, true);

  -- Recompute the cache from the full ledger so a reset boundary stays correct.
  select * into v_cfg from public.stamp_settings where id = true;
  select coalesce(sum(amount), 0) into v_net
    from public.stamp_transactions where user_id = v_order.user_id;
  update public.stamp_cards set
    total_stamps  = greatest(v_net, 0),
    cycle         = floor(greatest(v_net, 0) / v_cfg.card_size)::int,
    current_count = greatest(v_net, 0) - floor(greatest(v_net, 0) / v_cfg.card_size)::int * v_cfg.card_size,
    updated_at    = now()
  where user_id = v_order.user_id;

  -- Expire (revoke) only still-active vouchers this order issued.
  update public.vouchers set status = 'expired', updated_at = now()
    where source_order_id = v_order.id and status = 'active';
end;
$$;
```

- [ ] **Step 3: Append grants to the same migration**

```sql
revoke execute on function public.grant_order_stamp(uuid) from public;
grant execute on function public.grant_order_stamp(uuid) to authenticated;
revoke execute on function public.reverse_order_stamp(uuid) from public;
grant execute on function public.reverse_order_stamp(uuid) to authenticated;
```

- [ ] **Step 4: Apply the migration**

Use Supabase MCP `apply_migration` with name `stamp_functions` and the SQL from Steps 1–3.
Expected: success.

- [ ] **Step 5: Verify grant + idempotency against a real completed order**

Run via Supabase MCP `execute_sql` (pick a completed order that has a `user_id` and a paid line):
```sql
-- first grant returns a jsonb result; second returns null (idempotent)
select public.grant_order_stamp((select token from public.orders
  where user_id is not null and status = 'completed' limit 1)) as first_grant;
```
Expected: `first_grant` is a JSON object with `"stamped": true`. Re-running the same select returns `null`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260708121000_stamp_functions.sql
git commit -m "feat(stamps): grant_order_stamp + reverse_order_stamp RPCs"
```

---

### Task 3: `attach_order_member` RPC (staff link a member to an order)

**Files:**
- Create migration: `supabase/migrations/20260708122000_attach_order_member.sql`

**Interfaces:**
- Consumes: `public.orders`, `public.profiles` (`display_name, avatar_url, phone`), `auth.users` (`email`), `current_user_role()`, and `grant_order_stamp` (Task 2).
- Produces: `attach_order_member(p_token uuid, p_identifier text) returns jsonb` → `{ok:true, display_name, avatar_url, phone_masked}` or `{ok:false, error}`.

- [ ] **Step 1: Write the RPC in the migration**

```sql
-- Staff attach a member to an order by member-QR token (the user's uuid), phone,
-- or email. SECURITY DEFINER so it can read auth.users.email and set orders.user_id
-- under RLS. Returns ONLY minimal identity (never raw email/phone). If the order
-- is already completed, grants the stamp retroactively (idempotent via Task 2).
create or replace function public.attach_order_member(p_token uuid, p_identifier text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.user_role := public.current_user_role();
  v_order  public.orders%rowtype;
  v_uid    uuid;
  v_ident  text := btrim(p_identifier);
  v_prof   public.profiles%rowtype;
begin
  if v_role not in ('admin','manager','staff') then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select * into v_order from public.orders where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;

  -- Resolve member: try uuid (QR token), then phone, then email.
  begin
    v_uid := v_ident::uuid;
    if not exists (select 1 from public.profiles where id = v_uid) then v_uid := null; end if;
  exception when invalid_text_representation then v_uid := null;
  end;
  if v_uid is null then
    select id into v_uid from public.profiles where phone = v_ident limit 1;
  end if;
  if v_uid is null then
    select id into v_uid from auth.users where lower(email) = lower(v_ident) limit 1;
  end if;
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'member_not_found'); end if;

  -- Refuse if a different member is already attached.
  if v_order.user_id is not null and v_order.user_id <> v_uid then
    return jsonb_build_object('ok', false, 'error', 'different_member_attached');
  end if;

  update public.orders set user_id = v_uid where id = v_order.id;

  -- Retroactive grant if the order is already completed.
  if v_order.status = 'completed' then
    perform public.grant_order_stamp(p_token);
  end if;

  select * into v_prof from public.profiles where id = v_uid;
  return jsonb_build_object(
    'ok', true,
    'display_name', coalesce(v_prof.display_name, 'Member'),
    'avatar_url', v_prof.avatar_url,
    'phone_masked', case when v_prof.phone is null then null
                    else '••••' || right(v_prof.phone, 3) end
  );
end;
$$;

revoke execute on function public.attach_order_member(uuid, text) from public;
grant execute on function public.attach_order_member(uuid, text) to authenticated;
```

- [ ] **Step 2: Apply the migration**

Use Supabase MCP `apply_migration` with name `attach_order_member` and the SQL above.
Expected: success.

- [ ] **Step 3: Verify member lookup by uuid returns minimal identity**

Run via Supabase MCP `execute_sql`:
```sql
select public.attach_order_member(
  (select token from public.orders where user_id is null limit 1),
  (select id::text from public.profiles limit 1));
```
Expected: `{"ok": true, "display_name": ..., "phone_masked": ...}` with **no** raw email and no full phone. If there are no guest orders, expect a normal object; the point is the return shape.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260708122000_attach_order_member.sql
git commit -m "feat(stamps): attach_order_member RPC with retroactive grant"
```

---

### Task 4: Regenerate DB types + TS types

**Files:**
- Modify: `types/database.ts` (regenerated wholesale)
- Modify: `types/reward.ts` (append stamp/voucher types)

**Interfaces:**
- Produces: TS types `StampCard`, `Voucher`, `VoucherType`, `StampSettings`, `GrantStampResult`, `AttachMemberResult` for use by later tasks.

- [ ] **Step 1: Regenerate `types/database.ts`**

Use the Supabase MCP `generate_typescript_types` tool. Paste its output over the entire contents of `types/database.ts`.

- [ ] **Step 2: Append TS types to `types/reward.ts`**

```typescript
// --- Stamp card + vouchers (loyalty program #2, separate from streak) ---

export type VoucherType = "rm_off" | "free_drink";
export type VoucherStatus = "active" | "redeemed" | "expired";

// Cached per-member stamp state (mirrors the DB stamp_cards row, camelCased).
export type StampCard = {
  currentCount: number;
  cycle: number;
  totalStamps: number;
};

// A voucher issued at a stamp milestone.
export type Voucher = {
  id: string;
  type: VoucherType;
  status: VoucherStatus;
  discountAmount: number;   // sen
  minSpend: number;         // sen
  freeDrinkMaxValue: number; // sen
  expiresAt: string;        // ISO
};

// Admin-editable stamp/voucher config.
export type StampSettings = {
  isEnabled: boolean;
  cardSize: number;
  milestoneSmall: number;
  rmOffAmount: number;
  rmOffMinSpend: number;
  freeDrinkMaxValue: number;
  voucherExpiryDays: number;
};

// Result of grant_order_stamp.
export type GrantStampResult = {
  stamped: boolean;
  count: number;
  cycle: number;
  vouchersIssued: { type: VoucherType }[];
} | null;

// Result of attach_order_member (minimal identity only).
export type AttachMemberResult =
  | { ok: true; displayName: string; avatarUrl: string | null; phoneMasked: string | null }
  | { ok: false; error: string };
```

- [ ] **Step 3: Verify types compile**

Run: `npm run build`
Expected: build succeeds (no TS errors from the new types).

- [ ] **Step 4: Commit**

```bash
git add types/database.ts types/reward.ts
git commit -m "feat(stamps): regenerate db types + add stamp/voucher TS types"
```

---

### Task 5: Server wrappers (`lib/stamps/`)

**Files:**
- Create: `lib/stamps/config-store.ts`
- Create: `lib/stamps/store.ts`
- Create: `lib/stamps/member.ts`

**Interfaces:**
- Consumes: `@/lib/supabase/server` `createClient`, `@/lib/supabase/public` `createPublicClient`, types from Task 4.
- Produces: `getStampSettings()`, `STAMP_CONFIG_TAG`, `grantOrderStamp(token)`, `reverseOrderStamp(token)`, `getStampCard()`, `attachOrderMember(token, identifier)`.

- [ ] **Step 1: Write `lib/stamps/config-store.ts`**

```typescript
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import type { StampSettings } from "@/types/reward";

export const STAMP_CONFIG_TAG = "stamp-config";

// The single admin-editable config row, with safe defaults if missing. Cached in
// the Data Cache and invalidated by the admin save action via revalidateTag.
export const getStampSettings = cache(
  unstable_cache(
    async (): Promise<StampSettings> => {
      const db = createPublicClient();
      const { data } = await db.from("stamp_settings").select("*").limit(1).maybeSingle();
      return {
        isEnabled: data?.is_enabled ?? true,
        cardSize: data?.card_size ?? 8,
        milestoneSmall: data?.milestone_small ?? 4,
        rmOffAmount: data?.rm_off_amount ?? 500,
        rmOffMinSpend: data?.rm_off_min_spend ?? 1100,
        freeDrinkMaxValue: data?.free_drink_max_value ?? 1200,
        voucherExpiryDays: data?.voucher_expiry_days ?? 30,
      };
    },
    ["stamp-settings"],
    { tags: [STAMP_CONFIG_TAG], revalidate: 60 },
  ),
);
```

- [ ] **Step 2: Write `lib/stamps/store.ts`**

```typescript
import { createClient } from "@/lib/supabase/server";
import type { GrantStampResult, StampCard } from "@/types/reward";

type GrantRow = { stamped: boolean; count: number; cycle: number; vouchers_issued: { type: "rm_off" | "free_drink" }[] };

// Grant a stamp for a completed member order. No-ops (returns null) for guests,
// disabled program, non-qualifying, or already-stamped orders. Best-effort:
// callers must NOT fail the order if this throws.
export async function grantOrderStamp(token: string): Promise<GrantStampResult> {
  const db = await createClient();
  const { data, error } = await db.rpc("grant_order_stamp", { p_token: token });
  if (error) {
    console.error(`grant_order_stamp failed for ${token}: ${error.message}`);
    return null;
  }
  if (!data) return null;
  const row = data as unknown as GrantRow;
  return {
    stamped: row.stamped,
    count: row.count,
    cycle: row.cycle,
    vouchersIssued: (row.vouchers_issued ?? []).map((v) => ({ type: v.type })),
  };
}

// Reverse a cancelled order's stamp. Self-guards; logs on failure.
export async function reverseOrderStamp(token: string): Promise<void> {
  const db = await createClient();
  const { error } = await db.rpc("reverse_order_stamp", { p_token: token });
  if (error) console.error(`reverse_order_stamp failed for ${token}: ${error.message}`);
}

// The caller's own stamp card (RLS-scoped). Null when signed out or no card yet.
export async function getStampCard(): Promise<StampCard | null> {
  const db = await createClient();
  const { data } = await db.from("stamp_cards").select("current_count, cycle, total_stamps").maybeSingle();
  if (!data) return null;
  return { currentCount: data.current_count, cycle: data.cycle, totalStamps: data.total_stamps };
}
```

- [ ] **Step 3: Write `lib/stamps/member.ts`**

```typescript
import { createClient } from "@/lib/supabase/server";
import type { AttachMemberResult } from "@/types/reward";

type AttachRow =
  | { ok: true; display_name: string; avatar_url: string | null; phone_masked: string | null }
  | { ok: false; error: string };

// Staff attach a member to an order by QR token / phone / email. Returns minimal
// identity on success. RPC enforces the staff role gate.
export async function attachOrderMember(token: string, identifier: string): Promise<AttachMemberResult> {
  const db = await createClient();
  const { data, error } = await db.rpc("attach_order_member", { p_token: token, p_identifier: identifier });
  if (error) return { ok: false, error: error.message };
  const row = data as unknown as AttachRow;
  if (!row?.ok) return { ok: false, error: (row as { error?: string })?.error ?? "unknown" };
  return { ok: true, displayName: row.display_name, avatarUrl: row.avatar_url, phoneMasked: row.phone_masked };
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add lib/stamps/
git commit -m "feat(stamps): server wrappers for config, grant/reverse, attach"
```

---

### Task 6: Wire grant on complete + reverse on cancel

**Files:**
- Modify: `app/(admin)/manage/actions.ts`

**Interfaces:**
- Consumes: `grantOrderStamp`, `reverseOrderStamp` from `lib/stamps/store.ts` (Task 5).
- Produces: stamps granted at completion and reversed at cancel, in the same functions that already call the rewards RPCs.

- [ ] **Step 1: Add the import**

At the top of `app/(admin)/manage/actions.ts`, next to the existing rewards import (`import { reverseOrderRewards } from "@/lib/rewards/store";`), add:

```typescript
import { grantOrderStamp, reverseOrderStamp } from "@/lib/stamps/store";
```

- [ ] **Step 2: Grant the stamp after completion**

In `markReadyAndNotify`, immediately after the completion succeeds — the line:

```typescript
  const completed = await completeOrder(token);
  if (!completed) return { ok: false, error: "Could not complete the order." };
```

add right below it (best-effort; never fails the order):

```typescript
  // Grant the loyalty stamp (member orders only; no-ops otherwise). Best-effort:
  // a failure must not block completion — the RPC is idempotent so a retry is safe.
  await grantOrderStamp(token);
```

- [ ] **Step 3: Reverse the stamp on cancel**

In `cancelOrderAction`, directly after the existing `await reverseOrderRewards(token);` line, add:

```typescript
  await reverseOrderStamp(token);
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add app/\(admin\)/manage/actions.ts
git commit -m "feat(stamps): grant stamp on complete, reverse on cancel"
```

---

### Task 7: Admin stamp settings panel (CMS control)

**Files:**
- Create: `app/(admin)/admin/promotions/stamp-actions.ts`
- Create: `components/admin/stamp-settings-form.tsx`
- Modify: `app/(admin)/admin/promotions/page.tsx`
- Read for admin patterns: `app/(admin)/admin/rewards/actions.ts`, `lib/auth/session.ts` (`isAdmin`)

**Interfaces:**
- Consumes: `isAdmin` from `@/lib/auth/session`, `STAMP_CONFIG_TAG` + `getStampSettings` from Task 5, `StampSettings` type.
- Produces: server action `saveStampSettings(input: StampSettingsInput)`, component `<StampSettingsForm initial={...} />`.

- [ ] **Step 1: Write the save action `app/(admin)/admin/promotions/stamp-actions.ts`**

```typescript
"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";
import { STAMP_CONFIG_TAG } from "@/lib/stamps/config-store";

export type StampActionResult = { ok: true } | { ok: false; error: string };

export type StampSettingsInput = {
  isEnabled: boolean;
  cardSize: number;
  milestoneSmall: number;
  rmOffAmount: number;
  rmOffMinSpend: number;
  freeDrinkMaxValue: number;
  voucherExpiryDays: number;
};

// Persist the singleton stamp_settings row (admin only) and invalidate every
// surface that reads it. Config changes apply to FUTURE voucher issues only.
export async function saveStampSettings(input: StampSettingsInput): Promise<StampActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  if (input.milestoneSmall >= input.cardSize) {
    return { ok: false, error: "Milestone must be smaller than card size." };
  }
  const db = await createClient();
  const { error } = await db.from("stamp_settings").update({
    is_enabled: input.isEnabled,
    card_size: input.cardSize,
    milestone_small: input.milestoneSmall,
    rm_off_amount: input.rmOffAmount,
    rm_off_min_spend: input.rmOffMinSpend,
    free_drink_max_value: input.freeDrinkMaxValue,
    voucher_expiry_days: input.voucherExpiryDays,
  }).eq("id", true);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/promotions");
  revalidatePath("/rewards");
  revalidateTag(STAMP_CONFIG_TAG, "max");
  return { ok: true };
}
```

- [ ] **Step 2: Write `components/admin/stamp-settings-form.tsx`**

A client component with a header "Stamp Card & Vouchers", an enable/disable switch, and number inputs for card size, milestone, RM-off amount (in RM, ×100 to sen on save), min spend, free-drink max value, expiry days. On save it calls `saveStampSettings` and shows ok/error. Follow the exact styling and Switch/Input primitives used in `components/admin/payment-settings-form.tsx` (read it first to match the pattern). Money fields display RM (divide sen by 100) and convert back to sen on submit.

```tsx
"use client";

import { useState, useTransition } from "react";
import { saveStampSettings, type StampSettingsInput } from "@/app/(admin)/admin/promotions/stamp-actions";
import type { StampSettings } from "@/types/reward";

export function StampSettingsForm({ initial }: { initial: StampSettings }) {
  const [form, setForm] = useState<StampSettingsInput>({
    isEnabled: initial.isEnabled,
    cardSize: initial.cardSize,
    milestoneSmall: initial.milestoneSmall,
    rmOffAmount: initial.rmOffAmount,
    rmOffMinSpend: initial.rmOffMinSpend,
    freeDrinkMaxValue: initial.freeDrinkMaxValue,
    voucherExpiryDays: initial.voucherExpiryDays,
  });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function save() {
    start(async () => {
      const res = await saveStampSettings(form);
      setMsg(res.ok ? "Saved" : res.error);
    });
  }

  const rm = (sen: number) => (sen / 100).toFixed(2);
  const toSen = (rm: string) => Math.round(parseFloat(rm || "0") * 100);

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider">Stamp Card &amp; Vouchers</h2>

      <label className="mt-4 flex items-center justify-between gap-4">
        <span className="text-sm">Program enabled</span>
        <input type="checkbox" checked={form.isEnabled}
          onChange={(e) => setForm({ ...form, isEnabled: e.target.checked })} />
      </label>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <NumberField label="Card size" value={form.cardSize}
          onChange={(v) => setForm({ ...form, cardSize: v })} />
        <NumberField label="Reward at (stamps)" value={form.milestoneSmall}
          onChange={(v) => setForm({ ...form, milestoneSmall: v })} />
        <MoneyField label="RM off (RM)" value={rm(form.rmOffAmount)}
          onChange={(v) => setForm({ ...form, rmOffAmount: toSen(v) })} />
        <MoneyField label="Min spend (RM)" value={rm(form.rmOffMinSpend)}
          onChange={(v) => setForm({ ...form, rmOffMinSpend: toSen(v) })} />
        <MoneyField label="Free drink cap (RM)" value={rm(form.freeDrinkMaxValue)}
          onChange={(v) => setForm({ ...form, freeDrinkMaxValue: toSen(v) })} />
        <NumberField label="Voucher expiry (days)" value={form.voucherExpiryDays}
          onChange={(v) => setForm({ ...form, voucherExpiryDays: v })} />
      </div>

      <button type="button" onClick={save} disabled={pending}
        className="mt-4 h-11 rounded-2xl bg-foreground px-6 text-xs font-bold uppercase tracking-wider text-white disabled:opacity-70">
        {pending ? "Saving" : "Save"}
      </button>
      {msg && <p className="mt-2 text-xs">{msg}</p>}
    </section>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <input type="number" min={0} value={value}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="h-11 rounded-xl border border-border px-3 text-sm" />
    </label>
  );
}

function MoneyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <input type="text" inputMode="decimal" value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 rounded-xl border border-border px-3 text-sm" />
    </label>
  );
}
```

- [ ] **Step 3: Render it on the promotions page**

Modify `app/(admin)/admin/promotions/page.tsx` to fetch settings and render the form above the existing `PromotionsManager`:

```tsx
import { listAdminPromotions } from "@/lib/promotions/admin";
import { listAdminProducts, listAdminCategories } from "@/lib/menu/admin";
import { PromotionsManager } from "@/components/admin/promotions-manager";
import { getStampSettings } from "@/lib/stamps/config-store";
import { StampSettingsForm } from "@/components/admin/stamp-settings-form";

export const dynamic = "force-dynamic";

export default async function PromotionsAdminPage() {
  const [promotions, products, categories, stampSettings] = await Promise.all([
    listAdminPromotions(), listAdminProducts(), listAdminCategories(), getStampSettings(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <StampSettingsForm initial={stampSettings} />
      <PromotionsManager initial={promotions} products={products} categories={categories} />
    </div>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/promotions/stamp-actions.ts" components/admin/stamp-settings-form.tsx "app/(admin)/admin/promotions/page.tsx"
git commit -m "feat(stamps): admin stamp/voucher settings panel"
```

---

### Task 8: Install QR dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Produces: `qrcode` (generate member QR) + `@zxing/browser` (staff scanner) available to import.

- [ ] **Step 1: Install**

Run:
```bash
npm install qrcode @zxing/browser && npm install -D @types/qrcode
```
Expected: packages added, no peer-dependency errors that break the build.

- [ ] **Step 2: Verify build still works**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add qrcode + @zxing/browser for member QR"
```

---

### Task 9: Customer stamp card component (+ animation, realtime)

**Files:**
- Modify: `app/globals.css` (add keyframes)
- Create: `components/stamps/stamp-card.tsx`

**Interfaces:**
- Consumes: `StampCard`, `StampSettings` types; `@/lib/supabase/client` `createClient`; `@/store/auth` `useAuth`.
- Produces: `<StampCard initial={StampCard | null} settings={StampSettings} userId={string | null} />`.

- [ ] **Step 1: Add the stamp-press keyframes to `app/globals.css`**

Add near the other `@keyframes` (before the `prefers-reduced-motion` block):

```css
@keyframes naise-stamp-press {
  0% { transform: scale(1.6); opacity: 0; }
  55% { transform: scale(0.9); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
.naise-stamp-press { animation: naise-stamp-press 380ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
```

Then inside the existing `@media (prefers-reduced-motion: reduce)` block, add:

```css
  .naise-stamp-press { animation: naise-fade 200ms ease both; }
```

- [ ] **Step 2: Write `components/stamps/stamp-card.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { StampCard as StampCardData, StampSettings } from "@/types/reward";
import { cn } from "@/lib/utils";

// The 8-slot loyalty card. Subscribes to the member's own stamp_cards row so a
// stamp granted at the counter animates in live. Milestone slots carry a badge.
export function StampCard({
  initial,
  settings,
  userId,
}: {
  initial: StampCardData | null;
  settings: StampSettings;
  userId: string | null;
}) {
  const [card, setCard] = useState<StampCardData>(
    initial ?? { currentCount: 0, cycle: 0, totalStamps: 0 },
  );
  const prevCount = useRef(card.currentCount);
  const [justStamped, setJustStamped] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) return;
    const db = createClient();
    const channel = db
      .channel(`stamp-card-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stamp_cards", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { current_count: number; cycle: number; total_stamps: number };
          setCard({ currentCount: row.current_count, cycle: row.cycle, totalStamps: row.total_stamps });
        },
      )
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  }, [userId]);

  // Animate the newest slot when the count rises (ignore resets to 0).
  useEffect(() => {
    if (card.currentCount > prevCount.current) {
      setJustStamped(card.currentCount);
      const t = setTimeout(() => setJustStamped(null), 400);
      prevCount.current = card.currentCount;
      return () => clearTimeout(t);
    }
    prevCount.current = card.currentCount;
  }, [card.currentCount]);

  const slots = Array.from({ length: settings.cardSize }, (_, i) => i + 1);

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wider">Stamp Card</h2>
        <span className="text-xs text-muted-foreground">
          {card.currentCount}/{settings.cardSize}
          {card.cycle > 0 && <> · Card #{card.cycle + 1}</>}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3">
        {slots.map((n) => {
          const filled = n <= card.currentCount;
          const isMilestone = n === settings.milestoneSmall || n === settings.cardSize;
          return (
            <div
              key={n}
              className={cn(
                "relative flex aspect-square items-center justify-center rounded-full border-2 text-sm font-bold",
                filled ? "border-foreground bg-foreground text-white" : "border-dashed border-border text-muted-foreground",
                justStamped === n && "naise-stamp-press",
              )}
            >
              {filled ? "☕" : n}
              {isMilestone && !filled && (
                <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1 text-[0.5rem] font-bold text-black">
                  {n === settings.cardSize ? "FREE" : "RM"}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[0.6875rem] text-muted-foreground">
        Earn a stamp with every order. {settings.milestoneSmall} stamps = RM
        {(settings.rmOffAmount / 100).toFixed(0)} off · {settings.cardSize} stamps = a free drink.
      </p>
    </section>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css components/stamps/stamp-card.tsx
git commit -m "feat(stamps): customer stamp card with live animation"
```

---

### Task 10: Member QR component (customer)

**Files:**
- Create: `components/stamps/member-qr.tsx`

**Interfaces:**
- Consumes: `qrcode` (Task 8), the member's `userId`.
- Produces: `<MemberQr userId={string} />` — a button that reveals the member's QR (encodes `userId`) for staff to scan.

- [ ] **Step 1: Write `components/stamps/member-qr.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

// The member's static loyalty QR. Encodes the user's uuid — NOT a secret, since a
// stamp still requires a real completed order. Staff scan this at the counter.
export function MemberQr({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || dataUrl) return;
    QRCode.toDataURL(userId, { width: 320, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [open, dataUrl, userId]);

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-11 w-full rounded-2xl border border-border text-xs font-bold uppercase tracking-wider hover:bg-neutral-50"
      >
        {open ? "Hide my code" : "Show my code"}
      </button>
      {open && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL, not an optimizable asset
            <img src={dataUrl} alt="Your Naise member QR code" width={220} height={220} className="rounded-xl" />
          ) : (
            <div className="size-[220px] animate-pulse rounded-xl bg-neutral-100" />
          )}
          <p className="text-[0.6875rem] text-muted-foreground">Show this to staff to collect your stamp.</p>
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed (the inline eslint-disable keeps the data-URL `<img>` allowed).

- [ ] **Step 3: Commit**

```bash
git add components/stamps/member-qr.tsx
git commit -m "feat(stamps): customer member QR component"
```

---

### Task 11: Staff attach-member UI on `/manage`

**Files:**
- Modify: `app/(admin)/manage/actions.ts` (add the attach server action)
- Create: `components/stamps/attach-member.tsx`
- Modify: `components/order-detail.tsx` (mount the attach control)

**Interfaces:**
- Consumes: `attachOrderMember` from `lib/stamps/member.ts`, `canManageOrders` from `lib/auth/session`, `@zxing/browser` `BrowserQRCodeReader`, `AttachMemberResult`.
- Produces: server action `attachMemberAction(token, identifier)`; component `<AttachMember token={string} attached={boolean} />`.

- [ ] **Step 1: Add the server action to `app/(admin)/manage/actions.ts`**

Add the import near the other stamp import:

```typescript
import { attachOrderMember } from "@/lib/stamps/member";
```

Add this action (mirrors the shape of the other actions in the file):

```typescript
// Staff attach a member to an order by scanned QR (uuid) / phone / email. Grants
// retroactively if the order is already completed (handled in the RPC).
export async function attachMemberAction(
  token: string,
  identifier: string,
): Promise<AttachActionResult> {
  if (!(await canManageOrders())) {
    return { ok: false, error: "Not authorized." };
  }
  const res = await attachOrderMember(token, identifier.trim());
  if (!res.ok) {
    const msg =
      res.error === "member_not_found"
        ? "No member found for that QR, phone, or email."
        : res.error === "different_member_attached"
          ? "This order already has a different member."
          : res.error === "order_not_found"
            ? "Order not found."
            : "Couldn't attach the member. Try again.";
    return { ok: false, error: msg };
  }
  revalidatePath(`/manage/${token}`);
  return { ok: true, displayName: res.displayName, phoneMasked: res.phoneMasked };
}
```

Add the result type near the top of the file (below the existing imports):

```typescript
export type AttachActionResult =
  | { ok: true; displayName: string; phoneMasked: string | null }
  | { ok: false; error: string };
```

- [ ] **Step 2: Write `components/stamps/attach-member.tsx`**

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { attachMemberAction } from "@/app/(admin)/manage/actions";

// Staff control on the order page: attach a member by scanning their QR (camera)
// or keying in phone/email. On success the stamp is granted (now if the order is
// already completed, else at completion).
export function AttachMember({ token, attached }: { token: string; attached: boolean }) {
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);

  function submit(identifier: string) {
    if (!identifier.trim()) return;
    start(async () => {
      const res = await attachMemberAction(token, identifier);
      setMsg(res.ok ? `Attached: ${res.displayName}` : res.error);
      if (res.ok) setManual("");
    });
  }

  async function startScan() {
    setMsg(null);
    setScanning(true);
    try {
      const reader = new BrowserQRCodeReader();
      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current!,
        (result) => {
          if (result) {
            controlsRef.current?.stop();
            setScanning(false);
            submit(result.getText());
          }
        },
      );
    } catch {
      setScanning(false);
      setMsg("Couldn't open the camera. Key in phone or email instead.");
    }
  }

  function stopScan() {
    controlsRef.current?.stop();
    setScanning(false);
  }

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider">
        {attached ? "Member attached" : "Attach member for stamp"}
      </h3>

      {!attached && (
        <>
          {scanning ? (
            <div className="mt-3 flex flex-col gap-2">
              <video ref={videoRef} className="w-full rounded-xl bg-black" />
              <button type="button" onClick={stopScan}
                className="h-10 rounded-xl border border-border text-xs font-bold uppercase tracking-wider">
                Cancel scan
              </button>
            </div>
          ) : (
            <button type="button" onClick={startScan} disabled={pending}
              className="mt-3 h-11 w-full rounded-2xl bg-foreground text-xs font-bold uppercase tracking-wider text-white disabled:opacity-70">
              Scan member QR
            </button>
          )}

          <div className="mt-3 flex gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value)}
              placeholder="Phone or email" disabled={pending}
              className="h-11 flex-1 rounded-xl border border-border px-3 text-sm" />
            <button type="button" onClick={() => submit(manual)} disabled={pending || !manual.trim()}
              className="h-11 rounded-xl border border-border px-4 text-xs font-bold uppercase tracking-wider disabled:opacity-70">
              Attach
            </button>
          </div>
        </>
      )}

      {msg && <p className="mt-2 text-xs">{msg}</p>}
    </section>
  );
}
```

- [ ] **Step 3: Mount it in `components/order-detail.tsx`**

Add the import with the other component imports:

```tsx
import { AttachMember } from "@/components/stamps/attach-member";
```

Render it inside the order view (near the payment/receipt controls). Use the order's member state to set `attached` — the `Order` type exposes the member via `order.userId` (confirm the exact camelCase field on the `Order` type; if it is `ownerId`-only, use whether a member user id is present). Place:

```tsx
<AttachMember token={order.token} attached={Boolean(order.userId)} />
```

If the `Order` type has no `userId` field yet, add it in `types/order.ts` and map it in `lib/orders/store.ts` where the order row is shaped (the DB column is `orders.user_id`). Keep this change minimal — one field.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/manage/actions.ts" components/stamps/attach-member.tsx components/order-detail.tsx types/order.ts lib/orders/store.ts
git commit -m "feat(stamps): staff attach-member scan/keyed UI on manage"
```

---

### Task 12: Render stamp card + member QR on `/rewards` (gated)

**Files:**
- Modify: `app/(customer)/rewards/page.tsx`

**Interfaces:**
- Consumes: `getStampSettings`, `getStampCard` (Task 5), `<StampCard>` (Task 9), `<MemberQr>` (Task 10), `createClient` from `@/lib/supabase/server`.
- Produces: the stamp card + QR shown on the rewards page when `is_enabled` and the user is signed in.

- [ ] **Step 1: Modify `app/(customer)/rewards/page.tsx`**

Add imports:

```tsx
import { createClient } from "@/lib/supabase/server";
import { getStampSettings } from "@/lib/stamps/config-store";
import { getStampCard } from "@/lib/stamps/store";
import { StampCard } from "@/components/stamps/stamp-card";
import { MemberQr } from "@/components/stamps/member-qr";
```

In the component body, fetch the stamp data alongside the existing rewards config (add `getStampSettings()` / `getStampCard()` to the awaits and resolve the current user id):

```tsx
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [stampSettings, stampCard] = await Promise.all([
    getStampSettings(),
    user ? getStampCard() : Promise.resolve(null),
  ]);
```

Render the stamp card + QR above `<RewardsScreen>` when the program is enabled. Return them wrapped together:

```tsx
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 py-6">
      {stampSettings.isEnabled && (
        <>
          <StampCard initial={stampCard} settings={stampSettings} userId={user?.id ?? null} />
          {user && <MemberQr userId={user.id} />}
        </>
      )}
      <RewardsScreen
        tiers={tiers}
        catalog={catalog}
        milestones={milestones}
        beansPerRinggit={settings.beansPerRinggit}
        referral={{ beans: settings.referralBeans, voucher: settings.referralVoucherLabel }}
        streakEnabled={store.streakEnabled}
        referralEnabled={store.referralEnabled}
      />
    </div>
  );
```

Note: keep the existing `RewardsScreen` props exactly as they are today — only wrap it and prepend the stamp UI. If `RewardsScreen` already provides its own page padding/container, drop the extra wrapper classes to avoid double padding (check the component before finalizing).

- [ ] **Step 2: Verify**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 3: Manual smoke check**

Run: `npm run dev`, sign in as a member, open `/rewards`.
Expected: the stamp card renders with the correct slot count; "Show my code" reveals a QR. Toggle `is_enabled` off in `/admin/promotions` and reload → the stamp card and QR disappear.

- [ ] **Step 4: Commit**

```bash
git add "app/(customer)/rewards/page.tsx"
git commit -m "feat(stamps): show stamp card + member QR on rewards (gated)"
```

---

## Plan 1 Self-Review

- **Spec coverage:** stamp schema (T1), grant/reverse RPCs (T2), attach RPC (T3), TS types (T4), server wrappers (T5), grant-on-complete + reverse-on-cancel (T6), CMS enable/disable + config (T7), QR deps (T8), animated card (T9), member QR (T10), staff attach UI (T11), gated rewards render (T12). Voucher *redemption*, kiosk add-member step, customer voucher list, and expiry sweep are intentionally deferred to Plan 2.
- **Deferred to Plan 2:** `redeem_voucher` RPC + checkout apply-voucher UI + customer voucher list + kiosk `/store` add-member step + voucher expiry (lazy check / job). Milestone vouchers are *created* here (T2) but not yet redeemable — acceptable interim state (they sit `active` until Plan 2 ships).
- **Type consistency:** `grant_order_stamp` returns `{stamped,count,cycle,vouchers_issued}` (snake) → mapped to `GrantStampResult` (camel) in `store.ts`. `attach_order_member` returns `{ok,display_name,avatar_url,phone_masked}` → `AttachMemberResult`. Field names match across T2/T3/T4/T5.

**Known follow-ups for Plan 2 to honor:**
- The RM-off voucher redemption must apply the fixed `discount_amount` to the order with the `min_spend` gate (the RM11→RM6 example).
- The free-drink voucher bills any excess above `free_drink_max_value`.
- Kiosk `/store` add-member reuses `attachMemberAction` / `attach_order_member`.
