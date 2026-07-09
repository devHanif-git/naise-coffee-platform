# Loyalty Stamp Card + Voucher System — Design

**Date:** 2026-07-08
**Status:** Approved for planning
**Surfaces touched:** customer `/rewards` + checkout, kiosk `/store`, staff `/manage`, admin `/admin/promotions`, Supabase schema + RPCs.

## Summary

Add an in-app **stamp card** loyalty program, separate from the existing streak
program. A member earns **one stamp per completed order (per receipt)** — no
daily cap. The card holds **8 stamps**; reaching **4** issues an **RM5-off
voucher** and reaching **8** issues a **free-drink voucher**, after which the
card **resets** to 0 and the cycle count increments. Vouchers are a new
subsystem, applied at checkout with an admin-controlled minimum spend.

A stamp only ever lands on a **completed order that has a member attached**. This
single rule ("no order / no member = no stamp") makes the program
screenshot-proof without any rotating QR: a member's QR is a *static identity*,
not a secret, because scanning it alone grants nothing.

## Goals

- One stamp per completed order, tied to that order, idempotent, no daily cap.
  The order must include at least one paid drink — an order that is only a
  redeemed free drink earns no stamp.
- Automatic grant for online orders (member already attached).
- In-store grant: staff attaches a member to the order (scan member QR **or**
  key in phone or email), then completes the order.
- New users must register to have a member QR — this is the acquisition
  sell-point ("Register now to get your stamp!").
- Milestone vouchers at 4 (RM-off) and 8 (free drink); reset at 8.
- The whole program is CMS-controlled: an admin enable/disable master switch plus
  editable card/voucher config.
- A new voucher system: fixed-amount RM-off with admin-set minimum spend, and a
  free-drink voucher; both expire after N days.
- A satisfying stamp animation and milestone celebration on the customer card.

## Non-Goals

- Rotating / daily-regenerated QR codes (unnecessary given the order-completion
  gate; explicitly dropped).
- Changing the existing streak program (consecutive-day ordering, 30-day free
  drink). It stays exactly as-is and is independent of stamps.
- Percent-off promotions (the existing `promotions` table) — untouched.
- A standalone scan-to-stamp path decoupled from orders (rejected: violates the
  "no order = no stamp" rule).
- Per-receipt one-time printed codes (rejected in favour of staff-scans-member).

## Terminology

- **Stamp** — one mark earned per completed order. Distinct from a streak
  check-in.
- **Stamp card** — the 8-slot card; resets each time it fills.
- **Cycle** — how many full cards the member has completed ("Card #3").
- **Voucher** — a redeemable discount issued at a milestone.
- **Member QR** — a static, per-user code in the customer app encoding the
  member's identity token. Not a secret.

## Existing Patterns This Reuses

The rewards system already establishes the shape we follow:

- **Cached aggregate + append-only ledger:** `reward_accounts` (cache) +
  `bean_transactions` (ledger) with a trigger maintaining the cache.
- **Server-authoritative writes:** all mutations go through SECURITY DEFINER
  functions (`search_path = ''`, granted to `authenticated`, revoked from
  `public`/`anon`). Clients only `SELECT` (own rows or staff).
- **Order-lifecycle hooks:** `apply_order_rewards(token)` at checkout placement
  and `reverse_order_rewards(token)` at cancel (wired in
  `app/(customer)/checkout/actions.ts` and `app/(admin)/manage/actions.ts`).
- **Idempotency by order:** reward RPCs bail if the order already has ledger
  rows.
- **Config as a settings row + cached read:** `loyalty_settings` read via
  `unstable_cache` under `REWARDS_CONFIG_TAG`, invalidated by admin actions.
- **Realtime on the member's own row:** `reward_accounts` is in
  `supabase_realtime` with `replica identity full` for live balance updates.
- **Money as integer sen.**

The stamp/voucher system mirrors every one of these.

## Data Model

All money is integer **sen**. All tables have RLS: **read own rows or
staff/manager/admin; no client writes** (writes only via SECURITY DEFINER RPCs).

### `stamp_cards` — cached per-member state (mirrors `reward_accounts`)

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK → auth.users (on delete cascade) | one row per member |
| `current_count` | integer not null default 0 | 0..card_size |
| `cycle` | integer not null default 0 | full cards completed |
| `total_stamps` | integer not null default 0 | lifetime |
| `created_at` / `updated_at` | timestamptz | `set_updated_at` trigger |

Source of truth is `stamp_transactions`; this is the cheap-read cache and is
always recomputable. In `supabase_realtime` with `replica identity full` so the
customer card updates live.

