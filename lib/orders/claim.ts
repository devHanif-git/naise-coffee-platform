import { createClient } from "@/lib/supabase/server";

// Re-own this browser's unclaimed guest orders to the now-authenticated user.
// Calls the claim_device_orders RPC under the caller's cookie session (the RPC
// derives the user from auth.uid()). Best-effort: never throws — a failure here
// must not block login. Returns the number of orders claimed (0 on any error).
export async function claimDeviceOrders(
  ownerId: string | null,
): Promise<number> {
  if (!ownerId) return 0;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("claim_device_orders", {
      p_owner_id: ownerId,
    });
    if (error) {
      console.error("claim_device_orders failed:", error.message);
      return 0;
    }
    return data ?? 0;
  } catch (err) {
    // Honor the never-throws contract: a failure here must not turn the OAuth
    // callback (where the session cookies are already set) into a 500.
    console.error("claim_device_orders threw:", err);
    return 0;
  }
}
