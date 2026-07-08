"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

// The member's static loyalty QR. Encodes the user's uuid — NOT a secret, since a
// stamp still requires a real completed order. Staff scan this at the counter.
export function MemberQr({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || dataUrl) return;
    QRCode.toDataURL(userId, { width: 320, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [open, dataUrl, userId]);

  return (
    <section className="rounded-2xl border border-border bg-white p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-11 w-full rounded-2xl border border-border text-xs font-bold uppercase tracking-wider hover:bg-neutral-50"
      >
        {open ? "Hide my code" : "Show my code"}
      </button>
      {open && (
        <div className="mt-4 flex flex-col items-center gap-2">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL, not an optimizable asset
            <img src={dataUrl} alt="Your Naise member QR code" width={220} height={220} className="rounded-xl" />
          ) : (
            <div className="size-[220px] animate-pulse rounded-xl bg-neutral-100" />
          )}
          <p className="text-[0.6875rem] text-muted-foreground">Show this to staff to collect your stamp.</p>
        </div>
      )}
    </section>
  );
}
