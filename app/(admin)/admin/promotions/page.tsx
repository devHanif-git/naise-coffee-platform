import { listAdminPromotions } from "@/lib/promotions/admin";
import { listAdminProducts, listAdminCategories } from "@/lib/menu/admin";
import { PromotionsManager } from "@/components/admin/promotions-manager";

export const dynamic = "force-dynamic";

export default async function PromotionsAdminPage() {
  const [promotions, products, categories] = await Promise.all([
    listAdminPromotions(), listAdminProducts(), listAdminCategories(),
  ]);
  return <PromotionsManager initial={promotions} products={products} categories={categories} />;
}