### `stamp_transactions` — append-only ledger (mirrors `bean_transactions`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `user_id` | uuid not null → auth.users | |
| `order_id` | uuid not null → orders | the order that earned it (see note below) |
| `amount` | integer not null | +1 normal, -1 reversal |
| `is_reversal` | boolean not null default false | |
| `created_at` | timestamptz not null default now() | |

- **`create unique index stamp_transactions_order_once on stamp_transactions
  (order_id) where is_reversal = false;`** → one stamp per order (per receipt),
  idempotent grant. No daily cap by design.
- Index `(user_id, created_at desc)` and `(order_id)`.
- Note: `order_id` stays NOT NULL and references `orders`; reversal rows keep the
  same `order_id`. (Do not `set null` on delete — orders are cancelled, not
  hard-deleted, in this app.)

### `vouchers` — issued milestone rewards (new subsystem)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `user_id` | uuid not null → auth.users | owner |
| `type` | enum `voucher_type` (`rm_off`, `free_drink`) | |
| `status` | enum `voucher_status` (`active`, `redeemed`, `expired`) default `active` | |
| `discount_amount` | integer not null | sen; snapshot at issue (rm_off) |
| `min_spend` | integer not null default 0 | sen; snapshot at issue |
| `free_drink_max_value` | integer not null default 0 | sen; snapshot at issue (free_drink) |
| `expires_at` | timestamptz not null | issue time + expiry_days |
| `source_order_id` | uuid → orders | the stamp/order that earned it |
| `redeemed_order_id` | uuid → orders | set on redemption |
| `created_at` / `updated_at` | timestamptz | |

- Snapshots `discount_amount` / `min_spend` / `free_drink_max_value` /
  `expires_at` at **issue time** so later admin config changes never
  retroactively alter an issued voucher.
- Indexes: `(user_id, status)`, `(source_order_id)`.

### `stamp_settings` — single admin-editable config row (mirrors `loyalty_settings`)

| Column | Type | Default | Meaning |
|---|---|---|---|
| `id` | uuid PK / singleton | | |
| `is_enabled` | boolean not null | true | master on/off for the whole program |
| `card_size` | integer | 8 | slots per card |
| `milestone_small` | integer | 4 | position of the RM-off milestone |
| `rm_off_amount` | integer | 500 | RM5 in sen |
| `rm_off_min_spend` | integer | 1100 | RM11 in sen (admin-controllable) |
| `free_drink_max_value` | integer | 1200 | RM12 cap for the free drink |
| `voucher_expiry_days` | integer | 30 | voucher lifetime |
| `updated_at` | timestamptz | | |

Read via `unstable_cache` under a new config tag (or the existing
`REWARDS_CONFIG_TAG`), invalidated by the admin action. Vouchers read these at
**issue time only**.

## Backend Logic (SECURITY DEFINER RPCs)

All: `language plpgsql`, `security definer`, `set search_path = ''`, granted to
`authenticated`, revoked from `public`/`anon`, idempotent — same discipline as
`apply_order_rewards`.

### `grant_order_stamp(p_token uuid) returns jsonb`

Called immediately after an order transitions to `completed`.

0. Read `stamp_settings.is_enabled`. If the program is off → **return null** (no
   stamps granted while disabled).
1. Load order by token → resolve `user_id`. If order not found or `user_id` is
   null → **return null** (no member / guest = no stamp).
2. Idempotency: if a non-reversal `stamp_transactions` row exists for
   `order_id`, return null (the unique index also backs this).
3. **Qualifying check:** the order must contain at least one **paid**
   (non-free) line. An order whose only line is a redeemed free-drink voucher (or
   otherwise fully free) does **not** earn a stamp — return null. It qualifies
   only if it also includes at least one other paid drink. (Check: exists an
   `order_items` row not made free by a voucher/reward — e.g. `is_reward = false`
   and effective line price > 0.)
4. Insert `+1` stamp row. Trigger updates `stamp_cards` cache
   (`current_count + 1`, `total_stamps + 1`).
5. Read `stamp_settings`. Milestone check on the **new** `current_count`:
   - `= milestone_small` (4) → issue an `rm_off` voucher, snapshotting
     `rm_off_amount`, `rm_off_min_spend`, and `now() + voucher_expiry_days`.
   - `= card_size` (8) → issue a `free_drink` voucher (snapshot
     `free_drink_max_value` + expiry), then **reset** `current_count` to 0 and
     `cycle + 1`.
6. Return `{ stamped: true, count, cycle, vouchers_issued: [{type, ...}] }` for
   the confirmation UI.

