"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/admin/costs");
  // Product recipes and the live cost figure depend on the cost list.
  revalidatePath("/admin/menu");
  revalidatePath("/admin/reports");
  revalidatePath("/admin");
}

// Save every edited row plus any newly added ones in a single submit, so the
// page needs one Save button rather than one per row (mirrors the product
// form). Validates the whole set before writing; updates existing rows by id
// and inserts rows without one.
export async function saveCostItems(
  items: {
    id?: string;
    name: string;
    price: number;
    alwaysIncluded: boolean;
    isArchived: boolean;
  }[],
): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const clean = items.map((i) => ({ ...i, name: i.name.trim() }));
  if (clean.some((i) => !i.name))
    return { ok: false, error: "Every item needs a name." };
  if (clean.some((i) => !Number.isInteger(i.price) || i.price < 0))
    return { ok: false, error: "Every cost must be a whole number of sen (0 or more)." };

  const db = await createClient();
  const updates = clean.filter((i) => i.id);
  const inserts = clean.filter((i) => !i.id);

  for (const i of updates) {
    const { error } = await db
      .from("cost_items")
      .update({
        name: i.name,
        price: i.price,
        is_always_included: i.alwaysIncluded,
        is_archived: i.isArchived,
      })
      .eq("id", i.id!);
    if (error) return { ok: false, error: error.message };
  }
  if (inserts.length > 0) {
    const { error } = await db.from("cost_items").insert(
      inserts.map((i) => ({
        name: i.name,
        price: i.price,
        is_always_included: i.alwaysIncluded,
        is_archived: i.isArchived,
      })),
    );
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}
