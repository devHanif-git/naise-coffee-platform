import { createClient } from "@/lib/supabase/server";
import { MANAGE_ROLES, type Role } from "@/types/auth";
import { inStoreMode } from "@/lib/auth/store-mode";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

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

// Server-side route gate. Returns the signed-in user, or redirects logged-out
// visitors to the login screen with a sanitized return path (read from the
// `x-pathname` header the proxy stamps on every request). Call this at the top
// of a protected route's layout — it enforces auth on the server, so direct-URL
// access is blocked, not just clicks.
export async function requireUser(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return user;

  const hdrs = await headers();
  const raw = hdrs.get("x-pathname") || "/menu";
  // Only internal paths — never an absolute or protocol-relative URL.
  const safe = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/menu";
  redirect(`/login?redirect=${encodeURIComponent(safe)}`);
}
