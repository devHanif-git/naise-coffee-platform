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
  Flame,
  Loader2,
  Lock,
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
import { useAuth } from "@/store/auth";
import { useStreak } from "@/hooks/use-streak";
import { useBeans } from "@/store/beans";
import { getStreakAwards, type StreakAward } from "@/data/rewards";
import { paymentMethods, defaultPaymentMethodId } from "@/data/payment-methods";
import type { PaymentMethodId } from "@/types/payment";
import { GuestSignInModal } from "@/components/guest-signin-modal";
import { DuitnowQrCard } from "@/components/duitnow-qr-card";
import { placeOrder as placeOrderAction } from "@/app/(customer)/checkout/actions";
import { getOrCreateOwnerId } from "@/lib/auth/owner-id";
import { uploadReceipt } from "@/lib/orders/receipt";

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
  const { isAuthenticated, hydrated: authHydrated } = useAuth();
  const { checkIn } = useStreak();
  const { canAfford, spendAndEarn, creditBeans, earnRate } = useBeans();
  const [selected, setSelected] =
    useState<PaymentMethodId>(defaultPaymentMethodId);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // DuitNow QR receipt: the picked file (held until place) and any upload error.
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  // Set once the order is placed; switches the screen to the confirmation view.
  const [placedNumber, setPlacedNumber] = useState<string | null>(null);
  // Streak bonuses earned by placing this order, shown on the confirmation.
  const [streakAwards, setStreakAwards] = useState<StreakAward[]>([]);
  // Guest nudge shown at Place Order (or when a guest taps a members-only
  // method like Cash). Dismissed by signing in or choosing to continue.
  const [showGuestModal, setShowGuestModal] = useState(false);

  const hasItems = items.length > 0;

  // Nothing to check out: once the persisted cart has loaded and is empty,
  // send the customer back to the cart rather than showing a dead screen.
  // Skipped after a successful order — the cart is intentionally cleared then
  // and the confirmation view takes over.
  useEffect(() => {
    if (hydrated && !hasItems && !placedNumber) router.replace("/cart");
  }, [hydrated, hasItems, placedNumber, router]);

  // A guest can't keep Cash selected (it's pay-at-counter, members only). Once
  // the auth state has loaded, move them to the first prepaid method so the
  // selector never sits on a locked option.
  useEffect(() => {
    if (!authHydrated || isAuthenticated) return;
    const current = paymentMethods.find((m) => m.id === selected);
    if (current?.requiresAuth) {
      const fallback = paymentMethods.find((m) => !m.requiresAuth);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile selection once auth state is known
      if (fallback) setSelected(fallback.id);
    }
  }, [authHydrated, isAuthenticated, selected]);

  // Avoid a flash of the empty/redirecting state before localStorage loads.
  if (!placedNumber && (!hydrated || !hasItems)) return null;

  const featured = paymentMethods.filter((m) => m.featured);
  const others = paymentMethods.filter((m) => !m.featured);
  const hasSaving = totalSaving > 0;
  // Beans this order would earn if the customer were signed in — drives the
  // guest nudge's headline. Mirrors the store's earn rule (floor of RM × rate).
  const beansAtStake = Math.floor((totalPrice / 100) * earnRate);

  // Selecting a members-only method (Cash) as a guest opens the sign-in nudge
  // instead of switching to it; otherwise it's a normal selection.
  function selectMethod(id: PaymentMethodId) {
    const method = paymentMethods.find((m) => m.id === id);
    if (!isAuthenticated && method?.requiresAuth) {
      setShowGuestModal(true);
      return;
    }
    setSelected(id);
  }

  // Place Order entry point. Guests see the nudge first; from there they sign
  // in or continue (which calls placeOrder directly). Members place straight.
  function onPlaceOrder() {
    if (submitting) return;
    if (!isAuthenticated) {
      setShowGuestModal(true);
      return;
    }
    void placeOrder();
  }

  // Rewards being redeemed in this order, with their Bean costs. Reward lines
  // are always quantity 1; the cost is settled against the balance at checkout.
  const redeemedRewards = items
    .filter((item) => item.isReward)
    .map((item) => ({ name: item.name, cost: item.rewardCost ?? 0 }));
  const totalRewardCost = redeemedRewards.reduce((sum, r) => sum + r.cost, 0);

  async function placeOrder() {
    if (submitting) return;
    // Cash is members-only (pay-at-counter); a guest should never reach here
    // with it selected, but guard server-side intent anyway.
    const method = paymentMethods.find((m) => m.id === selected);
    if (!method) return;
    if (method.requiresAuth && !isAuthenticated) {
      setShowGuestModal(true);
      return;
    }

    // Re-validate Beans cover the redeemed rewards. The balance could have
    // changed since the reward was added to the cart (another order, another
    // tab), so this is the authoritative check before committing.
    if (totalRewardCost > 0 && !canAfford(totalRewardCost)) {
      setError(
        "You don't have enough Beans to redeem the reward in your cart. Remove it to continue.",
      );
      return;
    }

    if (selected === "duitnow-qr" && !receiptFile) {
      setError("Please attach your DuitNow QR payment receipt.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      let proofOfPaymentUrl: string | undefined;
      if (selected === "duitnow-qr" && receiptFile) {
        proofOfPaymentUrl = await uploadReceipt(receiptFile, getOrCreateOwnerId());
      }

      const result = await placeOrderAction({
        items: items.map((item) => ({
          name: item.name,
          quantity: item.quantity,
          sizeName: item.sizeName,
          addonNames: item.addonNames,
          unitPrice: item.unitPrice,
        })),
        paymentMethod: method.name,
        notes,
        subtotal: totalOriginal,
        total: totalPrice,
        // Per-browser stable id; minted on first call and reused thereafter.
        // Same id is adopted by the auth store on sign-in, so guest orders
        // automatically belong to the registered account afterwards.
        ownerId: getOrCreateOwnerId(),
        proofOfPaymentUrl,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Order is in and the store has been notified. The Beans ledger and
      // streak only apply to members — a guest who chose to continue earns
      // nothing (that's exactly what the sign-in nudge was holding back).
      if (isAuthenticated) {
        // Settle the Beans ledger (deduct redeemed reward costs, earn Beans on
        // the paid total) and mark today's streak — placing an order is the
        // real-world trigger for both. If today's check-in landed on a streak
        // checkpoint (3rd day of the week, a completed week, or a 30-day mark),
        // credit those bonuses too and note them on the confirmation screen.
        spendAndEarn({ paidTotal: totalPrice, rewards: redeemedRewards });
        const checkInResult = checkIn();
        if (checkInResult.isNewCheckIn) {
          const awards = getStreakAwards(checkInResult.streakDays);
          for (const award of awards) creditBeans(award.beans, award.label);
          if (awards.length > 0) setStreakAwards(awards);
        }
      }
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

        {streakAwards.length > 0 && (
          <div className="mt-4 flex flex-col items-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 naise-rise [animation-delay:270ms]">
            <span className="flex items-center gap-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.18em] text-emerald-700">
              <Flame className="size-3.5" strokeWidth={2.5} aria-hidden />
              Streak Bonus
            </span>
            {streakAwards.map((award) => (
              <span key={award.label} className="text-xs font-semibold text-emerald-800">
                +{award.beans.toLocaleString()} Beans · {award.label}
              </span>
            ))}
          </div>
        )}

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
          className="flex size-9 items-center justify-center justify-self-start rounded-full text-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </button>
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
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
            const locked = method.requiresAuth && !isAuthenticated;
            return (
              <button
                key={method.id}
                type="button"
                onClick={() => selectMethod(method.id)}
                aria-pressed={active}
                className={cn(
                  "relative flex flex-col items-start gap-2 rounded-2xl p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  active
                    ? "bg-black text-white"
                    : locked
                      ? "bg-neutral-100 text-muted-foreground hover:bg-neutral-200"
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
                {locked && !active && (
                  <span className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-white text-muted-foreground">
                    <Lock className="size-3" strokeWidth={2.5} aria-hidden />
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
                  onClick={() => selectMethod(method.id)}
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

        {selected === "duitnow-qr" && (
          <div className="mt-4">
            <DuitnowQrCard />
          </div>
        )}

        {selected === "duitnow-qr" && (
          <div className="mt-2.5 flex flex-col gap-2 rounded-2xl bg-neutral-50 px-4 py-3">
            <label
              htmlFor="receipt"
              className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
            >
              Payment Receipt
            </label>
            <input
              id="receipt"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-black file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            />
            {receiptFile && (
              <span className="truncate text-xs text-muted-foreground">
                {receiptFile.name}
              </span>
            )}
          </div>
        )}
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
                  {item.isReward && (
                    <span className="text-[0.6875rem] font-semibold text-emerald-600">
                      Reward Redeem
                      {item.rewardCost ? ` · ${item.rewardCost.toLocaleString()} Beans` : ""}
                    </span>
                  )}
                </div>
                <span className="shrink-0 font-semibold tabular-nums">
                  {item.isReward && lineTotal === 0 ? "RM 0.00" : formatPrice(lineTotal)}
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
        onClick={onPlaceOrder}
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

      {showGuestModal && (
        <GuestSignInModal
          beansAtStake={beansAtStake}
          redirect="/checkout"
          onClose={() => setShowGuestModal(false)}
          onContinueAsGuest={() => {
            setShowGuestModal(false);
            void placeOrder();
          }}
        />
      )}
    </main>
  );
}
