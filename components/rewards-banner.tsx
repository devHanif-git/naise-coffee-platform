import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { images } from "@/constants/images";

// Naise Rewards entry point. Our loyalty currency is "Beans": customers earn
// them on orders and redeem them for free drinks. Routes to the Rewards tab,
// whose back control returns to Home (see RewardsBackButton).
export function RewardsBanner() {
  return (
    <section aria-labelledby="rewards-heading" className="px-5">
      <Link
        href="/rewards"
        className="group relative flex items-center gap-4 overflow-hidden rounded-3xl bg-black py-6 pl-3 pr-5 text-white shadow-sm outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]"
      >
        <div className="relative -my-2 size-[8.5rem] shrink-0 sm:size-[9.5rem]">
          <Image
            src={images.celebration}
            alt="A cup celebrating with confetti"
            fill
            sizes="(min-width: 640px) 152px, 136px"
            className="object-contain transition-transform duration-300 group-hover:scale-105"
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[0.625rem] font-semibold uppercase tracking-[0.2em] text-white/60">
            Naise Rewards
          </p>
          <h2
            id="rewards-heading"
            className="mt-1 font-heading text-lg font-bold leading-tight tracking-tight"
          >
            Collect Beans, sip for free.
          </h2>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-white/70">
            Earn Beans on every order. Redeem for free Naise.
          </p>
        </div>

        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white text-black transition-transform duration-300 group-hover:translate-x-0.5"
        >
          <ArrowRight className="size-5" strokeWidth={2.5} />
        </span>
      </Link>
    </section>
  );
}
