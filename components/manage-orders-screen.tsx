"use client";

import { useMemo, useState } from "react";
import { ChevronRight, PackageX } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  matchesFilter,
  orderFilters,
  type OrderFilter,
} from "@/lib/orders/status";
import { OrderCard } from "@/components/order-card";
import type { Order } from "@/types/order";

export function ManageOrdersScreen({ orders }: { orders: Order[] }) {
  const [filter, setFilter] = useState<OrderFilter>("all");

  const counts = useMemo(() => {
    const map: Record<OrderFilter, number> = {
      all: orders.length,
      pending: 0,
      in_progress: 0,
      completed: 0,
    };
    for (const o of orders) {
      for (const f of ["pending", "in_progress", "completed"] as const) {
        if (matchesFilter(o.status, f)) map[f] += 1;
      }
    }
    return map;
  }, [orders]);

  const visible = useMemo(
    () => orders.filter((o) => matchesFilter(o.status, filter)),
    [orders, filter],
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8">
      <header className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          NAISE Coffee
        </span>
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          Manage Orders
        </h1>
      </header>

      {/* Filter tabs. */}
      <div
        role="tablist"
        aria-label="Filter orders"
        className="-mx-5 mt-5 flex gap-2 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {orderFilters.map((tab) => {
          const active = tab.value === filter;
          return (
            <button
              key={tab.value}
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(tab.value)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? "border-black bg-black text-white"
                  : "border-border bg-white text-foreground hover:bg-muted",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "tabular-nums",
                  active ? "text-white/70" : "text-muted-foreground",
                )}
              >
                {counts[tab.value]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Order list. */}
      {visible.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-neutral-100 text-muted-foreground">
            <PackageX className="size-8" strokeWidth={2} aria-hidden />
          </div>
          <p className="text-sm text-muted-foreground">
            No orders here right now.
          </p>
        </div>
      ) : (
        <ul className="mt-5 flex flex-col gap-4">
          {visible.map((order, i) => (
            <OrderCard key={order.token} order={order} delay={i * 60} />
          ))}
        </ul>
      )}

      {/* Tap hint. */}
      <footer className="mt-8 flex items-center justify-center gap-2 border-t border-border pt-5 text-[0.6875rem] text-muted-foreground">
        <span className="flex size-5 items-center justify-center rounded-full bg-neutral-100">
          <ChevronRight className="size-3.5" strokeWidth={2.5} aria-hidden />
        </span>
        Tap an order to manage its drinks
      </footer>
    </main>
  );
}
