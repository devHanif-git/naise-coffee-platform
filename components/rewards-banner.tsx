import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { images } from "@/constants/images";

// Naise Rewards entry point. Our loyalty currency is "Beans": customers earn
// them on orders and redeem them for free drinks. Routes to the Rewards tab,
// whose back control returns to Home.
export function RewardsBanner() {
  return (
    <section aria-labelledby="rewards-heading" className="px-5">
      <Link
        href="/rewards"
        className="group relative flex items-center gap-4 overflow-hidden rounded-[1.75rem] bg-black py-5 pl-3 pr-5 text-white shadow-sm outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99] sm:gap-6 sm:py-8 sm:pl-5 sm:pr-7"
      >
        <div className="relative -my-1 size-24 shrink-0 sm:size-40">
          <Image
            src={images.celebration}
            alt="A cup celebrating with confetti"
            fill
            sizes="(min-width: 640px) 160px, 96px"
            className="object-contain transition-transform duration-300 group-hover:scale-105"
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-white/60 sm:text-xs">
            Naise Rewards
          </p>
          <h2
            id="rewards-heading"
            className="mt-2 font-heading text-xl font-bold leading-tight tracking-tight sm:mt-3 sm:text-3xl"
          >
            Collect Beans, Sip for free.
          </h2>
          <p className="mt-2 text-[0.6875rem] leading-snug text-white/60 sm:mt-4 sm:text-sm">
            Earn Beans on every order. Redeem for free Naise.
          </p>
        </div>

        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform duration-300 group-hover:translate-x-0.5 sm:size-14"
        >
          <ArrowRight className="size-5 sm:size-6" strokeWidth={2.5} />
        </span>
      </Link>
    </section>
  );
}
