"use client";

import { useEffect } from "react";
import { BellRing } from "lucide-react";

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
          This marks the order complete and notifies the buyer that their order
          is ready for pickup.
        </p>

        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <BellRing className="size-4" strokeWidth={2} aria-hidden />
          {busy ? "Notifying…" : "Complete & Notify"}
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
