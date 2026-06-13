import type { Metadata } from "next";
import { Suspense } from "react";
import { CartScreen } from "@/components/cart-screen";

export const metadata: Metadata = {
  title: "Cart",
};

export default function CartPage() {
  return (
    <Suspense fallback={null}>
      <CartScreen />
    </Suspense>
  );
}
