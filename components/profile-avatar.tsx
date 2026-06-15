"use client";

import { cn } from "@/lib/utils";

// Up to two initials from a display name, e.g. "Naise Member" -> "NM".
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase();
}

// Customer avatar: shows the uploaded photo when set, otherwise initials on a
// branded circle. Avatars are user-uploaded data URLs (stored client-side for
// now), which Next's <Image> can't optimize, so a plain <img> is used here —
// an allowed exception to the image rule. `size` is the diameter in px.
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
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-black font-heading font-bold text-white",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user-uploaded data URL, not optimizable by next/image
        <img
          src={avatarUrl}
          alt={name}
          className="size-full object-cover"
        />
      ) : (
        <span aria-hidden>{initialsOf(name)}</span>
      )}
    </span>
  );
}
