"use client";

import Image from "next/image";
import Link from "next/link";
import { Minus, Plus } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { useCart } from "@/store/cart";
import type { CartItem } from "@/types/cart";

// A single cart line, sized to match the menu list (same image + type scale)
// and separated by a divider rather than boxed in a card. There is no separate
// "remove" control: pressing minus at quantity one removes the line (see
// decrementItem in the store). `delay` staggers the entrance animation.
export function CartItemCard({
  item,
  delay = 0,
}: {
  item: CartItem;
  delay?: number;
}) {
  const { incrementItem, decrementItem } = useCart();

  // Drinks without a size option still read as "Regular" so the line is never
  // blank when no add-ons are selected.
  const subtitle = [item.sizeName ?? "Regular", ...item.addonNames]
    .filter(Boolean)
    .join(", ");

  // Guard original price for carts persisted before discounts shipped.
  const unitOriginal = item.unitOriginalPrice ?? item.unitPrice;
  const lineTotal = item.unitPrice * item.quantity;
  const lineOriginal = unitOriginal * item.quantity;
  const onSale = lineOriginal > lineTotal;
  const lineSaving = lineOriginal - lineTotal;
  const lastOne = item.quantity <= 1;

  return (
    <li
      className="flex items-center gap-4 py-5 naise-rise"
      style={{ animationDelay: `${delay}ms` }}
    >
      <Link
        href={`/menu/${item.slug}?edit=${encodeURIComponent(item.key)}`}
        aria-label={`Edit ${item.name}`}
        className="flex min-w-0 flex-1 items-center gap-4 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded-2xl bg-black p-2">
          <Image
            src={item.image}
            alt={item.name}
            fill
            sizes="96px"
            className="object-contain"
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="truncate font-heading text-base font-bold leading-snug tracking-tight">
            {item.name}
          </h3>
          {subtitle && (
            <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
          )}

          {onSale ? (
            <div className="mt-1 flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold tabular-nums text-rose-600">
                  {formatPrice(lineTotal)}
                </span>
                <span className="text-xs font-medium tabular-nums text-muted-foreground line-through">
                  {formatPrice(lineOriginal)}
                </span>
              </div>
              <span className="text-xs font-semibold text-rose-600">
                Save {formatPrice(lineSaving)}
                {item.discountPercentOff ? ` · ${item.discountPercentOff}% off` : ""}
              </span>
            </div>
          ) : (
            <span className="mt-1 text-base font-bold tabular-nums">
              {formatPrice(lineTotal)}
            </span>
          )}
        </div>
      </Link>

      <div className="flex shrink-0 items-center gap-1 self-center rounded-full border border-border p-1">
        <button
          type="button"
          onClick={() => decrementItem(item.key)}
          aria-label={lastOne ? `Remove ${item.name}` : "Decrease quantity"}
          className="flex size-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Minus className="size-4" strokeWidth={2.5} aria-hidden />
        </button>
        <span
          className="w-6 text-center text-sm font-bold tabular-nums"
          aria-live="polite"
        >
          {item.quantity}
        </span>
        <button
          type="button"
          onClick={() => incrementItem(item.key)}
          aria-label="Increase quantity"
          className="flex size-8 items-center justify-center rounded-full text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Plus className="size-4" strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    </li>
  );
}
