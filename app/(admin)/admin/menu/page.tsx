import Link from "next/link";
import { Plus } from "lucide-react";
import { listAdminProducts, listAdminCategories } from "@/lib/menu/admin";
import { MenuListLive } from "@/components/admin/menu-list-live";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function AdminMenuPage() {
  const [products, categories] = await Promise.all([
    listAdminProducts(),
    listAdminCategories(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Menu" description="Items, pricing, and availability.">
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/categories">Categories</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/addons">Add-ons</Link>
        </Button>
        <Button size="sm" asChild>
          <Link href="/admin/menu/new">
            <Plus /> New item
          </Link>
        </Button>
      </AdminPageHeader>
      <MenuListLive products={products} categories={categories} />
    </div>
  );
}
