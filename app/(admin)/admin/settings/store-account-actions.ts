"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { STORE_ACCOUNT_EMAIL } from "@/constants/store";

type ActionResult = { ok: true } | { ok: false; error: string };

// Provisions the kiosk auth user on first call, rotates its password after.
export async function setStorePasscode(passcode: string): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const code = passcode.trim();
  if (code.length < 6) return { ok: false, error: "Passcode must be at least 6 characters." };

  const db = await createClient();
  const { data: row } = await db
    .from("store_account")
    .select("store_user_id")
    .limit(1)
    .maybeSingle();

  const admin = createAdminClient();
  let userId = row?.store_user_id ?? null;

  if (!userId) {
    // Try to create the user; if the email already exists (partial prior run),
    // find it and treat this as a rotation instead.
    const created = await admin.auth.admin.createUser({
      email: STORE_ACCOUNT_EMAIL,
      password: code,
      email_confirm: true,
    });
    if (created.error) {
      const { data: list } = await admin.auth.admin.listUsers();
      const existing = list?.users.find((u) => u.email === STORE_ACCOUNT_EMAIL);
      if (!existing) return { ok: false, error: created.error.message };
      userId = existing.id;
      const upd = await admin.auth.admin.updateUserById(userId, { password: code });
      if (upd.error) return { ok: false, error: upd.error.message };
    } else {
      userId = created.data.user.id;
    }
  } else {
    const upd = await admin.auth.admin.updateUserById(userId, { password: code });
    if (upd.error) return { ok: false, error: upd.error.message };
  }

  // Ensure the role is 'store' (the signup trigger created the profile as
  // 'customer'). Service-role client bypasses the role-guard trigger.
  const roleErr = (await admin.from("profiles").update({ role: "store" }).eq("id", userId)).error;
  if (roleErr) return { ok: false, error: roleErr.message };

  const accErr = (
    await admin
      .from("store_account")
      .update({ store_user_id: userId, last_rotated_at: new Date().toISOString() })
      .eq("id", true)
  ).error;
  if (accErr) return { ok: false, error: accErr.message };

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function setStoreEnabled(enabled: boolean): Promise<ActionResult> {
  if (!(await isAdmin())) return { ok: false, error: "Not authorized." };
  const db = await createClient();
  const { error } = await db.from("store_account").update({ is_enabled: enabled }).eq("id", true);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/settings");
  return { ok: true };
}
