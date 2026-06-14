"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronLeft, Trash2 } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { images } from "@/constants/images";
import { useCart } from "@/store/cart";
import { CartItemCard } from "@/components/cart-item-card";

export function CartScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { items, totalPrice, totalOriginal, totalSaving, notes, setNotes, clear } =
    useCart();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  const touchStartY = useRef<number | null>(null);

  // An edit that collapsed two lines into one arrives as ?merged=<name>. Show
  // the notice, then strip the param so a refresh doesn't repeat it.
  useEffect(() => {
    const merged = searchParams.get("merged");
    if (!merged) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from the URL param
    setMergeNotice(merged);
    router.replace("/cart");
  }, [searchParams, router]);

  // Auto-dismiss the notice. Kept separate from the param-read effect so that
  // stripping the URL param above doesn't reset (and thereby cancel) the timer.
  useEffect(() => {
    if (!mergeNotice) return;
    const timer = setTimeout(() => setMergeNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [mergeNotice]);

  const hasItems = items.length > 0;
  const hasSaving = totalSaving > 0;

  return (
    <main className="flex flex-1 flex-col px-5 pt-6">
      {mergeNotice && (
        <button
          type="button"
          role="status"
          onClick={() => setMergeNotice(null)}
          onTouchStart={(e) => {
            touchStartY.current = e.touches[0].clientY;
          }}
          onTouchMove={(e) => {
            // Swipe up past a small threshold dismisses the toast.
            if (
              touchStartY.current !== null &&
              touchStartY.current - e.touches[0].clientY > 24
            ) {
              setMergeNotice(null);
              touchStartY.current = null;
            }
          }}
          className="fixed left-1/2 top-4 z-[70] flex w-[calc(100%-2.5rem)] max-w-[calc(28rem-2.5rem)] -translate-x-1/2 items-center gap-2 rounded-2xl bg-black px-4 py-3 text-left text-sm font-medium text-white shadow-lg naise-rise outline-none focus-visible:ring-3 focus-visible:ring-white/30"
          aria-label="Dismiss notification"
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500">
            <Check className="size-3.5" strokeWidth={3} aria-hidden />
          </span>
          <span className="flex-1">
            Combined with your existing {mergeNotice}.
          </span>
        </button>
      )}
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button
          type="button"
          onClick={() => router.push("/menu")}
          aria-label="Go back"
          className="flex size-9 items-center justify-center justify-self-start rounded-full -ml-1.5 text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" strokeWidth={2.5} aria-hidden />
        </button>
        <h1 className="font-heading text-lg font-bold uppercase tracking-tight">
          Your Cart
        </h1>
        {hasItems ? (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            className="justify-self-end px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded"
          >
            Clear
          </button>
        ) : (
          <span aria-hidden />
        )}
      </header>

      {!hasItems ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 pb-16 text-center naise-rise">
          <div className="relative size-40 overflow-hidden rounded-full bg-neutral-100 p-6">
            <Image
              src={images.latteArt}
              alt=""
              fill
              sizes="160px"
              className="object-contain p-6"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="font-heading text-xl font-bold tracking-tight">
              Your cart is empty
            </h2>
            <p className="max-w-[16rem] text-sm leading-relaxed text-muted-foreground">
              Looks like you haven&rsquo;t added any drinks yet. Find your
              favourite and start brewing.
            </p>
          </div>
          <Link
            href="/menu"
            className="flex h-13 items-center justify-center rounded-2xl bg-black px-8 text-sm font-bold uppercase tracking-wider text-white transition-transform hover:scale-[1.02] active:scale-[0.98] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Browse the menu
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {items.map((item, i) => (
              <CartItemCard
                key={item.key}
                item={item}
                delay={Math.min(i, 6) * 60}
              />
            ))}
          </ul>

          <section
            className="mt-7 flex flex-col gap-2 naise-rise [animation-delay:180ms]"
          >
            <label
              htmlFor="order-notes"
              className="text-xs font-bold uppercase tracking-wider"
            >
              Add Order Notes
            </label>
            <textarea
              id="order-notes"
              value={notes}
              onChange={(e) =>
                setNotes(
                  e.target.value.replace(/^\s*([a-z])/, (_, c: string) =>
                    c.toUpperCase(),
                  ),
                )
              }
              autoCapitalize="sentences"
              rows={2}
              placeholder="(eg. No ice, Less sugar...)"
              className="w-full resize-none rounded-2xl border border-border bg-transparent px-4 py-3 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </section>

          <section
            className="mt-7 flex flex-col gap-3 border-t border-border pt-5 naise-rise [animation-delay:240ms]"
          >
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{formatPrice(totalOriginal)}</span>
            </div>
            {hasSaving && (
              <div className="flex items-baseline justify-between text-sm font-medium text-rose-600">
                <span>Promo savings</span>
                <span className="tabular-nums">
                  −{formatPrice(totalSaving)}
                </span>
              </div>
            )}
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Delivery/Pick-up</span>
              <span className="tabular-nums">{formatPrice(0)}</span>
            </div>
            <div className="flex items-baseline justify-between text-base font-bold">
              <span>Total</span>
              <span className="tabular-nums">{formatPrice(totalPrice)}</span>
            </div>
            {hasSaving && (
              <p className="text-xs font-semibold text-rose-600">
                You&rsquo;re saving {formatPrice(totalSaving)} on this order.
              </p>
            )}
          </section>

          <div
            className="mt-6 pb-6 naise-rise [animation-delay:300ms]"
          >
            <button
              type="button"
              onClick={() => router.push("/checkout")}
              className="flex h-14 w-full items-center justify-center rounded-2xl bg-black text-white transition-transform outline-none hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="text-sm font-bold uppercase tracking-wider">
                Proceed to Checkout
              </span>
            </button>
          </div>
        </>
      )}

      {confirmingClear && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-cart-title"
          aria-describedby="clear-cart-desc"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-6 naise-fade"
          onClick={() => setConfirmingClear(false)}
        >
          <div
            className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-2xl naise-rise"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <Trash2 className="size-7" strokeWidth={2} aria-hidden />
            </div>
            <h2
              id="clear-cart-title"
              className="mt-4 font-heading text-xl font-bold tracking-tight"
            >
              Clear your cart?
            </h2>
            <p
              id="clear-cart-desc"
              className="mt-1.5 text-sm leading-relaxed text-muted-foreground"
            >
              This removes all items from your cart. You can&rsquo;t undo this.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => {
                  clear();
                  setConfirmingClear(false);
                }}
                className="flex h-12 w-full items-center justify-center rounded-2xl bg-rose-600 text-sm font-bold text-white transition-colors hover:bg-rose-700 outline-none focus-visible:ring-3 focus-visible:ring-rose-600/40"
              >
                Yes, clear cart
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                className="flex h-12 w-full items-center justify-center rounded-2xl border border-border bg-white text-sm font-bold text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Keep items
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
