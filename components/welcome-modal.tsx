"use client";

import { useEffect } from "react";
import Image from "next/image";
import { Coffee, Flame, Star } from "lucide-react";
import { images } from "@/constants/images";
import { useAuth } from "@/store/auth";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

// One-time celebration for a newly-registered member. Rendered once at the
// customer layout level; it reads the auth store directly and shows itself only
// while `showWelcome` is armed (set on sign-in, cleared on dismiss so it never
// re-appears). Hand-rolled like RewardsReferralModal — closes on backdrop click
// or Esc and locks body scroll while open.
const perks = [
  { icon: Star, label: "Earn Beans on every order" },
  { icon: Coffee, label: "Redeem free drinks & treats" },
  { icon: Flame, label: "Build a daily streak for bonuses" },
] as const;

export function WelcomeModal() {
  const { showWelcome, dismissWelcome, user } = useAuth();

  useBodyScrollLock(showWelcome);
  useEffect(() => {
    if (!showWelcome) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissWelcome();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showWelcome, dismissWelcome]);

  if (!showWelcome) return null;

  // First word of the member's name keeps the greeting short and personal.
  const firstName = user?.name.trim().split(/\s+/)[0] ?? "there";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      onClick={dismissWelcome}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white naise-pop"
      >
        <div className="relative flex flex-col items-center overflow-hidden bg-black px-6 pb-8 pt-9 text-center text-white">
          <div className="relative size-28 naise-pop">
            <Image
              src={images.celebration}
              alt="A cup celebrating with confetti"
              fill
              sizes="112px"
              className="object-contain"
            />
          </div>
          <p className="mt-3 text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-white/60">
            Welcome to Naise
          </p>
          <h2
            id="welcome-title"
            className="mt-2 font-heading text-3xl font-bold leading-none tracking-tight"
          >
            Yey, {firstName}!
          </h2>
        </div>

        <div className="px-6 py-6">
          <p className="text-center text-sm leading-relaxed text-muted-foreground">
            You&rsquo;re all signed up. Your rewards start now — here&rsquo;s
            what you&rsquo;ve unlocked:
          </p>

          <ul className="mt-5 flex flex-col gap-3">
            {perks.map((perk) => {
              const Icon = perk.icon;
              return (
                <li key={perk.label} className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-foreground">
                    <Icon className="size-4.5" strokeWidth={2} aria-hidden />
                  </span>
                  <span className="text-sm font-medium">{perk.label}</span>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={dismissWelcome}
            className="mt-6 h-12 w-full rounded-full bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Let&rsquo;s go
          </button>
        </div>
      </div>
    </div>
  );
}
