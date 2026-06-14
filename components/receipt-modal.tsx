"use client";

import { useEffect } from "react";
import Image from "next/image";
import { X } from "lucide-react";

// Lightweight receipt viewer for proof-of-payment (DuitNow QR). Hand-rolled
// rather than pulling in a dialog primitive — closes on backdrop click or Esc,
// and locks scroll while open. Swap for a shared Dialog if one gets added.
export function ReceiptModal({
  src,
  orderNumber,
  onClose,
}: {
  src: string;
  orderNumber: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Proof of payment for ${orderNumber}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white naise-pop"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex flex-col">
            <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
              Proof of Payment
            </span>
            <span className="font-heading text-sm font-bold tracking-tight tabular-nums">
              {orderNumber}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close receipt"
            className="flex size-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-4" strokeWidth={2.5} aria-hidden />
          </button>
        </div>

        <div className="relative aspect-[3/4] w-full bg-neutral-100">
          <Image
            src={src}
            alt={`Payment receipt for ${orderNumber}`}
            fill
            sizes="(max-width: 640px) 100vw, 384px"
            className="object-contain"
          />
        </div>
      </div>
    </div>
  );
}
