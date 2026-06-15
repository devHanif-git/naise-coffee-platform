"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { Coffee, Flame, Star, X } from "lucide-react";
import { images } from "@/constants/images";

// Intercepts a guest at Place Order to show what an account would save them —
// the Beans this order would earn, plus loyalty and streak. They can sign in,
// register, or continue as a guest (which proceeds with the order). Hand-rolled
// like the other modals: closes on backdrop click or Esc, locks body scroll.
export function GuestSignInModal({
  beansAtStake,
  redirect,
  onClose,
  onContinueAsGuest,
}: {
  // Beans this order would earn if signed in — the headline "you're missing
  // out" figure. Computed by the caller from the cart total and earn rate.
  beansAtStake: number;
  // Where the login screen should return to after sign-in (the checkout route).
  redirect: string;
  onClose: () => void;
  onContinueAsGuest: () => void;
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

  const loginHref = `/login?redirect=${encodeURIComponent(redirect)}`;

  const perks = [
    {
      icon: Star,
      label: `Earn ${beansAtStake.toLocaleString()} Beans on this order`,
    },
    { icon: Coffee, label: "Climb loyalty tiers for bigger perks" },
    { icon: Flame, label: "Keep your daily streak alive" },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-signin-title"
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
            className="pointer-events-none absolute -bottom-4 -right-3 z-0 h-auto w-28 object-contain"
          />
          <div className="relative z-10 max-w-[72%]">
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-white/60">
              Don&rsquo;t leave Beans behind
            </p>
            <h2
              id="guest-signin-title"
              className="mt-2 font-heading text-2xl font-bold leading-tight tracking-tight"
            >
              Sign in before you order?
            </h2>
          </div>
        </div>

        <div className="px-6 py-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ordering as a guest works, but you&rsquo;ll miss the rewards this
            order could earn:
          </p>

          <ul className="mt-4 flex flex-col gap-3">
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

          <Link
            href={loginHref}
            className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Sign in / Register
          </Link>

          <button
            type="button"
            onClick={onContinueAsGuest}
            className="mt-2 h-12 w-full rounded-2xl text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground outline-none transition-colors hover:bg-neutral-100 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Continue as guest
          </button>
        </div>
      </div>
    </div>
  );
}
