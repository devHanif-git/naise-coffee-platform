import { listAdminPromotions } from "@/lib/promotions/admin";
import { listAdminProducts, listAdminCategories } from "@/lib/menu/admin";
import { PromotionsManager } from "@/components/admin/promotions-manager";
import { getStampSettings } from "@/lib/stamps/config-store";
import { StampSettingsForm } from "@/components/admin/stamp-settings-form";

export const dynamic = "force-dynamic";

export default async function PromotionsAdminPage() {
  const [promotions, products, categories, stampSettings] = await Promise.all([
    listAdminPromotions(), listAdminProducts(), listAdminCategories(), getStampSettings(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <StampSettingsForm initial={stampSettings} />
      <PromotionsManager initial={promotions} products={products} categories={categories} />
    </div>
  );
}
