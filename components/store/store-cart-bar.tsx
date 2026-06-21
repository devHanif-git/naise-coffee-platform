"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/store/cart";
import { formatPrice } from "@/lib/format";

// Persistent "View cart" bar on the kiosk menu screen. The product, cart,
// checkout, and login screens carry their own primary actions, so it only
// shows on /store to avoid stacking with the customizer's add-to-cart bar.
export function StoreCartBar() {
  const pathname = usePathname();
  const { items, totalItems, totalPrice, hydrated } = useCart();

  if (pathname !== "/store") return null;
  if (!hydrated || items.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-5xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <Link
        href="/store/cart"
        className="flex h-14 items-center justify-between rounded-2xl bg-black px-5 text-white shadow-lg outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-2.5 text-sm font-semibold">
          <ShoppingBag className="size-5" aria-hidden />
          View cart · {totalItems} item{totalItems === 1 ? "" : "s"}
        </span>
        <span className="text-base font-bold tabular-nums">{formatPrice(totalPrice)}</span>
      </Link>
    </div>
  );
}
