"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { cancelPendingPayment } from "@/app/(customer)/checkout/pay/[token]/actions";

function rm(sen: number): string {
  return `RM${(sen / 100).toFixed(2)}`;
}

export function PaymentReview({
  token,
  transactionNo,
  orderNumber,
  createdAt,
  amount,
  fee,
  total,
  payUrl,
}: {
  token: string;
  transactionNo: string;
  orderNumber: string;
  createdAt: string;
  amount: number;
  fee: number;
  total: number;
  payUrl: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Two-step cancel: the first tap arms the confirm prompt, so a single tap
  // never voids the order.
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // Set once we start navigating to CHIP — the full-page redirect takes a beat,
  // so show a spinner instead of a dead button.
  const [redirecting, setRedirecting] = useState(false);

  function onPay() {
    if (!payUrl) {
      setError("Payment link unavailable. Please try again.");
      return;
    }
    setRedirecting(true);
    // Full navigation to CHIP's hosted DuitNow QR page — never window.open, which
    // mobile/PWA popup blockers kill.
    window.location.href = payUrl;
  }

  function onCancel() {
    setError(null);
    startTransition(async () => {
      const res = await cancelPendingPayment(token);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.replace("/checkout");
    });
  }

  const shortTxn = transactionNo ? transactionNo.slice(0, 8).toUpperCase() : "—";
  const date = new Date(createdAt).toLocaleString("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <main className="flex flex-1 flex-col px-5 py-6">
      <header className="mb-5">
        <p className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-muted-foreground naise-rise [animation-delay:60ms]">
          Confirm Payment
        </p>
        <h1 className="mt-2 font-heading text-2xl font-bold tracking-tight naise-rise [animation-delay:120ms]">
          Review your transaction
        </h1>
      </header>

      {/* Ticket: detail rows on a tinted body, a perforated tear, then a black
          panel that anchors the amount the customer is committing to. */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-neutral-50 naise-rise [animation-delay:180ms]">
        <dl className="space-y-3 px-5 pb-4 pt-5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Transaction No.</dt>
            <dd className="font-medium tabular-nums">{shortTxn}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Bill No.</dt>
            <dd className="font-medium">{orderNumber}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Date</dt>
            <dd className="font-medium">{date}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Payment method</dt>
            <dd className="flex items-center gap-1.5 font-medium">
              <span className="flex size-1.5 rounded-full bg-black" aria-hidden />
              DuitNow QR
            </dd>
          </div>
        </dl>

        {/* Perforated tear — half-circles are clipped by the section's
            overflow-hidden, punching notches into each edge. */}
        <div className="relative">
          <span
            aria-hidden
            className="absolute left-0 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background"
          />
          <span
            aria-hidden
            className="absolute right-0 top-1/2 size-4 -translate-y-1/2 translate-x-1/2 rounded-full bg-background"
          />
          <div className="mx-4 border-t border-dashed border-border" />
        </div>

        <dl className="space-y-2 px-5 pb-3 pt-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="tabular-nums">{rm(amount)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Processing fee</dt>
            <dd className="tabular-nums">{rm(fee)}</dd>
          </div>
        </dl>

        {/* Total is the receipt's crescendo: a plain but elevated row, not a
            second black block competing with the CTA below. */}
        <div className="mx-5 mb-5 mt-1 flex items-baseline justify-between gap-3 border-t border-border pt-3">
          <span className="text-[0.625rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Total to pay
          </span>
          <span className="font-heading text-2xl font-bold tracking-tight tabular-nums">
            {rm(total)}
          </span>
        </div>
      </section>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-2xl bg-rose-50 px-4 py-2.5 text-xs text-rose-700 naise-rise"
        >
          {error}
        </div>
      )}

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={onPay}
          disabled={pending || confirmingCancel || redirecting}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-black px-5 text-white transition-transform outline-none hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100 naise-rise [animation-delay:240ms]"
        >
          {redirecting && (
            <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
          )}
          <span className="text-xs font-bold uppercase tracking-wider">
            {redirecting ? "Redirecting to payment" : "Proceed to Pay"}
          </span>
        </button>

        {confirmingCancel ? (
          <div className="rounded-2xl border border-border bg-neutral-50 p-4 naise-rise">
            <p className="text-sm font-medium">Cancel this payment?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your order won&rsquo;t be placed and you&rsquo;ll return to checkout.
            </p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                disabled={pending}
                className="flex h-11 flex-1 items-center justify-center rounded-2xl border border-border bg-white text-xs font-bold uppercase tracking-wider text-foreground transition-colors outline-none hover:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                Keep paying
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={pending}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-rose-600 text-xs font-bold uppercase tracking-wider text-white transition-colors outline-none hover:bg-rose-500 focus-visible:ring-3 focus-visible:ring-rose-600/40 disabled:opacity-50"
              >
                {pending && <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />}
                {pending ? "Cancelling" : "Yes, cancel"}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirmingCancel(true);
            }}
            disabled={pending || redirecting}
            className="flex h-12 w-full items-center justify-center rounded-2xl border border-border bg-white text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors outline-none hover:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>

      <p className="mt-5 flex items-center justify-center gap-1.5 text-[0.6875rem] text-muted-foreground naise-rise [animation-delay:300ms]">
        <ShieldCheck className="size-3.5" strokeWidth={2} aria-hidden />
        Payments secured by CHIP · DuitNow QR
      </p>
    </main>
  );
}
