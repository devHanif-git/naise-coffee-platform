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
  Copy,
  CreditCard,
  Flame,
  Landmark,
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
import { useBeans } from "@/store/beans";
import type { StreakAward } from "@/types/reward";
import type { PaymentMethod, PaymentMethodId } from "@/types/payment";
import type { BankDetails } from "@/lib/settings/payments";
import { GuestSignInModal } from "@/components/guest-signin-modal";
import { DuitnowQrCard } from "@/components/duitnow-qr-card";
import { StoreClosedBanner } from "@/components/store-closed-banner";
import { PhonePromptSheet } from "@/components/phone-prompt-sheet";
import { placeOrder as placeOrderAction } from "@/app/(customer)/checkout/actions";
import { getOrCreateOwnerId } from "@/lib/auth/owner-id";
import { uploadReceipt } from "@/lib/orders/receipt";
import { useProfile } from "@/store/profile";

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
  "bank-transfer": Landmark,
};

export function CheckoutScreen({
  closedMessage,
  methods,
  bank,
}: {
  closedMessage?: string | null;
  methods: PaymentMethod[];
  bank: BankDetails;
}) {
  const router = useRouter();
  const { items, hydrated, totalPrice, totalOriginal, totalSaving, notes, clear } =
    useCart();
  const { isAuthenticated, hydrated: authHydrated } = useAuth();
  const { canAfford, earnRate } = useBeans();
  const { profile, updateProfile } = useProfile();
  // Default to the first enabled method; null when none are enabled.
  const [selected, setSelected] = useState<PaymentMethodId | null>(
    methods[0]?.id ?? null,
  );
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
  // The number to stamp on this order: a value entered in the prompt this
  // attempt, else the member's saved profile number. Guests have no profile, so
  // theirs only ever comes from the prompt.
  const [enteredPhone, setEnteredPhone] = useState<string | null>(null);
  // Controls the phone prompt sheet shown before placing when no number is known.
  const [showPhonePrompt, setShowPhonePrompt] = useState(false);

  const hasItems = items.length > 0;

  // Nothing to check out: once the persisted cart has loaded and is empty,
  // send the customer back to the cart rather than showing a dead screen.
  // Skipped after a successful order — the cart is intentionally cleared then
  // and the confirmation view takes over.
  useEffect(() => {
    if (hydrated && !hasItems && !placedNumber) router.replace("/cart");
  }, [hydrated, hasItems, placedNumber, router]);

  // A guest can't keep a members-only method (Cash) selected. Once the auth
  // state has loaded, move them to the first non-gated enabled method so the
  // selector never sits on a locked option.
  useEffect(() => {
    if (!authHydrated || isAuthenticated) return;
    const current = methods.find((m) => m.id === selected);
    if (current?.requiresAuth) {
      const fallback = methods.find((m) => !m.requiresAuth);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile selection once auth state is known
      setSelected(fallback ? fallback.id : null);
    }
  }, [authHydrated, isAuthenticated, selected, methods]);

  // Avoid a flash of the empty/redirecting state before localStorage loads.
  if (!placedNumber && (!hydrated || !hasItems)) return null;

  // The currently selected method (null when nothing is selectable). Drives the
  // method-specific blocks below (QR card, bank details, receipt upload).
  const selectedMethod = methods.find((m) => m.id === selected) ?? null;
  const featured = methods.filter((m) => m.featured);
  const others = methods.filter((m) => !m.featured);
  const hasSaving = totalSaving > 0;
  // Beans this order would earn if the customer were signed in — drives the
  // guest nudge's headline. Mirrors the store's earn rule (floor of RM × rate).
  const beansAtStake = Math.floor((totalPrice / 100) * earnRate);

  // Selecting a members-only method (Cash) as a guest opens the sign-in nudge
  // instead of switching to it; otherwise it's a normal selection.
  function selectMethod(id: PaymentMethodId) {
    const method = methods.find((m) => m.id === id);
    if (!isAuthenticated && method?.requiresAuth) {
      setShowGuestModal(true);
      return;
    }
    setSelected(id);
  }

  // The number to attach to this order, if any: one entered in the prompt this
  // attempt, else the member's saved profile number.
  function resolveContactPhone(): string | undefined {
    return enteredPhone ?? profile.phone ?? undefined;
  }

  // Place Order entry point. Guests see the sign-in nudge first; members with no
  // number on file get the phone prompt; everyone else places straight.
  function onPlaceOrder() {
    if (submitting) return;
    if (!selected) {
      setError("No payment method is available right now.");
      return;
    }
    if (!isAuthenticated) {
      setShowGuestModal(true);
      return;
    }
    // Member with no number on file (and none entered yet): nudge first.
    if (!resolveContactPhone()) {
      setShowPhonePrompt(true);
      return;
    }
    void placeOrder();
  }

  // Total Bean cost of rewards in the cart — drives the advisory affordability
  // check before placing. The authoritative check is server-side in
  // apply_order_rewards.
  const totalRewardCost = items
    .filter((item) => item.isReward)
    .reduce((sum, item) => sum + (item.rewardCost ?? 0), 0);

  async function placeOrder(phoneOverride?: string) {
    if (submitting) return;
    // Cash is members-only (pay-at-counter); a guest should never reach here
    // with it selected, but guard server-side intent anyway.
    const method = methods.find((m) => m.id === selected);
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

    if (method.requiresReceipt && !receiptFile) {
      setError("Please attach your payment receipt.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      // Mint/read the owner id once so the receipt's path prefix matches the
      // ownerId sent to the action (the server validates they agree).
      const ownerId = getOrCreateOwnerId();
      let proofOfPaymentPath: string | undefined;
      if (method.requiresReceipt && receiptFile) {
        proofOfPaymentPath = await uploadReceipt(receiptFile, ownerId);
      }

      const result = await placeOrderAction({
        items: items.map((item) => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          sizeName: item.sizeName,
          addonNames: item.addonNames,
          unitPrice: item.unitPrice,
          isReward: item.isReward,
          rewardCost: item.rewardCost,
        })),
        paymentMethod: method.name,
        notes,
        subtotal: totalOriginal,
        total: totalPrice,
        // Per-browser stable id; minted on first call and reused thereafter.
        // Same id is adopted by the auth store on sign-in, so guest orders
        // automatically belong to the registered account afterwards.
        ownerId,
        proofOfPaymentPath,
        contactPhone: phoneOverride ?? resolveContactPhone(),
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Beans + streak are settled server-side at placement (members only).
      // Surface any streak-milestone bonuses the server granted.
      if (result.rewards && result.rewards.bonuses.length > 0) {
        setStreakAwards(result.rewards.bonuses);
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

      {closedMessage && (
        <StoreClosedBanner message={closedMessage} className="mt-4" />
      )}

      <section className="mt-5 flex flex-col gap-2.5 naise-rise">
        <h2 className="text-[0.6875rem] font-bold uppercase tracking-wider">
          Payment Method
        </h2>

        {methods.length === 0 && (
          <p className="rounded-2xl bg-neutral-50 px-4 py-3 text-xs text-muted-foreground">
            Payments are temporarily unavailable. Please try again later or contact the store.
          </p>
        )}

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

        {selected === "bank-transfer" && (
          <div className="mt-4 flex flex-col divide-y divide-border rounded-2xl border border-border bg-white px-4 py-2">
            {bank.name && <BankDetailRow label="Bank" value={bank.name} />}
            {bank.accountNumber && (
              <BankDetailRow label="Account number" value={bank.accountNumber} />
            )}
            {bank.accountHolder && (
              <BankDetailRow label="Account holder" value={bank.accountHolder} />
            )}
            {!bank.name && !bank.accountNumber && !bank.accountHolder && (
              <p className="py-3 text-xs text-muted-foreground">
                Bank details aren&rsquo;t set up yet. Please choose another method or contact the
                store.
              </p>
            )}
          </div>
        )}

        {selectedMethod?.requiresReceipt && (
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
        disabled={submitting || !selected}
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
            // Ask the guest for a number first (order-only), unless one was
            // already entered this attempt.
            if (!resolveContactPhone()) {
              setShowPhonePrompt(true);
              return;
            }
            void placeOrder();
          }}
        />
      )}

      {showPhonePrompt && (
        <PhonePromptSheet
          busy={submitting}
          onClose={() => setShowPhonePrompt(false)}
          onSkip={() => {
            setShowPhonePrompt(false);
            void placeOrder();
          }}
          onSubmit={(phone) => {
            setEnteredPhone(phone);
            setShowPhonePrompt(false);
            // Members: also save to their profile for next time. Guests have no
            // profile, so updateProfile no-ops (it early-returns for guests).
            if (isAuthenticated) void updateProfile({ phone });
            // Pass the number explicitly — setEnteredPhone hasn't re-rendered yet.
            void placeOrder(phone);
          }}
        />
      )}
    </main>
  );
}

// A single bank-detail line (label + value) with a copy-to-clipboard button,
// shown when Bank Transfer is the selected payment method.
function BankDetailRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (insecure context / denied) — leave the value
      // visible for manual copy; nothing to surface.
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="truncate text-sm font-semibold">{value}</span>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-foreground transition-colors hover:bg-neutral-200 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {copied ? (
          <Check className="size-3.5" strokeWidth={3} aria-hidden />
        ) : (
          <Copy className="size-3.5" strokeWidth={2} aria-hidden />
        )}
      </button>
    </div>
  );
}
