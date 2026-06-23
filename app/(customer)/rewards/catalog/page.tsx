import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { RewardsCatalog } from "@/components/rewards-catalog";
import { listRewardCatalog } from "@/lib/rewards/config-store";
import { getStoreSettings } from "@/lib/settings/store";

export const metadata: Metadata = {
  title: "Available Rewards",
  description:
    "Browse every reward you can unlock with Beans at Naise Coffee.",
};

export const dynamic = "force-dynamic";

export default async function RewardsCatalogPage() {
  const store = await getStoreSettings();
  if (!store.rewardsEnabled) redirect("/menu"); // no home for now redirect to menu
  const rewards = await listRewardCatalog();
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

      <RewardsCatalog rewards={rewards} />
    </div>
  );
}
