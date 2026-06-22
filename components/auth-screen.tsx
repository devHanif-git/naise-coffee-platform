"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Coffee, Flame, Loader2, Star } from "lucide-react";
import { images } from "@/constants/images";
import { createClient } from "@/lib/supabase/client";

// Google "G" mark — lucide ships no brand glyphs, so this is an inline SVG
// (allowed image-rule exception). Kept here next to its only use.
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

const perks = [
  { icon: Star, label: "Earn Beans on every order" },
  { icon: Coffee, label: "Redeem free drinks" },
  { icon: Flame, label: "Daily streak bonuses" },
] as const;

export function AuthScreen() {
  const router = useRouter();
  const params = useSearchParams();

  // Where to land after sign-in. Defaults to Home; the profile/checkout entry
  // points pass ?redirect=… so the customer returns to where they were (with
  // their cart intact — it lives in localStorage, untouched by auth).
  const rawRedirect = params.get("redirect") || "/menu"; // no home for now redirect to menu, but keep it general for future use
  const redirect =
    rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
      ? rawRedirect
      : "/menu";

  const [pending, setPending] = useState<"google" | null>(null);

  async function onGoogle() {
    setPending("google");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirect)}`,
      },
    });
    if (error) {
      setPending(null);
      // TODO: surface a toast; for now log so failures aren't silent.
      console.error("Google sign-in failed", error);
    }
    // On success the browser navigates away to Google — no further work here.
  }

  return (
    <main className="flex flex-1 flex-col">
      {/* Header — back closes the auth flow and returns to where they came
          from (or Home). Mirrors the in-app screen headers. */}
      <header className="flex items-center px-5 pb-2 pt-4">
        <button
          type="button"
          onClick={() => router.push(redirect)}
          aria-label="Go back"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </button>
      </header>

      {/* Brand hero. */}
      <section className="flex flex-col items-center px-6 pt-2 text-center">
        <Image
          src={images.logoTransparent}
          alt="Naise Coffee"
          width={640}
          height={640}
          priority
          className="naise-pop h-auto w-32 invert"
        />
        <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight naise-rise [animation-delay:40ms]">
          Sign in to Naise
        </h1>
        <p className="mt-1.5 max-w-[18rem] text-sm leading-relaxed text-muted-foreground naise-rise [animation-delay:80ms]">
          Save your rewards and pick up right where you left off.
        </p>
      </section>

      {/* Value props — the why behind the account, mirroring the guest nudge. */}
      <ul className="mt-6 flex justify-center gap-5 px-6 naise-rise [animation-delay:120ms]">
        {perks.map((perk) => {
          const Icon = perk.icon;
          return (
            <li
              key={perk.label}
              className="flex max-w-[5.5rem] flex-col items-center gap-2 text-center"
            >
              <span className="flex size-11 items-center justify-center rounded-full bg-neutral-100 text-foreground">
                <Icon className="size-5" strokeWidth={2} aria-hidden />
              </span>
              <span className="text-[0.6875rem] font-medium leading-tight text-muted-foreground">
                {perk.label}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex flex-col gap-3 px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-8">
        <div className="flex flex-col gap-3 naise-rise [animation-delay:160ms]">
          <button
            type="button"
            onClick={onGoogle}
            disabled={pending !== null}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-2xl border border-border bg-white text-sm font-semibold text-foreground outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {pending === "google" ? (
              <Loader2 className="size-5 animate-spin" strokeWidth={2.5} aria-hidden />
            ) : (
              <GoogleIcon className="size-5" />
            )}
            Continue with Google
          </button>
        </div>

        <p className="mt-2 text-center text-[0.6875rem] leading-relaxed text-muted-foreground naise-rise [animation-delay:200ms]">
          By continuing you agree to our Terms and acknowledge our Privacy
          Policy.
        </p>

        <Link
          href={redirect}
          className="mt-1 text-center text-xs font-semibold text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline"
        >
          Continue as guest
        </Link>
      </div>
    </main>
  );
}
