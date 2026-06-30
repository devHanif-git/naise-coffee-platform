"use client";

import { useEffect } from "react";
import { CheckCircle2, Loader2, MessageCircle, TriangleAlert } from "lucide-react";

// Shown after an order's last drink is marked done. Counter orders (kiosk/custom)
// open this directly in "loading" while completion runs, then settle to "success"
// or "error". Online orders open it in "success" after the confirm modal, where
// staff send the WhatsApp ready notice and return to the board.
//
// onDone routes back to /manage (the caller owns the router); onClose just
// dismisses (used for the counter "error" state so staff can set payment on the
// page without leaving the order).
export function OrderFinishedModal({
  orderNumber,
  state,
  variant,
  waReadyLink,
  error,
  onDone,
  onClose,
}: {
  orderNumber: string;
  state: "loading" | "success" | "error";
  variant: "counter" | "online";
  waReadyLink: string | null;
  error?: string | null;
  onDone: () => void;
  onClose: () => void;
}) {
  // Backdrop/Escape dismissal is only allowed in the error state; loading and
  // success settle through explicit buttons so staff don't skip the handoff.
  const dismissable = state === "error";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [dismissable, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Order ${orderNumber} ${state}`}
      onClick={() => dismissable && onClose()}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col items-center overflow-hidden rounded-3xl bg-white px-6 pb-6 pt-8 text-center naise-pop"
      >
        {state === "loading" && (
          <>
            <span className="flex size-14 items-center justify-center rounded-full bg-neutral-100 text-muted-foreground">
              <Loader2 className="size-6 animate-spin" strokeWidth={2} aria-hidden />
            </span>
            <h2 className="mt-4 font-heading text-xl font-bold tracking-tight tabular-nums">
              Completing {orderNumber}…
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Finishing up the order.
            </p>
          </>
        )}

        {state === "error" && (
          <>
            <span className="flex size-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <TriangleAlert className="size-6" strokeWidth={2} aria-hidden />
            </span>
            <h2 className="mt-4 font-heading text-xl font-bold tracking-tight tabular-nums">
              Can&apos;t complete yet
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {error ?? "Something went wrong completing this order."}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl border border-border text-xs font-semibold uppercase tracking-[0.15em] text-foreground outline-none transition-colors hover:bg-neutral-50 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              OK
            </button>
          </>
        )}

        {state === "success" && (
          <>
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
              {variant === "online" && waReadyLink
                ? "Send the buyer their ready notice, or head back to the board."
                : "Handed over at the counter. Back to the board when you're ready."}
            </p>

            {variant === "online" && waReadyLink && (
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
            )}

            <button
              type="button"
              onClick={onDone}
              className={
                (variant === "online" && waReadyLink
                  ? "mt-2 border border-border text-muted-foreground hover:bg-neutral-100 hover:text-foreground"
                  : "mt-6 bg-emerald-600 text-white hover:scale-[1.01] active:scale-[0.99]") +
                " flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-xs font-semibold uppercase tracking-[0.15em] outline-none transition-transform focus-visible:ring-3 focus-visible:ring-ring/50"
              }
            >
              {variant === "online" && waReadyLink ? "Done" : "OK"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
