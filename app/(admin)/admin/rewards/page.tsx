import { getAdminLoyaltySettings, listAdminTiers, listAdminMilestones, listAdminRewardCatalog } from "@/lib/rewards/admin";
import { listAdminProducts } from "@/lib/menu/admin";
import { LoyaltySettingsForm } from "@/components/admin/loyalty-settings-form";
import { TiersManager } from "@/components/admin/tiers-manager";
import { StreakMilestonesManager } from "@/components/admin/streak-milestones-manager";
import { RewardCatalogManager } from "@/components/admin/reward-catalog-manager";

export const dynamic = "force-dynamic";

export default async function RewardsAdminPage() {
  const [settings, tiers, milestones, rewards, products] = await Promise.all([
    getAdminLoyaltySettings(), listAdminTiers(), listAdminMilestones(),
    listAdminRewardCatalog(), listAdminProducts(),
  ]);
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Rewards</h1>
      <LoyaltySettingsForm initial={settings} />
      <TiersManager initial={tiers} />
      <StreakMilestonesManager initial={milestones} />
      <RewardCatalogManager initial={rewards} products={products} />
    </div>
  );
}
