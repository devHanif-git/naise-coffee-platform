"use client";

import { useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import { GuardedLink } from "@/components/admin/guarded-link";
import { isShiftStale } from "@/lib/shifts/reconcile";

// Non-blocking nudge shown in the admin shell when the open shift has gone stale
// (past midnight KL since open, or idle past STALE_AFTER_HOURS). Dismiss hides it
// for this page load; it returns on the next navigation until the shift closes.
// Staleness is computed on the client so it reflects the viewer's current time
// without needing the server to re-render.
export function ShiftStaleBanner({
  openedAt,
  lastOrderAt,
}: {
  openedAt: string | null;
  lastOrderAt: string | null;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (!openedAt || dismissed) return null;
  if (!isShiftStale(openedAt, lastOrderAt)) return null;

  return (
    <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
      <TriangleAlert className="size-4 shrink-0" strokeWidth={2} aria-hidden />
      <span className="flex-1">
        This shift has been open a while — close &amp; count the drawer.{" "}
        <GuardedLink href="/shift" className="font-semibold underline underline-offset-2">
          Go to shift
        </GuardedLink>
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="flex size-6 items-center justify-center rounded-md outline-none transition-colors hover:bg-amber-100 focus-visible:ring-3 focus-visible:ring-amber-300"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
