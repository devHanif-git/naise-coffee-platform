import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RewardsScreen } from "@/components/rewards-screen";
import {
  getLoyaltySettings,
  listTiers,
  listStreakMilestones,
  listRewardCatalog,
} from "@/lib/rewards/config-store";
import { getStoreSettings } from "@/lib/settings/store";
import { getStampSettings } from "@/lib/stamps/config-store";
import { getStampCard } from "@/lib/stamps/store";
import { StampCard } from "@/components/stamps/stamp-card";
import { MemberQr } from "@/components/stamps/member-qr";

export const metadata: Metadata = {
  title: "Rewards",
  description:
    "Earn Beans on every Naise Coffee order and redeem them for free drinks.",
};

export const dynamic = "force-dynamic";

export default async function RewardsPage() {
  const store = await getStoreSettings();
  if (!store.rewardsEnabled) redirect("/menu"); // no home for now redirect to menu

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [settings, tiers, milestones, catalog, stampSettings, stampCard] =
    await Promise.all([
      getLoyaltySettings(),
      listTiers(),
      listStreakMilestones(),
      listRewardCatalog(),
      getStampSettings(),
      user ? getStampCard() : Promise.resolve(null),
    ]);

  return (
    <div className="flex flex-col">
      {stampSettings.isEnabled && (
        <div className="flex flex-col gap-4 px-5 pt-4">
          <StampCard
            initial={stampCard}
            settings={stampSettings}
            userId={user?.id ?? null}
          />
          {user && <MemberQr userId={user.id} />}
        </div>
      )}
      <RewardsScreen
        tiers={tiers}
        catalog={catalog}
        milestones={milestones}
        beansPerRinggit={settings.beansPerRinggit}
        referral={{ beans: settings.referralBeans, voucher: settings.referralVoucherLabel }}
        streakEnabled={store.streakEnabled}
        referralEnabled={store.referralEnabled}
      />
    </div>
  );
}
