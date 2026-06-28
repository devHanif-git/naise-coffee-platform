"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/store/cart";
import { useOrderRoutes } from "@/store/order-mode";
import { formatPrice } from "@/lib/format";
import { images } from "@/constants/images";
import { cn } from "@/lib/utils";
import { CartSheet } from "@/components/cart-sheet";

// Floating cart affordance, shared by the customer storefront and the kiosk
// (/store). Empty → a circular cart button bottom-right; once items are added it
// becomes a full-width bar with the count and total. Only shown on the menu list
// (customer: /menu, kiosk: /store) — other screens have their own flows.
//
// When the cart is empty, tapping the circle previews the full bar (zeroed)
// instead of navigating. Opening sweeps the bar open right→left; closing slides
// it off the right edge before collapsing back to the circle.
//
// When the cart has items, tapping the bar opens the floating cart sheet (rising
// from the bottom over the menu); Checkout routes to the mode's checkout.
//
// Layout differs by mode: the customer column is max-w-md and the bar sits above
// the tab bar (4rem); the kiosk column is max-w-5xl with no tab bar, so the bar
// sits near the bottom edge.

const CLOSE_MS = 550; // keep in sync with naise-*-out animation duration
const SHEET_CLOSE_MS = 320; // keep in sync with naise-sheet-out duration

type Preview = "closed" | "open" | "closing";
type Sheet = "closed" | "open" | "closing";

