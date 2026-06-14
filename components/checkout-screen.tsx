"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Apple,
  Banknote,
  Check,
  ChevronLeft,
  CreditCard,
  Loader2,
  QrCode,
  ShieldCheck,
  Smartphone,
  StickyNote,
  TriangleAlert,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import { images } from "@/constants/images";
import { cn } from "@/lib/utils";
import { useCart } from "@/store/cart";
import { paymentMethods, defaultPaymentMethodId } from "@/data/payment-methods";
import type { PaymentMethodId } from "@/types/payment";
import { placeOrder as placeOrderAction } from "@/app/(customer)/checkout/actions";

// Icons live in the UI layer so the data file stays pure content. Branded
// wallets use a representative lucide glyph (no official logos shipped yet);
// selection state — not colour — carries the visual signal, matching the
// size selector on the product page.
const methodIcons: Record<PaymentMethodId, LucideIcon> = {
  cash: Banknote,
  "duitnow-qr": QrCode,
  "apple-pay": Apple,
  "google-pay": CreditCard,
  "tng-ewallet": Wallet,
  boost: Zap,
  grabpay: Smartphone,
};

export function CheckoutScreen() {
  const router = useRouter();
  const { items, hydrated, totalPrice, totalOriginal, totalSaving, notes, clear } =
    useCart();
  const [selected, setSelected] =
    useState<PaymentMethodId>(defaultPaymentMethodId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the order is placed; switches the screen to the confirmation view.
  const [placedNumber, setPlacedNumber] = useState<string | null>(null);

  const hasItems = items.length > 0;

  // Nothing to check out: once the persisted cart has loaded and is empty,
  // send the customer back to the cart rather than showing a dead screen.
  // Skipped after a successful order — the cart is intentionally cleared then
  // and the confirmation view takes over.
  useEffect(() => {
    if (hydrated && !hasItems && !placedNumber) router.replace("/cart");
  }, [hydrated, hasItems, placedNumber, router]);

  // Avoid a flash of the empty/redirecting state before localStorage loads.
  if (!placedNumber && (!hydrated || !hasItems)) return null;

  const featured = paymentMethods.filter((m) => m.featured);
  const others = paymentMethods.filter((m) => !m.featured);
  const hasSaving = totalSaving > 0;

  async function placeOrder() {
    // Only Cash is wired end to end for now: it creates the order and notifies
    // the store over Telegram. Other methods await their payment integration.
    if (selected !== "cash") {
      setError("This payment method isn't available yet. Please choose Cash.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const result = await placeOrderAction({
        items: items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          sizeName: item.sizeName,
          addonNames: item.addonNames,
          unitPrice: item.unitPrice,
        })),
        paymentMethod: "Cash",
        notes,
        subtotal: totalOriginal,
        total: totalPrice,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Order is in and the store has been notified. Clear the cart and show
      // the confirmation; reading placedNumber keeps the success view mounted.
      setPlacedNumber(result.orderNumber);
      clear();
    } catch {
      setError("Something went wrong placing your order. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (placedNumber) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-5 py-16 text-center">
        <div className="relative size-32 naise-pop sm:size-36">
          <Image
            src={images.celebration}
            alt="A cup celebrating with confetti"
            fill
            sizes="(min-width: 640px) 144px, 128px"
            className="object-contain"
          />
        </div>
        <p className="mt-4 text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-muted-foreground naise-rise [animation-delay:60ms]">
          Order Confirmed
        </p>
        <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight naise-rise [animation-delay:120ms]">
          You&rsquo;re all set!
        </h1>
        <p className="mt-2 max-w-[17rem] text-xs leading-relaxed text-muted-foreground naise-rise [animation-delay:180ms]">
          The store has been notified and is brewing your order. Show this
          reference when you collect it.
        </p>

        <div className="mt-6 inline-flex flex-col items-center rounded-2xl bg-black px-6 py-3 text-white naise-rise [animation-delay:240ms]">
          <span className="text-[0.5625rem] font-semibold uppercase tracking-[0.2em] text-white/50">
            Order Ref
          </span>
          <span className="mt-0.5 font-heading text-xl font-bold tracking-tight tabular-nums">
            {placedNumber}
          </span>
        </div>

        <Link
          href="/menu"
          className="mt-7 flex h-12 items-center justify-center rounded-2xl bg-black px-7 text-xs font-bold uppercase tracking-wider text-white transition-transform hover:scale-[1.02] active:scale-[0.98] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 naise-rise [animation-delay:300ms]"
        >
          Back to menu
        </Link>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col px-5 pt-5 pb-8">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button
          type="button"
          onClick={() => router.push("/cart")}
          aria-label="Go back to cart"
          className="flex size-8 items-center justify-center justify-self-start rounded-full -ml-1.5 text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-5" strokeWidth={2.5} aria-hidden />
        </button>
        <h1 className="font-heading text-base font-bold uppercase tracking-tight">
          Checkout
        </h1>
        <span aria-hidden />
      </header>

      <section className="mt-5 flex flex-col gap-2.5 naise-rise">
        <h2 className="text-[0.6875rem] font-bold uppercase tracking-wider">
          Payment Method
        </h2>

        <div className="grid grid-cols-2 gap-2.5">
          {featured.map((method) => {
            const Icon = methodIcons[method.id];
            const active = selected === method.id;
            return (
              <button
                key={method.id}
                type="button"
                onClick={() => setSelected(method.id)}
                aria-pressed={active}
                className={cn(
                  "relative flex flex-col items-start gap-2 rounded-2xl p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "bg-black text-white"
                    : "bg-neutral-100 text-foreground hover:bg-neutral-200",
                )}
              >
                {active && (
                  <span className="absolute right-3 top-3 flex size-4 items-center justify-center rounded-full bg-white">
                    <Check
                      className="size-3 text-black"
                      strokeWidth={3}
                      aria-hidden
                    />
                  </span>
                )}
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-xl transition-colors",
                    active ? "bg-white/15" : "bg-white",
                  )}
                >
                  <Icon className="size-4" strokeWidth={2} aria-hidden />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-bold">{method.name}</span>
                  <span
                    className={cn(
                      "text-[0.6875rem] leading-snug",
                      active ? "text-neutral-300" : "text-muted-foreground",
                    )}
                  >
                    {method.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <ul className="mt-1 flex flex-col gap-2">
          {others.map((method) => {
            const Icon = methodIcons[method.id];
            const active = selected === method.id;
            return (
              <li key={method.id}>
                <button
                  type="button"
                  onClick={() => setSelected(method.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border p-2.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "border-black bg-neutral-50"
                      : "border-border bg-white hover:bg-neutral-50",
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100">
                    <Icon className="size-4" strokeWidth={2} aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-xs font-bold">{method.name}</span>
                    <span className="truncate text-[0.6875rem] text-muted-foreground">
                      {method.description}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      active
                        ? "border-black bg-black text-white"
                        : "border-neutral-300 bg-white",
                    )}
                  >
                    {active && (
                      <Check className="size-3" strokeWidth={3} aria-hidden />
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        className="mt-6 flex flex-col gap-2.5 naise-rise [animation-delay:60ms]"
      >
        <h2 className="text-[0.6875rem] font-bold uppercase tracking-wider">
          Order Summary
        </h2>
        <ul className="flex flex-col divide-y divide-border rounded-2xl bg-neutral-50 px-4">
          {items.map((item) => {
            const subtitle = [item.sizeName ?? "Regular", ...item.addonNames]
              .filter(Boolean)
              .join(", ");
            const lineTotal = item.unitPrice * item.quantity;
            return (
              <li
                key={item.key}
                className="flex items-center gap-3 py-3 text-xs"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-black text-[0.6875rem] font-bold tabular-nums text-white">
                  {item.quantity}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{item.name}</span>
                  {subtitle && (
                    <span className="truncate text-[0.6875rem] text-muted-foreground">
                      {subtitle}
                    </span>
                  )}
                </div>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatPrice(lineTotal)}
                </span>
              </li>
            );
          })}
        </ul>
        {notes.trim() && (
          <div className="flex items-start gap-2 rounded-2xl bg-neutral-50 px-4 py-2.5 text-xs">
            <StickyNote
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              strokeWidth={2}
              aria-hidden
            />
            <p className="min-w-0 flex-1 whitespace-pre-line break-words text-foreground">
              <span className="font-semibold">Note: </span>
              {notes.trim()}
            </p>
          </div>
        )}
      </section>

      <section
        className="mt-6 flex flex-col gap-3 border-t border-border pt-4 naise-rise [animation-delay:120ms]"
      >
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">{formatPrice(totalOriginal)}</span>
        </div>
        {hasSaving && (
          <div className="flex items-baseline justify-between text-xs font-medium text-rose-600">
            <span>Promo savings</span>
            <span className="tabular-nums">−{formatPrice(totalSaving)}</span>
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
      </section>

      <p
        className="mt-4 flex items-center justify-center gap-1.5 text-[0.6875rem] text-muted-foreground naise-rise [animation-delay:180ms]"
      >
        <ShieldCheck className="size-3.5" strokeWidth={2} aria-hidden />
        Your order goes straight to the store once you place it.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-2xl bg-rose-50 px-4 py-2.5 text-xs text-rose-700 naise-rise"
        >
          <TriangleAlert
            className="mt-0.5 size-3.5 shrink-0"
            strokeWidth={2}
            aria-hidden
          />
          <p className="min-w-0 flex-1">{error}</p>
        </div>
      )}

      <button
        type="button"
        onClick={placeOrder}
        disabled={submitting}
        className="mt-4 flex h-12 w-full items-center justify-between rounded-2xl bg-black px-5 text-white transition-transform outline-none hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100 naise-rise [animation-delay:240ms]"
      >
        {submitting ? (
          <span className="flex w-full items-center justify-center gap-2">
            <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
            <span className="text-xs font-bold uppercase tracking-wider">
              Placing Order
            </span>
          </span>
        ) : (
          <>
            <span className="text-xs font-bold uppercase tracking-wider">
              Place Order
            </span>
            <span className="text-xs font-bold tabular-nums">
              {formatPrice(totalPrice)}
            </span>
          </>
        )}
      </button>
    </main>
  );
}
