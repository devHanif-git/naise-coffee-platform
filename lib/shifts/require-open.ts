import { createClient } from "@/lib/supabase/server";

// True when a shift is currently open. Used to gate drink-making server-side.
// Reads under the caller's session (staff RLS allows the select).
export async function requireOpenShift(): Promise<boolean> {
  const db = await createClient();
  const { data } = await db
    .from("shifts")
    .select("id")
    .eq("status", "open")
    .maybeSingle();
  return !!data;
}
