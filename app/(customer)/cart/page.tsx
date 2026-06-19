import type { Metadata } from "next";
import { Suspense } from "react";
import { CartScreen } from "@/components/cart-screen";
import { getAvailableProductIds } from "@/lib/menu/store";

export const metadata: Metadata = {
  title: "Cart",
};

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const availableProductIds = await getAvailableProductIds();
  return (
    <Suspense fallback={null}>
      <CartScreen availableProductIds={availableProductIds} />
    </Suspense>
  );
}
