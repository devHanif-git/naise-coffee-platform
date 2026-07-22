"use client";

import { useEffect } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { images } from "@/constants/images";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

// "Coming soon" placeholder for the referral program. Opened from the "Share
// Referral" CTA in the Rewards invite card. Hand-rolled like RewardsInfoModal —
// closes on backdrop click or Esc and locks body scroll while open.
export function RewardsReferralModal({ onClose }: { onClose: () => void }) {
  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rewards-referral-title"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white naise-pop"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 flex size-9 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 outline-none focus-visible:ring-3 focus-visible:ring-white/40"
        >
          <X className="size-5" strokeWidth={2.5} aria-hidden />
        </button>

        <div className="relative overflow-hidden bg-black px-6 pb-7 pt-8 text-white">
          <Image
            src={images.celebration}
            alt=""
            width={200}
            height={200}
            aria-hidden
            className="pointer-events-none absolute -bottom-4 -right-3 z-0 h-auto w-32 object-contain"
          />
          <div className="relative z-10 max-w-[68%]">
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-white/60">
              Invite Friends
            </p>
            <h2
              id="rewards-referral-title"
              className="mt-2 font-heading text-3xl font-bold leading-none tracking-tight"
            >
              Coming Soon
            </h2>
          </div>
        </div>

        <div className="px-6 py-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Our referral program is brewing. Soon you&apos;ll earn Beans for
            every friend you bring to Naise — and they&apos;ll get a welcome
            treat too. Hang tight.
          </p>

          <button
            type="button"
            onClick={onClose}
            className="mt-6 h-12 w-full rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white transition-transform hover:scale-[1.01] active:scale-[0.99] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
