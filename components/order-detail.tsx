"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, ChevronLeft, ChevronRight, Loader2, MessageCircle, Receipt, TriangleAlert } from "lucide-react";
import { formatPrice, formatOrderTime } from "@/lib/format";
import { buildWhatsAppReadyLink } from "@/lib/orders/message";
import { DrinkRow, type DrinkStatus } from "@/components/drink-row";
import { ReceiptModal } from "@/components/receipt-modal";
import { paymentMethodLabel, UNPAID_PAYMENT_METHOD } from "@/data/payment-methods";
import {
  cancelOrderAction,
  markReadyAndNotify,
  setOrderPaymentAction,
  updateDrinkStatus,
} from "@/app/(admin)/manage/actions";
import { OrderCompleteModal } from "@/components/order-complete-modal";
import type { Order } from "@/types/order";

// Interactive single-order management view used by the manage page
// (/manage/[token]). Each drink is advanced individually by swiping
// (pending -> preparing -> done). When every drink is done the whole order is
// complete — which is where the backend will later notify the buyer over
// WhatsApp and mark the unique link as complete.
//
// `persist` controls whether changes are written to the store: real orders
// persist (and survive a refresh). It's kept as a prop so a non-persisting,
// read-only render stays possible without store writes.
export function OrderDetail({
  order,
  persist = true,
  backHref = "/manage",
  recipeMap,
}: {
  order: Order;
  persist?: boolean;
  // Where the back control returns to — the staff board by default.
  backHref?: string;
  recipeMap?: Map<string, string[]>;
}) {
  // Per-drink status, keyed by line index, seeded from the order's own lines.
  // Held locally for optimistic updates; the server action persists in parallel.
  const [statuses, setStatuses] = useState<DrinkStatus[]>(() =>
    order.items.map((item) => item.status),
  );
  // Completion timestamp. Seeded from the order (set for orders already
  // complete when loaded) and stamped client-side when the last drink is
  // marked done; cleared if a drink is re-opened. The store stamps the same
  // field server-side for real orders, so a refresh keeps this value.
  const [completedAt, setCompletedAt] = useState<string | undefined>(
    order.completedAt,
  );
  const [showReceipt, setShowReceipt] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [lastDoneIndex, setLastDoneIndex] = useState<number | null>(null);
  const [completing, setCompleting] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState(order.paymentMethod);
  const [settingPayment, setSettingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  const doneCount = statuses.filter((s) => s === "done").length;
  const allDone = doneCount === order.items.length;
  // wa.me deep link for the manual ready handoff; null when no number on file.
  const waReadyLink = buildWhatsAppReadyLink(order);

  // Optimistically set a drink's status, then persist (for real orders).
  function applyStatus(index: number, status: DrinkStatus) {
    const next = [...statuses];
    next[index] = status;
    setStatuses(next);

    const nowAllDone = next.length > 0 && next.every((s) => s === "done");
    setCompletedAt((prev) =>
      nowAllDone ? (prev ?? new Date().toISOString()) : undefined,
    );
    // Auto-open the completion modal the moment the last drink turns done, but
    // only for real (persisted) orders that aren't already completed.
    if (nowAllDone && status === "done") {
      setLastDoneIndex(index);
      setShowComplete(true);
    }

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

  function confirmComplete() {
    setCompleting(true);
    startTransition(async () => {
      if (persist) await markReadyAndNotify(order.token);
      setCompleting(false);
      setShowComplete(false);
      // Auto-open WhatsApp with the prefilled ready notice so staff don't tap a
      // second button. Same-tab navigation (not window.open) so it isn't
      // popup-blocked after the await; on mobile this hands off to the WA app.
      // The persistent button below stays for manual re-sends.
      if (persist && waReadyLink) window.location.href = waReadyLink;
    });
  }

  // Cancel reverts the drink that just completed back to "preparing", so the
  // order leaves "ready" and no notice is sent.
  function cancelComplete() {
    setShowComplete(false);
    if (lastDoneIndex !== null) applyStatus(lastDoneIndex, "preparing");
    setLastDoneIndex(null);
  }

  // Cancel the whole order (staff override). This also reverses any Beans the
  // order earned for a member (server-side, via cancelOrderAction). On success
  // we return to the board, where the order moves to the Cancelled filter.
  function confirmCancelOrder() {
    setCancelError(null);
    setCancelling(true);
    startTransition(async () => {
      const result = await cancelOrderAction(order.token);
      setCancelling(false);
      if (!result.ok) {
        setCancelError(result.error);
        return;
      }
      setShowCancel(false);
      router.push(backHref);
    });
  }

  // Resolve a pay-later order's method. Staff-only; the action re-checks auth.
  function resolvePayment(method: "cash" | "duitnow-qr") {
    setPaymentError(null);
    setSettingPayment(true);
    startTransition(async () => {
      const res = await setOrderPaymentAction(order.token, method);
      setSettingPayment(false);
      if (!res.ok) {
        setPaymentError(res.error);
        return;
      }
      setPaymentMethod(method);
    });
  }

  const isUnpaid = paymentMethod === UNPAID_PAYMENT_METHOD;

  // Whether the staff cancel control is offered: persisted orders that aren't
  // already finished. A non-persisting (persist=false) render never shows it.
  const canCancel =
    persist && order.status !== "completed" && order.status !== "cancelled";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8">
      {/* Sticky back bar — same control as the customer order view. */}
      <header className="sticky top-0 z-20 -mx-5 flex items-center justify-between bg-background px-5 pb-3 pt-4">
        <Link
          href={backHref}
          aria-label="Back"
          className="flex size-9 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-neutral-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <h1 className="font-heading text-base font-semibold uppercase tracking-[0.25em]">
          Manage
        </h1>
        <div className="size-9" aria-hidden />
      </header>

      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-2xl font-bold tracking-tight tabular-nums">
          {order.orderNumber}
        </h2>
        <time
          dateTime={order.createdAt}
          className="text-xs text-muted-foreground tabular-nums"
        >
          {formatOrderTime(order.createdAt)}
        </time>
      </div>

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
          <div className="flex flex-col gap-2.5">
            <p className="text-xs font-medium text-emerald-700">
              {waReadyLink
                ? "All drinks ready — buyer notified on WhatsApp. Resend below if it didn't go through."
                : "All drinks ready — buyer will be notified for pickup."}
              {completedAt && (
                <>
                  {" "}
                  <span className="text-emerald-700/70">
                    Completed{" "}
                    <time dateTime={completedAt} className="tabular-nums">
                      {formatOrderTime(completedAt)}
                    </time>
                    .
                  </span>
                </>
              )}
            </p>
            {/* Same-tab navigation to match the auto-open on Complete (which must
                be same-tab to dodge popup blocking). Keeps both paths consistent
                — on mobile this hands off to the WhatsApp app. */}
            {waReadyLink && (
              <a
                href={waReadyLink}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <MessageCircle className="size-4" strokeWidth={2} aria-hidden />
                Resend on WhatsApp
              </a>
            )}
          </div>
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
          {isUnpaid ? (
            <dd className="mt-1 flex flex-col gap-2">
              <span className="inline-flex w-fit items-center rounded-full bg-amber-100 px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-amber-700">
                Unpaid
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => resolvePayment("cash")}
                  disabled={settingPayment}
                  className="h-8 flex-1 rounded-xl border border-border bg-white text-xs font-semibold disabled:opacity-50"
                >
                  Cash
                </button>
                <button
                  type="button"
                  onClick={() => resolvePayment("duitnow-qr")}
                  disabled={settingPayment}
                  className="h-8 flex-1 rounded-xl border border-border bg-white text-xs font-semibold disabled:opacity-50"
                >
                  DuitNow QR
                </button>
              </div>
              {paymentError && <span className="text-xs text-rose-600">{paymentError}</span>}
            </dd>
          ) : (
            <dd className="mt-0.5 text-sm font-bold">{paymentMethodLabel(paymentMethod)}</dd>
          )}
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
              recipeSteps={item.productId ? recipeMap?.get(item.productId) ?? null : null}
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

      <section className="mt-7 flex items-baseline justify-between border-t border-border pt-5 text-base font-bold">
        <span>Total</span>
        <span className="tabular-nums">{formatPrice(order.total)}</span>
      </section>

      {canCancel && (
        <button
          type="button"
          onClick={() => setShowCancel(true)}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 text-xs font-semibold uppercase tracking-wider text-rose-600 transition-colors hover:bg-rose-50 outline-none focus-visible:ring-3 focus-visible:ring-rose-300"
        >
          <Ban className="size-4" strokeWidth={2} aria-hidden />
          Cancel Order
        </button>
      )}

      {showCancel && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-order-title"
          onClick={() => !cancelling && setShowCancel(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 naise-fade"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-white p-6 naise-pop"
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                <Ban className="size-6" strokeWidth={2} aria-hidden />
              </span>
              <h2
                id="cancel-order-title"
                className="font-heading text-xl font-bold tracking-tight"
              >
                Cancel {order.orderNumber}?
              </h2>
              <p className="text-sm text-muted-foreground">
                This marks the order cancelled and refunds any Beans it earned.
                This can&apos;t be undone.
              </p>
            </div>

            {cancelError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-2xl bg-rose-50 px-4 py-2.5 text-xs text-rose-700"
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <p className="min-w-0 flex-1">{cancelError}</p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={confirmCancelOrder}
                disabled={cancelling}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-rose-600 text-xs font-semibold uppercase tracking-[0.15em] text-white transition-transform hover:scale-[1.01] active:scale-[0.99] outline-none focus-visible:ring-3 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100"
              >
                {cancelling ? (
                  <>
                    <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
                    Cancelling
                  </>
                ) : (
                  "Cancel Order"
                )}
              </button>
              <button
                type="button"
                onClick={() => setShowCancel(false)}
                disabled={cancelling}
                className="flex h-12 w-full items-center justify-center rounded-full border border-border text-xs font-semibold uppercase tracking-[0.15em] text-foreground transition-colors hover:bg-neutral-50 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
              >
                Keep Order
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceipt && order.proofOfPaymentUrl && (
        <ReceiptModal
          src={order.proofOfPaymentUrl}
          orderNumber={order.orderNumber}
          onClose={() => setShowReceipt(false)}
        />
      )}
      {showComplete && (
        <OrderCompleteModal
          orderNumber={order.orderNumber}
          busy={completing}
          hasContactPhone={Boolean(order.contactPhone)}
          onConfirm={confirmComplete}
          onCancel={cancelComplete}
        />
      )}
    </main>
  );
}
