import type { Metadata } from "next";
import { Suspense } from "react";
import { CartScreen } from "@/components/cart-screen";
import { getAvailableProductIds } from "@/lib/menu/store";
import { getStoreSettings } from "@/lib/settings/store";

export const metadata: Metadata = {
  title: "Cart",
};

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const [availableProductIds, settings] = await Promise.all([
    getAvailableProductIds(),
    getStoreSettings(),
  ]);
  return (
    <Suspense fallback={null}>
      <CartScreen
        availableProductIds={availableProductIds}
        closedMessage={settings.isOpen ? null : settings.closedMessage}
      />
    </Suspense>
  );
}
