"use client";

import { useEffect } from "react";
import { LogOut } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

// Confirms before ending the session. Hand-rolled like the other modals:
// closes on backdrop click or Esc, locks body scroll while open.
export function SignOutConfirmModal({
  onConfirm,
  onClose,
}: {
  onConfirm: () => void;
  onClose: () => void;
}) {
  useBodyScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signout-title"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 naise-fade"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-w-sm flex-col items-center overflow-hidden rounded-3xl bg-white px-6 pb-6 pt-8 text-center naise-pop"
      >
        <span className="flex size-14 items-center justify-center rounded-full bg-neutral-100 text-foreground">
          <LogOut className="size-6" strokeWidth={2} aria-hidden />
        </span>

        <h2
          id="signout-title"
          className="mt-4 font-heading text-xl font-bold tracking-tight"
        >
          Sign out?
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          You&rsquo;ll need to sign in again to view your Beans, streak, and
          order history.
        </p>

        <button
          type="button"
          onClick={onConfirm}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-black text-xs font-semibold uppercase tracking-[0.15em] text-white outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LogOut className="size-4" strokeWidth={2} aria-hidden />
          Sign Out
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
