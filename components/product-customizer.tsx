"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Minus, Plus } from "lucide-react";
import type { Product } from "@/types/menu";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCart } from "@/store/cart";
import { useBeans } from "@/store/beans";
import { rewardsSummary } from "@/data/rewards";
import { applyDiscount, getProductDiscount } from "@/data/discounts";

export function ProductCustomizer({ product }: { product: Product }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editKey = searchParams.get("edit") ?? undefined;
  const { items, addItem, updateItem } = useCart();
  const { canAfford } = useBeans();
  const editLine = editKey ? items.find((i) => i.key === editKey) : undefined;
  const isEditing = Boolean(editKey && editLine);

  // Reward mode: arriving via ?reward=<id> redeems that reward as a free drink.
  // Only valid when the reward exists, targets this product, and the balance
  // covers it (re-checked again at checkout). Editing an existing reward line
  // (?edit=<key>) stays in reward mode using the line's stored reward, without
  // re-validating affordability — the cost was already committed at redemption.
  const rewardId = searchParams.get("reward") ?? undefined;
  const reward = rewardId
    ? rewardsSummary.rewards.find((r) => r.id === rewardId)
    : undefined;
  const newReward =
    Boolean(reward) &&
    reward!.productSlug === product.slug &&
    canAfford(reward!.cost);
  const isReward = newReward || Boolean(editLine?.isReward);
  // The reward this line carries: the URL reward when redeeming fresh, or the
  // line's own reward id/cost when editing.
  const activeRewardId = newReward ? reward!.id : editLine?.rewardId;
  const activeRewardCost = newReward ? reward!.cost : editLine?.rewardCost ?? 0;
  const maxAddons = Math.min(
    product.addons.length,
    Math.max(0, product.maxAddons ?? product.addons.length),
  );
  const sizes = product.sizes ?? [];
  const hasSizes = sizes.length > 0;

  const [sizeId, setSizeId] = useState(sizes[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [prefilled, setPrefilled] = useState(false);

  // When editing a cart line (?edit=<key>), prefill the controls from it. The
  // cart loads from localStorage in an effect, so we wait until the matching
  // line is available, then apply once.
  useEffect(() => {
    if (!editKey || prefilled) return;
    const line = items.find((i) => i.key === editKey);
    if (!line) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time prefill once the persisted cart line is available */
    if (line.sizeId) setSizeId(line.sizeId);
    setAddonIds(line.addonIds);
    setQuantity(line.quantity);
    setPrefilled(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [editKey, prefilled, items]);

  const selectedSize = sizes.find((s) => s.id === sizeId);
  const atAddonLimit = addonIds.length >= maxAddons;

  // Discount applies to the drink price only; add-ons are charged in full.
  const discount = getProductDiscount(product);
  const addonsTotal = product.addons
    .filter((a) => addonIds.includes(a.id))
    .reduce((sum, a) => sum + a.price, 0);
  const baseOriginal = hasSizes
    ? (selectedSize?.price ?? 0)
    : (product.price ?? 0);
  const basePricing = applyDiscount(baseOriginal, discount);
  // In reward mode the base drink is free; add-ons are still charged on top, so
  // a redeemed line can exceed RM0.00. Discounts don't apply (the drink is
  // already free) and quantity is locked to 1 — one reward, one drink.
  const onSale = !isReward && basePricing.percentOff > 0;
  const drinkPrice = isReward ? 0 : basePricing.final;
  const drinkOriginal = isReward ? 0 : baseOriginal;
  const effectiveQuantity = isReward ? 1 : quantity;
  const unitPrice = drinkPrice + addonsTotal;
  const total = unitPrice * effectiveQuantity;
  const totalOriginal = (drinkOriginal + addonsTotal) * effectiveQuantity;

  function toggleAddon(id: string) {
    setAddonIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= maxAddons) return prev;
      return [...prev, id];
    });
  }

  function addToCart() {
    const selectedAddons = product.addons.filter((a) =>
      addonIds.includes(a.id),
    );
    const input = {
      productId: product.id,
      slug: product.slug,
      name: product.name,
      image: product.image,
      sizeId: selectedSize?.id,
      sizeName: selectedSize?.name,
      addonIds,
      addonNames: selectedAddons.map((a) => a.name),
      unitPrice,
      unitOriginalPrice: drinkOriginal + addonsTotal,
      discountLabel: onSale ? discount?.label : undefined,
      discountPercentOff: onSale ? basePricing.percentOff : undefined,
      isReward: isReward || undefined,
      rewardId: isReward ? activeRewardId : undefined,
      rewardCost: isReward ? activeRewardCost : undefined,
      quantity: effectiveQuantity,
    };

    if (isEditing && editKey) {
      const merged = updateItem(editKey, input);
      router.push(
        merged ? `/cart?merged=${encodeURIComponent(product.name)}` : "/cart",
      );
      return;
    }

    addItem(input);
    // A redeemed reward returns to Rewards (where the redemption started); a
    // normal add returns to the menu to keep browsing.
    router.push(isReward ? "/rewards" : "/menu");
  }

  return (
    <>
      <div className="flex flex-col gap-5 pb-32">
        {hasSizes && (
          <section
            className="flex flex-col gap-2.5 naise-rise [animation-delay:240ms]"
          >
            <h2 className="text-[0.6875rem] font-bold uppercase tracking-wider">
              Choose Size
            </h2>
            <div className="grid grid-cols-2 gap-2.5">
              {sizes.map((size) => {
                const active = size.id === sizeId;
                const sizePricing = applyDiscount(size.price, discount);
                return (
                  <button
                    key={size.id}
                    type="button"
                    onClick={() => setSizeId(size.id)}
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-2xl px-3 py-3 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      active
                        ? "bg-black text-white"
                        : "bg-neutral-100 text-foreground hover:bg-neutral-200",
                    )}
                  >
                    <span className="text-sm font-bold">{size.name}</span>
                    {onSale ? (
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "text-xs font-semibold",
                            active ? "text-rose-300" : "text-rose-600",
                          )}
                        >
                          {formatPrice(sizePricing.final)}
                        </span>
                        <span
                          className={cn(
                            "text-[0.6875rem] line-through",
                            active ? "text-neutral-400" : "text-muted-foreground",
                          )}
                        >
                          {formatPrice(size.price)}
                        </span>
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "text-xs",
                          active ? "text-neutral-300" : "text-muted-foreground",
                        )}
                      >
                        {formatPrice(size.price)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {product.addons.length > 0 && (
          <section
            className="flex flex-col gap-1 naise-rise [animation-delay:300ms]"
          >
            <h2 className="text-[0.6875rem] font-bold uppercase tracking-wider">
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
                      className="flex w-full items-center gap-3 py-2.5 text-left outline-none disabled:opacity-40 focus-visible:[&>span:first-child]:ring-3 focus-visible:[&>span:first-child]:ring-ring/50"
                    >
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                          checked
                            ? "border-black bg-black text-white"
                            : "border-neutral-300 bg-white",
                        )}
                      >
                        {checked && (
                          <Check
                            className="size-3.5"
                            strokeWidth={3}
                            aria-hidden
                          />
                        )}
                      </span>
                      <span className="flex-1 text-xs font-medium">
                        {addon.name}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
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
        className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-1/2 z-40 w-full max-w-md -translate-x-1/2 border-t border-border bg-background px-5 py-3 naise-fade [animation-delay:360ms]"
      >
        <div className="flex items-center gap-3">
          {!isReward && (
            <div className="flex h-12 items-center gap-1 rounded-full bg-neutral-100 p-1">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                aria-label="Decrease quantity"
                className="flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white disabled:opacity-40 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Minus className="size-4" strokeWidth={2.5} aria-hidden />
              </button>
              <span
                className="w-6 text-center text-base font-bold tabular-nums"
                aria-live="polite"
              >
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                aria-label="Increase quantity"
                className="flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Plus className="size-4" strokeWidth={2.5} aria-hidden />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={addToCart}
            className="flex h-12 flex-1 flex-col items-center justify-center rounded-2xl bg-black px-4 text-white transition-transform outline-none hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="text-xs font-bold uppercase tracking-wider">
              {isReward ? "Redeem Reward" : isEditing ? "Update Cart" : "Add to Cart"}
            </span>
            {isReward ? (
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-white">
                  {addonsTotal > 0 ? formatPrice(total) : "Free Drink"}
                </span>
                <span className="text-xs text-neutral-400">
                  · {activeRewardCost.toLocaleString()} Beans
                </span>
              </span>
            ) : onSale ? (
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-white">
                  {formatPrice(total)}
                </span>
                <span className="text-xs text-neutral-400 line-through">
                  {formatPrice(totalOriginal)}
                </span>
              </span>
            ) : (
              <span className="text-xs font-medium text-neutral-300">
                {formatPrice(total)}
              </span>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
