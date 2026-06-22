"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ManageOrdersScreen } from "@/components/manage-orders-screen";
import { subscribeToOrders } from "@/lib/orders/realtime";
import { loadOrdersAction } from "@/app/(admin)/manage/actions";
import {
  ORDERS_PAGE_SIZE,
  type OrderFilter,
  type OrderGroupCounts,
} from "@/lib/orders/status";
import type { DateRangeKey } from "@/lib/orders/range";
import type { Order } from "@/types/order";

type Props = {
  initialOrders: Order[];
  initialHasMore: boolean;
  initialCounts: OrderGroupCounts;
  initialFilter: OrderFilter;
  initialRange: DateRangeKey;
  backHref: string;
  backLabel: string;
};

// Owns the board's data: current status tab, date range, loaded orders, the
// per-tab counts, and whether more pages remain. Changing a tab/range or
// pressing "Load more" calls the server action; a realtime change re-fetches
// the pages already on screen so live updates don't drop the staff's view.
export function ManageOrdersLive({
  initialOrders,
  initialHasMore,
  initialCounts,
  initialFilter,
  initialRange,
  backHref,
  backLabel,
}: Props) {
  const [filter, setFilter] = useState<OrderFilter>(initialFilter);
  const [range, setRange] = useState<DateRangeKey>(initialRange);
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [counts, setCounts] = useState<OrderGroupCounts>(initialCounts);
  const [isPending, startTransition] = useTransition();
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Latest filter/range/page-count, so the realtime callback always refreshes
  // the current view rather than whatever was current when the subscription was
  // created. Synced in an effect (never mutated during render).
  const viewRef = useRef({ filter, range, pages: 1 });
  useEffect(() => {
    viewRef.current = {
      filter,
      range,
      pages: Math.max(1, Math.ceil(orders.length / ORDERS_PAGE_SIZE)),
    };
  }, [filter, range, orders.length]);

  // Fetch pages [0, pages) for a view and concatenate them. hasMore comes from
  // the final page. Returns null if any page fails (e.g. lost authorization).
  const fetchPages = useCallback(
    async (f: OrderFilter, r: DateRangeKey, pages: number) => {
      const results = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          loadOrdersAction({ filter: f, range: r, offset: i * ORDERS_PAGE_SIZE }),
        ),
      );
      if (results.some((res) => !res.ok)) return null;
      const ok = results as Extract<
        Awaited<ReturnType<typeof loadOrdersAction>>,
        { ok: true }
      >[];
      return {
        orders: ok.flatMap((res) => res.orders),
        hasMore: ok[ok.length - 1].hasMore,
        counts: ok[ok.length - 1].counts,
      };
    },
    [],
  );

  // Switch to a new tab/range: reset to the first page.
  const applyView = useCallback(
    (f: OrderFilter, r: DateRangeKey) => {
      setFilter(f);
      setRange(r);
      startTransition(async () => {
        const res = await fetchPages(f, r, 1);
        if (!res) return;
        setOrders(res.orders);
        setHasMore(res.hasMore);
        setCounts(res.counts);
      });
    },
    [fetchPages],
  );

  const onFilterChange = useCallback(
    (f: OrderFilter) => {
      if (f !== filter) applyView(f, range);
    },
    [filter, range, applyView],
  );

  const onRangeChange = useCallback(
    (r: DateRangeKey) => {
      if (r !== range) applyView(filter, r);
    },
    [filter, range, applyView],
  );

  const onLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    const res = await loadOrdersAction({ filter, range, offset: orders.length });
    setIsLoadingMore(false);
    if (!res.ok) return;
    setOrders((prev) => [...prev, ...res.orders]);
    setHasMore(res.hasMore);
    setCounts(res.counts);
  }, [filter, range, orders.length, hasMore, isLoadingMore]);

  // Realtime: re-fetch the pages currently on screen for the active view.
  useEffect(
    () =>
      subscribeToOrders(() => {
        const { filter: f, range: r, pages } = viewRef.current;
        startTransition(async () => {
          const res = await fetchPages(f, r, pages);
          if (!res) return;
          setOrders(res.orders);
          setHasMore(res.hasMore);
          setCounts(res.counts);
        });
      }),
    [fetchPages],
  );

  return (
    <ManageOrdersScreen
      backHref={backHref}
      backLabel={backLabel}
      orders={orders}
      counts={counts}
      filter={filter}
      range={range}
      hasMore={hasMore}
      isRefreshing={isPending}
      isLoadingMore={isLoadingMore}
      onFilterChange={onFilterChange}
      onRangeChange={onRangeChange}
      onLoadMore={onLoadMore}
    />
  );
}