export function CartFab() {
  const pathname = usePathname();
  const router = useRouter();
  const routes = useOrderRoutes();
  const { items, totalItems, totalPrice, hydrated } = useCart();
  const [preview, setPreview] = useState<Preview>("closed");
  const [sheet, setSheet] = useState<Sheet>("closed");
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isEmpty = items.length === 0;
  const isStore = routes.mode === "store";
  // Column width + bottom offset per mode. Kiosk has no tab bar, so the bar sits
  // just above the safe-area; the customer bar clears the 4rem tab bar.
  const widthClass = isStore ? "max-w-5xl" : "max-w-md";
  const bottomClass = isStore
    ? "bottom-[calc(1rem+env(safe-area-inset-bottom))]"
    : "bottom-[calc(4rem+0.5rem+env(safe-area-inset-bottom))]";

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (sheetTimer.current) clearTimeout(sheetTimer.current);
  }, []);

  if (!hydrated) return null;
  if (pathname !== routes.menu) return null;

  // Real items always show the bar — drop any stale empty-preview state during
  // render (React's "adjust state when derived value changes" pattern).
  if (!isEmpty && preview !== "closed") {
    setPreview("closed");
  }
  // An emptied cart can't show the sheet — snap it shut. Exception: the kiosk
  // keeps the sheet usable while empty so staff can place a custom-only order
  // (the custom-drink builder lives inside the sheet).
  if (isEmpty && sheet !== "closed" && !isStore) {
    setSheet("closed");
  }

  const collapse = () => {
    if (preview !== "open") return;
    setPreview("closing");
    closeTimer.current = setTimeout(() => setPreview("closed"), CLOSE_MS);
  };

  const toggleSheet = () => {
    if (sheet === "open") { closeSheet(); } else { setSheet("open"); }
  };
  const closeSheet = () => {
    setSheet("closing");
    sheetTimer.current = setTimeout(() => setSheet("closed"), SHEET_CLOSE_MS);
  };

  // Empty + collapsed → circular FAB. In the kiosk, tapping it opens the cart
  // sheet straight away so staff can add a custom-only drink (the builder lives
  // in the sheet); the circle stays put with the sheet rising over it. On the
  // customer storefront an empty tap previews the zeroed bar instead (preview
  // "open" falls through to the bar branch below).
  if (isEmpty && preview === "closed") {
    return (
      <div className={cn("pointer-events-none fixed inset-x-0 z-[60] mx-auto flex w-full justify-end px-4", widthClass, bottomClass)}>
        <button
          type="button"
          onClick={() => (isStore ? toggleSheet() : setPreview("open"))}
          aria-label={isStore ? "Open cart" : "Show cart"}
          aria-haspopup={isStore ? "dialog" : undefined}
          className="naise-fade pointer-events-auto flex size-14 items-center justify-center overflow-hidden rounded-full bg-black shadow-lg outline-none transition-transform hover:scale-105 active:scale-95 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Image
            src={images.emptyCart}
            alt=""
            width={56}
            height={56}
            className="size-full object-cover"
            aria-hidden
          />
        </button>
        {/* Kiosk: the sheet can be open over an empty cart (custom-only flow). */}
        {sheet !== "closed" && (
          <CartSheet closing={sheet === "closing"} onClose={closeSheet} />
        )}
      </div>
    );
  }

  const closing = preview === "closing";

  // Logo + count badge, shared by the real bar and the empty preview.
  const logoInner = (
    <>
      <Image
        src={images.emptyCartNoBg}
        alt=""
        width={48}
        height={48}
        className="size-full object-contain"
        aria-hidden
      />
      {/* key by count so the badge re-pops each time an item is added. */}
      <span
        key={totalItems}
        className="naise-pop absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-black px-1 text-[11px] font-bold leading-none tabular-nums text-white ring-2 ring-white"
      >
        {totalItems}
      </span>
    </>
  );

  const logoBase = "naise-glide absolute left-1 top-1/2 z-10 size-12 -translate-y-1/2";

  // Full bar — real cart, or the collapsible empty preview (zeroed totals).
  return (
    <div className={cn("fixed inset-x-0 z-[60] mx-auto w-full px-4", widthClass, bottomClass)}>
      {/* Positioning context that does NOT clip, so the logo can sit above the
          bar and carry the count badge on its corner. On close the whole thing
          slides off the right edge of the screen. */}
      <div className={cn("relative", closing && "naise-slide-out-right")}>
        <div className="naise-sweep relative flex h-14 items-center justify-between overflow-hidden rounded-2xl bg-black pl-2.5 pr-2.5 text-white shadow-lg">
          {/* Toggle zone (logo slot + total) — fills the bar so tapping anywhere
              left of Checkout opens the sheet (items) or collapses the preview. */}
          <button
            type="button"
            onClick={isEmpty ? collapse : toggleSheet}
            aria-label={isEmpty ? "Hide cart" : "View cart"}
            aria-haspopup={isEmpty ? undefined : "dialog"}
            className="flex h-full flex-1 items-center rounded-xl pr-2 text-left outline-none transition-transform active:scale-[0.98] focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="w-[3.25rem] shrink-0" aria-hidden />
            <span className="text-base font-bold tabular-nums">{formatPrice(totalPrice)}</span>
          </button>

          {/* Checkout: with items → go to checkout; empty preview → inert chip
              that just collapses the bar (nothing to check out). */}
          {isEmpty ? (
            <button
              type="button"
              onClick={collapse}
              aria-label="Hide cart"
              className="flex h-10 shrink-0 items-center rounded-xl bg-white/10 px-4 text-sm font-semibold text-white/40 outline-none transition-transform active:scale-95 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Checkout
            </button>
          ) : (
            <button
              type="button"
              onClick={() => router.push(routes.checkout)}
              className="flex h-10 shrink-0 items-center rounded-xl bg-white px-4 text-sm font-semibold text-black outline-none transition-transform hover:scale-[1.03] active:scale-95 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Checkout
            </button>
          )}
        </div>

        {/* Logo sits above the bar; pointer-events-none so taps fall through to
            the toggle zone behind it. */}
        <span className={cn(logoBase, "pointer-events-none")}>{logoInner}</span>
      </div>

      {/* Floating cart sheet — rises from the bottom over the menu. */}
      {sheet !== "closed" && (
        <CartSheet
          closing={sheet === "closing"}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}
