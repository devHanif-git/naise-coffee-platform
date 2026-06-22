import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RewardsScreen } from "@/components/rewards-screen";
import {
  getLoyaltySettings,
  listTiers,
  listStreakMilestones,
  listRewardCatalog,
} from "@/lib/rewards/config-store";
import { getStoreSettings } from "@/lib/settings/store";

export const metadata: Metadata = {
  title: "Rewards",
  description:
    "Earn Beans on every Naise Coffee order and redeem them for free drinks.",
};

export const dynamic = "force-dynamic";

export default async function RewardsPage() {
  const store = await getStoreSettings();
  if (!store.rewardsEnabled) redirect("/menu"); // no home for now redirect to menu
  const [settings, tiers, milestones, catalog] = await Promise.all([
    getLoyaltySettings(),
    listTiers(),
    listStreakMilestones(),
    listRewardCatalog(),
  ]);
  return (
    <RewardsScreen
      tiers={tiers}
      catalog={catalog}
      milestones={milestones}
      beansPerRinggit={settings.beansPerRinggit}
      referral={{ beans: settings.referralBeans, voucher: settings.referralVoucherLabel }}
      streakEnabled={store.streakEnabled}
      referralEnabled={store.referralEnabled}
    />
  );
}
