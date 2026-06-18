# Rewards System → Supabase — Design

Date: 2026-06-18
Status: Approved design, pending implementation plan
Scope: Move the per-user rewards state — Beans balance + ledger, loyalty tier,
daily streak, and activity history — from the local/mock client stores to
Supabase, linked to the user profile and **server-authoritative**. Every member
starts at **0 Beans**. Earning, redeeming, and streak check-ins happen inside the
existing order server actions so the client can only *read* rewards state.

The redeemable-drinks **catalog**, **tier thresholds**, **earn rate**, and the
**referral** program stay as typed code config for now; the schema is designed so
a future admin/CMS Rewards surface can take them over without rework. This mirrors
how the ordering-system spec deliberately left rewards mocked but link-ready.

---

## 1. Goals

- Beans balance, ledger, streak, tier standing, and activity history persist in
  Supabase, keyed to `auth.users` / `profiles`, and survive across devices.
- Every member starts at **0 Beans** (no seed, no mock starting balance).
- Earning and spending Beans are **server-authoritative** — the client never
  writes rewards state. This closes the current hole where the balance lives in
  localStorage and is freely editable.
- Beans are earned **at order placement** (members only) and **reversed if the
  order is cancelled** by staff.
- Loyalty tier is based on **lifetime Beans earned** (earn-only), so redeeming a
  free drink never demotes a member.
- The Rewards screen, Profile screen, and the full activity feed read real data;
  the Beans balance updates **live** after an order via realtime.
- Guests never earn or redeem (unchanged) — rewards are a members-only concept.

### Non-goals (designed-for, not built here)

- The redeemable-drinks **catalog** and **tier definitions** moving into DB tables.
- Any **admin/CMS Rewards** management UI (create/edit rewards, edit bean
  requirements, view/adjust customer balances).
- The **referral** program (stays a "Coming Soon" modal; display values stay config).
- Push notifications for rewards events.

---

## 2. Current state (what we are replacing)

All rewards state is client-side and mock/local:

- `store/beans.tsx` — React context backed by **localStorage** (`balance`,
  `activity`). Exposes `spendAndEarn(order)`, `creditBeans(amount, label)`,
  `canAfford(cost)`, `earnRate`. Seeds from the mock `rewardsSummary` (1250 Beans).
  10 Beans per RM1 (`beansPerRinggit`).
- `hooks/use-streak.ts` + `lib/streak.ts` — streak backed by **localStorage** as a
  set of check-in date keys, plus a **dev-only "skip a day" offset** for testing.
  The pure rules (`computeStreakDays`, `buildWeek`, `hasCheckedInToday`,
  `dateKey`) live in `lib/streak.ts` and take "a set of date keys + today".
- `data/rewards.ts` — static config + mock snapshot: `rewardTiers`
  (Fresh 0 / Bold 1000 / Naise Club 3000), `beansPerRinggit = 10`,
  `getTierProgress(beans)`, `rewardsSummary` (mock balance/activity/streak/etc.),
  `RECENT_ACTIVITY_LIMIT = 3`, milestones, `getStreakAwards(streakDays)`.
- `types/reward.ts` — `Reward`, `RewardTier`, `StreakDay`, `StreakMilestone`,
  `BeanActivity`, `RewardsSummary`.
- Consumers: `components/rewards-screen.tsx`, `components/rewards-activity.tsx`,
  `components/rewards-catalog.tsx`, `components/profile-screen.tsx`, and
  `components/checkout-screen.tsx` (the earn/redeem/check-in trigger).

**The earn/redeem/streak all fire client-side at checkout** (`checkout-screen.tsx`,
members only): on a successful `placeOrder`, the client calls `spendAndEarn`
(deduct redeemed reward costs, earn Beans on the paid total), `checkIn()`, and
`creditBeans` for any streak milestone — then shows the bonus on the confirmation.

Orders already moved to Supabase. `public.orders` has `user_id` (null for guests),
`total` (sen), `status`, `completed_at`, RLS by role, and realtime. The cancel path
exists in the staff manage actions. There are **no rewards tables yet**.

---

## 3. Decisions (from brainstorming)

1. **Scope:** per-user state only. Catalog, tier thresholds, earn rate, milestones,
   and referral values stay as code config; CMS + catalog/tier tables are a later
   project the schema is designed for.
