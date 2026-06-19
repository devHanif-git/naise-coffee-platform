import { listAdminCategories, listAdminAddons } from "@/lib/menu/admin";
import { CategoryManager } from "@/components/admin/category-manager";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const [categories, addons] = await Promise.all([
    listAdminCategories(),
    listAdminAddons(),
  ]);
  return <CategoryManager initial={categories} addons={addons} />;
}
