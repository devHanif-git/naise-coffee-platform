import { createClient } from "@/lib/supabase/server";
import { MANAGE_ROLES, type Role } from "@/types/auth";
import { inStoreMode } from "@/lib/auth/store-mode";

// Reads the signed-in user's role from `profiles` (RLS-backed). Returns null
// for guests. Replaces the old `naise_role` cookie placeholder — staff/admin
// roles are now assigned in Supabase, not via a dev toggle.
export async function getSessionRole(): Promise<Role | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (error || !data) return null;
  return data.role as Role;
}

// Whether the current session may open an order management link.
export async function canManageOrders(): Promise<boolean> {
  const role = await getSessionRole();
  return role !== null && MANAGE_ROLES.includes(role);
}

// Whether the current session is an admin (full CMS access). Staff/manager are
// NOT admin — they keep the order board only.
export async function isAdmin(): Promise<boolean> {
  return (await getSessionRole()) === "admin";
}

// Whether this device is in kiosk/store mode (signed naise_store cookie). No
// longer tied to a Supabase role — store mode layers on the user's own session.
export async function isStoreMode(): Promise<boolean> {
  return inStoreMode();
}
