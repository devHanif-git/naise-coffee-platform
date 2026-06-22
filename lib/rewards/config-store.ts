import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { images } from "@/constants/images";
import type { Reward, RewardTier, StreakMilestone } from "@/types/reward";

export type LoyaltySettings = {
  beansPerRinggit: number;
  referralBeans: number;
  referralVoucherLabel: string;
};

// Shared (non per-user) rewards configuration: loyalty settings, tiers, streak
// milestones, and the redeemable catalog. Admin-managed and identical for every
// user, so it's cached across requests under this tag and invalidated by the
// rewards admin actions via revalidateTag(REWARDS_CONFIG_TAG). NEVER cache
// per-user reward data (balances, redemptions) this way — that lives elsewhere
// and must stay request-scoped.
export const REWARDS_CONFIG_TAG = "rewards-config";

// All reads use the cookie-free public client (anon role) so they can live in
// the Data Cache; RLS grants anon SELECT on these tables, scoped to the same
// active/non-archived rows the storefront shows.

// The single config row, with safe defaults if it's somehow missing.
export const getLoyaltySettings = cache(
  unstable_cache(
    async (): Promise<LoyaltySettings> => {
      const db = createPublicClient();
      const { data } = await db.from("loyalty_settings").select("*").limit(1).maybeSingle();
      return {
        beansPerRinggit: data?.beans_per_ringgit ?? 10,
        referralBeans: data?.referral_beans ?? 200,
        referralVoucherLabel: data?.referral_voucher_label ?? "RM5 Voucher",
      };
    },
    ["loyalty-settings"],
    { tags: [REWARDS_CONFIG_TAG], revalidate: 60 },
  ),
);

// Public, non-archived tiers ascending by threshold. RLS hides archived rows
// from non-admins; the filter here is belt-and-suspenders.
export const listTiers = cache(
  unstable_cache(
    async (): Promise<RewardTier[]> => {
      const db = createPublicClient();
      const { data } = await db.from("reward_tiers").select("*").order("threshold");
      return (data ?? [])
        .filter((t) => !t.is_archived)
        .map((t) => ({ id: t.slug, name: t.name, threshold: t.threshold, perk: t.perk }));
    },
    ["reward-tiers"],
    { tags: [REWARDS_CONFIG_TAG], revalidate: 60 },
  ),
);

// Active milestones for the stamp card. `reward` is the card display text; the
// ledger label lives in `label` and is only used by apply_order_rewards.
export const listStreakMilestones = cache(
  unstable_cache(
    async (): Promise<StreakMilestone[]> => {
      const db = createPublicClient();
      const { data } = await db.from("streak_milestones").select("*").order("trigger_day");
      return (data ?? [])
        .filter((m) => m.is_active)
        .map((m) => ({ days: m.trigger_day, reward: m.display_label, beans: m.beans }));
    },
    ["streak-milestones"],
    { tags: [REWARDS_CONFIG_TAG], revalidate: 60 },
  ),
);

// Active, non-archived redeemable rewards, joined to their product for the slug
// (redeem link) and an image fallback. Rewards whose product is hidden/archived
// are dropped. Mirrors data/rewards.ts shapes: id = catalog slug.
export const listRewardCatalog = cache(
  unstable_cache(
    async (): Promise<Reward[]> => {
      const db = createPublicClient();
      const { data: rows } = await db.from("reward_catalog").select("*").order("sort_order");
      const active = (rows ?? []).filter((r) => r.is_active && !r.is_archived);
      if (active.length === 0) return [];
      const { data: prods } = await db
        .from("products")
        .select("id, slug, image_url")
        .in("id", active.map((r) => r.product_id));
      const byId = new Map((prods ?? []).map((p) => [p.id, p]));
      return active.flatMap((r) => {
        const p = byId.get(r.product_id);
        if (!p) return [];
        return [
          {
            id: r.slug,
            name: r.name,
            cost: r.cost,
            image: r.image_url ?? p.image_url ?? images.coffeeWithLogo,
            productSlug: p.slug,
          },
        ];
      });
    },
    ["reward-catalog"],
    { tags: [REWARDS_CONFIG_TAG], revalidate: 60 },
  ),
);
