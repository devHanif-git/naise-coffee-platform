import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RewardsActivity } from "@/components/rewards-activity";
import { getStoreSettings } from "@/lib/settings/store";

export const metadata: Metadata = {
  title: "Bean Activity",
  description: "Your full history of Beans earned and redeemed at Naise Coffee.",
};

export default async function RewardsActivityPage() {
  const store = await getStoreSettings();
  if (!store.rewardsEnabled) redirect("/menu"); // no home for now redirect to menu
  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <div className="size-9" aria-hidden />
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
          Activity
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <RewardsActivity />
    </div>
  );
}
