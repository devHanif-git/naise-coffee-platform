"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { Minus, Plus, Trash2 } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { useCart } from "@/store/cart";
import { useOrderRoutes } from "@/store/order-mode";
import { useRepriceCart } from "@/hooks/use-reprice-cart";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { CustomLineBuilder } from "@/components/store/custom-line-builder";
import type { CartItem } from "@/types/cart";

// Single row inside the cart sheet. Unlike CartItemCard (which is a full-page
// edit link), this is display-only with a quantity stepper and a dedicated "Edit"
// text link that navigates to the product page to re-customize.
// `isOnlyLine` is true when this is the sole line in the cart, so removing it
// would empty the cart — in that case we defer to the clear-cart confirmation
// (via `onRequestClear`) instead of silently wiping everything.
function SheetRow({
  item,
  isOnlyLine,
  onRequestClear,
}: {
  item: CartItem;
  isOnlyLine: boolean;
  onRequestClear: () => void;
}) {
  const { incrementItem, decrementItem } = useCart();
  const routes = useOrderRoutes();

  const subtitle = [item.sizeName ?? "Regular", ...item.addonNames]
    .filter(Boolean)
    .join(", ");
  const lineTotal = item.unitPrice * item.quantity;
  const lineOriginal = item.unitOriginalPrice * item.quantity;
  const onSale = lineOriginal > lineTotal && !item.isReward;
  const lastOne = item.quantity <= 1;

  // Removing the last unit of the only line empties the cart — confirm first.
  const removeReward = () => {
    if (isOnlyLine) onRequestClear();
    else decrementItem(item.key);
  };
  const decrement = () => {
    if (lastOne && isOnlyLine) onRequestClear();
    else decrementItem(item.key);
  };

  return (
    <li className="flex items-center gap-3 py-4">
      {/* Product image — custom (off-menu) lines have no image, so show a
          neutral placeholder block instead. */}
      <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-2xl bg-black p-2">
        {item.image ? (
          <Image
            src={item.image}
            alt={item.name}
            fill
            sizes="64px"
            className="object-contain"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[10px] font-bold uppercase tracking-wide text-white/70">
            Custom
          </span>
        )}
      </div>

      {/* Name, options, price */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="line-clamp-2 font-heading text-sm font-bold leading-snug tracking-tight">
          {item.name}
        </h3>
        {item.isCustom ? (
          <span className="w-fit rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Custom
          </span>
        ) : (
          subtitle && (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          )
        )}
        {onSale ? (
          <div className="mt-0.5 flex flex-col gap-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-bold tabular-nums text-rose-600">
                {formatPrice(lineTotal)}
              </span>
              <span className="text-[0.6875rem] font-medium tabular-nums text-muted-foreground line-through">
                {formatPrice(lineOriginal)}
              </span>
            </div>
            <span className="text-[0.6875rem] font-semibold text-rose-600">
              Save {formatPrice(lineOriginal - lineTotal)}
              {item.discountPercentOff ? ` · ${item.discountPercentOff}% off` : ""}
            </span>
          </div>
        ) : (
          <span className="mt-0.5 text-sm font-bold tabular-nums">
            {formatPrice(lineTotal)}
          </span>
        )}
        {/* Edit link — navigates to the product page to re-customize. Custom
            lines have no product page, so they aren't editable here (change via
            quantity, or remove and re-add). */}
        {!item.isCustom && item.slug && (
          <Link
            href={`${routes.product(item.slug)}?edit=${encodeURIComponent(item.key)}`}
            className="mt-0.5 w-fit text-xs font-medium text-black underline underline-offset-2 transition-colors hover:text-neutral-600"
          >
            Edit
          </Link>
        )}
      </div>

      {/* Quantity stepper */}
      {item.isReward ? (
        <button
          type="button"
          onClick={removeReward}
          aria-label={`Remove ${item.name}`}
          className="flex size-8 shrink-0 items-center justify-center self-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-neutral-100 hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Trash2 className="size-4" strokeWidth={2} aria-hidden />
        </button>
      ) : (
        <div className="flex shrink-0 items-center gap-0.5 self-center rounded-full border border-border p-0.5">
          <button
            type="button"
            onClick={decrement}
            aria-label={lastOne ? `Remove ${item.name}` : "Decrease quantity"}
            className="flex size-7 items-center justify-center rounded-full text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Minus className="size-3.5" strokeWidth={2.5} aria-hidden />
          </button>
          <span className="w-5 text-center text-sm font-bold tabular-nums" aria-live="polite">
            {item.quantity}
          </span>
          <button
            type="button"
            onClick={() => incrementItem(item.key)}
            aria-label="Increase quantity"
            className="flex size-7 items-center justify-center rounded-full text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Plus className="size-3.5" strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      )}
    </li>
  );
}

// Floating cart: a bottom sheet that rises over the menu (dimmed backdrop, but the
// menu stays visible behind) so the user can manage quantities and clear items
// without leaving the page. The sheet sits below the floating bar (z-50 vs z-60).
// Layout offsets follow the bar's position, which differs by mode (see useOrderRoutes).
export function CartSheet({ closing, onClose }: { closing: boolean; onClose: () => void }) {
  const { items, totalItems, clear } = useCart();
  const routes = useOrderRoutes();
  const reprice = useRepriceCart();
  const [confirmingClear, setConfirmingClear] = useState(false);

  useBodyScrollLock(true);

  // Re-price against the live catalogue when the sheet opens. The sheet is only
  // mounted while open, so this mount-only effect fires on every open — catching
  // a promotion toggled in the CMS since the item was added, without a page
  // refresh. reprice() reads the current cart itself and no-ops when nothing
  // changed, so it needn't be in the deps.
  useEffect(() => {
    void reprice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isStore = routes.mode === "store";
  // Where the floating bar's top edge sits above the viewport bottom: kiosk has
  // no tab bar (1rem gap + 3.5rem bar); customer clears the 4rem tab bar too.
  const barTop = isStore
    ? "calc(1rem + 3.5rem + env(safe-area-inset-bottom))"
    : "calc(4rem + 0.5rem + 3.5rem + env(safe-area-inset-bottom))";
  // Match the bar/menu column width per mode.
  const widthClass = isStore ? "max-w-5xl" : "max-w-md";

  // Escape closes the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portal renders to document.body so the sheet lives in the root stacking
  // context, not inside CartFab's own stacking context. This lets the FAB (z-60)
  // and TabBar (z-55) always sit above it at the same level.
  if (typeof document === "undefined") return null;
  const content = (
    <div
      className="fixed inset-0 z-50 pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-label="Your cart"
    >
      {/* Dimmed backdrop — stops just below the floating bar's bottom edge so the
          bar stays interactable through the backdrop. */}
      <button
        type="button"
        aria-label="Close cart"
        onClick={onClose}
        className={
          (closing ? "naise-backdrop-out" : "naise-backdrop-in") +
          " pointer-events-auto absolute top-0 left-0 right-0 opacity-0 bg-black/40"
        }
        style={{ bottom: isStore ? "calc(1rem + env(safe-area-inset-bottom))" : "calc(4rem + 0.5rem + env(safe-area-inset-bottom))" }}
      />

      {/* Panel rises from the bottom, filling 65 dvh so it stops above the
          floating bar (pinned below it). Centered via inset-x-0 + mx-auto so the
          `transform` property stays free for the slide-up/down animation. */}
      <div
        className={
          (closing ? "naise-sheet-out" : "naise-sheet-in") +
          " pointer-events-auto absolute inset-x-0 bottom-0 mx-auto flex h-[65dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-background shadow-[0_8px_40px_rgba(0,0,0,0.18)] " +
          widthClass
        }
      >
        {/* Grabber */}
        <div className="flex justify-center pt-3 pb-1">
          <span className="h-1.5 w-10 rounded-full bg-neutral-300" aria-hidden />
        </div>

        {/* Header */}
        <header className="flex items-center justify-between px-5 pb-3 pt-1">
          <h2 className="font-heading text-lg font-bold tracking-tight">
            My Cart{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({totalItems})
            </span>
          </h2>
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            disabled={totalItems === 0}
            className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-0"
          >
            <Trash2 className="size-4" strokeWidth={2} aria-hidden />
            Clear Order
          </button>
        </header>

        {/* Scrollable item rows. Bottom padding clears the floating bar so the
            last row can scroll above it (+1rem breathing room). */}
        <div
          className="flex-1 overflow-y-auto px-5"
          style={{ paddingBottom: `calc(${barTop} + 1rem)` }}
        >
          {/* Kiosk: an empty cart is a valid starting point for a custom-only
              order, so guide staff to the builder below instead of looking empty. */}
          {isStore && items.length === 0 && (
            <p className="px-1 pt-2 text-sm text-muted-foreground">
              No items yet. Add an off-menu drink below, or browse the menu.
            </p>
          )}
          <ul className="flex flex-col divide-y divide-border">
            {items.map((item) => (
              <SheetRow
                key={item.key}
                item={item}
                isOnlyLine={items.length === 1}
                onRequestClear={() => setConfirmingClear(true)}
              />
            ))}
          </ul>
          {/* Kiosk only: staff can add an off-menu drink into this same cart.
              Hidden on the customer storefront (no free-form pricing there). */}
          {isStore && <CustomLineBuilder />}
        </div>
      </div>

      {/* Clear-cart confirmation */}
      {confirmingClear && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-sheet-title"
          className="pointer-events-auto absolute inset-0 z-[60] flex items-center justify-center bg-black/50 px-6 naise-fade"
          onClick={() => setConfirmingClear(false)}
        >
          <div
            className="w-full max-w-xs rounded-3xl bg-white p-5 text-center shadow-2xl naise-rise"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <Trash2 className="size-6" strokeWidth={2} aria-hidden />
            </div>
            <h3 id="clear-sheet-title" className="mt-3 font-heading text-lg font-bold tracking-tight">
              Clear your cart?
            </h3>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              This removes all items from your cart. You can&rsquo;t undo this.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => {
                  clear();
                  setConfirmingClear(false);
                  onClose();
                }}
                className="flex h-11 w-full items-center justify-center rounded-2xl bg-rose-600 text-xs font-bold text-white transition-colors hover:bg-rose-700 outline-none focus-visible:ring-3 focus-visible:ring-rose-600/40"
              >
                Yes, clear cart
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                className="flex h-11 w-full items-center justify-center rounded-2xl border border-border bg-white text-xs font-bold text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Keep items
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
  return createPortal(content, document.body);
}
