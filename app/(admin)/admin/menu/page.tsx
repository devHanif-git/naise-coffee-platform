import Link from "next/link";
import { Plus } from "lucide-react";
import { listAdminProducts, listAdminCategories } from "@/lib/menu/admin";
import { MenuListLive } from "@/components/admin/menu-list-live";

export const dynamic = "force-dynamic";

export default async function AdminMenuPage() {
  const [products, categories] = await Promise.all([
    listAdminProducts(),
    listAdminCategories(),
  ]);
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-5 py-4">
        <h1 className="font-heading text-lg font-bold tracking-tight">Menu</h1>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/categories"
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
          >
            Categories
          </Link>
          <Link
            href="/admin/addons"
            className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
          >
            Add-ons
          </Link>
          <Link
            href="/admin/menu/new"
            className="flex items-center gap-1 rounded-full bg-black px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="size-4" /> New
          </Link>
        </div>
      </div>
      <MenuListLive products={products} categories={categories} />
    </div>
  );
}
