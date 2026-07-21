"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Apple,
  Banknote,
  Check,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Copy,
  CreditCard,
  Ticket,
  Landmark,
  Loader2,
  QrCode,
  ShieldCheck,
  Smartphone,
  StickyNote,
  TriangleAlert,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCart } from "@/store/cart";
import { useAuth } from "@/store/auth";
import { useBeans } from "@/store/beans";
import type { StreakAward, Voucher } from "@/types/reward";
import type { PaymentMethod, PaymentMethodId } from "@/types/payment";
import type { BankDetails } from "@/lib/settings/payments";
import { DuitnowQrCard } from "@/components/duitnow-qr-card";
import { StoreClosedBanner } from "@/components/store-closed-banner";
import { PhonePromptSheet } from "@/components/phone-prompt-sheet";
import { VoucherPickerSheet } from "@/components/stamps/voucher-picker-sheet";
import { placeOrder as placeOrderAction } from "@/app/(customer)/checkout/actions";
import { OrderConfirmed } from "@/components/order-confirmed";
import { uploadReceipt } from "@/lib/orders/receipt";
import { useProfile } from "@/store/profile";
import { useRepriceCart } from "@/hooks/use-reprice-cart";

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
  duitnowQrUrl,
  vouchers,
  chipEnabled,
}: {
  closedMessage?: string | null;
  methods: PaymentMethod[];
  bank: BankDetails;
  duitnowQrUrl: string | null;
  vouchers: Voucher[];
  // When true, DuitNow QR is collected via the CHIP gateway: hide the manual QR
  // card + receipt upload, and route to the payment review screen on submit.
  chipEnabled: boolean;
}) {
  const router = useRouter();
  const { items, hydrated, totalPrice, totalOriginal, totalSaving, notes, clear } =
    useCart();
  const reprice = useRepriceCart();
  const { user } = useAuth();
  const { canAfford } = useBeans();
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
  // The number to stamp on this order: a value entered in the prompt this
  // attempt, else the member's saved profile number. Guests have no profile, so
  // theirs only ever comes from the prompt.
  const [enteredPhone, setEnteredPhone] = useState<string | null>(null);
  // Controls the phone prompt sheet shown before placing when no number is known.
  const [showPhonePrompt, setShowPhonePrompt] = useState(false);
  const [selectedVoucherId, setSelectedVoucherId] = useState<string | null>(null);
  // Whether the voucher picker sheet is open. Selecting + confirming there is
  // the one-time-use step; the inline warning lives in the sheet.
  const [voucherSheetOpen, setVoucherSheetOpen] = useState(false);
  // Set true right before the CHIP path clears the cart and navigates to the
  // review screen. Without it, clearing the cart makes it empty and the
  // empty-cart guard below races router.push and wins, bouncing to /menu.
  const [leavingToPayment, setLeavingToPayment] = useState(false);

  const hasItems = items.length > 0;

  // Nothing to check out: once the persisted cart has loaded and is empty,
  // send the customer back to the cart rather than showing a dead screen.
  // Skipped after a successful order (confirmation view takes over) and while
  // handing off to the CHIP review screen (cart is intentionally cleared then).
  useEffect(() => {
    if (hydrated && !hasItems && !placedNumber && !leavingToPayment)
      router.replace("/menu"); // no cart for now redirect to menu
  }, [hydrated, hasItems, placedNumber, leavingToPayment, router]);

  // Re-price against the live catalogue when checkout mounts, so a promo toggled
  // in the CMS since the item was added is reflected here without a page refresh.
  // Fires once hydrated; reprice() reads the current cart itself and no-ops when
  // nothing changed, so it needn't be in the deps. The server re-prices
  // authoritatively at placement anyway — this just keeps the displayed total honest.
  useEffect(() => {
    if (hydrated) void reprice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Avoid a flash of the empty/redirecting state before localStorage loads.
  if (!placedNumber && (!hydrated || !hasItems)) return null;

  // The currently selected method (null when nothing is selectable). Drives the
  // method-specific blocks below (QR card, bank details, receipt upload).
  const selectedMethod = methods.find((m) => m.id === selected) ?? null;
  // True when the selected method is collected via the CHIP gateway (only
  // DuitNow QR this phase). Drives hiding the manual QR + receipt UI and the
  // redirect-to-review submit behaviour.
  const isChipPath = chipEnabled && selected === "duitnow-qr";
  const featured = methods.filter((m) => m.featured);
  const others = methods.filter((m) => !m.featured);
  const hasSaving = totalSaving > 0;

  const selectedVoucher = vouchers.find((v) => v.id === selectedVoucherId) ?? null;
  // Mirror the server discount rule (checkout/actions.ts). Display-only; the
  // server recomputes authoritatively. free_drink applies to the cheapest PAID
  // line — reward lines are already free (unitPrice 0), so including them would
  // wrongly show a 0.00 discount when a paid drink should be the free one.
  const paidUnitPrices = items.filter((i) => !i.isReward).map((i) => i.unitPrice);
  const cheapestUnit =
    paidUnitPrices.length > 0 ? Math.min(...paidUnitPrices) : 0;
  const voucherDiscount = !selectedVoucher
    ? 0
    : selectedVoucher.type === "rm_off"
      ? totalOriginal >= selectedVoucher.minSpend
        ? Math.min(selectedVoucher.discountAmount, totalOriginal)
        : 0
      : Math.min(selectedVoucher.freeDrinkMaxValue, cheapestUnit, totalOriginal);
  const totalAfterVoucher = Math.max(0, totalPrice - voucherDiscount);

  // Every checkout visitor is signed in (the route is gated), so any enabled
  // method — including members-only ones like Cash — is selectable.
  function selectMethod(id: PaymentMethodId) {
    setSelected(id);
  }

  // The number to attach to this order, if any: one entered in the prompt this
  // attempt, else the member's saved profile number.
  function resolveContactPhone(): string | undefined {
    return enteredPhone ?? profile.phone ?? undefined;
  }

  function onPlaceOrder() {
    if (submitting) return;
    if (!selected) {
      setError("No payment method is available right now.");
      return;
    }
    // No number on file (and none entered yet): nudge first.
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
    const method = methods.find((m) => m.id === selected);
    if (!method) return;
    // The route is gated, so a user is always present; guard for types.
    if (!user) return;

    // Re-validate Beans cover the redeemed rewards. The balance could have
    // changed since the reward was added to the cart (another order, another
    // tab), so this is the authoritative check before committing.
    if (totalRewardCost > 0 && !canAfford(totalRewardCost)) {
      setError(
        "You don't have enough Beans to redeem the reward in your cart. Remove it to continue.",
      );
      return;
    }

    // The CHIP gateway path collects payment on CHIP's page — no manual receipt.
    if (method.requiresReceipt && !isChipPath && !receiptFile) {
      setError("Please attach your payment receipt.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      // Scope the order and receipt path to the signed-in user's id (a UUID,
      // satisfying orders.owner_id). The server validates the receipt path
      // prefix matches this id.
      const ownerId = user.id;
      let proofOfPaymentPath: string | undefined;
      if (method.requiresReceipt && !isChipPath && receiptFile) {
        proofOfPaymentPath = await uploadReceipt(receiptFile, ownerId);
      }

      const result = await placeOrderAction({
        items: items.map((item) => ({
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          // Sent so the server can re-price the line against the live catalogue.
          sizeId: item.sizeId,
          addonIds: item.addonIds,
          sizeName: item.sizeName,
          addonNames: item.addonNames,
          unitPrice: item.unitPrice,
          unitOriginalPrice: item.unitOriginalPrice,
          isReward: item.isReward,
          rewardCost: item.rewardCost,
        })),
        // Store the stable method id (e.g. "duitnow-qr") — not the display name
        // — so it matches what the in-store kiosk stores and reports group as one.
        paymentMethod: method.id,
        notes,
        subtotal: totalOriginal,
        total: totalPrice,
        // The signed-in user's id — scopes the order to their account.
        ownerId,
        proofOfPaymentPath,
        contactPhone: phoneOverride ?? resolveContactPhone(),
        voucherId: selectedVoucherId ?? undefined,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // CHIP path: go to the payment review screen instead of showing the
      // confirmation view. Set the leaving flag BEFORE clearing so the empty-cart
      // guard doesn't race the push and bounce us to /menu. The order is
      // awaiting_payment until paid.
      if ("redirectTo" in result) {
        setLeavingToPayment(true);
        clear();
        router.push(result.redirectTo);
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
    return <OrderConfirmed orderNumber={placedNumber} streakAwards={streakAwards} />;
  }

  return (
    <main className="flex flex-1 flex-col px-5 pt-5 pb-8">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button
          type="button"
          onClick={() => router.push("/menu")} // no home for now redirect to menu
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

        {selected === "duitnow-qr" && !isChipPath && (
          <div className="mt-4">
            <DuitnowQrCard src={duitnowQrUrl ?? undefined} />
          </div>
        )}

        {isChipPath && (
          <div className="mt-4 rounded-2xl border border-border bg-white px-4 py-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              You&rsquo;ll review the payment details and pay securely with DuitNow
              QR on the next screen.
            </p>
          </div>
        )}

        {selected === "bank-transfer" &&
          (bank.name || bank.accountNumber || bank.accountHolder ? (
            <div className="relative mt-4 overflow-hidden rounded-2xl bg-neutral-900 p-5 text-white">
              {/* Soft decorative glows give the panel a card-like feel without
                  any imagery. */}
              <div
                className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-white/5"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute -bottom-12 -left-8 size-32 rounded-full bg-white/[0.04]"
                aria-hidden
              />

              <div className="relative flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[0.5625rem] font-semibold uppercase tracking-[0.2em] text-white/50">
                    Bank
                  </span>
                  <span className="truncate font-heading text-lg font-bold tracking-tight">
                    {bank.name || "—"}
                  </span>
                </div>
                <Landmark className="size-6 shrink-0 text-white/40" strokeWidth={2} aria-hidden />
              </div>

              {bank.accountHolder && (
                <div className="relative mt-3 flex flex-col gap-0.5">
                  <span className="text-[0.5625rem] font-semibold uppercase tracking-[0.2em] text-white/50">
                    Account holder
                  </span>
                  <span className="truncate text-sm font-medium">{bank.accountHolder}</span>
                </div>
              )}

              <div className="relative mt-5 flex items-end justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-[0.5625rem] font-semibold uppercase tracking-[0.2em] text-white/50">
                    Account number
                  </span>
                  <span className="break-all font-heading text-xl font-bold tabular-nums tracking-[0.08em]">
                    {bank.accountNumber || "—"}
                  </span>
                </div>
                {bank.accountNumber && (
                  <CopyButton value={bank.accountNumber} label="account number" />
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-border bg-white px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Bank details aren&rsquo;t set up yet. Please choose another method or contact the
                store.
              </p>
            </div>
          ))}

        {selectedMethod?.requiresReceipt && !isChipPath && (
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
            const lineOriginal = item.unitOriginalPrice * item.quantity;
            const onSale = lineOriginal > lineTotal && !item.isReward;
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
                  {onSale && (
                    <span className="text-[0.6875rem] font-semibold text-rose-600">
                      Save {formatPrice(lineOriginal - lineTotal)}
                      {item.discountPercentOff ? ` · ${item.discountPercentOff}% off` : ""}
                    </span>
                  )}
                </div>
                {onSale ? (
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="font-semibold tabular-nums text-rose-600">
                      {formatPrice(lineTotal)}
                    </span>
                    <span className="text-[0.6875rem] font-medium tabular-nums text-muted-foreground line-through">
                      {formatPrice(lineOriginal)}
                    </span>
                  </div>
                ) : (
                  <span className="shrink-0 font-semibold tabular-nums">
                    {item.isReward && lineTotal === 0 ? "RM 0.00" : formatPrice(lineTotal)}
                  </span>
                )}
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

      {vouchers.length > 0 && (
        <section className="mt-6 flex flex-col gap-2.5 border-t border-border pt-4 naise-rise [animation-delay:120ms]">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Voucher
          </span>
          {selectedVoucher ? (
            // Applied voucher — compact ticket summary with a Change control that
            // reopens the picker. Removing clears the selection.
            <div className="relative flex items-stretch overflow-hidden rounded-2xl bg-black text-white">
              <div className="flex w-14 shrink-0 items-center justify-center bg-white/10">
                {selectedVoucher.type === "free_drink" ? (
                  <Coffee className="size-5" strokeWidth={2} aria-hidden />
                ) : (
                  <Ticket className="size-5" strokeWidth={2} aria-hidden />
                )}
              </div>
              <span
                aria-hidden
                className="absolute left-[3.25rem] top-0 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background"
              />
              <span
                aria-hidden
                className="absolute bottom-0 left-[3.25rem] size-3 -translate-x-1/2 translate-y-1/2 rounded-full bg-background"
              />
              <div className="flex flex-1 items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-heading text-base font-bold uppercase tracking-wide">
                    {selectedVoucher.type === "free_drink"
                      ? "Free Drink"
                      : `${formatPrice(selectedVoucher.discountAmount)} Off`}
                  </p>
                  <p className="text-[0.6875rem] text-white/60">Applied</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setVoucherSheetOpen(true)}
                    className="rounded-lg px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-wide text-white/80 outline-none transition-colors hover:text-white focus-visible:ring-3 focus-visible:ring-white/40"
                  >
                    Change
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedVoucherId(null)}
                    aria-label="Remove voucher"
                    className="flex size-7 items-center justify-center rounded-full text-white/70 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-3 focus-visible:ring-white/40"
                  >
                    <X className="size-4" strokeWidth={2.5} aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            // Nothing applied — a single "Add voucher" row that opens the picker.
            <button
              type="button"
              onClick={() => setVoucherSheetOpen(true)}
              className="flex items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-white px-4 py-3.5 text-left outline-none transition-colors hover:border-foreground/40 hover:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex items-center gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-foreground">
                  <Ticket className="size-4.5" strokeWidth={2} aria-hidden />
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">Add voucher</span>
                  <span className="text-[0.6875rem] text-muted-foreground">
                    {vouchers.length} available
                  </span>
                </span>
              </span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" strokeWidth={2.5} aria-hidden />
            </button>
          )}
        </section>
      )}

      <section className="mt-6 flex flex-col gap-3 border-t border-border pt-4 naise-rise [animation-delay:120ms]">
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
        {voucherDiscount > 0 && (
          <div className="flex items-baseline justify-between text-xs font-medium text-rose-600">
            <span>Voucher</span>
            <span className="tabular-nums">−{formatPrice(voucherDiscount)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted-foreground">Delivery/Pick-up</span>
          <span className="tabular-nums">{formatPrice(0)}</span>
        </div>
        <div className="flex items-baseline justify-between text-sm font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatPrice(totalAfterVoucher)}</span>
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
              {isChipPath && totalAfterVoucher > 0 ? "Continue to Payment" : "Place Order"}
            </span>
            <span className="text-xs font-bold tabular-nums">
              {formatPrice(totalAfterVoucher)}
            </span>
          </>
        )}
      </button>

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
            // Save to the member's profile for next time.
            void updateProfile({ phone });
            // Pass the number explicitly — setEnteredPhone hasn't re-rendered yet.
            void placeOrder(phone);
          }}
        />
      )}

      {vouchers.length > 0 && (
        <VoucherPickerSheet
          open={voucherSheetOpen}
          onOpenChange={setVoucherSheetOpen}
          vouchers={vouchers}
          cartTotal={totalOriginal}
          selectedVoucherId={selectedVoucherId}
          onApply={setSelectedVoucherId}
        />
      )}
    </main>
  );
}

// Copy-to-clipboard button styled for the dark Bank Transfer card. Swaps to a
// check for 1.5s on success; silently no-ops if the clipboard is unavailable
// (insecure context / denied) — the value stays visible for manual copy.
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Nothing to surface — leave the value on screen for manual copy.
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white transition-colors hover:bg-white/20 outline-none focus-visible:ring-3 focus-visible:ring-white/40"
    >
      {copied ? (
        <Check className="size-4" strokeWidth={3} aria-hidden />
      ) : (
        <Copy className="size-4" strokeWidth={2} aria-hidden />
      )}
    </button>
  );
}
