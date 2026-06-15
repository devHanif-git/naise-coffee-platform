import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { RewardsCatalog } from "@/components/rewards-catalog";

export const metadata: Metadata = {
  title: "Available Rewards",
  description:
    "Browse every reward you can unlock with Beans at Naise Coffee.",
};

export default function RewardsCatalogPage() {
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
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
          Rewards
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <RewardsCatalog />
    </div>
  );
}
