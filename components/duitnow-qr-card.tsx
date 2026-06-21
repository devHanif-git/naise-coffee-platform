"use client";

import { useState } from "react";
import { SmartImage } from "@/components/ui/smart-image";
import { Download, Loader2 } from "lucide-react";
import { images } from "@/constants/images";

const SAVE_FILENAME = "naise-duitnow-qr.png";

// Shows the branded DuitNow QR card and a "Save to device" action so the
// customer can scan in their bank app or stash the image in their gallery and
// scan it from another phone. The PNG is already a finished card (header, logo,
// QR, brand) — we just frame it and hang the save button beneath.
// `src` is the CMS-uploaded QR URL; when absent we fall back to the bundled
// asset so the card never renders empty.
export function DuitnowQrCard({ src }: { src?: string }) {
  const QR_SRC = src ?? images.qrDuitnow;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveToDevice() {
    if (saving) return;
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(QR_SRC);
      const blob = await res.blob();
      const file = new File([blob], SAVE_FILENAME, { type: blob.type });

      // Mobile: native share sheet lets the user pick "Save to Photos", which
      // drops the QR straight into their gallery.
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (shareError) {
          // User dismissed the sheet — not an error worth surfacing.
          if (shareError instanceof DOMException && shareError.name === "AbortError") {
            return;
          }
          // Anything else: fall through to a plain download below.
        }
      }

      // Desktop / unsupported: trigger a normal file download.
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = SAVE_FILENAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Couldn't save the QR. Try a screenshot instead.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl">
        <SmartImage
          src={QR_SRC}
          alt="Naise Coffee DuitNow QR code"
          fill
          sizes="(min-width: 640px) 480px, 100vw"
          className="object-contain"
          priority
        />
      </div>

      <button
        type="button"
        onClick={saveToDevice}
        disabled={saving}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-white text-xs font-bold uppercase tracking-wider text-foreground transition-colors outline-none hover:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {saving ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
        ) : (
          <Download className="size-4" strokeWidth={2.5} aria-hidden />
        )}
        {saving ? "Saving" : "Save to device"}
      </button>

      {error && (
        <p role="alert" className="text-[0.6875rem] text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
