"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Minus, Plus, Trash2 } from "lucide-react";
import { useCart } from "@/store/cart";
import { formatPrice } from "@/lib/format";

export function StoreCart() {
  const router = useRouter();
  const { items, totalPrice, incrementItem, decrementItem, removeItem, hydrated } = useCart();

  if (hydrated && items.length === 0) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-muted-foreground">No items yet.</p>
        <Link href="/store" className="h-12 rounded-2xl bg-black px-6 py-3 text-sm font-semibold text-white">
          Browse menu
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <h1 className="font-heading text-lg font-bold uppercase tracking-wider">Order</h1>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-3 py-3">
            <div className="flex-1">
              <p className="text-sm font-semibold">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                {[item.sizeName, ...item.addonNames].filter(Boolean).join(", ")}
              </p>
              <p className="text-xs font-medium">{formatPrice(item.unitPrice * item.quantity)}</p>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-neutral-100 p-1">
              <button type="button" aria-label="Decrease" onClick={() => decrementItem(item.key)} className="flex size-9 items-center justify-center rounded-full hover:bg-white">
                <Minus className="size-4" />
              </button>
              <span className="w-6 text-center text-sm font-bold tabular-nums">{item.quantity}</span>
              <button type="button" aria-label="Increase" onClick={() => incrementItem(item.key)} className="flex size-9 items-center justify-center rounded-full hover:bg-white">
                <Plus className="size-4" />
              </button>
            </div>
            <button type="button" aria-label="Remove" onClick={() => removeItem(item.key)} className="flex size-9 items-center justify-center rounded-full text-muted-foreground hover:text-rose-600">
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <div className="sticky bottom-0 flex items-center justify-between gap-4 border-t border-border bg-background py-4">
        <span className="text-base font-bold">{formatPrice(totalPrice)}</span>
        <button type="button" onClick={() => router.push("/store/checkout")} className="h-12 flex-1 rounded-2xl bg-black text-sm font-semibold text-white">
          Checkout
        </button>
      </div>
    </div>
  );
}
