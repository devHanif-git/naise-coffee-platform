import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { rewardsSummary } from "@/data/rewards";

export const metadata: Metadata = {
  title: "Available Rewards",
  description:
    "Browse every reward you can unlock with Beans at Naise Coffee.",
};

export default function RewardsCatalogPage() {
  const { rewards, beans } = rewardsSummary;

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <Link
          href="/rewards#available-rewards"
          aria-label="Back to Rewards"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <h1 className="font-heading text-sm font-bold uppercase tracking-[0.25em]">
          Rewards
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <main className="px-5 pb-8 pt-2">
        <p className="text-sm text-muted-foreground">
          You have{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {beans.toLocaleString()} Beans
          </span>{" "}
          to spend.
        </p>

        <ul className="mt-4 grid grid-cols-2 gap-3">
          {rewards.map((reward) => {
            const affordable = beans >= reward.cost;
            return (
              <li
                key={reward.id}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
              >
                <div className="relative flex aspect-square items-center justify-center bg-[radial-gradient(circle_at_50%_36%,_#f4ede4,_#ffffff_72%)]">
                  <Image
                    src={reward.image}
                    alt={reward.name}
                    fill
                    sizes="(max-width: 768px) 50vw, 200px"
                    className="object-contain p-4"
                  />
                </div>
                <div className="px-3 pb-3 pt-2.5 text-center">
                  <h2 className="text-xs font-bold leading-snug">{reward.name}</h2>
                  <p className="mt-0.5 text-[0.6875rem] text-muted-foreground tabular-nums">
                    {reward.cost.toLocaleString()} Beans
                  </p>
                  <button
                    type="button"
                    disabled={!affordable}
                    className="mt-2.5 h-8 w-full rounded-full bg-black text-[0.6875rem] font-semibold uppercase tracking-wide text-white outline-none transition-transform hover:scale-[1.02] active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100"
                  >
                    Redeem
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
