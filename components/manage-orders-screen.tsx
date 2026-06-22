"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Loader2, PackageX } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  orderFilters,
  type OrderFilter,
  type OrderGroupCounts,
} from "@/lib/orders/status";
import { dateRanges, type DateRangeKey } from "@/lib/orders/range";
import { OrderCard } from "@/components/order-card";
import type { Order } from "@/types/order";

type Props = {
  backHref: string;
  backLabel: string;
  orders: Order[];
  counts: OrderGroupCounts;
  filter: OrderFilter;
  range: DateRangeKey;
  hasMore: boolean;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  onFilterChange: (filter: OrderFilter) => void;
  onRangeChange: (range: DateRangeKey) => void;
  onLoadMore: () => void;
};

export function ManageOrdersScreen({
  backHref,
  backLabel,
  orders,
  counts,
  filter,
  range,
  hasMore,
  isRefreshing,
  isLoadingMore,
  onFilterChange,
  onRangeChange,
  onLoadMore,
}: Props) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8">
      <header className="flex flex-col gap-1">
        <Link
          href={backHref}
          className="mb-2 flex w-fit items-center gap-1 rounded-sm text-sm font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-4" aria-hidden /> {backLabel}
        </Link>
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          NAISE Coffee
        </span>
        <h1 className="font-heading text-2xl font-bold tracking-tight">
          Manage Orders
        </h1>
      </header>

      {/* Status tabs. Defaults to Pending. */}
      <div
        role="tablist"
        aria-label="Filter orders by status"
        className="-mx-5 mt-5 flex gap-2 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {orderFilters.map((tab) => {
          const active = tab.value === filter;
          return (
            <button
              key={tab.value}
              role="tab"
              aria-selected={active}
              onClick={() => onFilterChange(tab.value)}
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

      {/* Date quick-filters. */}
      <div
        role="group"
        aria-label="Filter orders by date"
        className="-mx-5 mt-2.5 flex gap-2 overflow-x-auto px-5 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {dateRanges.map((chip) => {
          const active = chip.value === range;
          return (
            <button
              key={chip.value}
              aria-pressed={active}
              onClick={() => onRangeChange(chip.value)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? "border-black bg-black text-white"
                  : "border-border bg-white text-muted-foreground hover:bg-muted",
              )}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      {/* Order list. */}
      {orders.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-neutral-100 text-muted-foreground">
            {isRefreshing ? (
              <Loader2 className="size-8 animate-spin" strokeWidth={2} aria-hidden />
            ) : (
              <PackageX className="size-8" strokeWidth={2} aria-hidden />
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {isRefreshing ? "Loading orders…" : "No orders here right now."}
          </p>
        </div>
      ) : (
        <ul
          className={cn(
            "mt-5 flex flex-col gap-4 transition-opacity",
            isRefreshing && "opacity-60",
          )}
        >
          {orders.map((order, i) => (
            <OrderCard key={order.token} order={order} delay={i * 60} />
          ))}
        </ul>
      )}

      {/* Load more. */}
      {hasMore && orders.length > 0 && (
        <button
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="mt-5 flex items-center justify-center gap-2 rounded-full border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-60 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {isLoadingMore && (
            <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
          )}
          {isLoadingMore ? "Loading…" : "Load more"}
        </button>
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
