import type { Metadata } from "next";
import { RewardsBackButton } from "@/components/rewards-back-button";

export const metadata: Metadata = {
  title: "Rewards",
  description:
    "Earn Beans on every Naise Coffee order and redeem them for free drinks.",
};

export default function RewardsPage() {
  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 bg-black px-5 pb-5 pt-4 text-white">
        <div className="flex items-center justify-between">
          <RewardsBackButton />
          <h1 className="font-heading text-lg font-semibold tracking-[0.25em]">
            BEANS
          </h1>
          <div className="size-8" aria-hidden />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <p className="font-heading text-2xl font-semibold">Your Beans</p>
        <p className="mt-2 text-sm text-muted-foreground">Coming soon.</p>
      </main>
    </div>
  );
}
