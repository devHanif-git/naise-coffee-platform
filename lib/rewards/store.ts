import { createClient } from "@/lib/supabase/server";
import type { OrderRewardsResult } from "@/types/reward";

// Shape returned by the apply_order_rewards SQL function (snake_case JSON).
type ApplyRewardsRow = {
  earned: number;
  redeemed_cost: number;
  streak_days: number;
  bonuses: { label: string; beans: number }[];
};

export type ApplyRewardsResult =
  | { ok: true; rewards: OrderRewardsResult }
  | { ok: false; insufficient: boolean };

// Settle an order's rewards: earn Beans, deduct redeemed reward costs, record the
// streak check-in, grant milestone bonuses. Members only — the SQL function
// no-ops for guest orders (returns null) and is idempotent per order. Called by
// placeOrder under the member's cookie-scoped session.
export async function applyOrderRewards(
  token: string,
): Promise<ApplyRewardsResult> {
  const db = await createClient();
  const { data, error } = await db.rpc("apply_order_rewards", {
    p_token: token,
  });
  if (error) {
    return { ok: false, insufficient: error.message.includes("INSUFFICIENT_BEANS") };
  }
  if (!data) {
    // Guest/unknown/already-applied: treat as a no-op success with zero rewards.
    return {
      ok: true,
      rewards: { earned: 0, redeemedCost: 0, streakDays: 0, bonuses: [] },
    };
  }
  const row = data as ApplyRewardsRow;
  return {
    ok: true,
    rewards: {
      earned: row.earned,
      redeemedCost: row.redeemed_cost,
      streakDays: row.streak_days,
      bonuses: row.bonuses ?? [],
    },
  };
}

// Reverse a cancelled order's rewards (offsetting ledger rows; remove the day's
// check-in if it was the sole order that day). Self-guards for guests and
// double-cancels. Called by the staff cancel action.
export async function reverseOrderRewards(token: string): Promise<void> {
  const db = await createClient();
  await db.rpc("reverse_order_rewards", { p_token: token });
}
