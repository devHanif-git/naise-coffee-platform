import { MenuBrowser } from "@/components/menu-browser";
import { listCategories, listProducts } from "@/lib/menu/store";
import { getStoreSettings } from "@/lib/settings/store";

export const dynamic = "force-dynamic";

export default async function StoreMenuPage() {
  const [categories, products, settings] = await Promise.all([
    listCategories(),
    listProducts(),
    getStoreSettings(),
  ]);

  if (!settings.isOpen) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-muted-foreground">{settings.closedMessage}</p>
      </div>
    );
  }

  // Bottom padding leaves room for the floating "View cart" bar (StoreCartBar).
  return (
    <div className="pb-28">
      <MenuBrowser categories={categories} products={products} />
    </div>
  );
}
