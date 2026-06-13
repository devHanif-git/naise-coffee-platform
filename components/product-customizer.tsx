"use client";

import { useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import type { Product } from "@/types/menu";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ProductCustomizer({ product }: { product: Product }) {
  const maxAddons = product.maxAddons ?? product.addons.length;
  const sizes = product.sizes ?? [];
  const hasSizes = sizes.length > 0;

  const [sizeId, setSizeId] = useState(sizes[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);

  const selectedSize = sizes.find((s) => s.id === sizeId);
  const atAddonLimit = addonIds.length >= maxAddons;

  const addonsTotal = product.addons
    .filter((a) => addonIds.includes(a.id))
    .reduce((sum, a) => sum + a.price, 0);
  const basePrice = hasSizes ? (selectedSize?.price ?? 0) : (product.price ?? 0);
  const unitPrice = basePrice + addonsTotal;
  const total = unitPrice * quantity;

  function toggleAddon(id: string) {
    setAddonIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= maxAddons) return prev;
      return [...prev, id];
    });
  }

  function addToCart() {
    // TODO: wire to cart store once it exists in store/.
  }

  return (
    <>
      <div className="flex flex-col gap-6 pb-32">
        {hasSizes && (
          <section
            className="flex flex-col gap-3 naise-rise"
            style={{ animationDelay: "240ms" }}
          >
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Choose Size
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {sizes.map((size) => {
                const active = size.id === sizeId;
                return (
                  <button
                    key={size.id}
                    type="button"
                    onClick={() => setSizeId(size.id)}
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-2xl px-4 py-3.5 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      active
                        ? "bg-black text-white"
                        : "bg-neutral-100 text-foreground hover:bg-neutral-200",
                    )}
                  >
                    <span className="text-base font-bold">{size.name}</span>
                    <span
                      className={cn(
                        "text-sm",
                        active ? "text-neutral-300" : "text-muted-foreground",
                      )}
                    >
                      {formatPrice(size.price)}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {product.addons.length > 0 && (
          <section
            className="flex flex-col gap-1 naise-rise"
            style={{ animationDelay: "300ms" }}
          >
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Add-on{" "}
              <span className="font-normal normal-case tracking-normal text-muted-foreground">
                (Choose up to {maxAddons})
              </span>
            </h2>
            <ul className="flex flex-col">
              {product.addons.map((addon) => {
                const checked = addonIds.includes(addon.id);
                const disabled = !checked && atAddonLimit;
                return (
                  <li key={addon.id}>
                    <button
                      type="button"
                      onClick={() => toggleAddon(addon.id)}
                      disabled={disabled}
                      aria-pressed={checked}
                      className="flex w-full items-center gap-3 py-3 text-left outline-none disabled:opacity-40 focus-visible:[&>span:first-child]:ring-3 focus-visible:[&>span:first-child]:ring-ring/50"
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                          checked
                            ? "border-black bg-black text-white"
                            : "border-neutral-300 bg-white",
                        )}
                      >
                        {checked && (
                          <Check className="size-4" strokeWidth={3} aria-hidden />
                        )}
                      </span>
                      <span className="flex-1 text-sm font-medium">
                        {addon.name}
                      </span>
                      <span className="text-sm font-medium text-muted-foreground">
                        {formatPrice(addon.price)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <div
        className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-border bg-background px-5 py-3 naise-fade"
        style={{ animationDelay: "360ms" }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-14 items-center gap-1 rounded-full bg-neutral-100 p-1">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1}
              aria-label="Decrease quantity"
              className="flex size-12 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white disabled:opacity-40 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Minus className="size-4" strokeWidth={2.5} aria-hidden />
            </button>
            <span
              className="w-7 text-center text-lg font-bold tabular-nums"
              aria-live="polite"
            >
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => q + 1)}
              aria-label="Increase quantity"
              className="flex size-12 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Plus className="size-4" strokeWidth={2.5} aria-hidden />
            </button>
          </div>

          <button
            type="button"
            onClick={addToCart}
            className="flex h-14 flex-1 flex-col items-center justify-center rounded-2xl bg-black px-4 text-white transition-transform outline-none hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="text-sm font-bold uppercase tracking-wider">
              Add to Cart
            </span>
            <span className="text-sm font-medium text-neutral-300">
              {formatPrice(total)}
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
