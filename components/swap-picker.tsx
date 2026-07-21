"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, Loader2, Minus, Plus, TriangleAlert } from "lucide-react";
import type { Category, Product } from "@/types/menu";
import type { OrderLine } from "@/types/order";
import type { SwapDrinkInput } from "@/app/(admin)/manage/actions";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { applyDiscount, getProductDiscount } from "@/lib/promotions/pricing";
import { SearchInput } from "@/components/ui/search-input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

// A menu-style drink picker for swapping one line of an order. Two steps in a
// bottom sheet: browse (search + category tabs, mirroring the customer menu),
// then customize (size + add-ons, like the product page). On confirm it hands
// back the chosen product/size/add-ons; the server re-prices authoritatively.
//
// `replacing` is the line being swapped out — its line total anchors the
// difference shown to staff before they commit ("+RM2.00" / "−RM1.50").
export function SwapPicker({
  open,
  onOpenChange,
  categories,
  products,
  replacing,
  busy,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  products: Product[];
  replacing: OrderLine;
  busy: boolean;
  error: string | null;
  onConfirm: (input: SwapDrinkInput) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string>("all");
  const [picked, setPicked] = useState<Product | null>(null);
  const [sizeId, setSizeId] = useState<string | undefined>(undefined);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  // How many units of the line to swap. For a qty-1 line this is always 1; for a
  // multi-unit line staff pick 1..qty in the customize step (fewer than the full
  // quantity splits the line, leaving the rest as the original drink).
  const [swapCount, setSwapCount] = useState(1);

  // Reset everything each time the sheet is opened so a prior attempt never
  // bleeds into the next drink being swapped.
  function reset() {
    setQuery("");
    setActiveCat("all");
    setPicked(null);
    setSizeId(undefined);
    setAddonIds([]);
    setSwapCount(1);
  }

  // Categories that actually have drinks, plus a leading "All" tab.
  const catTabs = useMemo(() => {
    const withItems = categories.filter((c) =>
      products.some((p) => p.category === c.type),
    );
    return [{ type: "all", name: "All" }, ...withItems];
  }, [categories, products]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    return products.filter((p) => {
      if (activeCat !== "all" && p.category !== activeCat) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [products, activeCat, q]);

  function choose(product: Product) {
    setPicked(product);
    // Default to the first (usually smallest) size so a price shows immediately.
    setSizeId(product.sizes?.[0]?.id);
    setAddonIds([]);
    // Default to swapping the whole line; staff dial it down for a partial swap.
    setSwapCount(replacing.quantity);
  }

  const sizes = picked?.sizes ?? [];
  const hasSizes = sizes.length > 0;
  const selectedSize = sizes.find((s) => s.id === sizeId);
  const maxAddons = picked
    ? Math.min(
        picked.addons.length,
        Math.max(0, picked.maxAddons ?? picked.addons.length),
      )
    : 0;
  const atAddonLimit = addonIds.length >= maxAddons;

  function toggleAddon(id: string) {
    setAddonIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= maxAddons) return prev;
      return [...prev, id];
    });
  }

  // Live price of the picked drink, mirroring the customer customizer: discount
  // applies to the drink price only; add-ons are charged in full. This is a
  // preview — the server recomputes it on confirm.
  const discount = picked ? getProductDiscount(picked) : undefined;
  const baseOriginal = hasSizes ? (selectedSize?.price ?? 0) : (picked?.price ?? 0);
  const drinkPrice = applyDiscount(baseOriginal, discount).final;
  const addonsTotal = picked
    ? picked.addons
        .filter((a) => addonIds.includes(a.id))
        .reduce((sum, a) => sum + a.price, 0)
    : 0;
  const unitPrice = drinkPrice + addonsTotal;
  // Difference preview compares the SWAPPED units against the same number of
  // original units (the server prices the same way). For a full swap swapCount
  // equals the line quantity; for a partial swap only those units move.
  const swappedInTotal = unitPrice * swapCount;
  const swappedOutTotal = replacing.unitPrice * swapCount;
  const diff = swappedInTotal - swappedOutTotal;
  const isPartial = swapCount < replacing.quantity;

  // A sized drink needs a size chosen before it can be confirmed.
  const ready = Boolean(picked) && (!hasSizes || Boolean(selectedSize));

  function confirm() {
    if (!picked || !ready) return;
    onConfirm({ productId: picked.id, sizeId, addonIds, count: swapCount });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={!busy}
        aria-describedby={undefined}
        className="mx-auto flex max-h-[88vh] w-full max-w-md flex-col gap-0 rounded-t-3xl p-0"
      >
        {/* Header — grab handle + step title. In customize mode the title is a
            back control returning to the drink list. */}
        <div className="shrink-0 px-5 pb-3 pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
          {picked ? (
            <button
              type="button"
              onClick={() => !busy && setPicked(null)}
              className="-ml-1.5 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ChevronLeft className="size-4" strokeWidth={2.5} aria-hidden />
              All drinks
            </button>
          ) : (
            <SheetTitle className="font-heading text-lg font-bold tracking-tight">
              Swap drink
            </SheetTitle>
          )}
          {!picked && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Replacing{" "}
              <span className="font-semibold text-foreground">
                {replacing.name}
              </span>
              {replacing.quantity > 1 && ` ×${replacing.quantity}`}
            </p>
          )}
        </div>

        {picked ? (
          /* ---- Step 2: customize the picked drink ---- */
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
              <div className="flex flex-col gap-0.5 border-b border-border pb-4">
                <SheetTitle className="font-heading text-xl font-bold tracking-tight">
                  {picked.name}
                </SheetTitle>
                <p className="text-xs text-muted-foreground">
                  Replacing {replacing.name}
                  {replacing.quantity > 1 && ` ×${replacing.quantity}`}
                </p>
              </div>

              {/* Quantity to swap — only for multi-unit lines. Bounds 1..qty; at
                  the max the whole line is swapped, below it the line splits and
                  the rest stay as the original drink. */}
              {replacing.quantity > 1 && (
                <section className="mt-4 flex flex-col gap-2.5">
                  <h3 className="text-[0.6875rem] font-bold uppercase tracking-wider">
                    How many to swap
                  </h3>
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3">
                    <span className="text-sm font-semibold tabular-nums">
                      {swapCount} of {replacing.quantity}
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setSwapCount((c) => Math.max(1, c - 1))}
                        disabled={busy || swapCount <= 1}
                        aria-label="Swap one fewer"
                        className="flex size-9 items-center justify-center rounded-full border border-border text-foreground outline-none transition-colors hover:bg-neutral-100 disabled:opacity-40 focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <Minus className="size-4" strokeWidth={2.5} aria-hidden />
                      </button>
                      <span className="w-6 text-center text-base font-bold tabular-nums">
                        {swapCount}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setSwapCount((c) => Math.min(replacing.quantity, c + 1))
                        }
                        disabled={busy || swapCount >= replacing.quantity}
                        aria-label="Swap one more"
                        className="flex size-9 items-center justify-center rounded-full border border-border text-foreground outline-none transition-colors hover:bg-neutral-100 disabled:opacity-40 focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <Plus className="size-4" strokeWidth={2.5} aria-hidden />
                      </button>
                    </div>
                  </div>
                  {isPartial && (
                    <p className="text-xs text-muted-foreground">
                      {replacing.quantity - swapCount} × {replacing.name} stay on
                      the order.
                    </p>
                  )}
                </section>
              )}

              {hasSizes && (
                <section className="mt-4 flex flex-col gap-2.5">
                  <h3 className="text-[0.6875rem] font-bold uppercase tracking-wider">
                    Size
                  </h3>
                  <div className="grid grid-cols-2 gap-2.5">
                    {sizes.map((size) => {
                      const active = size.id === sizeId;
                      const price = applyDiscount(size.price, discount).final;
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
                          <span
                            className={cn(
                              "text-xs",
                              active ? "text-neutral-300" : "text-muted-foreground",
                            )}
                          >
                            {formatPrice(price)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {picked.addons.length > 0 && (
                <section className="mt-4 flex flex-col gap-1">
                  <h3 className="text-[0.6875rem] font-bold uppercase tracking-wider">
                    Add-on{" "}
                    <span className="font-normal normal-case tracking-normal text-muted-foreground">
                      (up to {maxAddons})
                    </span>
                  </h3>
                  <ul className="flex flex-col">
                    {picked.addons.map((addon) => {
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
                                <Check className="size-3.5" strokeWidth={3} aria-hidden />
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

            {/* Confirm bar — new price + the difference vs the old drink. */}
            <div className="shrink-0 border-t border-border px-5 pb-[calc(0.875rem+env(safe-area-inset-bottom))] pt-3.5">
              {error && (
                <div
                  role="alert"
                  className="mb-3 flex items-start gap-2 rounded-2xl bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700"
                >
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                  <p className="min-w-0 flex-1">{error}</p>
                </div>
              )}
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="font-semibold">Difference</span>
                <span
                  className={cn(
                    "font-bold tabular-nums",
                    diff > 0
                      ? "text-emerald-600"
                      : diff < 0
                        ? "text-rose-600"
                        : "text-muted-foreground",
                  )}
                >
                  {diff > 0 ? "+" : diff < 0 ? "−" : ""}
                  {formatPrice(Math.abs(diff))}
                </span>
              </div>
              <button
                type="button"
                onClick={confirm}
                disabled={!ready || busy}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-black px-4 text-white transition-transform outline-none hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
                    <span className="text-xs font-bold uppercase tracking-wider">
                      Swapping
                    </span>
                  </>
                ) : (
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {isPartial
                      ? `Swap ${swapCount} · ${formatPrice(swappedInTotal)}`
                      : `Replace · ${formatPrice(swappedInTotal)}`}
                  </span>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* ---- Step 1: browse drinks ---- */
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 px-5">
              <SearchInput
                value={query}
                onValueChange={setQuery}
                placeholder="Search drinks..."
                aria-label="Search drinks"
                className="h-11 rounded-2xl border-0 bg-neutral-100 text-base md:text-sm"
              />
              <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {catTabs.map((tab) => {
                  const active = tab.type === activeCat;
                  return (
                    <button
                      key={tab.type}
                      type="button"
                      onClick={() => setActiveCat(tab.type)}
                      aria-pressed={active}
                      className={cn(
                        "shrink-0 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        active
                          ? "border-black bg-black text-white"
                          : "border-border bg-white text-foreground hover:bg-muted",
                      )}
                    >
                      {tab.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {results.length === 0 ? (
                <p className="py-16 text-center text-xs text-muted-foreground">
                  No drinks match.
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {results.map((product) => {
                    const soldOut = !product.isAvailable;
                    const from = applyDiscount(
                      product.sizes && product.sizes.length > 0
                        ? Math.min(...product.sizes.map((s) => s.price))
                        : (product.price ?? 0),
                      getProductDiscount(product),
                    ).final;
                    return (
                      <li key={product.id}>
                        <button
                          type="button"
                          onClick={() => choose(product)}
                          disabled={soldOut}
                          className="flex w-full items-center justify-between gap-3 py-3 text-left outline-none transition-colors hover:bg-neutral-50 disabled:opacity-40 focus-visible:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-heading text-sm font-bold tracking-tight">
                              {product.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {soldOut ? "Sold out" : `from ${formatPrice(from)}`}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
