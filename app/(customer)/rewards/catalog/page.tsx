import type { Metadata } from "next";
import { redirect } from "next/navigation";
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
        <div className="size-9" aria-hidden />
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
          Rewards
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <RewardsCatalog rewards={rewards} />
    </div>
  );
}
