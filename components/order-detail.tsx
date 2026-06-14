"use client";

import { useState, useTransition } from "react";
import { ChevronRight, Receipt } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { DrinkRow, type DrinkStatus } from "@/components/drink-row";
import { ReceiptModal } from "@/components/receipt-modal";
import { updateDrinkStatus } from "@/app/(admin)/manage/actions";
import type { Order } from "@/types/order";

// Interactive single-order management view, shared by the real manage page
// (/manage/[token]) and the mock test page (/manage/test). Each drink is
// advanced individually by swiping (pending -> preparing -> done). When every
// drink is done the whole order is complete — which is where the backend will
// later notify the buyer over WhatsApp and mark the unique link as complete.
//
// `persist` controls whether changes are written to the store: real orders
// persist (and survive a refresh); the /manage/test mock isn't in the store, so
// it runs local-only.
export function OrderDetail({
  order,
  persist = true,
}: {
  order: Order;
  persist?: boolean;
}) {
  // Per-drink status, keyed by line index, seeded from the order's own lines.
  // Held locally for optimistic updates; the server action persists in parallel.
  const [statuses, setStatuses] = useState<DrinkStatus[]>(() =>
    order.items.map((item) => item.status),
  );
  const [showReceipt, setShowReceipt] = useState(false);
  const [, startTransition] = useTransition();

  const doneCount = statuses.filter((s) => s === "done").length;
  const allDone = doneCount === order.items.length;

  // Optimistically set a drink's status, then persist (for real orders).
  function applyStatus(index: number, status: DrinkStatus) {
    setStatuses((prev) => {
      const next = [...prev];
      next[index] = status;
      return next;
    });
    if (persist) {
      startTransition(async () => {
        await updateDrinkStatus(order.token, index, status);
      });
    }
  }

  // Advance a single drink one step along pending -> preparing -> done.
  function advanceDrink(index: number) {
    const current = statuses[index];
    applyStatus(index, current === "pending" ? "preparing" : "done");
  }

  // True once every drink is done.
  const justCompleted = allDone;
  // When this flips true for a real order, the store derives the order status as
  // "completed". TODO(backend): that's the hook to notify the buyer over the
  // WhatsApp API that the order is ready for pickup and mark the unique manage
  // link as complete. Wire up once Supabase + WhatsApp land.

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 py-8">
      <header className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Manage Order
        </span>
        <h1 className="font-heading text-2xl font-bold tracking-tight tabular-nums">
          {order.orderNumber}
        </h1>
      </header>

      {/* Order-level progress: how many drinks are done. */}
      <section className="mt-6 flex flex-col gap-2 rounded-2xl bg-neutral-100/70 px-4 py-3.5">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {justCompleted ? "Order Complete" : "Progress"}
          </span>
          <span className="text-xs font-semibold tabular-nums text-muted-foreground">
            {doneCount}/{order.items.length} drinks
          </span>
        </div>
        <div className="flex gap-1.5">
          {order.items.map((_, i) => (
            <div
              key={i}
              className={
                "h-1.5 flex-1 rounded-full transition-colors " +
                (statuses[i] === "done"
                  ? "bg-emerald-500"
                  : statuses[i] === "preparing"
                    ? "bg-blue-500"
                    : "bg-neutral-300")
              }
            />
          ))}
        </div>
        {justCompleted && (
          <p className="text-xs font-medium text-emerald-700">
            All drinks ready — buyer will be notified for pickup.
          </p>
        )}
      </section>

      <dl className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-neutral-100 px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">Status</dt>
          <dd className="mt-0.5 text-sm font-bold capitalize">
            {justCompleted ? "completed" : order.status}
          </dd>
        </div>
        <div className="rounded-2xl bg-neutral-100 px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">Payment</dt>
          <dd className="mt-0.5 text-sm font-bold">{order.paymentMethod}</dd>
        </div>
      </dl>

      <section className="mt-7 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider">Drinks</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            Swipe each drink to update
          </span>
        </div>
        <ul className="flex flex-col">
          {order.items.map((item, i) => (
            <DrinkRow
              key={`${item.name}-${i}`}
              item={item}
              status={statuses[i]}
              onAdvance={() => advanceDrink(i)}
              onReset={() => applyStatus(i, "pending")}
            />
          ))}
        </ul>
      </section>

      {order.notes && (
        <section className="mt-5 rounded-2xl bg-neutral-50 px-4 py-3 text-sm">
          <span className="font-semibold">Note: </span>
          <span className="whitespace-pre-line break-words">{order.notes}</span>
        </section>
      )}

      {/* Proof of payment — only for orders that carry a receipt (e.g. DuitNow
          QR). Tap opens the receipt full-screen, like opening a tab. */}
      {order.proofOfPaymentUrl && (
        <section className="mt-5 flex flex-col gap-2">
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
                {order.paymentMethod}
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

      <section className="mt-7 flex items-baseline justify-between border-t border-border pt-5 text-base font-bold">
        <span>Total</span>
        <span className="tabular-nums">{formatPrice(order.total)}</span>
      </section>

      {showReceipt && order.proofOfPaymentUrl && (
        <ReceiptModal
          src={order.proofOfPaymentUrl}
          orderNumber={order.orderNumber}
          onClose={() => setShowReceipt(false)}
        />
      )}
    </main>
  );
}
