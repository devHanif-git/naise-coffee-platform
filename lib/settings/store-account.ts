import { createClient } from "@/lib/supabase/server";

// Authoritative kill switch for the kiosk, read on every kiosk request as the
// store user. FAIL-CLOSED: any read error or missing row is treated as disabled
// so a transient glitch can never leave the kiosk open after it was turned off.
export async function getStoreAccountEnabled(): Promise<boolean> {
  const db = await createClient();
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
