"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateAll() {
  revalidatePath("/admin/addons");
  revalidatePath("/admin/menu");
  revalidatePath("/menu");
}

export async function saveAddon(input: {
  id?: string;
  name: string;
  price: number;
}): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!Number.isInteger(input.price) || input.price < 0)
    return { ok: false, error: "Price must be a whole number of sen (0 or more)." };
  const db = await createClient();
  if (input.id) {
    const { error } = await db
      .from("addons")
      .update({ name, price: input.price })
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db.from("addons").insert({ name, price: input.price });
    if (error) return { ok: false, error: error.message };
  }
  revalidateAll();
  return { ok: true };
}

export async function setAddonArchived(
  id: string,
  value: boolean,
): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("addons").update({ is_archived: value }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateAll();
  return { ok: true };
}
