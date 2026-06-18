"use client";

import { useEffect } from "react";

// Auto-opens when the last drink is marked done. Confirm sends the buyer the
// "ready" notice and completes the order; Cancel reverts the just-completed
// drink back to "preparing" so nothing is sent.
export function OrderCompleteModal({
  orderNumber,
  busy,
  onConfirm,
  onCancel,
}: {
  orderNumber: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Complete order ${orderNumber}`}
      onClick={() => !busy && onCancel()}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-3xl bg-white p-6 naise-pop"
      >
        <div className="flex flex-col gap-1">
          <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-muted-foreground">
            All drinks ready
          </span>
          <h2 className="font-heading text-xl font-bold tracking-tight tabular-nums">
            Complete {orderNumber}?
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This marks the order complete and notifies the buyer that their
            order is ready for pickup.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-full bg-neutral-100 px-4 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-neutral-200 disabled:opacity-50 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-full bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {busy ? "Notifying…" : "Complete & notify"}
          </button>
        </div>
      </div>
    </div>
  );
}
