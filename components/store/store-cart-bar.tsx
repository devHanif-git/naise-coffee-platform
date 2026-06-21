"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/store/cart";
import { formatPrice } from "@/lib/format";

// Cart affordance on the kiosk menu screen. Empty → a circular cart button
// bottom-left; once items are added it becomes a full-width bar with the count
// and total. Only shows on /store so it never stacks with the customizer's own
// add-to-cart bar on the product screen.
export function StoreCartBar() {
  const pathname = usePathname();
  const { items, totalItems, totalPrice, hydrated } = useCart();

  if (pathname !== "/store" || !hydrated) return null;

  if (items.length === 0) {
    return (
      <Link
        href="/store/cart"
        aria-label="Cart (empty)"
        className="naise-fade fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-5 z-40 flex size-14 items-center justify-center rounded-full bg-black text-white shadow-lg outline-none transition-transform hover:scale-105 active:scale-95 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ShoppingBag className="size-6" aria-hidden />
      </Link>
    );
  }

  return (
    <div className="naise-rise fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-5xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <Link
        href="/store/cart"
        className="flex h-14 items-center justify-between rounded-2xl bg-black px-5 text-white shadow-lg outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-2.5 text-sm font-semibold">
          <ShoppingBag className="size-5" aria-hidden />
          View cart
          {/* key by count so the badge re-pops each time an item is added. */}
          <span
            key={totalItems}
            className="naise-pop inline-flex min-w-5 items-center justify-center rounded-full bg-white/20 px-1.5 text-xs font-bold tabular-nums"
          >
            {totalItems}
          </span>
        </span>
        <span className="text-base font-bold tabular-nums">{formatPrice(totalPrice)}</span>
      </Link>
    </div>
  );
}
