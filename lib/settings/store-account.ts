import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Authoritative kill switch for the kiosk, read on every kiosk request. Uses the
// service-role client because store mode now runs under the user's own session
// (or a guest with none), which cannot read store_account under RLS. FAIL-CLOSED:
// any read error or missing row is treated as disabled.
export async function getStoreAccountEnabled(): Promise<boolean> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("store_account")
    .select("is_enabled")
    .limit(1)
    .maybeSingle();
  if (error || !data) return false;
  return data.is_enabled;
}

// Admin CMS read: enabled flag, whether the auth user has been provisioned, and
// when the passcode was last set.
export async function getStoreAccountStatus(): Promise<{
  isEnabled: boolean;
  isProvisioned: boolean;
  lastRotatedAt: string | null;
}> {
  const db = await createClient();
  const { data } = await db
    .from("store_account")
    .select("is_enabled, store_user_id, last_rotated_at")
    .limit(1)
    .maybeSingle();
  return {
    isEnabled: data?.is_enabled ?? false,
    isProvisioned: Boolean(data?.store_user_id),
    lastRotatedAt: data?.last_rotated_at ?? null,
  };
}
