"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Up to two initials from a display name, e.g. "Naise Member" -> "NM".
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

// Customer avatar: shows the photo when set and loadable, otherwise initials on
// a branded circle. The source may be a Supabase-storage URL, a user-uploaded
// data URL, or a Google (lh3.googleusercontent.com) photo — none reliably
// optimizable by next/image — so a plain <img> is used here, an allowed
// exception to the image rule. `size` is the diameter in px.
export function ProfileAvatar({
  name,
  avatarUrl,
  size = 40,
  className,
}: {
  name: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
}) {
  // Google avatar URLs intermittently fail (rate limiting / referrer throttling
  // / expiry). When the current src can't load, fall back to initials instead of
  // letting the broken <img> render its alt text. Tracking the failed URL (not a
  // boolean) auto-retries when avatarUrl later changes to a different value.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = avatarUrl && avatarUrl !== failedUrl;

  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-black font-heading font-bold text-white",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- external/data URL, not optimizable by next/image
        <img
          src={avatarUrl}
          alt={name}
          // Google's CDN throttles requests that carry a referrer; sending none
          // markedly reduces the intermittent 403/429 failures.
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : (
        <span aria-hidden>{initialsOf(name)}</span>
      )}
    </span>
  );
}
