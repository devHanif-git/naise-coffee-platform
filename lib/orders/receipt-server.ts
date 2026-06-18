import { createAdminClient } from "@/lib/supabase/admin";

// One year, in seconds. The signed receipt URL is stored on the order and shown
// in the staff/customer order views, so it must outlive any realistic review
// window. A path-scoped, unguessable signed URL on a private bucket is an
// acceptable long-lived reference for this. (The alternative — store the path
// and sign on every render — needs the orders column to hold a path instead of
// a URL; that schema change is deferred because it would break the live app
// until a coordinated deploy.)
const RECEIPT_URL_TTL_SECONDS = 60 * 60 * 24 * 365;

// Server-only. Signs a previously-uploaded receipt path into a long-lived URL
// using the service-role client. The `receipts` bucket is private with a
// staff-only read policy, so customers/guests cannot sign their own upload —
// signing must happen here. Never import this into a client component.
export async function signReceiptPath(path: string): Promise<string> {
  const db = createAdminClient();
  const { data, error } = await db.storage
    .from("receipts")
    .createSignedUrl(path, RECEIPT_URL_TTL_SECONDS);
  if (error || !data) {
    throw error ?? new Error("Could not sign receipt URL.");
  }
  return data.signedUrl;
}
