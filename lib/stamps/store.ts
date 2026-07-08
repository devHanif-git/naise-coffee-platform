import { createClient } from "@/lib/supabase/server";
import type { GrantStampResult, StampCard } from "@/types/reward";

type GrantRow = { stamped: boolean; count: number; cycle: number; vouchers_issued: { type: "rm_off" | "free_drink" }[] };

// Grant a stamp for a completed member order. No-ops (returns null) for guests,
// disabled program, non-qualifying, or already-stamped orders. Best-effort:
// callers must NOT fail the order if this throws.
export async function grantOrderStamp(token: string): Promise<GrantStampResult> {
  const db = await createClient();
  const { data, error } = await db.rpc("grant_order_stamp", { p_token: token });
  if (error) {
    console.error(`grant_order_stamp failed for ${token}: ${error.message}`);
    return null;
  }
  if (!data) return null;
  const row = data as unknown as GrantRow;
  return {
    stamped: row.stamped,
    count: row.count,
    cycle: row.cycle,
    vouchersIssued: (row.vouchers_issued ?? []).map((v) => ({ type: v.type })),
  };
}

// Reverse a cancelled order's stamp. Self-guards; logs on failure.
export async function reverseOrderStamp(token: string): Promise<void> {
  const db = await createClient();
  const { error } = await db.rpc("reverse_order_stamp", { p_token: token });
  if (error) console.error(`reverse_order_stamp failed for ${token}: ${error.message}`);
}

// The caller's own stamp card (RLS-scoped). Null when signed out or no card yet.
export async function getStampCard(): Promise<StampCard | null> {
  const db = await createClient();
  const { data } = await db.from("stamp_cards").select("current_count, cycle, total_stamps").maybeSingle();
  if (!data) return null;
  return { currentCount: data.current_count, cycle: data.cycle, totalStamps: data.total_stamps };
}
