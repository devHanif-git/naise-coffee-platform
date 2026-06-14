"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Apple,
  Banknote,
  Check,
  ChevronLeft,
  CreditCard,
  Loader2,
  PartyPopper,
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
        <div className="flex size-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 naise-rise">
          <PartyPopper className="size-8" strokeWidth={2} aria-hidden />
        </div>
        <h1 className="mt-5 font-heading text-2xl font-bold tracking-tight naise-rise [animation-delay:60ms]">
          Order placed!
        </h1>
        <p className="mt-2 max-w-[18rem] text-sm leading-relaxed text-muted-foreground naise-rise [animation-delay:120ms]">
          The store has been notified and is preparing your order. Your order
          reference is below.
        </p>
        <span className="mt-5 rounded-2xl bg-neutral-100 px-5 py-2.5 font-heading text-lg font-bold tracking-tight tabular-nums naise-rise [animation-delay:180ms]">
          {placedNumber}
        </span>
        <Link
          href="/menu"
          className="mt-8 flex h-13 items-center justify-center rounded-2xl bg-black px-8 text-sm font-bold uppercase tracking-wider text-white transition-transform hover:scale-[1.02] active:scale-[0.98] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 naise-rise [animation-delay:240ms]"
        >
          Back to menu
        </Link>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col px-5 pt-6 pb-8">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button
          type="button"
          onClick={() => router.push("/cart")}
          aria-label="Go back to cart"
          className="flex size-9 items-center justify-center justify-self-start rounded-full -ml-1.5 text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" strokeWidth={2.5} aria-hidden />
        </button>
        <h1 className="font-heading text-lg font-bold uppercase tracking-tight">
          Checkout
        </h1>
        <span aria-hidden />
      </header>

      <section className="mt-6 flex flex-col gap-3 naise-rise">
        <h2 className="text-xs font-bold uppercase tracking-wider">
          Payment Method
        </h2>

        <div className="grid grid-cols-2 gap-3">
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
                  "relative flex flex-col items-start gap-2.5 rounded-2xl p-4 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "bg-black text-white"
                    : "bg-neutral-100 text-foreground hover:bg-neutral-200",
                )}
              >
                {active && (
                  <span className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-white">
                    <Check
                      className="size-3.5 text-black"
                      strokeWidth={3}
                      aria-hidden
                    />
                  </span>
                )}
                <span
                  className={cn(
                    "flex size-10 items-center justify-center rounded-xl transition-colors",
                    active ? "bg-white/15" : "bg-white",
                  )}
                >
                  <Icon className="size-5" strokeWidth={2} aria-hidden />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold">{method.name}</span>
                  <span
                    className={cn(
                      "text-xs leading-snug",
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
                    "flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    active
                      ? "border-black bg-neutral-50"
                      : "border-border bg-white hover:bg-neutral-50",
                  )}
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100">
                    <Icon className="size-5" strokeWidth={2} aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-bold">{method.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
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
        className="mt-7 flex flex-col gap-3 naise-rise [animation-delay:60ms]"
      >
        <h2 className="text-xs font-bold uppercase tracking-wider">
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
                className="flex items-center gap-3 py-3.5 text-sm"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-black text-xs font-bold tabular-nums text-white">
                  {item.quantity}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{item.name}</span>
                  {subtitle && (
                    <span className="truncate text-xs text-muted-foreground">
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
          <div className="flex items-start gap-2 rounded-2xl bg-neutral-50 px-4 py-3 text-sm">
            <StickyNote
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
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
        className="mt-7 flex flex-col gap-3 border-t border-border pt-5 naise-rise [animation-delay:120ms]"
      >
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="tabular-nums">{formatPrice(totalOriginal)}</span>
        </div>
        {hasSaving && (
          <div className="flex items-baseline justify-between text-sm font-medium text-rose-600">
            <span>Promo savings</span>
            <span className="tabular-nums">−{formatPrice(totalSaving)}</span>
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
      </section>

      <p
        className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground naise-rise [animation-delay:180ms]"
      >
        <ShieldCheck className="size-3.5" strokeWidth={2} aria-hidden />
        Your order goes straight to the store once you place it.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 naise-rise"
        >
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0"
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
        className="mt-5 flex h-14 w-full items-center justify-between rounded-2xl bg-black px-6 text-white transition-transform outline-none hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100 naise-rise [animation-delay:240ms]"
      >
        {submitting ? (
          <span className="flex w-full items-center justify-center gap-2">
            <Loader2 className="size-5 animate-spin" strokeWidth={2.5} aria-hidden />
            <span className="text-sm font-bold uppercase tracking-wider">
              Placing Order
            </span>
          </span>
        ) : (
          <>
            <span className="text-sm font-bold uppercase tracking-wider">
              Place Order
            </span>
            <span className="text-sm font-bold tabular-nums">
              {formatPrice(totalPrice)}
            </span>
          </>
        )}
      </button>
    </main>
  );
}
