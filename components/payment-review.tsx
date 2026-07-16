"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
      <header className="mb-4">
        <p className="text-[0.625rem] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
          Confirm Payment
        </p>
        <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight">
          Review your transaction
        </h1>
      </header>

      <section className="rounded-2xl border border-border bg-white p-5">
        <dl className="space-y-3 text-sm">
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
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Description</dt>
            <dd className="font-medium">NAISE COFFEE order</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Payment method</dt>
            <dd className="font-medium">DuitNow QR</dd>
          </div>
        </dl>

        <div className="my-4 h-px bg-border" />

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="tabular-nums">{rm(amount)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Payment gateway fee</dt>
            <dd className="tabular-nums">{rm(fee)}</dd>
          </div>
          <div className="flex justify-between gap-3 pt-1 text-base font-bold">
            <dt>Total to pay</dt>
            <dd className="tabular-nums">{rm(total)}</dd>
          </div>
        </dl>
      </section>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={onPay}
          disabled={pending || confirmingCancel || redirecting}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 py-3.5 font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-50"
        >
          {redirecting && <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />}
          {redirecting ? "Redirecting to payment…" : "Proceed to Pay"}
        </button>

        {confirmingCancel ? (
          <div className="rounded-2xl border border-border bg-neutral-50 p-4">
            <p className="text-sm font-medium">Cancel this payment?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Your order won&rsquo;t be placed and you&rsquo;ll return to checkout.
            </p>
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmingCancel(false)}
                disabled={pending}
                className="flex-1 rounded-2xl border border-border py-2.5 text-sm font-medium transition-colors hover:bg-white disabled:opacity-50"
              >
                Keep paying
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={pending}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-rose-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
              >
                {pending && <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />}
                {pending ? "Cancelling…" : "Yes, cancel"}
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
            className="w-full rounded-2xl border border-border py-3.5 font-medium text-muted-foreground transition-colors hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </main>
  );
}
