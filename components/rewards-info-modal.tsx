"use client";

import { useEffect } from "react";
import { X, Coffee, Gift, Sparkles } from "lucide-react";

// Explains the Naise Rewards program. Opened from the "?" in the Rewards
// header. Hand-rolled like ReceiptModal — closes on backdrop click or Esc and
// locks body scroll while open.
export function RewardsInfoModal({
  beansPerRinggit,
  onClose,
}: {
  beansPerRinggit: number;
  onClose: () => void;
}) {
  const steps = [
    {
      icon: Coffee,
      title: "Earn Beans",
      body: `Earn ${beansPerRinggit} Beans for every RM1 you spend on Naise drinks.`,
    },
    {
      icon: Gift,
      title: "Redeem Rewards",
      body: "Spend your Beans on free drinks and other rewards.",
    },
    {
      icon: Sparkles,
      title: "Climb the Tiers",
      body: "Keep a daily streak and level up your tier for bonus Beans.",
    },
  ];
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
      aria-labelledby="rewards-info-title"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white naise-pop"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
              Naise Rewards
            </p>
            <h2
              id="rewards-info-title"
              className="mt-1 font-heading text-2xl font-bold tracking-tight"
            >
              How rewards work
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X className="size-5" strokeWidth={2.5} aria-hidden />
          </button>
        </div>

        <ul className="flex flex-col gap-5 px-6 py-6">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="flex items-start gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-black text-white">
                  <Icon className="size-5" strokeWidth={2} aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="font-heading text-base font-bold leading-snug tracking-tight">
                    {step.title}
                  </h3>
                  <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                    {step.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="px-6 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="h-12 w-full rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white transition-transform hover:scale-[1.01] active:scale-[0.99] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
