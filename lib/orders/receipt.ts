import { createClient } from "@/lib/supabase/client";

// Uploads a DuitNow QR payment receipt to the private `receipts` bucket and
// returns a signed URL (valid 7 days) for display in the manage/customer views.
// Path is `<ownerId>/<random>.<ext>` — unguessable and grouped per browser.
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

  const { data, error: signError } = await supabase.storage
    .from("receipts")
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signError || !data) {
    throw signError ?? new Error("Could not sign receipt URL.");
  }
  return data.signedUrl;
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
