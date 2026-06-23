import { getAdminLoyaltySettings, listAdminTiers, listAdminMilestones, listAdminRewardCatalog } from "@/lib/rewards/admin";
import { listAdminProducts } from "@/lib/menu/admin";
import { RewardsManager } from "@/components/admin/rewards-manager";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

export const dynamic = "force-dynamic";

export default async function RewardsAdminPage() {
  const [settings, tiers, milestones, rewards, products] = await Promise.all([
    getAdminLoyaltySettings(), listAdminTiers(), listAdminMilestones(),
    listAdminRewardCatalog(), listAdminProducts(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Rewards" description="Loyalty, tiers, streaks, and the reward catalog." />
      <RewardsManager initial={{ settings, tiers, milestones, rewards }} products={products} />
    </div>
  );
}
