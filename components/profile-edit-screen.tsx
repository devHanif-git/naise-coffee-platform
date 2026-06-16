"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Camera, Loader2 } from "lucide-react";
import { useAuth } from "@/store/auth";
import { useProfile } from "@/store/profile";
import { uploadAvatar } from "@/lib/supabase/avatar";
import { ProfileAvatar } from "@/components/profile-avatar";

// Edit Profile — photo and display name only (security lives in Settings).
// Persists to the Supabase `profiles` row: the picked photo is uploaded to the
// `avatars` Storage bucket, then its public URL + the display name are written
// to the row via the profile store. Returns to /profile on success.
export function ProfileEditScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { profile, updateProfile } = useProfile();
  const fileRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(profile.displayName);
  // Preview shown in the avatar. Starts at the stored URL; swaps to a local
  // object URL the moment a new file is picked (instant feedback before upload).
  const [previewUrl, setPreviewUrl] = useState(profile.avatarUrl);
  // The newly-picked file, held until save so we only upload on confirm.
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setPickedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    if (!user) {
      setError("You need to be signed in to edit your profile.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      // Upload the new photo first (if one was picked) so we persist a real
      // Storage URL, not the temporary local preview.
      let avatarUrl = profile.avatarUrl;
      if (pickedFile) {
        avatarUrl = await uploadAvatar(pickedFile, user.id);
      }
      await updateProfile({
        displayName: displayName.trim() || profile.displayName,
        avatarUrl,
      });
      router.push("/profile");
    } catch {
      setError("Couldn't save your changes. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <Link
          href="/profile"
          aria-label="Back to profile"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
          Edit Profile
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <form onSubmit={onSave} className="flex flex-col gap-7 px-5 pb-8 pt-2">
        {/* Avatar with change-photo control. */}
        <section className="flex flex-col items-center gap-3 naise-rise">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Change photo"
            className="relative rounded-full outline-none transition-transform hover:scale-[1.02] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ProfileAvatar
              name={displayName}
              avatarUrl={previewUrl}
              size={104}
              className="text-3xl"
            />
            <span className="absolute bottom-0 right-0 flex size-8 items-center justify-center rounded-full border-2 border-background bg-black text-white">
              <Camera className="size-4" strokeWidth={2} aria-hidden />
            </span>
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-xs font-semibold text-foreground underline-offset-2 hover:underline"
          >
            Change photo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onPickPhoto}
            className="hidden"
          />
        </section>

        {/* Display name. */}
        <section className="flex flex-col gap-2 naise-rise [animation-delay:80ms]">
          <label
            htmlFor="displayName"
            className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
          >
            Display Name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            placeholder="Your name"
            className="h-12 rounded-2xl border border-border bg-white px-4 text-sm font-medium outline-none transition-colors focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </section>

        {error && (
          <p className="text-center text-xs font-medium text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 naise-rise [animation-delay:140ms]"
        >
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
