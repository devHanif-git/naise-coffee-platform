import { listAdminCategories, listAdminAddons } from "@/lib/menu/admin";
import { ProductForm } from "@/components/admin/product-form";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const [categories, addons] = await Promise.all([
    listAdminCategories(),
    listAdminAddons(),
  ]);
  return <ProductForm product={null} categories={categories} addons={addons} />;
}
