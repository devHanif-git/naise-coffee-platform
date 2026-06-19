"use client";

import { useState } from "react";
import Image, { type ImageProps } from "next/image";
import { cn } from "@/lib/utils";

// A drop-in wrapper around <Image fill> that reserves the image's box with a
// soft skeleton while the image decodes, fades the image in once it loads, and
// shows a neutral placeholder (never a broken-image icon) if the source fails.
//
// Requires `fill` and a sized, position:relative parent — which all current
// adoption sites already provide. Works for local paths and remote (Supabase
// Storage) URLs alike.
type SmartImageProps = Omit<ImageProps, "onLoad" | "onError"> & {
  fill: true;
};

export function SmartImage({ className, alt, ...props }: SmartImageProps) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );

  return (
    <>
      {status !== "loaded" && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 animate-pulse rounded-[inherit] bg-muted",
            status === "error" && "animate-none",
          )}
        />
      )}
      {status !== "error" && (
        <Image
          {...props}
          alt={alt}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("error")}
          className={cn(
            "transition-opacity duration-300",
            status === "loaded" ? "opacity-100" : "opacity-0",
            className,
          )}
        />
      )}
    </>
  );
}