2. **Server-authoritative:** the client only reads rewards state. Every mutation
   goes through `SECURITY DEFINER` Postgres functions invoked by the existing
   order server actions. No client-facing insert/update RLS on rewards tables.
3. **Earn timing:** Beans are earned (and today's streak recorded) **at order
   placement**, members only. Staff **cancel reverses** the Beans via offsetting
   ledger rows, and removes that day's check-in only if it was the member's sole
   order that day.
4. **Tier basis:** **lifetime Beans earned** (earn-only). Tracked separately from
   the spendable balance so redemptions never lower a tier. A genuine cancel does
   reduce lifetime-earned (the order never really happened).
5. **Start at 0:** no seed Beans; the mock starting balance is removed. A member's
   `reward_accounts` row defaults to 0 and is created on first earn (or lazily).
6. **Streak timezone:** Asia/Kuala_Lumpur (matches the profile screen's member-since
   formatting). The dev "skip a day" offset is removed — real calendar only.

---

## 4. Architecture

Rewards mutations are folded into the order server actions and executed as single
atomic, idempotent Postgres functions. The client stores become thin readers.

```
placeOrder (server action) — members only (guests earn nothing, unchanged)
  └─ insert order + order_items                         (existing)
  └─ select apply_order_rewards(order_id)               ← NEW Postgres fn
       • earn = floor(paid_total_sen / 100) * earn_rate
       • settle redeemed reward Bean cost (validated vs live balance)
       • record today's streak check-in (KL timezone)
       • grant streak-milestone bonus Beans (getStreakAwards equivalent)
       • returns { earned, redeemed, streak_days, bonuses[] } for the UI
  └─ return { ok, orderNumber, rewards }                (UI shows instant feedback)

cancelOrderAction (staff) 
  └─ select reverse_order_rewards(order_id)             ← NEW Postgres fn
       • offsetting ledger rows restore Beans (earn + bonus from that order)
       • remove the day's check-in iff it was the member's sole order that day

rewards screen / profile / activity (server components)
  └─ fetch reward_accounts + bean_transactions + streak_checkins (RLS: own rows)
  └─ client subscribes to the member's reward_accounts row → live balance/tier

staff / CMS later
  └─ select-own-or-staff RLS already exposes any member's rewards to staff
```

### Why Postgres functions (not just TS in the action)

Earn + redeem + check-in + bonus must be **one atomic unit** keyed to the order,
and must be **idempotent** (a retried action must not double-credit). A
`SECURITY DEFINER` function does all writes in one transaction, enforces the
balance check, and is the single place rewards rules are applied. The server
action calls it via the existing cookie-scoped server client for members; the
function runs as definer so the tamper-proof tables need no client write policy.

Guest orders (no `user_id`) simply skip the rewards call.

---

## 5. Data model

New migration in `supabase/migrations/`. Integers throughout (Beans are whole
numbers; money stays sen elsewhere).

### Enum

- `public.bean_txn_category`: `earn | redeem | streak_bonus | referral | adjustment`
  - `earn` — Beans earned on an order's paid total.
  - `redeem` — Beans spent on a reward (negative amount).
  - `streak_bonus` — milestone bonus Beans.
  - `referral` — reserved for the future referral program.
  - `adjustment` — manual staff/CMS correction (reserved; no UI yet).
  Reversals are not a separate category: a cancel inserts offsetting rows under the
  **same** category as what they reverse (so `lifetime_earned`, which sums earning
  categories, nets correctly).

### `public.bean_transactions` — append-only ledger (source of truth)

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `user_id` | uuid not null | → `auth.users(id) on delete cascade` |
| `order_id` | uuid null | → `orders(id) on delete set null`; set for earn/redeem/streak_bonus tied to an order |
| `category` | `bean_txn_category` not null | |
| `amount` | integer not null | signed: +earn/+bonus, −redeem; reversals are the negation |
| `label` | text not null | display label, e.g. "Order earnings", "Redeemed Latte", "3-Day Streak Bonus", "Order earnings reversed" |
| `created_at` | timestamptz not null | default `now()` |

Indexes: `(user_id, created_at desc)` for the activity feed; `order_id`.

Idempotency: enforced **in the function**, not by a unique index — a single order
can legitimately produce multiple positive rows (e.g. an `earn` plus two
`streak_bonus` rows when a day completes a week *and* hits a 30-day mark), so
`(order_id, category)` is not unique. `apply_order_rewards` instead checks "does
this order already have any rewards rows?" at the top and no-ops if so. This is
race-free because placement is one transaction over a freshly-created `order_id`
(no concurrent call can target the same order). `reverse_order_rewards` is guarded
the same way (see §6).

### `public.reward_accounts` — 1:1 cached aggregates per member

| column | type | notes |
| --- | --- | --- |
| `user_id` | uuid pk | → `auth.users(id) on delete cascade` |
| `balance` | integer not null default 0 | spendable Beans = Σ all `amount` |
| `lifetime_earned` | integer not null default 0 | Σ `amount` over earning categories (`earn`,`streak_bonus`,`referral`) incl. their reversals → **drives tier** |
| `current_streak` | integer not null default 0 | cached from `streak_checkins` |
| `longest_streak` | integer not null default 0 | cached high-water mark |
| `last_check_in` | date null | most recent check-in date (KL) |
| `created_at` | timestamptz not null | default `now()` |
| `updated_at` | timestamptz not null | default `now()`, trigger-maintained |

Maintained by a trigger on `bean_transactions` (insert) for `balance` /
`lifetime_earned`, and by the streak path for the streak columns. The cache exists
for cheap reads and CMS display; the ledger + check-ins remain authoritative and
the cache is always recomputable from them.

Created on demand: `apply_order_rewards` upserts the row (default 0) before
crediting, satisfying "everyone starts at 0".

### `public.streak_checkins` — one row per member per calendar day

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | `gen_random_uuid()` |
| `user_id` | uuid not null | → `auth.users(id) on delete cascade` |
| `check_in_date` | date not null | calendar day in **Asia/Kuala_Lumpur** |
| `created_at` | timestamptz not null | default `now()` |

Unique `(user_id, check_in_date)`. Index `(user_id, check_in_date desc)`.
Streak length/week are derived by reusing `lib/streak.ts` against the set of
`check_in_date` keys (the rules are unchanged; only the source moves from
localStorage to this table).

### RLS (all three tables)

- **SELECT:** `user_id = auth.uid()` OR `current_user_role() in
  ('admin','manager','staff')` — same pattern as `orders`. Lets staff/CMS read any
  member's rewards later with no schema change.
- **No INSERT/UPDATE/DELETE policies for clients.** All writes happen through the
  `SECURITY DEFINER` functions (which run as definer and bypass RLS). This is the
  core anti-tamper guarantee.

---

## 6. Server functions

All `language plpgsql security definer set search_path = ''`, owned by a privileged
role, with `execute` granted to `authenticated` (and callable by the service-role
client for guest-less paths). Earn rate and tier/milestone constants are passed in
by the caller **or** mirrored as SQL constants — see §7 for how config stays in sync.

### `apply_order_rewards(p_order_id uuid) returns jsonb`

Runs in one transaction:

0. **Idempotency guard:** if `bean_transactions` already has any row for
   `p_order_id`, return early (no-op). Safe because placement is sequential over a
   fresh order id.
1. Load the order; resolve `user_id`. If null (guest), return `null` (no-op).
2. Upsert the member's `reward_accounts` row (default 0).
3. **Redeem:** for each redeemed reward on the order (see §8 for how redemptions are
   represented), validate the live `balance` covers the total cost; if not, **raise**
   (the placement transaction fails with a clear error). Insert `redeem` rows
   (negative `amount`).
4. **Earn:** `earned = floor(order.total / 100) * earn_rate`; insert one `earn` row.
5. **Streak:** insert today's `streak_checkins` row (KL date) `on conflict do
   nothing`; recompute `current_streak` / `longest_streak` / `last_check_in`.
6. **Bonus:** compute streak milestone awards for the new streak length and insert
   `streak_bonus` rows.
7. Return `{ earned, redeemed_cost, streak_days, bonuses: [{label, beans}] }` for the
   confirmation UI.

Idempotent via the step-0 guard; the check-in upsert is conflict-safe regardless.

### `reverse_order_rewards(p_order_id uuid) returns void`

1. Resolve `user_id`; if guest, no-op.
2. For each positive `earn` / `streak_bonus` / `redeem` row tied to the order that
   has **not** already been reversed, insert the negation (same category, negated
   amount, label suffixed "reversed"). Redeemed Beans are refunded; earned Beans are
   clawed back.
3. Remove today's-style check-in for the order's date **iff** the member has no other
   non-cancelled order on that date; recompute streak columns.

Guarded so a double-cancel doesn't double-reverse (track reversed state by summing
per-order per-category, or a `reversed_at` marker — finalized in the plan).

The `reward_accounts` trigger keeps `balance` / `lifetime_earned` correct after both
functions, because reversals are signed rows in the same categories.

---

## 7. Tier & config that stays in code

- Tier standing comes from `getTierProgress(lifetimeEarned)` — **same function**,
  fed `reward_accounts.lifetime_earned` instead of the live balance. No logic change.
- These stay in `data/rewards.ts` as typed config (CMS reads them from DB later):
  `rewardTiers`, `beansPerRinggit`, the redeemable-drinks `rewards` list,
  `milestones`, `getStreakAwards`, referral display values, `RECENT_ACTIVITY_LIMIT`.
- **Config sync:** the SQL functions must agree with the TS constants (earn rate,
  milestone day→beans map). To avoid drift, the migration defines them as SQL
  constants/`returns`-table seeded **from the same numbers**, and the spec/plan calls
  out that changing `beansPerRinggit` or `milestones` means updating both the TS
  config and the migration until they move to a shared DB table (the CMS phase).
  Earn-rate is a single number; the milestone map is the `getStreakAwards` rule
  (week-position 3 → 50, completed week → 100, every 30 days → free-drink Beans).

---

## 8. Redemption representation

Redeeming a free drink stays the **current cart flow**: the reward is added as an
`isReward` cart line (free base drink, `rewardCost` in Beans), and the order is
placed normally. What changes is **where the Bean cost is settled**:

- Today: client `spendAndEarn` deducts the cost at checkout.
- New: the redeemed reward(s) and their Bean costs are sent to `placeOrder` and
  persisted with the order (e.g. on `order_items`: a nullable `reward_id` /
  `reward_cost` on the reward line, or a small `order_redemptions` side table —
  finalized in the plan). `apply_order_rewards` reads them and inserts the `redeem`
  ledger rows, validating against the live balance **inside the transaction**.

The client `canAfford` check becomes **advisory** (nice UX, not the gate); the
authoritative check is server-side, so a stale balance across tabs can't overspend.

---

## 9. Client refactor

- **`store/beans.tsx`** — no longer the source of truth. Becomes a reader: seeded
  from server-fetched `reward_accounts` + recent `bean_transactions`, kept live by a
  realtime subscription on the member's `reward_accounts` row (Postgres Changes,
  RLS-gated to own row). Drops `spendAndEarn` / `creditBeans` (server-side now);
  keeps `balance`, `activity`, `earnRate`, and a read-only `canAfford` for advisory
  UI. Guests/signed-out render the empty/locked state.
- **`hooks/use-streak.ts`** — reads `streak_checkins` for the member; derives
  `streakDays` / `week` / `checkedInToday` via the unchanged `lib/streak.ts`. The dev
  "skip a day" offset and `devReset`/`devAdvanceDay` are **removed**.
- **`app/(customer)/rewards/page.tsx`**, **`profile/page.tsx`**,
  **`rewards/activity/page.tsx`** — server-fetch the member's rewards snapshot
  (account + activity + check-ins) and pass it down so the screens are server-rendered
  for members and crawlable, then hydrate to live values.
- **`components/rewards-screen.tsx`**, **`rewards-activity.tsx`**, **`profile-screen.tsx`**
  — read live server-backed values; tier uses `lifetime_earned`. Dev streak controls
  removed from the rewards screen.
- **`components/checkout-screen.tsx`** — stops calling the client ledger. After a
  successful `placeOrder`, it uses the `rewards` payload the action returns to show
  the earned Beans + streak bonus on the confirmation screen (same UX, now truthful).
- **`types/reward.ts`** / **`types/database.ts`** — align with the new rows;
  regenerate Supabase types after the migration.

---

## 10. Edge cases

- **Start at 0 / no seed:** the mock `rewardsSummary.beans` starting balance is
  removed; new members read 0 until they earn. Existing localStorage Beans from
  testing are discarded (not migrated) — per "everyone starts at 0".
- **Cancel reversal:** restores earned + bonus Beans and refunds redeemed Beans via
  offsetting rows; removes the day's check-in only if it was the sole order that day.
- **Redemption race:** validated inside `apply_order_rewards`; insufficient balance
  fails the placement with a clear, user-facing error. The cart line should then be
  removed (existing error copy already says so).
- **Idempotency:** both functions guard at the top on "does this order already have
  (un-reversed) rewards rows?"; check-in upsert is conflict-safe; reversal guarded
  against double-cancel.
- **Realtime auth:** `reward_accounts` Postgres Changes are RLS-gated to the owner's
  row (same model as the staff order board, narrowed to self).
- **Timezone:** all check-in dates computed in Asia/Kuala_Lumpur so "today" matches
  what the member sees, server- and client-side.

---

## 11. Files touched (anticipated)

New:
- `supabase/migrations/<ts>_rewards.sql` — enum, three tables, RLS, cache trigger,
  `apply_order_rewards`, `reverse_order_rewards`, grants.
- `lib/rewards/server.ts` (or similar) — server helpers to fetch a member's rewards
  snapshot and to invoke the functions from the actions.
- `lib/rewards/realtime.ts` (or inline) — client subscribe helper for the member's
  `reward_accounts` row.

Changed:
- `app/(customer)/checkout/actions.ts` — call `apply_order_rewards`; return the
  rewards payload.
- `app/(admin)/manage/actions.ts` — call `reverse_order_rewards` on cancel.
- `components/checkout-screen.tsx` — drop client ledger writes; use returned payload.
- `store/beans.tsx`, `hooks/use-streak.ts` — become server-backed readers.
- `app/(customer)/rewards/page.tsx`, `app/(customer)/rewards/activity/page.tsx`,
  `app/(customer)/profile/page.tsx` — server-fetch and pass rewards data.
- `components/rewards-screen.tsx`, `components/rewards-activity.tsx`,
  `components/profile-screen.tsx` — read live values; tier from lifetime-earned;
  remove dev streak controls.
- `data/rewards.ts` — keep config; remove the mock per-user snapshot
  (`rewardsSummary` beans/activity/streak) once nothing reads it.
- `types/reward.ts`, `types/database.ts` — align/regenerate.
- Order-line schema touch for redemption persistence (§8), finalized in the plan.

Removed:
- localStorage-backed Beans + streak state, the dev streak offset, and the mock
  starting balance.

---

## 12. Testing

- **New member:** signs in → 0 Beans, Fresh tier, empty activity, 0-day streak.
- **Earn on placement (member):** place an order → `earn` row inserted, `balance`
  and `lifetime_earned` rise by `floor(RM)×10`, today's check-in recorded, streak
  increments, confirmation shows earned Beans (+ any milestone bonus). Guest order →
  no rewards rows.
- **Tier from lifetime:** earn past a threshold → tier climbs; redeem a free drink →
  balance drops but **tier holds** (lifetime-earned unchanged).
- **Redeem:** add a reward to cart, place → `redeem` row, balance drops by the cost,
  free drink on the order. Spend more than the live balance (second tab) → placement
  fails server-side with the clear error.
- **Cancel reversal:** staff cancel an earning order → Beans clawed back, redeemed
  Beans refunded; check-in removed only if it was the sole order that day.
- **Streak rules:** consecutive days increment; a skipped day breaks to 0;
  milestone days (week-position 3, completed week, every 30) grant bonuses — matching
  the pre-existing `lib/streak.ts` / `getStreakAwards` behaviour.
- **Realtime:** with the rewards screen open, placing an order updates the balance
  live without refresh.
- **RLS:** a member cannot read another member's `reward_accounts` /
  `bean_transactions` / `streak_checkins`; no client can insert/update them directly;
  staff can read any.
- **Idempotency:** re-invoking `apply_order_rewards` for the same order does not
  double-credit.
- `npm run lint` / typecheck clean; `types/database.ts` regenerated.

---

## 13. Open items for the plan

- Exact representation of redeemed rewards on the order (nullable columns on the
  reward `order_items` line vs. a small `order_redemptions` table) — §8.
- How the SQL functions source the earn rate + milestone map without drifting from
  `data/rewards.ts` (SQL constants seeded from the same numbers vs. a tiny config
  table) — §7. This is the seam the CMS phase later replaces.
- Reversal double-guard mechanism (per-order/category sum vs. a `reversed_at` marker).
- Whether the rewards screens wrap a server component in a thin realtime subscriber
  or refetch via `router.refresh()` on the realtime event (mirror the orders choice).
- Confirm the welcome/first-run path creates the `reward_accounts` row lazily on
  first earn (no separate signup trigger needed).
