"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/session";
import type { Role } from "@/types/auth";

export type ActionResult = { ok: true } | { ok: false; error: string };
export type AdjustResult = { ok: true; balance: number } | { ok: false; error: string };

// Map a Postgres exception message (our RAISE codes) to a friendly string.
function friendly(message: string, fallback: string): string {
  if (message.includes("CANNOT_CHANGE_OWN_ROLE")) return "You can't change your own role.";
  if (message.includes("LAST_ADMIN")) return "There must be at least one admin.";
  if (message.includes("NO_SUCH_USER")) return "Customer not found.";
  if (message.includes("NEGATIVE_BALANCE")) return "Adjustment would make the balance negative.";
  if (message.includes("ZERO_AMOUNT")) return "Enter a non-zero amount.";
  if (message.includes("REASON_REQUIRED")) return "A reason is required.";
  if (message.includes("NOT_ADMIN")) return "Not authorized.";
  return fallback;
}

export async function setCustomerRole(userId: string, role: Role): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.rpc("admin_set_role", { p_user: userId, p_role: role });
  if (error) return { ok: false, error: friendly(error.message, "Couldn't update the role.") };
  revalidatePath("/admin/customers");
  revalidatePath(`/admin/customers/${userId}`);
  return { ok: true };
}

export async function adjustCustomerBeans(
  userId: string,
  amount: number,
  reason: string,
): Promise<AdjustResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  if (!Number.isInteger(amount)) return { ok: false, error: "Enter a whole number of Beans." };
  const db = await createClient();
  const { data, error } = await db.rpc("admin_adjust_beans", {
    p_user: userId,
    p_amount: amount,
    p_reason: reason,
  });
  if (error) return { ok: false, error: friendly(error.message, "Couldn't adjust Beans.") };
  revalidatePath(`/admin/customers/${userId}`);
  return { ok: true, balance: data as number };
}
