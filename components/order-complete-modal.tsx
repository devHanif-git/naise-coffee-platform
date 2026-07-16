"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { formatPrice } from "@/lib/format";

// Auto-opens when the last drink is marked done. Confirm sends the buyer the
// "ready" notice and completes the order; Cancel reverts the just-completed
// drink back to "preparing" so nothing is sent.
//
// For cash orders it also shows a change calculator: staff type the cash
// received and see the change to hand back before completing. Purely a counter
// aid — the figure is not persisted.
export function OrderCompleteModal({
  orderNumber,
  busy,
  hasContactPhone,
  error,
  isCash = false,
  total,
  onConfirm,
  onCancel,
}: {
  orderNumber: string;
  busy: boolean;
  hasContactPhone: boolean;
  error?: string | null;
  // Cash order → render the change calculator. total is the amount due (sen).
  isCash?: boolean;
  total: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [cashReceived, setCashReceived] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [busy, onCancel]);

  // Change = cash received − amount due. A blank field means "exact cash" —
  // received equals the total, so change is RM 0 (staff can just complete).
  const cashReceivedSen =
    cashReceived.trim() === ""
      ? total
      : Math.max(Math.round(Number(cashReceived)), 0) * 100;
  const changeDue = cashReceivedSen - total;
  // Can't complete a cash order when the entered amount doesn't cover the total.
  // A blank field (exact cash) is fine — it equals the total, so never short.
  const isShort = isCash && changeDue < 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Complete order ${orderNumber}`}
      onClick={() => !busy && onCancel()}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col items-center overflow-hidden rounded-3xl bg-white px-6 pb-6 pt-8 text-center naise-pop"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <BellRing className="size-6" strokeWidth={2} aria-hidden />
        </span>

        <span className="mt-4 text-[0.6875rem] font-bold uppercase tracking-[0.15em] text-emerald-700">
          All drinks ready
        </span>
        <h2 className="mt-1 font-heading text-xl font-bold tracking-tight tabular-nums">
          Complete {orderNumber}?
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {hasContactPhone
            ? "This marks the order complete and opens WhatsApp so you can send the buyer their ready notice."
            : "This marks the order as complete."}
        </p>

        {/* Cash change calculator — collect on the spot before completing. */}
        {isCash && (
          <div className="mt-5 flex w-full flex-col gap-3 rounded-2xl border border-border bg-neutral-50 p-4 text-left">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Total due
              </span>
              <span className="text-sm font-bold tabular-nums">{formatPrice(total)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="cash-received"
                className="text-xs font-bold uppercase tracking-wide"
              >
                Cash received
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-muted-foreground">RM</span>
                <input
                  id="cash-received"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoFocus
                  value={cashReceived}
                  onChange={(e) =>
                    setCashReceived(e.target.value.replace(/[^0-9]/g, ""))
                  }
                  placeholder="0"
                  disabled={busy}
                  className="h-10 w-24 rounded-xl border border-border bg-white px-3 text-right text-sm font-semibold tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                />
              </div>
            </div>
            <div className="flex items-baseline justify-between border-t border-border pt-3">
              <span className="text-sm font-semibold">
                {changeDue < 0 ? "Short by" : "Change"}
              </span>
              <span
                className={
                  "text-lg font-bold tabular-nums " +
                  (changeDue < 0 ? "text-rose-600" : "text-emerald-700")
                }
              >
                {formatPrice(Math.abs(changeDue))}
              </span>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 w-full rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onConfirm}
          disabled={busy || isShort}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <BellRing className="size-4" strokeWidth={2} aria-hidden />
          {busy ? "Completing…" : isShort ? "Cash received is short" : "Complete order"}
        </button>

        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="mt-2 h-12 w-full rounded-2xl border border-border text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground outline-none transition-colors hover:bg-neutral-100 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
