import { createClient } from "@/lib/supabase/client";

// Uploads a DuitNow QR payment receipt to the private `receipts` bucket and
// returns its storage PATH (`<ownerId>/<random>.<ext>`). The bucket's only read
// policy is staff-only, so the SIGNED URL is generated server-side (in the
// placeOrder action via the service-role client) — a customer/guest can insert
// here but not sign. The INSERT policy allows anon + authenticated, so the
// upload itself works for guests.
export async function uploadReceipt(
  file: File,
  ownerId: string,
): Promise<string> {
  const supabase = createClient();
  const ext = extensionFor(file.type);
  const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("receipts")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (uploadError) throw uploadError;

  return path;
}

function extensionFor(mime: string): string {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}
