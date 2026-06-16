import { createClient } from "@/lib/supabase/client";

// Uploads a customer avatar to the public `avatars` bucket and returns its
// public URL. Files are stored under "<userId>/avatar.<ext>" — the uid-prefixed
// folder is what the storage RLS policies key off (a user may only write inside
// their own folder). We use a stable filename per extension and upsert, so a
// user keeps one current avatar rather than accumulating orphans.
//
// A cache-busting `?v=<timestamp>` is appended to the returned URL so the new
// photo shows immediately (the public URL is otherwise identical after an
// overwrite and would serve the cached image).
export async function uploadAvatar(
  file: File,
  userId: string,
): Promise<string> {
  const supabase = createClient();

  const ext = extensionFor(file.type);
  const path = `${userId}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);

  return `${publicUrl}?v=${Date.now()}`;
}

// Maps an allowed image MIME type to a file extension. The bucket only accepts
// jpeg/png/webp (enforced server-side), so this covers every valid case.
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
