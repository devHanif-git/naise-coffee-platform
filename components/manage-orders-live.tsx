"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { ManageOrdersScreen } from "@/components/manage-orders-screen";
import { subscribeToOrders } from "@/lib/orders/realtime";
import { loadOrdersAction } from "@/app/(admin)/manage/actions";
import {
  ORDERS_PAGE_SIZE,
  isOrderFilter,
  type OrderFilter,
  type OrderGroupCounts,
  type PaymentFilterOption,
} from "@/lib/orders/status";
import { isDateRangeKey, type DateRangeKey } from "@/lib/orders/range";
import type { Order } from "@/types/order";

// Remembers the staffer's tab/range for this browser session, so returning to
// the board (back button, or a router.push from a finished order) restores the
// view instead of snapping back to the Pending default.
const VIEW_STORAGE_KEY = "manage-orders-view";

type Props = {
  initialOrders: Order[];
  initialHasMore: boolean;
  initialCounts: OrderGroupCounts;
  initialFilter: OrderFilter;
  initialRange: DateRangeKey;
  // Payment quick-filter chips derived from the CMS payment settings, leading
  // with the "all" chip. Fixed for the session (server-provided).
  paymentOptions: PaymentFilterOption[];
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
  paymentOptions,
  backHref,
  backLabel,
}: Props) {
  const [filter, setFilter] = useState<OrderFilter>(initialFilter);
  const [range, setRange] = useState<DateRangeKey>(initialRange);
  // Payment chip: "all" by default (matches the server's unfiltered initial page).
  const [payment, setPayment] = useState<string>("all");
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [counts, setCounts] = useState<OrderGroupCounts>(initialCounts);
  const [isPending, startTransition] = useTransition();
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // Latest filter/range/page-count, so the realtime callback always refreshes
  // the current view rather than whatever was current when the subscription was
  // created. Synced in an effect (never mutated during render).
  const viewRef = useRef({ filter, range, payment, pages: 1 });
  useEffect(() => {
    viewRef.current = {
      filter,
      range,
      payment,
      pages: Math.max(1, Math.ceil(orders.length / ORDERS_PAGE_SIZE)),
    };
  }, [filter, range, payment, orders.length]);

  // Fetch pages [0, pages) for a view and concatenate them. hasMore comes from
  // the final page. Returns null if any page fails (e.g. lost authorization).
  const fetchPages = useCallback(
    async (f: OrderFilter, r: DateRangeKey, p: string, pages: number) => {
      const results = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          loadOrdersAction({
            filter: f,
            range: r,
            payment: p,
            offset: i * ORDERS_PAGE_SIZE,
          }),
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

  // Switch to a new tab/range/payment: reset to the first page.
  const applyView = useCallback(
    (f: OrderFilter, r: DateRangeKey, p: string) => {
      setFilter(f);
      setRange(r);
      setPayment(p);
      startTransition(async () => {
        const res = await fetchPages(f, r, p, 1);
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
      if (f !== filter) applyView(f, range, payment);
    },
    [filter, range, payment, applyView],
  );

  const onRangeChange = useCallback(
    (r: DateRangeKey) => {
      if (r !== range) applyView(filter, r, payment);
    },
    [filter, range, payment, applyView],
  );

  const onPaymentChange = useCallback(
    (p: string) => {
      if (p !== payment) applyView(filter, range, p);
    },
    [filter, range, payment, applyView],
  );

  // On mount, restore the tab/range the staffer last used this session. The
  // server always renders the Pending default, so if the stored view differs we
  // switch to it and re-fetch. Runs once; state updates happen inside the
  // transition (not synchronously in the effect body) and SSR has no
  // sessionStorage, so reading it here is safe. `hydrated` gates the persist
  // effect below until the initial view is settled, so it can't overwrite the
  // saved value with the default before restore applies.
  const started = useRef(false);
  const hydrated = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let f = filter;
    let r = range;
    let p = payment;
    const raw = sessionStorage.getItem(VIEW_STORAGE_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as {
          filter?: string;
          range?: string;
          payment?: string;
        };
        if (saved.filter && isOrderFilter(saved.filter)) f = saved.filter;
        if (saved.range && isDateRangeKey(saved.range)) r = saved.range;
        // Restore the payment chip only if it's still an offered option — the
        // CMS may have disabled that method since the value was saved.
        if (
          saved.payment &&
          paymentOptions.some((o) => o.value === saved.payment)
        ) {
          p = saved.payment;
        }
      } catch {
        // Corrupt entry — keep the server default.
      }
    }
    if (f === filter && r === range && p === payment) {
      hydrated.current = true;
      return;
    }
    startTransition(async () => {
      const res = await fetchPages(f, r, p, 1);
      hydrated.current = true;
      if (!res) return;
      setFilter(f);
      setRange(r);
      setPayment(p);
      setOrders(res.orders);
      setHasMore(res.hasMore);
      setCounts(res.counts);
    });
  }, [fetchPages, filter, range, payment, paymentOptions]);

  // Persist the active view so the next visit restores it. Gated on `hydrated`
  // so the mount-time write can't clobber the stored value before restore runs.
  useEffect(() => {
    if (!hydrated.current) return;
    sessionStorage.setItem(
      VIEW_STORAGE_KEY,
      JSON.stringify({ filter, range, payment }),
    );
  }, [filter, range, payment]);

  const onLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    const res = await loadOrdersAction({
      filter,
      range,
      payment,
      offset: orders.length,
    });
    setIsLoadingMore(false);
    if (!res.ok) return;
    setOrders((prev) => [...prev, ...res.orders]);
    setHasMore(res.hasMore);
    setCounts(res.counts);
  }, [filter, range, payment, orders.length, hasMore, isLoadingMore]);

  // Realtime: re-fetch the pages currently on screen for the active view.
  useEffect(
    () =>
      subscribeToOrders(() => {
        const { filter: f, range: r, payment: p, pages } = viewRef.current;
        startTransition(async () => {
          const res = await fetchPages(f, r, p, pages);
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
      payment={payment}
      paymentOptions={paymentOptions}
      hasMore={hasMore}
      isRefreshing={isPending}
      isLoadingMore={isLoadingMore}
      onFilterChange={onFilterChange}
      onRangeChange={onRangeChange}
      onPaymentChange={onPaymentChange}
      onLoadMore={onLoadMore}
    />
  );
}
