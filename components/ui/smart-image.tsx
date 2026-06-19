"use client";

import { useCallback, useState } from "react";
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

  // Reset to the loading state when the src changes on a reused instance
  // (e.g. a stable component fed changing CMS URLs). This is React's
  // "adjust state during render" pattern — cheaper and more correct than a
  // useEffect, which would briefly paint the previous image's state.
  const [prevSrc, setPrevSrc] = useState(props.src);
  if (props.src !== prevSrc) {
    setPrevSrc(props.src);
    setStatus("loading");
  }

  // next/image forwards `ref` to the underlying <img>. A cached image can be
  // `complete` before React attaches `onLoad`, so that event never fires and
  // the skeleton would stick forever. Catch that on mount via a ref callback.
  const captureRef = useCallback((node: HTMLImageElement | null) => {
    if (node?.complete && node.naturalWidth > 0) {
      setStatus("loaded");
    }
  }, []);

  return (
    <>
      {status !== "loaded" && (
        <span
          aria-hidden
          className={cn(
            // A clearly visible grey — `bg-muted` is near-white and vanishes on
            // the white/cream product stages. neutral-200 reads as a loader on
            // both the light stages and the black image containers.
            "absolute inset-0 animate-pulse rounded-[inherit] bg-neutral-200",
            status === "error" && "animate-none",
          )}
        />
      )}
      {status !== "error" && (
        <Image
          {...props}
          ref={captureRef}
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
