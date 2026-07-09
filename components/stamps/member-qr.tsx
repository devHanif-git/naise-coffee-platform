"use client";

import { useEffect, useState } from "react";
import { QrCode, X } from "lucide-react";
import QRCode from "qrcode";

// The member's static loyalty QR. Encodes the user's uuid — NOT a secret, since a
// stamp still requires a real completed order. Staff scan this at the counter.
// Rendered as a pill button that expands into a framed QR card.
export function MemberQr({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || dataUrl) return;
    QRCode.toDataURL(userId, { width: 400, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [open, dataUrl, userId]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 naise-rise [animation-delay:40ms]"
      >
        <QrCode className="size-4" strokeWidth={2} aria-hidden />
        Show my code
      </button>
    );
  }

  return (
    <section className="relative flex flex-col items-center gap-4 rounded-[1.5rem] border border-border bg-white px-6 py-6 naise-rise [animation-delay:40ms]">
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Hide my code"
        className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <X className="size-4" strokeWidth={2.5} aria-hidden />
      </button>

      <p className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
        Member Code
      </p>

      <div className="flex size-[220px] items-center justify-center rounded-2xl border border-border bg-white p-3">
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL, not an optimizable asset
          <img src={dataUrl} alt="Your Naise member QR code" className="size-full object-contain" />
        ) : (
          <div className="size-full animate-pulse rounded-xl bg-neutral-100" />
        )}
      </div>

      <p className="max-w-[15rem] text-center text-xs leading-snug text-muted-foreground">
        Show this to staff after ordering to collect your stamp.
      </p>
    </section>
  );
}
