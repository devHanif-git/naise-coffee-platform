"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { normalizeMyPhone } from "@/lib/phone";
import { filterPhone } from "@/lib/input";

// Skippable prompt shown at checkout when no number is on file for this order.
// Collects an unverified MY mobile so the store can message the customer on
// WhatsApp when the order is ready. The caller decides where the number is
// persisted (member profile vs order-only for guests); this sheet only
// validates and hands back the normalized +60… value. Hand-rolled modal like
// the others: closes on backdrop/Esc, locks body scroll.
export function PhonePromptSheet({
  onSubmit,
  onSkip,
  onClose,
  busy = false,
}: {
  onSubmit: (phone: string) => void;
  onSkip: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeMyPhone(phone);
    if (!normalized) {
      setError("Enter a valid Malaysian mobile number, e.g. 011-2561 7058.");
      return;
    }
    setError(null);
    onSubmit(normalized);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="phone-prompt-title"
      onClick={() => !busy && onClose()}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 naise-fade"
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="relative flex w-full max-w-sm flex-col rounded-3xl bg-white px-6 pb-6 pt-7 naise-pop"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <MessageCircle className="size-6" strokeWidth={2} aria-hidden />
        </span>

        <h2
          id="phone-prompt-title"
          className="mt-4 font-heading text-xl font-bold tracking-tight"
        >
          Add your WhatsApp number
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          So we can message you on WhatsApp when your order is ready. Optional —
          you can skip this.
        </p>

        <div className="mt-5 flex items-center gap-2">
          <span className="flex h-12 shrink-0 items-center rounded-2xl border border-border bg-neutral-50 px-3 text-sm font-semibold text-muted-foreground">
            +60
          </span>
          <input
            id="phone-prompt-input"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            autoFocus
            value={phone}
            onChange={(e) => setPhone(filterPhone(e.target.value))}
            placeholder="11-2561 7058"
            disabled={busy}
            className="h-12 flex-1 rounded-2xl border border-border bg-white px-4 text-sm font-medium outline-none transition-colors focus-visible:border-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
          />
        </div>

        {error && (
          <p className="mt-2 text-xs font-medium text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Save &amp; continue
        </button>

        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="mt-2 h-12 w-full rounded-2xl text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground outline-none transition-colors hover:bg-neutral-100 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        >
          Skip
        </button>
      </form>
    </div>
  );
}