### `reverse_order_stamp(p_token uuid) returns void`

Called on order cancel (wired into the `/manage` cancel action next to
`reverse_order_rewards`).

1. Load order → `user_id`. Bail if null, already reversed, or no stamp to
   reverse.
2. Insert offsetting `-1` row; decrement `stamp_cards` cache.
   - If the reversed stamp had crossed a reset boundary, recompute
     `current_count`/`cycle` from the ledger to stay consistent.
3. For any voucher with `source_order_id = this order` that is still `active`:
   set `status = 'expired'` (revoked). If it was already `redeemed`, **leave it**
   and record a staff-visible note (can't claw back a used voucher).

### `attach_order_member(p_token uuid, p_identifier text) returns jsonb`

Staff-only (`current_user_role() in ('staff','manager','admin')`).

1. Resolve a member from `p_identifier`: member-QR token (the member's
   `user_id`), `profiles.phone`, or `auth.users.email` (try in that order; exact
   match). Note: the schema has **no username** column — email lookup works
   because this RPC is SECURITY DEFINER and can read `auth.users`.
2. Guard: refuse if no match, ambiguous match, or the order already has a
   *different* `user_id`. Attaching to an **already-completed** order is allowed
   (customer forgot at the counter).
3. Set `orders.user_id` (and mirror `owner_id` per existing convention).
4. **If the order is already `completed`, call `grant_order_stamp` now** so the
   stamp is granted retroactively. (The idempotency + qualifying checks still
   apply.) If the order is not yet completed, the stamp lands at completion as
   usual.
5. Return **minimal** identity only: `{ display_name, avatar_url,
   phone_masked }`. **Never** return full email or raw phone (PII minimization).

### `redeem_voucher(p_voucher_id uuid, p_order_token uuid) returns jsonb`

Called at checkout when the member applies a voucher.

1. Validate: voucher belongs to caller, `status = 'active'`, not past
   `expires_at`, order meets `min_spend`.
2. Apply discount:
   - `rm_off`: subtract `discount_amount` from the order total, floored at 0
     (no cash back if order < discount).
   - `free_drink`: subtract up to `free_drink_max_value` (RM12 cap) from the
     chosen drink. If the drink costs more, the **customer pays the excess**
     (RM13 drink − RM12 = RM1 due). The order must also contain at least one
     other paid drink to qualify for a stamp (see `grant_order_stamp` step 3).
3. One voucher per order. Mark `redeemed`, set `redeemed_order_id`. Status check
   inside the RPC closes the double-redeem race.

### Expiry

Active vouchers past `expires_at` are marked `expired` by either a scheduled job
or a lazy check-on-read (both acceptable; lazy check is simplest to start).

## Grant Flows (trigger points)

Principle: **a stamp is granted once the order is both `completed` and has a
member attached — in whichever order those two happen.** Attach-then-complete
grants at completion; complete-then-attach grants retroactively at attach time
(customer forgot at the counter). The `unique(order_id)` guard ensures exactly
one stamp either way.

**Path 1 — Online order (member logged in).** Order already scoped to `user_id`.
Staff marks `completed` on `/manage` → completion handler calls
`grant_order_stamp`. Stamp + any voucher land automatically; customer sees it
live via realtime. No new staff action.

**Path 2 — Kiosk order (`/store`).** Guest by default. Add an optional "Add
member" step in kiosk checkout: enter phone or email → `attach_order_member`
→ confirm the returned display name. Order now has `user_id` → completion grants
the stamp. Skipped → guest order, no stamp (acceptable).

**Path 3 — Walk-in / cash sale.** Staff opens the member-attach action on
`/manage`: **scan the member QR** (browser camera) or key in
phone or email. Attach to the order, then complete → stamp lands. New
customer → registers in the app (gains a member QR), then staff attaches.

**Member QR.** Static, per-user, shown in the customer app (`/rewards` or
profile, "Show my code"). Encodes the member identity token — not a secret.
Never reprinted, never rotated.

**Staff scan surface.** A scanner on `/manage` (staff already work there). Uses
the browser camera API — no new hardware beyond a staff phone/tablet.

## Customer UI

**Stamp card** on `/rewards`, a distinct card from the streak card:
- 8-slot grid; filled slots show a stamped bean/logo mark, empty slots are
  outlines. Slots 4 and 8 carry a small reward badge.
- Header: `current_count / 8` and cycle ("Card #3").
- **Stamp animation:** on a realtime `stamp_cards` update, the newest slot
  animates a "press" (scale + settle + subtle ink splash). At a milestone (4 or
  8), a celebratory flourish + toast ("Reward unlocked: RM5 off!"). Keyframes in
  `globals.css` (per style rules — not inline). Honors
  `prefers-reduced-motion` with a plain fade fallback.

**Vouchers** in a "My Rewards" section on `/rewards`:
- Active vouchers show type, value, min-spend, expiry countdown. Redeemed/expired
  shown dimmed in history.
- At checkout, an "Apply voucher" control lists eligible active vouchers (those
  meeting the current cart's min-spend); selecting one calls `redeem_voucher`
  and shows the discounted total. Example: min RM11, RM5 off → an RM11 drink
  becomes RM6.

**New-user entry (sell-point).** A not-logged-in visitor hitting a stamp link
sees "Register now to get your stamp!" → registers → lands on an empty stamp card
with their member QR ready.

## Admin UI (`/admin/promotions`)

The whole program is **CMS-controlled**. A "Stamp Card & Vouchers" settings
panel edits the `stamp_settings` row:

- **Enable / disable toggle** (`is_enabled`) — the master switch. When off:
  `grant_order_stamp` grants nothing (step 0), and the customer stamp card + QR
  entry points are hidden on the storefront. Existing vouchers already issued
  stay valid and redeemable (disabling stops *new* stamps, it doesn't confiscate
  earned rewards).
- **Numeric config** — card size, milestone position, RM-off amount, min-spend,
  free-drink max value, expiry days.

Save → admin action guarded by `current_user_role() = 'admin'` → `revalidateTag`
invalidates the cached config. Config changes apply to **future** voucher issues
only (issued vouchers keep their snapshot).

**Customer view (admin):** the existing customer detail page shows a read-only
stamp count, current cycle, and the customer's active vouchers, so staff/admin
can answer "how many stamps do I have?" and see issued rewards.

The existing percent-off `promotions` table is **not** overloaded — the voucher
config lives in its own `stamp_settings` row surfaced on the same admin page.

**Gating everywhere:** every surface reads `is_enabled` before showing stamp UI
or calling stamp RPCs — customer `/rewards` card, checkout voucher control,
kiosk "Add member" step, and the `/manage` scan action. The server RPCs are the
authoritative gate (`grant_order_stamp` step 0); the UI checks are for hiding
controls, not security.

## Error Handling

- Attach: no match / ambiguous → "No member found for that phone or email",
  retry; order stays guest. Order already has a different member → refused with a
  clear message.
- Grant on completion is **best-effort** (like Beans): if `grant_order_stamp`
  throws, the order still completes (loyalty never blocks fulfillment); the
  failure is logged and the `unique(order_id)` guard makes a later retry safe
  (no double-stamp).
- `redeem_voucher`: expired / ineligible / min-spend not met → clear checkout
  message, voucher untouched. Double-redeem race closed by the in-RPC status
  check.
- Cancel after a milestone voucher was already **redeemed** → no claw-back;
  surface a staff note.

## Testing

**SQL / RPC:**
- Double-grant on the same order → exactly one stamp.
- Reaching 4 → issues an `rm_off` voucher with snapshot values.
- Reaching 8 → issues a `free_drink` voucher, resets `current_count` to 0,
  increments `cycle`.
- **Disabled program:** with `is_enabled = false`, `grant_order_stamp` grants no
  stamp; already-issued vouchers stay redeemable.
- **Qualifying check:** an order whose only line is a free drink → no stamp; the
  same order plus one paid drink → one stamp.
- `reverse_order_stamp` → decrements cache and revokes an unredeemed
  source voucher; leaves a redeemed one and notes it.
- `attach_order_member` → role-gated; returns only minimal identity (no email /
  raw phone); refuses a conflicting (different-member) order. Attaching to an
  **already-completed** order retroactively grants the stamp (once, via the
  idempotency guard).
- `redeem_voucher` → enforces min-spend, expiry, one-per-order; free-drink cap
  bills the excess (RM13 − RM12 = RM1); double-redeem race yields a single
  redemption.

**App:**
- Attach flow (scan + manual) on `/manage` and `/store`.
- Voucher apply math at checkout (RM11 − RM5 = RM6; floor at 0; free-drink cap).
- New-user register → stamp-card landing.

**UI:**
- Stamp animation triggers on realtime update; milestone flourish/toast fires at
  4 and 8; `prefers-reduced-motion` fallback.

## Open Defaults (tweakable)

- `voucher_expiry_days` = 30
- `rm_off_amount` = RM5 (500 sen), `rm_off_min_spend` = RM11 (1100 sen)
- `free_drink_max_value` = RM12 (1200 sen)
- `card_size` = 8, `milestone_small` = 4
