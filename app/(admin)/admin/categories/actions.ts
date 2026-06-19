"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function revalidateAll() {
  revalidatePath("/admin/categories");
  revalidatePath("/admin/menu");
  revalidatePath("/menu");
  revalidatePath("/home");
}

export async function saveCategory(input: {
  id?: string;
  name: string;
  maxAddons: number;
}): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (input.maxAddons < 0)
    return { ok: false, error: "Max add-ons must be 0 or more." };
  const db = await createClient();
  if (input.id) {
    const { error } = await db
      .from("categories")
      .update({ name, max_addons: input.maxAddons })
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db
      .from("categories")
      .insert({ name, slug: slugify(name), max_addons: input.maxAddons });
    if (error)
      return {
        ok: false,
        error: error.code === "23505" ? "That category already exists." : error.message,
      };
  }
  revalidateAll();
  return { ok: true };
}

export async function reorderCategories(ids: string[]): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  for (let i = 0; i < ids.length; i++) {
    const { error } = await db
      .from("categories")
      .update({ sort_order: i })
      .eq("id", ids[i]);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function setCategoryArchived(
  id: string,
  value: boolean,
): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db
    .from("categories")
    .update({ is_archived: value })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}

// Replace a category's default add-on set.
export async function setCategoryAddons(
  categoryId: string,
  addonIds: string[],
): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  await db.from("category_addons").delete().eq("category_id", categoryId);
  if (addonIds.length > 0) {
    const rows = addonIds.map((addon_id, i) => ({
      category_id: categoryId,
      addon_id,
      sort_order: i,
    }));
    const { error } = await db.from("category_addons").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}
