import {
  listAdminCategories,
  listAdminAddons,
  listAdminCostItems,
} from "@/lib/menu/admin";
import { CategoryManager } from "@/components/admin/category-manager";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const [categories, addons, costItems] = await Promise.all([
    listAdminCategories(),
    listAdminAddons(),
    listAdminCostItems(),
  ]);
  return (
    <CategoryManager initial={categories} addons={addons} costItems={costItems} />
  );
}
