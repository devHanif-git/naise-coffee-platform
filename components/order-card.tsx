"use client";

import Link from "next/link";
import { ChevronRight, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/format";
import { statusDisplay, timeAgo } from "@/lib/orders/status";
import { paymentMethodLabel } from "@/data/payment-methods";
import type { Order } from "@/types/order";

// A summary card in the /manage order list. Read-only — tapping opens the
// single-order management view (/manage/[token]) where drinks are worked
// through. The list itself doesn't mutate orders.
export function OrderCard({ order, delay = 0 }: { order: Order; delay?: number }) {
  const status = statusDisplay[order.status];

  return (
    <li className="naise-rise" style={{ animationDelay: `${delay}ms` }}>
      <Link
        href={`/manage/${order.token}`}
        className="flex flex-col gap-4 rounded-3xl bg-white p-5 ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/20 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <header className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-heading text-lg font-bold tracking-tight tabular-nums">
              #{order.orderNumber.replace(/^NAISE-0*(?=\d)/, "")}
            </h3>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-bold",
                status.pill,
              )}
            >
              <span className={cn("size-1.5 rounded-full", status.dot)} />
              {status.label}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="tabular-nums" suppressHydrationWarning>
              {timeAgo(order.createdAt)}
            </span>
            <span className="font-medium">{paymentMethodLabel(order.paymentMethod)}</span>
          </div>
        </header>

        <ul className="flex flex-col divide-y divide-border">
          {order.items.map((item, i) => {
            const subtitle = [item.sizeName, ...item.addonNames]
              .filter(Boolean)
              .join(", ");
            return (
              <li
                key={`${item.name}-${i}`}
                className="flex items-start gap-3 py-2.5 text-sm first:pt-0 last:pb-0"
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-black text-[0.6875rem] font-bold tabular-nums text-white">
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
                  {formatPrice(item.lineTotal)}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <span className="flex items-center gap-2 text-sm font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatPrice(order.total)}</span>
          </span>
          <span className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
            {order.proofOfPaymentUrl && (
              <Receipt className="size-3.5" strokeWidth={2} aria-hidden />
            )}
            Manage
            <ChevronRight className="size-4" strokeWidth={2.5} aria-hidden />
          </span>
        </div>
      </Link>
    </li>
  );
}
