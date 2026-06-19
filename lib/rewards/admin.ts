import { createClient } from "@/lib/supabase/server";
import type {
  AdminLoyaltySettings,
  AdminMilestone,
  AdminRewardItem,
  AdminTier,
} from "@/lib/rewards/types";

// All reads run under the caller's RLS; the admin SELECT policies return archived
// /inactive rows too. Callers gate with isAdmin before rendering.

export async function getAdminLoyaltySettings(): Promise<AdminLoyaltySettings> {
  const db = await createClient();
  const { data } = await db.from("loyalty_settings").select("*").limit(1).maybeSingle();
  return {
    beansPerRinggit: data?.beans_per_ringgit ?? 10,
    referralBeans: data?.referral_beans ?? 200,
    referralVoucherLabel: data?.referral_voucher_label ?? "RM5 Voucher",
  };
}

export async function listAdminTiers(): Promise<AdminTier[]> {
  const db = await createClient();
  const { data } = await db.from("reward_tiers").select("*").order("threshold");
  return (data ?? []).map((t) => ({
    id: t.id, slug: t.slug, name: t.name, threshold: t.threshold, perk: t.perk,
    sortOrder: t.sort_order, isArchived: t.is_archived,
  }));
}

export async function listAdminMilestones(): Promise<AdminMilestone[]> {
  const db = await createClient();
  const { data } = await db.from("streak_milestones").select("*").order("sort_order").order("trigger_day");
  return (data ?? []).map((m) => ({
    id: m.id, label: m.label, displayLabel: m.display_label, beans: m.beans,
    triggerDay: m.trigger_day, repeatEveryDays: m.repeat_every_days,
    sortOrder: m.sort_order, isActive: m.is_active,
  }));
}

export async function listAdminRewardCatalog(): Promise<AdminRewardItem[]> {
  const db = await createClient();
  const [rewards, products] = await Promise.all([
    db.from("reward_catalog").select("*").order("sort_order"),
    db.from("products").select("id, name"),
  ]);
  const name = new Map((products.data ?? []).map((p) => [p.id, p.name]));
  return (rewards.data ?? []).map((r) => ({
    id: r.id, slug: r.slug, name: r.name, cost: r.cost, productId: r.product_id,
    productName: name.get(r.product_id) ?? "(unknown product)",
    imageUrl: r.image_url, isActive: r.is_active, isArchived: r.is_archived,
    sortOrder: r.sort_order,
  }));
}
