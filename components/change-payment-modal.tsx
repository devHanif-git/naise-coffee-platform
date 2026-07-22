"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

// Manager-gated correction of an order's payment method. Opened from the manage
// screen when staff record the wrong method (e.g. Cash keyed as DuitNow QR).
// Switching is gated by the store passcode only managers know — the same secret
// that gates store mode — so a manager physically approves the change.
export function ChangePaymentModal({
  options,
  currentMethod,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  options: { id: string; name: string }[];
  currentMethod: string;
  busy: boolean;
  error?: string | null;
  onConfirm: (method: string, passcode: string) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState(currentMethod);
  const [passcode, setPasscode] = useState("");

  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const canSubmit = passcode.length >= 6 && !busy;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Change payment method"
      onClick={() => !busy && onClose()}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 naise-fade"
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
            Change payment
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Manager approval required. Enter the kiosk passcode to correct this
            order&rsquo;s payment method.
          </p>
        </div>

        <fieldset className="mt-5 flex flex-col gap-2" disabled={busy}>
          <legend className="mb-1 text-xs font-bold uppercase tracking-wider">
            Method
          </legend>
          {options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setMethod(opt.id)}
              aria-pressed={method === opt.id}
              className={`flex h-12 items-center justify-between rounded-2xl border px-4 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
                method === opt.id
                  ? "border-black bg-black text-white"
                  : "border-border bg-white hover:bg-neutral-100"
              }`}
            >
              {opt.name}
              {opt.id === currentMethod && (
                <span
                  className={`text-[0.625rem] font-bold uppercase tracking-wide ${
                    method === opt.id ? "text-white/70" : "text-muted-foreground"
                  }`}
                >
                  Current
                </span>
              )}
            </button>
          ))}
        </fieldset>

        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor="manager-passcode" className="text-xs font-bold uppercase tracking-wider">
            Manager passcode
          </label>
          <input
            id="manager-passcode"
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
          onClick={() => onConfirm(method, passcode)}
          disabled={!canSubmit}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {busy && <Loader2 className="size-4 animate-spin" strokeWidth={2.5} aria-hidden />}
          {busy ? "Saving" : "Save payment"}
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
