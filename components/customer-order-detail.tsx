"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Receipt } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { formatPrice, formatOrderTime } from "@/lib/format";
import { statusDisplay } from "@/lib/orders/status";
import { ReceiptModal } from "@/components/receipt-modal";
import { paymentMethodLabel } from "@/data/payment-methods";
import type { Order } from "@/types/order";

// Read-only customer view of a single past order — a receipt, not the staff
// fulfilment screen. Shows the order reference, status, item lines, totals, and
// the proof-of-payment receipt (for QR/transfer orders). No drink-status
// mutation: customers don't advance fulfilment.
export function CustomerOrderDetail({
  order,
  backHref = "/profile/orders",
}: {
  order: Order;
  // Where the back button returns to — depends on where the order was opened
  // from (the full orders list vs. the profile's recent-orders section).
  backHref?: string;
}) {
  const [showReceipt, setShowReceipt] = useState(false);
  const status = statusDisplay[order.status];

  return (
    <div className="flex flex-col">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <Link
          href={backHref}
          aria-label="Back"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
          Order
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <main className="flex flex-col px-5 pb-8 pt-2">
        <section className="flex items-start justify-between gap-3 naise-rise">
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-2xl font-bold tracking-tight tabular-nums">
              {order.orderNumber}
            </h2>
            <time
              dateTime={order.createdAt}
              className="text-xs text-muted-foreground tabular-nums"
              suppressHydrationWarning
            >
              {formatOrderTime(order.createdAt)}
            </time>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold",
              status.pill,
            )}
          >
            <span className={cn("size-1.5 rounded-full", status.dot)} />
            {status.label}
          </span>
        </section>

        <section className="mt-6 flex flex-col gap-3 naise-rise [animation-delay:80ms]">
          <h2 className="text-xs font-bold uppercase tracking-wider">Items</h2>
          <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border px-4">
            {order.items.map((item, i) => {
              const subtitle = [item.sizeName, ...item.addonNames]
                .filter(Boolean)
                .join(", ");
              const voided = Boolean(item.voidedAt);
              return (
                <li
                  key={`${item.name}-${i}`}
                  className={cn(
                    "flex items-start gap-3 py-3 text-sm",
                    voided && "opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-lg text-[0.6875rem] font-bold tabular-nums text-white",
                      voided ? "bg-neutral-400" : "bg-black",
                    )}
                  >
                    {item.quantity}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className={cn("truncate font-medium", voided && "line-through")}>
                        {item.name}
                      </span>
                      {voided ? (
                        <span className="shrink-0 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-rose-700">
                          Voided
                        </span>
                      ) : (
                        item.isCustom && (
                          <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-amber-700">
                            Custom
                          </span>
                        )
                      )}
                    </span>
                    {subtitle && (
                      <span className="truncate text-xs text-muted-foreground">
                        {subtitle}
                      </span>
                    )}
                  </div>
                  <span
                    className={cn(
                      "shrink-0 font-semibold tabular-nums",
                      voided && "text-muted-foreground line-through",
                    )}
                  >
                    {formatPrice(item.lineTotal)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <dl className="mt-4 grid grid-cols-2 gap-3 naise-rise [animation-delay:140ms]">
          <div className="rounded-2xl bg-neutral-100 px-4 py-3">
            <dt className="text-xs font-medium text-muted-foreground">Payment</dt>
            <dd className="mt-0.5 text-sm font-bold">{paymentMethodLabel(order.paymentMethod)}</dd>
          </div>
          <div className="rounded-2xl bg-neutral-100 px-4 py-3">
            <dt className="text-xs font-medium text-muted-foreground">Status</dt>
            <dd className="mt-0.5 text-sm font-bold">{status.label}</dd>
          </div>
        </dl>

        {order.notes && (
          <section className="mt-4 rounded-2xl bg-neutral-50 px-4 py-3 text-sm naise-rise [animation-delay:160ms]">
            <span className="font-semibold">Note: </span>
            <span className="whitespace-pre-line break-words">{order.notes}</span>
          </section>
        )}

        {order.proofOfPaymentUrl && (
          <section className="mt-4 flex flex-col gap-2 naise-rise [animation-delay:180ms]">
            <h2 className="text-xs font-bold uppercase tracking-wider">
              Proof of Payment
            </h2>
            <button
              type="button"
              onClick={() => setShowReceipt(true)}
              className="flex items-center gap-3 rounded-2xl bg-neutral-50 px-4 py-3 text-left transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-black text-white">
                <Receipt className="size-4" strokeWidth={2} aria-hidden />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold">Tap to view receipt</span>
                <span className="truncate text-xs text-muted-foreground">
                  {paymentMethodLabel(order.paymentMethod)}
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground"
                strokeWidth={2.5}
                aria-hidden
              />
            </button>
          </section>
        )}

        <section className="mt-6 flex flex-col gap-2 border-t border-border pt-5 naise-rise [animation-delay:220ms]">
          <div className="flex items-baseline justify-between text-sm text-muted-foreground">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatPrice(order.subtotal)}</span>
          </div>
          <div className="flex items-baseline justify-between text-base font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatPrice(order.total)}</span>
          </div>
        </section>
      </main>

      {showReceipt && order.proofOfPaymentUrl && (
        <ReceiptModal
          src={order.proofOfPaymentUrl}
          orderNumber={order.orderNumber}
          onClose={() => setShowReceipt(false)}
        />
      )}
    </div>
  );
}
