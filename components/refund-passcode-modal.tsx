"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { formatPrice } from "@/lib/format";

// Manager-gated confirmation for a CHIP refund (money-out). Opened from the
// manage screen for both "Cancel & Refund" and the failed-refund "Retry" — the
// store passcode only managers know is the same secret that gates store mode, so
// a manager physically approves money leaving the till.
export function RefundPasscodeModal({
  amount,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  // Captured amount being refunded, in sen.
  amount: number;
  busy: boolean;
  error?: string | null;
  onConfirm: (passcode: string) => void;
  onClose: () => void;
}) {
  const [passcode, setPasscode] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [busy, onClose]);

  const canSubmit = passcode.length >= 6 && !busy;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm refund"
      onClick={() => !busy && onClose()}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col overflow-hidden rounded-3xl bg-white p-6 naise-pop"
      >
        <div className="flex flex-col gap-1">
          <span className="flex size-11 items-center justify-center rounded-full bg-neutral-900 text-white">
            <Lock className="size-5" strokeWidth={2} aria-hidden />
          </span>
          <h2 className="mt-3 font-heading text-xl font-bold tracking-tight">
            Refund {formatPrice(amount)}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Manager approval required. Enter the kiosk passcode to refund this
            payment to the customer via CHIP.
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-1.5">
          <label
            htmlFor="refund-passcode"
            className="text-xs font-bold uppercase tracking-wider"
          >
            Manager passcode
          </label>
          <input
            id="refund-passcode"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            disabled={busy}
            placeholder="Enter kiosk passcode"
            className="h-12 rounded-2xl border border-border bg-white px-4 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          />
        </div>

        {error && (
          <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => onConfirm(passcode)}
          disabled={!canSubmit}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-rose-300"
        >
          {busy && <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />}
          {busy ? "Refunding" : `Refund ${formatPrice(amount)}`}
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="mt-2 h-12 w-full rounded-2xl border border-border text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground outline-none transition-colors hover:bg-neutral-100 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
