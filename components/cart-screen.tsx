"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronLeft, Gift, Trash2 } from "lucide-react";
import { formatPrice, capitalizeFirst } from "@/lib/format";
import { cn } from "@/lib/utils";
import { images } from "@/constants/images";
import { useCart } from "@/store/cart";
import { CartItemCard } from "@/components/cart-item-card";
import { StoreClosedBanner } from "@/components/store-closed-banner";

export function CartScreen({
  availableProductIds,
  closedMessage,
}: {
  availableProductIds: string[];
  closedMessage?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    items,
    totalPrice,
    totalOriginal,
    totalSaving,
    notes,
    setNotes,
    clear,
    rewardsRemoved,
    acknowledgeRewardsRemoved,
  } = useCart();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  // Count of reward lines the store auto-removed (sign-out / account switch),
  // captured locally so the toast survives after we acknowledge the store.
  const [rewardNotice, setRewardNotice] = useState<number | null>(null);

  // A drink can go sold-out (or archived) after it was added to the cart. The
  // set of currently-orderable product ids comes from the server; any line not
  // in it is flagged and blocks checkout until removed. (placeOrder re-checks
  // this server-side too, as the authoritative guard.)
  const availableSet = new Set(availableProductIds);
  const hasUnavailable = items.some(
    (item) => item.productId !== undefined && !availableSet.has(item.productId),
  );

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

  // The store auto-strips reward lines when the signed-in identity changes
  // (sign-out or an account switch). Pull that one-shot count into a local
  // notice and acknowledge the store so it can't re-fire on the next render.
  useEffect(() => {
    if (rewardsRemoved <= 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- surface the store's one-shot removal count
    setRewardNotice(rewardsRemoved);
    acknowledgeRewardsRemoved();
  }, [rewardsRemoved, acknowledgeRewardsRemoved]);

  // Auto-dismiss the reward notice on its own timer, independent of the merge one.
  useEffect(() => {
    if (rewardNotice === null) return;
    const timer = setTimeout(() => setRewardNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [rewardNotice]);

  const hasItems = items.length > 0;
  const hasSaving = totalSaving > 0;

  return (
    <main className="flex flex-1 flex-col px-5 pt-5">
      {mergeNotice && (
        <CartToast
          tone="success"
          message={`Combined with your existing ${mergeNotice}.`}
          onDismiss={() => setMergeNotice(null)}
        />
      )}
      {rewardNotice !== null && (
        <CartToast
          tone="info"
          message={
            rewardNotice === 1
              ? "A reward was removed from your cart because it was tied to a different account."
              : `${rewardNotice} rewards were removed from your cart because they were tied to a different account.`
          }
          onDismiss={() => setRewardNotice(null)}
        />
      )}
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button
          type="button"
          onClick={() => router.push("/menu")}
          aria-label="Go back"
          className="flex size-9 items-center justify-center justify-self-start rounded-full text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </button>
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
          Your Cart
        </h1>
        {hasItems ? (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            className="justify-self-end px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 rounded"
          >
            Clear
          </button>
        ) : (
          <span aria-hidden />
        )}
      </header>

      {closedMessage && (
        <StoreClosedBanner message={closedMessage} className="mt-4" />
      )}

      {!hasItems ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 pb-16 text-center naise-rise">
          <div className="relative size-32 rounded-full bg-neutral-100">
            <Image
              src={images.latteArt}
              alt=""
              fill
              sizes="128px"
              className="object-contain p-8"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="font-heading text-lg font-bold tracking-tight">
              Your cart is empty
            </h2>
            <p className="max-w-[15rem] text-xs leading-relaxed text-muted-foreground">
              Looks like you haven&rsquo;t added any drinks yet. Find your
              favourite and start brewing.
            </p>
          </div>
          <Link
            href="/menu"
            className="flex h-12 items-center justify-center rounded-2xl bg-black px-7 text-xs font-bold uppercase tracking-wider text-white transition-transform hover:scale-[1.02] active:scale-[0.98] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
                unavailable={item.productId !== undefined && !availableSet.has(item.productId)}
              />
            ))}
          </ul>

          <section
            className="mt-6 flex flex-col gap-2 naise-rise [animation-delay:180ms]"
          >
            <label
              htmlFor="order-notes"
              className="text-[0.6875rem] font-bold uppercase tracking-wider"
            >
              Add Order Notes
            </label>
            <textarea
              id="order-notes"
              value={notes}
              onChange={(e) => setNotes(capitalizeFirst(e.target.value))}
              autoCapitalize="sentences"
              rows={2}
              placeholder="(eg. No ice, Less sugar...)"
              className="w-full resize-none rounded-2xl border border-border bg-transparent px-3 py-2.5 text-xs transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </section>

          <section
            className="mt-6 flex flex-col gap-3 border-t border-border pt-4 naise-rise [animation-delay:240ms]"
          >
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{formatPrice(totalOriginal)}</span>
            </div>
            {hasSaving && (
              <div className="flex items-baseline justify-between text-xs font-medium text-rose-600">
                <span>Promo savings</span>
                <span className="tabular-nums">
                  −{formatPrice(totalSaving)}
                </span>
              </div>
            )}
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Delivery/Pick-up</span>
              <span className="tabular-nums">{formatPrice(0)}</span>
            </div>
            <div className="flex items-baseline justify-between text-sm font-bold">
              <span>Total</span>
              <span className="tabular-nums">{formatPrice(totalPrice)}</span>
            </div>
            {hasSaving && (
              <p className="text-[0.6875rem] font-semibold text-rose-600">
                You&rsquo;re saving {formatPrice(totalSaving)} on this order.
              </p>
            )}
          </section>

          <div
            className="mt-5 flex flex-col gap-2 pb-6 naise-rise [animation-delay:300ms]"
          >
            {hasUnavailable && (
              <p
                role="alert"
                className="rounded-2xl bg-rose-50 px-4 py-2.5 text-center text-xs font-medium text-rose-600"
              >
                Some items are sold out. Remove them to continue.
              </p>
            )}
            <button
              type="button"
              onClick={() => router.push("/checkout")}
              disabled={hasUnavailable}
              className="flex h-12 w-full items-center justify-center rounded-2xl bg-black text-white transition-transform outline-none hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:hover:scale-100"
            >
              <span className="text-xs font-bold uppercase tracking-wider">
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
            className="w-full max-w-xs rounded-3xl bg-white p-5 text-center shadow-2xl naise-rise"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <Trash2 className="size-6" strokeWidth={2} aria-hidden />
            </div>
            <h2
              id="clear-cart-title"
              className="mt-3 font-heading text-lg font-bold tracking-tight"
            >
              Clear your cart?
            </h2>
            <p
              id="clear-cart-desc"
              className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
            >
              This removes all items from your cart. You can&rsquo;t undo this.
            </p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => {
                  clear();
                  setConfirmingClear(false);
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
    </main>
  );
}

// Top-of-screen toast used for transient cart notices. Tapping or swiping up
// dismisses it; each instance owns its own touch tracking so multiple toasts
// don't fight over one ref. `success` is the merge confirmation; `info` is the
// reward-removed notice.
function CartToast({
  tone,
  message,
  onDismiss,
}: {
  tone: "success" | "info";
  message: string;
  onDismiss: () => void;
}) {
  const touchStartY = useRef<number | null>(null);
  return (
    <button
      type="button"
      role="status"
      onClick={onDismiss}
      onTouchStart={(e) => {
        touchStartY.current = e.touches[0].clientY;
      }}
      onTouchMove={(e) => {
        // Swipe up past a small threshold dismisses the toast.
        if (
          touchStartY.current !== null &&
          touchStartY.current - e.touches[0].clientY > 24
        ) {
          onDismiss();
          touchStartY.current = null;
        }
      }}
      className="fixed left-1/2 top-4 z-[70] flex w-[calc(100%-2.5rem)] max-w-[calc(28rem-2.5rem)] -translate-x-1/2 items-center gap-2 rounded-2xl bg-black px-4 py-2.5 text-left text-xs font-medium text-white shadow-lg naise-rise outline-none focus-visible:ring-3 focus-visible:ring-white/30"
      aria-label="Dismiss notification"
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full",
          tone === "success" ? "bg-emerald-500" : "bg-amber-500",
        )}
      >
        {tone === "success" ? (
          <Check className="size-3" strokeWidth={3} aria-hidden />
        ) : (
          <Gift className="size-3" strokeWidth={2.5} aria-hidden />
        )}
      </span>
      <span className="flex-1">{message}</span>
    </button>
  );
}
