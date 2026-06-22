import { createClient } from "@/lib/supabase/server";
import type { CustomDrinkPreset } from "@/types/custom-order";

// Quick-select presets for the custom-order screen, most-used first. Reads under
// the caller's RLS (admin-only select policy) — callers gate with isAdmin() first.
export async function getCustomDrinkPresets(
  limit = 24,
): Promise<CustomDrinkPreset[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("custom_drinks")
    .select("id, name, last_price")
    .order("times_used", { ascending: false })
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error || !data) {
    if (error) console.error(`getCustomDrinkPresets failed: ${error.message}`);
    return [];
  }
  return data.map((r) => ({ id: r.id, name: r.name, lastPrice: r.last_price }));
}
