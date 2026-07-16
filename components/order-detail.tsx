"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, ChevronLeft, ChevronRight, CheckCircle2, Loader2, MessageCircle, Minus, Pencil, Plus, Receipt, TriangleAlert } from "lucide-react";
import { formatPrice, formatOrderTime } from "@/lib/format";
import { buildWhatsAppReadyLink } from "@/lib/orders/message";
import { DrinkRow, type DrinkStatus } from "@/components/drink-row";
import { SwapPicker } from "@/components/swap-picker";
import { ReceiptModal } from "@/components/receipt-modal";
import { paymentMethodLabel, UNPAID_PAYMENT_METHOD } from "@/data/payment-methods";
import {
  cancelOrderAction,
  changeOrderPaymentAction,
  markReadyAndNotify,
  setOrderPaymentAction,
  swapDrinkAction,
  updateDrinkStatus,
  voidDrinkAction,
  type SwapDrinkInput,
} from "@/app/(admin)/manage/actions";
import { OrderCompleteModal } from "@/components/order-complete-modal";
import { OrderFinishedModal } from "@/components/order-finished-modal";
import { ChangePaymentModal } from "@/components/change-payment-modal";
import type { Category, Product } from "@/types/menu";
import type { Order, OrderAdjustment } from "@/types/order";
import { AttachMember } from "@/components/stamps/attach-member";

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
  paymentOptions = [],
  categories = [],
  products = [],
  hasOpenShift = true,
}: {
  order: Order;
  persist?: boolean;
  // Where the back control returns to — the staff board by default.
  backHref?: string;
  recipeMap?: Map<string, string[]>;
  // Methods staff can switch this order to (manager-gated edit). Empty disables
  // the edit control (e.g. a read-only / non-persisting render).
  paymentOptions?: { id: string; name: string }[];
  // Menu catalog for the swap picker. Empty on a non-persisting render (no swaps).
  categories?: Category[];
  products?: Product[];
  // Whether a cash-drawer shift is currently open. Drink-making (advancing a
  // drink, completing the order) is gated on this — the server actions enforce
  // it too. Defaults true so non-manage renders (which don't pass it) are
  // unaffected.
  hasOpenShift?: boolean;
}) {
  // Per-drink status, keyed by line index, seeded from the order's own lines.
  // Held locally for optimistic updates; the server action persists in parallel.
  const [statuses, setStatuses] = useState<DrinkStatus[]>(() =>
    order.items.map((item) => item.status),
  );
  // Which lines have been voided, keyed by index. Seeded from the order; updated
  // when a void action returns the refreshed order.
  const [voided, setVoided] = useState<boolean[]>(() =>
    order.items.map((item) => Boolean(item.voidedAt)),
  );
  // Live copies of the fields amendments change: the lines (name/size/add-ons on
  // a swap), the running total, and the amendment log. All refreshed wholesale
  // from the server's returned order after a void/swap.
  const [lines, setLines] = useState(() => order.items);
  const [total, setTotal] = useState(order.total);
  const [adjustments, setAdjustments] = useState<OrderAdjustment[]>(
    () => order.adjustments ?? [],
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
  const [settingPayment, setSettingPayment] = useState<"cash" | "duitnow-qr" | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [showChangePayment, setShowChangePayment] = useState(false);
  const [changingPayment, setChangingPayment] = useState(false);
  const [changePaymentError, setChangePaymentError] = useState<string | null>(null);
  // Per-drink amendment (void/swap) UI state. `amending` names the line + action
  // in flight so the row and modal can show a busy state. Void goes through a
  // small confirm; swap opens the picker.
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const [voidIndex, setVoidIndex] = useState<number | null>(null);
  // How many units to void on the line being confirmed. For a qty-1 line this is
  // always 1; for a multi-unit line staff pick 1..qty in the modal.
  const [voidCount, setVoidCount] = useState(1);
  const [amending, setAmending] = useState(false);
  const [amendError, setAmendError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  // Drives the post-completion WhatsApp handoff modal. Set to "success" after a
  // confirmed completion when the order has a contact number to notify; orders
  // with no number skip it and route straight back to the board.
  const [finishState, setFinishState] = useState<"success" | null>(null);

  // Progress is measured over ACTIVE (non-voided) drinks only — a voided line has
  // left the order, so it neither counts toward completion nor blocks it.
  const activeCount = voided.filter((v) => !v).length;
  const doneCount = statuses.filter((s, i) => s === "done" && !voided[i]).length;
  const allDone = activeCount > 0 && doneCount === activeCount;
  // wa.me deep link for the manual ready handoff; null when no number on file.
  const waReadyLink = buildWhatsAppReadyLink(order);

  // Discount breakdown, derived from the order as stored (not the live amended
  // state — the amendment panel + struck total below handle in-session edits).
  // subtotal = pre-promo; sum of active line totals = promo-applied; total =
  // after voucher too. So the two gaps give the promo and voucher amounts.
  // Works for old orders too, since it only reads subtotal/total/line totals.
  const activeLineSum = order.items
    .filter((i) => !i.voidedAt)
    .reduce((sum, i) => sum + i.lineTotal, 0);
  const promoSavings = Math.max(0, order.subtotal - activeLineSum);
  const voucherDiscount = Math.max(0, activeLineSum - order.total);

  // Whether staff can still amend individual drinks: a persisted, in-progress
  // order with the catalog loaded. Terminal orders (completed/cancelled) are
  // locked. Individual line eligibility (not done/voided/reward) is decided per row.
  const canAmend =
    persist &&
    products.length > 0 &&
    order.status !== "completed" &&
    order.status !== "cancelled" &&
    finishState !== "success";

  // Whether the order is actually settled — completed in the DB, or completed in
  // this session. Distinct from `allDone`: an order can have every drink done yet
  // still sit at "ready" if completion never ran (an interrupted auto-complete).
  const isCompleted = order.status === "completed" || finishState === "success";
  // All drinks done but the order was never settled — it needs an explicit
  // Complete action since there's nothing left to swipe. Hidden while a
  // completion is already in flight (the finished/confirm modals cover it).
  const needsManualComplete =
    persist &&
    hasOpenShift &&
    allDone &&
    !isCompleted &&
    order.status !== "cancelled" &&
    finishState === null &&
    !showComplete;

  // Optimistically set a drink's status, then persist (for real orders).
  function applyStatus(index: number, status: DrinkStatus) {
    const next = [...statuses];
    next[index] = status;
    setStatuses(next);

    // "All done" is measured over active (non-voided) lines only.
    const activeIdx = next.filter((_, i) => !voided[i]);
    const nowAllDone =
      activeIdx.length > 0 && activeIdx.every((s) => s === "done");
    setCompletedAt((prev) =>
      nowAllDone ? (prev ?? new Date().toISOString()) : undefined,
    );
    // The moment the last drink turns done on a real, not-yet-complete order,
    // open the confirm modal — for every order, counter or online. Guard on
    // persist so a read-only render never fires completion.
    if (nowAllDone && status === "done" && persist) {
      setLastDoneIndex(index);
      setCompleteError(null);
      setShowComplete(true);
    }

    if (persist) {
      startTransition(async () => {
        // Persist the drink status. This write derives the order status from the
        // drinks — "ready" once every drink is done — and clears completed_at.
        // The explicit confirm modal (opened above) drives completion after this.
        await updateDrinkStatus(order.token, index, status);
      });
    }
  }

  // Advance a single drink one step along pending -> preparing -> done. Gated on
  // an open shift — the server action enforces it too, this just avoids a wasted
  // round-trip and keeps the UI honest.
  function advanceDrink(index: number) {
    if (!hasOpenShift) return;
    const current = statuses[index];
    applyStatus(index, current === "pending" ? "preparing" : "done");
  }

  // Refresh all amendment-affected local state from the server's returned order.
  // The server is the source of truth for voids, swapped line details, the
  // recalculated total, and the amendment log — so we replace wholesale.
  function applyRefreshedOrder(next: Order) {
    setLines(next.items);
    setStatuses(next.items.map((i) => i.status));
    setVoided(next.items.map((i) => Boolean(i.voidedAt)));
    setTotal(next.total);
    setAdjustments(next.adjustments ?? []);
  }

  // Void drinks on one line. Opens a confirm first (handleVoid), then commits
  // here for `voidCount` units. On the "last active drink" guard the action
  // returns an error steering staff to cancel the whole order instead; we surface
  // it inline in the confirm.
  function confirmVoid() {
    if (voidIndex === null) return;
    const index = voidIndex;
    const count = voidCount;
    setAmendError(null);
    setAmending(true);
    startTransition(async () => {
      const res = await voidDrinkAction(order.token, index, count);
      setAmending(false);
      if (!res.ok) {
        setAmendError(res.error);
        return;
      }
      applyRefreshedOrder(res.order);
      setVoidIndex(null);
    });
  }

  // Swap one drink for another. The picker collects the product/size/add-ons; the
  // server re-prices and rewrites the line, then returns the refreshed order.
  function confirmSwap(input: SwapDrinkInput) {
    if (swapIndex === null) return;
    const index = swapIndex;
    setAmendError(null);
    setAmending(true);
    startTransition(async () => {
      const res = await swapDrinkAction(order.token, index, input);
      setAmending(false);
      if (!res.ok) {
        setAmendError(res.error);
        return;
      }
      applyRefreshedOrder(res.order);
      setSwapIndex(null);
    });
  }

  // Open the void confirm / swap picker for a line, clearing any stale error.
  // Void starts with a count of 1 so a multi-unit line defaults to voiding one.
  function handleVoid(index: number) {
    setAmendError(null);
    setVoidCount(1);
    setVoidIndex(index);
  }
  function handleSwap(index: number) {
    setAmendError(null);
    setSwapIndex(index);
  }

  // Settle an order whose drinks are all done but which was never completed (a
  // stuck "ready" order, or an interrupted auto-complete). Same paths as the
  // automatic flow: counter orders complete directly; online orders open the
  // confirm modal so staff still get the notify step.
  function completeNow() {
    if (!hasOpenShift) return;
    setCompleteError(null);
    setShowComplete(true);
  }

  // True once every drink is done.
  const justCompleted = allDone;

  // Return to the staff board. Used by every post-completion "done" affordance so
  // staff never have to hit Back on a finished order.
  function goToBoard() {
    router.push(backHref);
  }

  function confirmComplete() {
    setCompleting(true);
    setCompleteError(null);
    startTransition(async () => {
      if (persist) {
        const res = await markReadyAndNotify(order.token);
        setCompleting(false);
        if (!res.ok) {
          // Most common cause: order still 'unpaid'. Keep the modal open and
          // tell staff to resolve payment first (the picker is in the modal).
          setCompleteError(res.error);
          return;
        }
      } else {
        setCompleting(false);
      }
      setShowComplete(false);
      // Order is complete. When it has a contact number, show the WhatsApp
      // handoff modal (a real anchor tap, not popup-blocked, that also routes
      // back to the board). With no number there's nobody to message, so skip
      // the extra tap and go straight back to /manage.
      if (waReadyLink) {
        setFinishState("success");
      } else {
        goToBoard();
      }
    });
  }

  // Cancel reverts the drink that just completed back to "preparing", so the
  // order leaves "ready" and no notice is sent.
  function cancelComplete() {
    setCompleteError(null);
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
    setSettingPayment(method);
    startTransition(async () => {
      const res = await setOrderPaymentAction(order.token, method);
      setSettingPayment(null);
      if (!res.ok) {
        setPaymentError(res.error);
        return;
      }
      setPaymentMethod(method);
      // If the order was blocked on payment with every drink already done, open
      // the confirm modal so staff can complete it now without re-swiping.
      if (allDone) {
        setCompleteError(null);
        setShowComplete(true);
      }
    });
  }

  const isUnpaid = paymentMethod === UNPAID_PAYMENT_METHOD;

  // Manager-gated correction of an already-set method. Offered for persisted,
  // non-cancelled orders that have a real method and at least one option to
  // switch to. The action re-verifies the passcode and staff role server-side.
  const canEditPayment =
    persist &&
    !isUnpaid &&
    order.status !== "cancelled" &&
    paymentOptions.length > 0;

  function changePayment(method: string, passcode: string) {
    setChangePaymentError(null);
    setChangingPayment(true);
    startTransition(async () => {
      const res = await changeOrderPaymentAction(order.token, method, passcode);
      setChangingPayment(false);
      if (!res.ok) {
        setChangePaymentError(res.error);
        return;
      }
      setPaymentMethod(method);
      setShowChangePayment(false);
    });
  }

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
            {doneCount}/{activeCount} drinks
          </span>
        </div>
        <div className="flex gap-1.5">
          {lines.map((line, i) =>
            voided[i] ? null : (
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
            ),
          )}
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
          <div className="flex items-center justify-between gap-2">
            <dt className="text-xs font-medium text-muted-foreground">Payment</dt>
            {canEditPayment && (
              <button
                type="button"
                onClick={() => {
                  setChangePaymentError(null);
                  setShowChangePayment(true);
                }}
                aria-label="Change payment method"
                className="-my-1 -mr-1 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[0.6875rem] font-semibold text-muted-foreground outline-none transition-colors hover:bg-neutral-200/70 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Pencil className="size-3" strokeWidth={2.5} aria-hidden />
                Edit
              </button>
            )}
          </div>
          {isUnpaid ? (
            <dd className="mt-1">
              <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-amber-700">
                Unpaid
              </span>
            </dd>
          ) : (
            <dd className="mt-0.5 text-sm font-bold">{paymentMethodLabel(paymentMethod)}</dd>
          )}
        </div>
      </dl>

      {/* Resolve a pay-later order. Full-width so the method labels never wrap
          (a half-grid cell crammed "DuitNow QR" onto two lines). */}
      {isUnpaid && (
        <section className="mt-3 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-xs font-bold uppercase tracking-wider">Set payment</h2>
            <p className="text-xs text-muted-foreground">
              Record how the customer paid to complete this order.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => resolvePayment("cash")}
              disabled={settingPayment !== null}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-white text-sm font-semibold outline-none transition-colors hover:bg-neutral-100 disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {settingPayment === "cash" && (
                <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
              )}
              Cash
            </button>
            <button
              type="button"
              onClick={() => resolvePayment("duitnow-qr")}
              disabled={settingPayment !== null}
              className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-border bg-white text-sm font-semibold outline-none transition-colors hover:bg-neutral-100 disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {settingPayment === "duitnow-qr" && (
                <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
              )}
              DuitNow QR
            </button>
          </div>
          {paymentError && <p className="text-xs text-rose-600">{paymentError}</p>}
        </section>
      )}

      {/* No shift open -> drink-making is gated (server + UI). Show staff how to
          proceed without blocking the rest of the order view. */}
      {!hasOpenShift && order.status !== "cancelled" && !isCompleted && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Open a shift to start making drinks.{" "}
          <a
            href="/admin/shift"
            className="font-semibold underline underline-offset-2"
          >
            Open shift
          </a>
        </div>
      )}

      <section className="mt-7 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider">Drinks</h2>
          <span className="text-[0.6875rem] text-muted-foreground">
            {order.status === "cancelled"
              ? "Order cancelled"
              : !hasOpenShift
                ? "Shift closed"
                : canAmend
                  ? "Swipe ← to update · → to amend"
                  : "Swipe each drink to update"}
          </span>
        </div>
        <ul className="flex flex-col">
          {lines.map((item, i) => (
            <DrinkRow
              key={`${item.name}-${i}`}
              item={item}
              status={statuses[i]}
              amendable={
                canAmend &&
                hasOpenShift &&
                !voided[i] &&
                statuses[i] !== "done" &&
                !item.isReward
              }
              locked={order.status === "cancelled" || !hasOpenShift}
              onAdvance={() => advanceDrink(i)}
              onSwap={() => handleSwap(i)}
              onVoid={() => handleVoid(i)}
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

      {/* Attach a loyalty member to this order so the stamp is granted. When a
          member already came with the order, this is a slim confirmation; when
          not, staff can scan the member QR or key in phone/email to bind one. */}
      {persist && (
        <div className="mt-5">
          <AttachMember
            token={order.token}
            attached={Boolean(order.userId)}
            memberName={order.memberName}
          />
        </div>
      )}

      {/* Amendments — the running list of price differences from voids/swaps,
          shown right above the Total so staff read the change before the number.
          Green +RM… when the customer owes more, red −RM… for a refund/cheaper. */}
      {adjustments.length > 0 && (
        <section className="mt-7 flex flex-col gap-2.5 border-t border-border pt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider">
            Amendments
          </h2>
          <ul className="flex flex-col gap-2">
            {adjustments.map((adj, i) => {
              const positive = adj.delta > 0;
              return (
                <li key={i} className="flex items-start justify-between gap-3 text-sm">
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
                      {adj.kind === "void" ? "Voided" : "Swapped"}
                    </span>
                    <span className="min-w-0 break-words font-medium leading-snug">
                      {adj.kind === "swap" && adj.toLabel ? (
                        <>
                          {adj.fromLabel}
                          <span className="text-muted-foreground"> → </span>
                          {adj.toLabel}
                        </>
                      ) : (
                        adj.fromLabel
                      )}
                    </span>
                  </span>
                  <span
                    className={
                      "shrink-0 font-bold tabular-nums " +
                      (positive
                        ? "text-emerald-600"
                        : adj.delta < 0
                          ? "text-rose-600"
                          : "text-muted-foreground")
                    }
                  >
                    {positive ? "+" : adj.delta < 0 ? "−" : ""}
                    {formatPrice(Math.abs(adj.delta))}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Discount breakdown — only when a promo and/or voucher applied. Carries
          the divider above the totals when there are no amendments (which supply
          their own). Negatives in rose, matching the customer checkout. */}
      {(promoSavings > 0 || voucherDiscount > 0) && (
        <section
          className={
            "mt-5 flex flex-col gap-2 " +
            (adjustments.length > 0 ? "" : "mt-7 border-t border-border pt-5")
          }
        >
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="tabular-nums">{formatPrice(order.subtotal)}</span>
          </div>
          {promoSavings > 0 && (
            <div className="flex items-baseline justify-between text-xs font-medium text-rose-600">
              <span>Promo savings</span>
              <span className="tabular-nums">−{formatPrice(promoSavings)}</span>
            </div>
          )}
          {voucherDiscount > 0 && (
            <div className="flex items-baseline justify-between text-xs font-medium text-rose-600">
              <span>{order.voucherLabel ? `Voucher · ${order.voucherLabel}` : "Voucher"}</span>
              <span className="tabular-nums">−{formatPrice(voucherDiscount)}</span>
            </div>
          )}
        </section>
      )}

      <section
        className={
          "flex items-baseline justify-between text-base font-bold " +
          // The breakdown block (when shown) already supplies the divider +
          // top spacing; amendments do too. Only add our own when neither is present.
          (adjustments.length > 0 || promoSavings > 0 || voucherDiscount > 0
            ? "mt-3"
            : "mt-7 border-t border-border pt-5")
        }
      >
        <span>Total</span>
        <span className="flex items-baseline gap-2">
          {total !== order.total && (
            <span className="text-xs font-medium text-muted-foreground line-through tabular-nums">
              {formatPrice(order.total)}
            </span>
          )}
          <span className="tabular-nums">{formatPrice(total)}</span>
        </span>
      </section>

      {/* Order actions, grouped as one block: a tight stack set off from the
          content above. Complete is the primary action for an all-drinks-done
          order; Cancel is the secondary override. */}
      {(needsManualComplete || canCancel) && (
        <div className="mt-6 flex flex-col gap-3">
          {/* All drinks done but the order was never settled (a stuck "ready"
              order, or an interrupted auto-complete). Give staff an explicit way
              to finish it, since there's nothing left to swipe. */}
          {needsManualComplete && (
            <button
              type="button"
              onClick={completeNow}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-xs font-semibold uppercase tracking-[0.15em] text-white transition-transform hover:scale-[1.01] active:scale-[0.99] outline-none focus-visible:ring-3 focus-visible:ring-emerald-300"
            >
              <CheckCircle2 className="size-4" strokeWidth={2} aria-hidden />
              Complete Order
            </button>
          )}

          {canCancel && (
            <button
              type="button"
              onClick={() => setShowCancel(true)}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-rose-200 text-xs font-semibold uppercase tracking-wider text-rose-600 transition-colors hover:bg-rose-50 outline-none focus-visible:ring-3 focus-visible:ring-rose-300"
            >
              <Ban className="size-4" strokeWidth={2} aria-hidden />
              Cancel Order
            </button>
          )}
        </div>
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
          error={completeError}
          onConfirm={confirmComplete}
          onCancel={cancelComplete}
        />
      )}
      {showChangePayment && (
        <ChangePaymentModal
          options={paymentOptions}
          currentMethod={paymentMethod}
          busy={changingPayment}
          error={changePaymentError}
          onConfirm={changePayment}
          onClose={() => setShowChangePayment(false)}
        />
      )}
      {finishState === "success" && waReadyLink && (
        <OrderFinishedModal
          orderNumber={order.orderNumber}
          waReadyLink={waReadyLink}
          onDone={goToBoard}
        />
      )}

      {/* Void a single drink — confirm first. Reworded per-drink from the
          whole-order cancel dialog; surfaces the "last drink" guard inline. */}
      {voidIndex !== null && lines[voidIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="void-drink-title"
          onClick={() => !amending && setVoidIndex(null)}
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
                id="void-drink-title"
                className="font-heading text-xl font-bold tracking-tight"
              >
                Void {lines[voidIndex].name}?
              </h2>
              {lines[voidIndex].quantity > 1 ? (
                <p className="text-sm text-muted-foreground">
                  This line has {lines[voidIndex].quantity} drinks. Choose how many
                  to void — the rest stay on the order. Voided drinks stay on the
                  ticket for the record.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This removes the drink from the order and takes{" "}
                  {formatPrice(lines[voidIndex].lineTotal)} off the total. It stays
                  on the ticket, struck through, for the record.
                </p>
              )}
            </div>

            {/* Quantity stepper — only for multi-unit lines. Bounds 1..qty; at
                the max the line is fully voided (struck through), below it the
                line stays live with fewer units. */}
            {lines[voidIndex].quantity > 1 && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3">
                  <span className="text-sm font-semibold">Drinks to void</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setVoidCount((c) => Math.max(1, c - 1))}
                      disabled={amending || voidCount <= 1}
                      aria-label="Void one fewer"
                      className="flex size-9 items-center justify-center rounded-full border border-border text-foreground outline-none transition-colors hover:bg-neutral-100 disabled:opacity-40 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <Minus className="size-4" strokeWidth={2.5} aria-hidden />
                    </button>
                    <span className="w-6 text-center text-base font-bold tabular-nums">
                      {voidCount}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setVoidCount((c) =>
                          Math.min(lines[voidIndex].quantity, c + 1),
                        )
                      }
                      disabled={amending || voidCount >= lines[voidIndex].quantity}
                      aria-label="Void one more"
                      className="flex size-9 items-center justify-center rounded-full border border-border text-foreground outline-none transition-colors hover:bg-neutral-100 disabled:opacity-40 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <Plus className="size-4" strokeWidth={2.5} aria-hidden />
                    </button>
                  </div>
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  {voidCount >= lines[voidIndex].quantity
                    ? "Voids the whole line"
                    : `${lines[voidIndex].quantity - voidCount} drink${lines[voidIndex].quantity - voidCount === 1 ? "" : "s"} left on the order`}
                  {" · "}−{formatPrice(lines[voidIndex].unitPrice * voidCount)}
                </p>
              </div>
            )}

            {amendError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-2xl bg-rose-50 px-4 py-2.5 text-xs text-rose-700"
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                <p className="min-w-0 flex-1">{amendError}</p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={confirmVoid}
                disabled={amending}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-rose-600 text-xs font-semibold uppercase tracking-[0.15em] text-white transition-transform hover:scale-[1.01] active:scale-[0.99] outline-none focus-visible:ring-3 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100"
              >
                {amending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />
                    Voiding
                  </>
                ) : lines[voidIndex].quantity > 1 ? (
                  voidCount >= lines[voidIndex].quantity
                    ? "Void All Drinks"
                    : `Void ${voidCount} Drink${voidCount === 1 ? "" : "s"}`
                ) : (
                  "Void Drink"
                )}
              </button>
              <button
                type="button"
                onClick={() => setVoidIndex(null)}
                disabled={amending}
                className="flex h-12 w-full items-center justify-center rounded-full border border-border text-xs font-semibold uppercase tracking-[0.15em] text-foreground transition-colors hover:bg-neutral-50 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
              >
                Keep Drink
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Swap a single drink for another menu item. */}
      {swapIndex !== null && lines[swapIndex] && (
        <SwapPicker
          open
          onOpenChange={(next) => {
            if (!next) setSwapIndex(null);
          }}
          categories={categories}
          products={products}
          replacing={lines[swapIndex]}
          busy={amending}
          error={amendError}
          onConfirm={confirmSwap}
        />
      )}
    </main>
  );
}
