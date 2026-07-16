import Image from "next/image";
import Link from "next/link";
import { Flame } from "lucide-react";
import { images } from "@/constants/images";
import { AutoRedirect } from "@/components/auto-redirect";
import type { StreakAward } from "@/types/reward";

// Seconds before the confirmation eases the customer back to the menu. Short —
// this is the customer app, not the store kiosk (which lingers far longer).
const AUTO_BACK_SECONDS = 5;

// The "You're all set" celebration shown after an order is confirmed — used by
// the cash/manual checkout (inline) and the CHIP paid landing route. Pure
// presentational apart from a short auto-redirect back to the menu.
export function OrderConfirmed({
  orderNumber,
  streakAwards = [],
}: {
  orderNumber: string;
  streakAwards?: StreakAward[];
}) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-5 py-16 text-center">
      <AutoRedirect href="/menu" seconds={AUTO_BACK_SECONDS} />
      <div className="relative size-32 naise-pop sm:size-36">
        <Image
          src={images.celebration}
          alt="A cup celebrating with confetti"
          fill
          sizes="(min-width: 640px) 144px, 128px"
          className="object-contain"
        />
      </div>
      <p className="mt-4 text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-muted-foreground naise-rise [animation-delay:60ms]">
        Order Confirmed
      </p>
      <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight naise-rise [animation-delay:120ms]">
        You&rsquo;re all set!
      </h1>
      <p className="mt-2 max-w-[17rem] text-xs leading-relaxed text-muted-foreground naise-rise [animation-delay:180ms]">
        The store has been notified and is brewing your order. Show this
        reference when you collect it.
      </p>

      <div className="mt-6 inline-flex flex-col items-center rounded-2xl bg-black px-6 py-3 text-white naise-rise [animation-delay:240ms]">
        <span className="text-[0.5625rem] font-semibold uppercase tracking-[0.2em] text-white/50">
          Order Ref
        </span>
        <span className="mt-0.5 font-heading text-xl font-bold tracking-tight tabular-nums">
          {orderNumber}
        </span>
      </div>

      {streakAwards.length > 0 && (
        <div className="mt-4 flex flex-col items-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 naise-rise [animation-delay:270ms]">
          <span className="flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-emerald-700">
            <Flame className="size-3.5" strokeWidth={2.5} aria-hidden />
            Streak Bonus
          </span>
          {streakAwards.map((award) => (
            <span key={award.label} className="text-xs font-semibold text-emerald-800">
              +{award.beans.toLocaleString()} Beans · {award.label}
            </span>
          ))}
        </div>
      )}

      <Link
        href="/menu"
        className="mt-7 flex h-12 items-center justify-center rounded-2xl bg-black px-7 text-xs font-bold uppercase tracking-wider text-white transition-transform hover:scale-[1.02] active:scale-[0.98] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 naise-rise [animation-delay:300ms]"
      >
        Back to menu
      </Link>
      <p className="mt-3 text-[0.625rem] text-muted-foreground naise-rise [animation-delay:360ms]">
        Returning to the menu shortly&hellip;
      </p>
    </main>
  );
}
