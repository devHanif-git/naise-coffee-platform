"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";
import { CATALOG_TAG } from "@/lib/menu/store";
import type { PromotionFormData } from "@/lib/promotions/types";

export type ActionResult = { ok: true } | { ok: false; error: string };

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Revalidate the CMS page and the storefront surfaces a promotion affects.
function revalidateAll() {
  revalidatePath("/admin/promotions");
  revalidatePath("/menu");
  revalidatePath("/menu/[slug]", "page");
  revalidatePath("/home");
  // Invalidate the cached storefront catalogue. Price-authoritative paths (cart
  // re-price, checkout) read fresh via listProductsFresh(), so stale-while-
  // revalidate ("max") is fine here — the menu can refresh in the background.
  revalidateTag(CATALOG_TAG, "max");
}

// Upsert the promotion, then replace its product/category target links.
export async function savePromotion(input: PromotionFormData): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const label = input.label.trim();
  if (!label) return { ok: false, error: "Label is required." };
  if (!Number.isInteger(input.percentOff) || input.percentOff < 1 || input.percentOff > 100) {
    return { ok: false, error: "Percent off must be between 1 and 100." };
  }
  if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) {
    return { ok: false, error: "End must be after start." };
  }
  if (input.productIds.length === 0 && input.categoryIds.length === 0) {
    return { ok: false, error: "Target at least one product or category." };
  }

  const db = await createClient();
  const payload = {
    label,
    percent_off: input.percentOff,
    is_active: input.isActive,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
  };

  let promoId = input.id;
  if (promoId) {
    const { error } = await db.from("promotions").update(payload).eq("id", promoId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await db
      .from("promotions")
      .insert({ ...payload, slug: slugify(label) })
      .select("id")
      .single();
    if (error || !data) {
      return { ok: false, error: error?.code === "23505" ? "That promotion slug is already used." : error?.message ?? "Insert failed." };
    }
    promoId = data.id;
  }

  // Replace target links (delete-then-insert; simplest correct approach).
  await db.from("promotion_products").delete().eq("promotion_id", promoId);
  await db.from("promotion_categories").delete().eq("promotion_id", promoId);
  if (input.productIds.length > 0) {
    const { error } = await db
      .from("promotion_products")
      .insert(input.productIds.map((product_id) => ({ promotion_id: promoId!, product_id })));
    if (error) return { ok: false, error: error.message };
  }
  if (input.categoryIds.length > 0) {
    const { error } = await db
      .from("promotion_categories")
      .insert(input.categoryIds.map((category_id) => ({ promotion_id: promoId!, category_id })));
    if (error) return { ok: false, error: error.message };
  }

  revalidateAll();
  return { ok: true };
}

export async function setPromotionActive(id: string, value: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("promotions").update({ is_active: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// Order lines snapshot the discount label/percent at add-time and have no FK to
// promotions, so a hard delete is safe for history.
export async function deletePromotion(id: string): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("promotions").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}
