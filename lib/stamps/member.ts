import { createClient } from "@/lib/supabase/server";
import type { AttachMemberResult } from "@/types/reward";

type AttachRow =
  | { ok: true; display_name: string; avatar_url: string | null; phone_masked: string | null }
  | { ok: false; error: string };

// Staff attach a member to an order by QR token / phone / email. Returns minimal
// identity on success. RPC enforces the staff role gate.
export async function attachOrderMember(token: string, identifier: string): Promise<AttachMemberResult> {
  const db = await createClient();
  const { data, error } = await db.rpc("attach_order_member", { p_token: token, p_identifier: identifier });
  if (error) return { ok: false, error: error.message };
  const row = data as unknown as AttachRow;
  if (!row?.ok) return { ok: false, error: (row as { error?: string })?.error ?? "unknown" };
  return { ok: true, displayName: row.display_name, avatarUrl: row.avatar_url, phoneMasked: row.phone_masked };
}
