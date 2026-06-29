import { notFound } from "next/navigation";
import {
  getAdminProduct,
  listAdminCategories,
  listAdminAddons,
  listAdminCostItems,
} from "@/lib/menu/admin";
import { ProductForm } from "@/components/admin/product-form";

export const dynamic = "force-dynamic";

export default async function EditProductPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const [product, categories, addons, costItems] = await Promise.all([
    getAdminProduct(id),
    listAdminCategories(),
    listAdminAddons(),
    listAdminCostItems(),
  ]);
  if (!product) notFound();
  return (
    <ProductForm
      product={product}
      categories={categories}
      addons={addons}
      costItems={costItems}
    />
  );
}
