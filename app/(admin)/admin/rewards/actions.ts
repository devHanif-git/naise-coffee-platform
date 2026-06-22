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

export async function updateLoyaltySettings(input: {
  beansPerRinggit: number;
  referralBeans: number;
  referralVoucherLabel: string;
}): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  if (!Number.isInteger(input.beansPerRinggit) || input.beansPerRinggit < 1) {
    return { ok: false, error: "Beans per RM must be a whole number of at least 1." };
  }
  if (!Number.isInteger(input.referralBeans) || input.referralBeans < 0) {
    return { ok: false, error: "Referral beans must be a whole number of 0 or more." };
  }
  if (!input.referralVoucherLabel.trim()) return { ok: false, error: "Voucher label is required." };
  const db = await createClient();
  // upsert (not update) so a missing settings row is created rather than the
  // write silently no-op'ing on zero matched rows.
  const { error } = await db
    .from("loyalty_settings")
    .upsert({
      id: true,
      beans_per_ringgit: input.beansPerRinggit,
      referral_beans: input.referralBeans,
      referral_voucher_label: input.referralVoucherLabel.trim(),
    });
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function saveTier(input: {
  id?: string;
  name: string;
  threshold: number;
  perk: string;
}): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!Number.isInteger(input.threshold) || input.threshold < 0) {
    return { ok: false, error: "Threshold must be a whole number of 0 or more." };
  }
  const db = await createClient();
  if (input.id) {
    const { error } = await db
      .from("reward_tiers")
      .update({ name, threshold: input.threshold, perk: input.perk.trim() })
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from("reward_tiers").insert({
      slug: slugify(name), name, threshold: input.threshold, perk: input.perk.trim(),
      sort_order: input.threshold,
    });
    if (error) return { ok: false, error: error.code === "23505" ? "That tier already exists." : error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function setTierArchived(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("reward_tiers").update({ is_archived: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function saveMilestone(input: {
  id?: string;
  label: string;
  displayLabel: string;
  beans: number;
  triggerDay: number;
  repeatEveryDays: number | null;
}): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  if (!input.label.trim()) return { ok: false, error: "Ledger label is required." };
  if (!input.displayLabel.trim()) return { ok: false, error: "Card label is required." };
  if (!Number.isInteger(input.beans) || input.beans < 1) {
    return { ok: false, error: "Beans must be a whole number of at least 1." };
  }
  if (!Number.isInteger(input.triggerDay) || input.triggerDay < 1) {
    return { ok: false, error: "Trigger day must be a whole number of at least 1." };
  }
  if (input.repeatEveryDays !== null && (!Number.isInteger(input.repeatEveryDays) || input.repeatEveryDays < 1)) {
    return { ok: false, error: "Repeat must be empty or a whole number of at least 1." };
  }
  const db = await createClient();
  const payload = {
    label: input.label.trim(),
    display_label: input.displayLabel.trim(),
    beans: input.beans,
    trigger_day: input.triggerDay,
    repeat_every_days: input.repeatEveryDays,
  };
  if (input.id) {
    const { error } = await db.from("streak_milestones").update(payload).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from("streak_milestones").insert({ ...payload, sort_order: input.triggerDay });
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function setMilestoneActive(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("streak_milestones").update({ is_active: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// Milestones carry no FK from history (bonuses snapshot the label into
// bean_transactions), so a hard delete is safe.
export async function deleteMilestone(id: string): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("streak_milestones").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function saveRewardItem(input: {
  id?: string;
  name: string;
  cost: number;
  productId: string;
  imageUrl: string | null;
}): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!Number.isInteger(input.cost) || input.cost < 1) {
    return { ok: false, error: "Cost must be a whole number of at least 1 Bean." };
  }
  if (!input.productId) return { ok: false, error: "Pick the free drink this reward grants." };
  const db = await createClient();
  const payload = {
    name, cost: input.cost, product_id: input.productId, image_url: input.imageUrl,
  };
  if (input.id) {
    const { error } = await db.from("reward_catalog").update(payload).eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from("reward_catalog").insert({ ...payload, slug: slugify(name) });
    if (error) return { ok: false, error: error.code === "23505" ? "That reward slug is already used." : error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function setRewardActive(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("reward_catalog").update({ is_active: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function setRewardArchived(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("reward_catalog").update({ is_archived: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}
