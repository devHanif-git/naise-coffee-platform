import type { Metadata } from "next";
import { RewardsScreen } from "@/components/rewards-screen";
import {
  getLoyaltySettings,
  listTiers,
  listStreakMilestones,
  listRewardCatalog,
} from "@/lib/rewards/config-store";

export const metadata: Metadata = {
  title: "Rewards",
  description:
    "Earn Beans on every Naise Coffee order and redeem them for free drinks.",
};

export const dynamic = "force-dynamic";

export default async function RewardsPage() {
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
    />
  );
}
