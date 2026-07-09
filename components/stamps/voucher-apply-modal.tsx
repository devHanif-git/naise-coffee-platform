"use client";

import { useEffect } from "react";
import { Ticket, TriangleAlert } from "lucide-react";

// Warns before applying a loyalty voucher to an order. Vouchers are one-time
// use and non-refundable: once the order is placed the voucher is consumed, and
// cancelling the order afterwards does NOT return it. Surfaced here so the
// member makes an informed choice. Hand-rolled like the other modals: closes on
// backdrop click or Esc, locks body scroll while open.
export function VoucherApplyModal({
  onConfirm,
  onClose,
}: {
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="voucher-apply-title"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col items-center overflow-hidden rounded-3xl bg-white px-6 pb-6 pt-8 text-center naise-pop"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-neutral-100 text-foreground">
          <Ticket className="size-6" strokeWidth={2} aria-hidden />
        </span>

        <h2
          id="voucher-apply-title"
          className="mt-4 font-heading text-xl font-bold tracking-tight"
        >
          Use this voucher?
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Vouchers are one-time use. Once you place this order the voucher is
          used up &mdash; if the order is later cancelled, it is{" "}
          <span className="font-semibold text-foreground">not refunded</span>.
        </p>

        <div className="mt-4 flex w-full items-start gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 text-left">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-amber-500"
            strokeWidth={2}
            aria-hidden
          />
          <p className="text-xs leading-snug text-amber-900">
            Only apply it if you&rsquo;re sure about this order.
          </p>
        </div>

        <button
          type="button"
          onClick={onConfirm}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Ticket className="size-4" strokeWidth={2} aria-hidden />
          Apply Voucher
        </button>

        <button
          type="button"
          onClick={onClose}
          className="mt-2 h-12 w-full rounded-2xl border border-border text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground outline-none transition-colors hover:bg-neutral-100 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
