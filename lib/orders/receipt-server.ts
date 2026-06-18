import { createAdminClient } from "@/lib/supabase/admin";

// Server-only. Signs a previously-uploaded receipt path into a 7-day URL using
// the service-role client. The `receipts` bucket is private with a staff-only
// read policy, so customers/guests cannot sign their own upload — signing must
// happen here. Never import this into a client component.
export async function signReceiptPath(path: string): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db.storage
    .from("receipts")
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error || !data) {
    throw error ?? new Error("Could not sign receipt URL.");
  }
  return data.signedUrl;
}
