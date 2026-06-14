import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Plus, Minus } from "lucide-react";
import { rewardsSummary } from "@/data/rewards";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Bean Activity",
  description: "Your full history of Beans earned and redeemed at Naise Coffee.",
};

export default function RewardsActivityPage() {
  const { activity } = rewardsSummary;

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <Link
          href="/rewards#activity"
          aria-label="Back to Rewards"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <h1 className="font-heading text-sm font-bold uppercase tracking-[0.25em]">
          Activity
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <main className="px-5 pb-8 pt-2">
        <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
          {activity.map((item) => {
            const earned = item.amount > 0;
            return (
              <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full",
                    earned ? "bg-black text-white" : "bg-neutral-100 text-foreground",
                  )}
                >
                  {earned ? (
                    <Plus className="size-3.5" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <Minus className="size-3.5" strokeWidth={2.5} aria-hidden />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="text-sm font-bold tabular-nums">
                    {Math.abs(item.amount)}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {item.label}
                  </span>
                </div>
                <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                  {item.when}
                </span>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
