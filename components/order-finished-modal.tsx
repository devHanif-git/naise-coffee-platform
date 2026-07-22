"use client";

import { CheckCircle2, MessageCircle } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

// Shown after an order is completed AND it has a contact number to notify — the
// WhatsApp handoff. Staff tap "Send on WhatsApp" (opens wa.me with the ready
// notice pre-filled) or "Done", either of which returns to the board. Orders
// with no number skip this modal entirely and go straight back to /manage; the
// confirm modal owns the busy/error state before this point.
export function OrderFinishedModal({
  orderNumber,
  waReadyLink,
  onDone,
}: {
  orderNumber: string;
  waReadyLink: string;
  onDone: () => void;
}) {
  useBodyScrollLock(true);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Order ${orderNumber} complete`}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col items-center overflow-hidden rounded-3xl bg-white px-6 pb-6 pt-8 text-center naise-pop"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="size-6" strokeWidth={2} aria-hidden />
        </span>
        <span className="mt-4 text-[0.6875rem] font-bold uppercase tracking-[0.15em] text-emerald-700">
          Order complete
        </span>
        <h2 className="mt-1 font-heading text-xl font-bold tracking-tight tabular-nums">
          {orderNumber} done
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Send the buyer their ready notice, or head back to the board.
        </p>

        <a
          href={waReadyLink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onDone}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <MessageCircle className="size-4" strokeWidth={2} aria-hidden />
          Send on WhatsApp
        </a>

        <button
          type="button"
          onClick={onDone}
          className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground outline-none transition-colors hover:bg-neutral-100 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Done
        </button>
      </div>
    </div>
  );
}
