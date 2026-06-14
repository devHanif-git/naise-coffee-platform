import { cookies } from "next/headers";
import { MANAGE_ROLES, type Role } from "@/types/auth";

// PLACEHOLDER until Supabase Auth lands. For now the role is read from a
// `naise_role` cookie so the management gate can be exercised in development.
// Replace this with the Supabase server client + a `profiles.role` lookup, and
// back it with RLS — do not rely on this for real security.
export async function getSessionRole(): Promise<Role | null> {
  const store = await cookies();
  const value = store.get("naise_role")?.value;
  const allowed: Role[] = ["admin", "manager", "staff", "customer"];
  return allowed.includes(value as Role) ? (value as Role) : null;
}

// Whether the current session may open an order management link.
export async function canManageOrders(): Promise<boolean> {
  const role = await getSessionRole();
  return role !== null && MANAGE_ROLES.includes(role);
}
