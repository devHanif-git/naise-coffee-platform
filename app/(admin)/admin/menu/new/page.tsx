import {
  listAdminCategories,
  listAdminAddons,
  listAdminCostItems,
} from "@/lib/menu/admin";
import { ProductForm } from "@/components/admin/product-form";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const [categories, addons, costItems] = await Promise.all([
    listAdminCategories(),
    listAdminAddons(),
    listAdminCostItems(),
  ]);
  return (
    <ProductForm
      product={null}
      categories={categories}
      addons={addons}
      costItems={costItems}
    />
  );
}
