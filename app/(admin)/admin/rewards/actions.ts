"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";
import { REWARDS_CONFIG_TAG } from "@/lib/rewards/config-store";

export type ActionResult = { ok: true } | { ok: false; error: string };

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Revalidate the CMS page and every storefront surface that reads rewards config.
function revalidateAll() {
  revalidatePath("/admin/rewards");
  revalidatePath("/rewards");
  revalidatePath("/rewards/catalog");
  revalidatePath("/profile");
  revalidatePath("/menu/[slug]", "page");
  revalidateTag(REWARDS_CONFIG_TAG, "max");
}

// One desired-state payload for the whole Rewards CMS page. The client holds a
// working copy of every section and commits it here in a single Save, so the
// page needs exactly one floating action bar instead of a button per row.
export type RewardsConfigInput = {
  settings: {
    beansPerRinggit: number;
    referralBeans: number;
    referralVoucherLabel: string;
  };
  tiers: {
    id?: string;
    name: string;
    threshold: number;
    perk: string;
    isArchived: boolean;
  }[];
  milestones: {
    id?: string;
    label: string;
    displayLabel: string;
    beans: number;
    triggerDay: number;
    repeatEveryDays: number | null;
    isActive: boolean;
    deleted?: boolean;
  }[];
  rewards: {
    id?: string;
    name: string;
    cost: number;
    productId: string;
    imageUrl: string | null;
    isActive: boolean;
    isArchived: boolean;
  }[];
};

export async function saveRewardsConfig(input: RewardsConfigInput): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };

  // Validate everything up front so a bad row never leaves a half-applied page.
  const s = input.settings;
  if (!Number.isInteger(s.beansPerRinggit) || s.beansPerRinggit < 1) {
    return { ok: false, error: "Beans per RM must be a whole number of at least 1." };
  }
  if (!Number.isInteger(s.referralBeans) || s.referralBeans < 0) {
    return { ok: false, error: "Referral beans must be a whole number of 0 or more." };
  }
  if (!s.referralVoucherLabel.trim()) return { ok: false, error: "Voucher label is required." };

  for (const t of input.tiers) {
    const label = t.name.trim() || "Untitled tier";
    if (!t.name.trim()) return { ok: false, error: "Every tier needs a name." };
    if (!Number.isInteger(t.threshold) || t.threshold < 0) {
      return { ok: false, error: `Tier "${label}": threshold must be a whole number of 0 or more.` };
    }
  }

  for (const m of input.milestones) {
    if (m.deleted) continue;
    const label = m.label.trim() || "Untitled milestone";
    if (!m.label.trim()) return { ok: false, error: "Every milestone needs a ledger label." };
    if (!m.displayLabel.trim()) return { ok: false, error: `Milestone "${label}": card label is required.` };
    if (!Number.isInteger(m.beans) || m.beans < 1) {
      return { ok: false, error: `Milestone "${label}": beans must be a whole number of at least 1.` };
    }
    if (!Number.isInteger(m.triggerDay) || m.triggerDay < 1) {
      return { ok: false, error: `Milestone "${label}": trigger day must be a whole number of at least 1.` };
    }
    if (m.repeatEveryDays !== null && (!Number.isInteger(m.repeatEveryDays) || m.repeatEveryDays < 1)) {
      return { ok: false, error: `Milestone "${label}": repeat must be empty or a whole number of at least 1.` };
    }
  }

  for (const r of input.rewards) {
    const label = r.name.trim() || "Untitled reward";
    if (!r.name.trim()) return { ok: false, error: "Every reward needs a name." };
    if (!Number.isInteger(r.cost) || r.cost < 1) {
      return { ok: false, error: `Reward "${label}": cost must be a whole number of at least 1 Bean.` };
    }
    if (!r.productId) return { ok: false, error: `Reward "${label}": pick the free drink it grants.` };
  }

  const db = await createClient();

  // Settings — upsert (not update) so a missing row is created rather than the
  // write silently no-op'ing on zero matched rows.
  {
    const { error } = await db.from("loyalty_settings").upsert({
      id: true,
      beans_per_ringgit: s.beansPerRinggit,
      referral_beans: s.referralBeans,
      referral_voucher_label: s.referralVoucherLabel.trim(),
    });
    if (error) return { ok: false, error: error.message };
  }

  // Tiers — archive-only model (no hard delete).
  for (const t of input.tiers) {
    const name = t.name.trim();
    if (t.id) {
      const { error } = await db
        .from("reward_tiers")
        .update({ name, threshold: t.threshold, perk: t.perk.trim(), is_archived: t.isArchived })
        .eq("id", t.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await db.from("reward_tiers").insert({
        slug: slugify(name), name, threshold: t.threshold, perk: t.perk.trim(),
        sort_order: t.threshold, is_archived: t.isArchived,
      });
      if (error) {
        return { ok: false, error: error.code === "23505" ? `That tier ("${name}") already exists.` : error.message };
      }
    }
  }

  // Milestones — support hard delete (history snapshots the label, so it is safe).
  for (const m of input.milestones) {
    if (m.deleted) {
      if (m.id) {
        const { error } = await db.from("streak_milestones").delete().eq("id", m.id);
        if (error) return { ok: false, error: error.message };
      }
      continue;
    }
    const payload = {
      label: m.label.trim(),
      display_label: m.displayLabel.trim(),
      beans: m.beans,
      trigger_day: m.triggerDay,
      repeat_every_days: m.repeatEveryDays,
      is_active: m.isActive,
    };
    if (m.id) {
      const { error } = await db.from("streak_milestones").update(payload).eq("id", m.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await db.from("streak_milestones").insert({ ...payload, sort_order: m.triggerDay });
      if (error) return { ok: false, error: error.message };
    }
  }

  // Reward catalog — archive-only model (no hard delete).
  for (const r of input.rewards) {
    const name = r.name.trim();
    const payload = {
      name, cost: r.cost, product_id: r.productId, image_url: r.imageUrl,
      is_active: r.isActive, is_archived: r.isArchived,
    };
    if (r.id) {
      const { error } = await db.from("reward_catalog").update(payload).eq("id", r.id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await db.from("reward_catalog").insert({ ...payload, slug: slugify(name) });
      if (error) {
        return { ok: false, error: error.code === "23505" ? `That reward slug ("${name}") is already used.` : error.message };
      }
    }
  }

  revalidateAll();
  return { ok: true };
}
