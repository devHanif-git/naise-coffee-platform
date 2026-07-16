"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { capitalizeFirst, formatPrice } from "@/lib/format";
import type { ShiftSummary } from "@/types/shift";
import { closeShiftAction } from "@/app/(admin)/shift/actions";

// Inline close panel: shows the reconciliation statement, takes a whole-RM
// counted-cash count, and reveals over/short live. Confirming closes the shift.
export function ShiftClosePanel({
  summary,
  onCancel,
}: {
  summary: ShiftSummary;
  onCancel: () => void;
}) {
  const [countedRm, setCountedRm] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const countedSen =
    countedRm === "" ? null : Math.max(Math.round(Number(countedRm)), 0) * 100;
  const diff = countedSen === null ? null : countedSen - summary.expectedCash;

  function submit() {
    if (countedSen === null) {
      setError("Enter the counted cash (whole ringgit).");
      return;
    }
    setError(null);
    start(async () => {
      const res = await closeShiftAction(
        Math.round(Number(countedRm)),
        note.trim() || undefined,
      );
      if (!res.ok) setError(res.error);
      // On success the page revalidates and this panel unmounts with the summary.
    });
  }

  return (
    <section className="naise-rise flex flex-col gap-4 rounded-3xl border border-amber-200 bg-amber-50/60 p-5 sm:p-6">
      <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-amber-800">
        Close &amp; count the drawer
      </span>

      <div className="flex flex-col divide-y divide-amber-200/70">
        <Line label="Opening float" value={formatPrice(summary.shift.openingFloat)} />
        <Line label="+ Cash sales" value={formatPrice(summary.cashSales)} />
        <Line label="± Movements" value={formatPrice(summary.movementsCash)} />
        <Line label="Expected cash" value={formatPrice(summary.expectedCash)} strong />
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Counted cash
        </span>
        <div className="flex items-center gap-2.5">
          <span className="text-base font-bold text-muted-foreground">RM</span>
          <Input
            id="counted-cash"
            inputMode="numeric"
            pattern="[0-9]*"
            value={countedRm}
            onChange={(e) => setCountedRm(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="0"
            className="h-12 max-w-[9rem] bg-white font-mono text-lg font-bold tabular-nums"
          />
        </div>
      </div>

      {diff !== null && (
        <div
          className={cn(
            "flex items-baseline justify-between rounded-2xl px-4 py-3 font-semibold",
            diff === 0
              ? "bg-neutral-100 text-neutral-700"
              : diff > 0
                ? "bg-emerald-100 text-emerald-800"
                : "bg-rose-100 text-rose-800",
          )}
        >
          <span className="text-sm">
            {diff === 0 ? "Balanced" : diff > 0 ? "Over" : "Short"}
          </span>
          <span className="font-mono text-lg tabular-nums">
            {diff === 0 ? "—" : formatPrice(Math.abs(diff))}
          </span>
        </div>
      )}

      <Input
        value={note}
        onChange={(e) => setNote(capitalizeFirst(e.target.value))}
        placeholder="Note (optional — explain any difference)"
        className="bg-white"
      />

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <PendingButton pending={pending} onClick={submit} className="h-11 px-6">
          Close shift
        </PendingButton>
        <Button variant="ghost" onClick={onCancel} disabled={pending} className="h-11">
          Cancel
        </Button>
      </div>
    </section>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className={cn("text-sm", strong ? "font-bold" : "text-muted-foreground")}>
        {label}
      </span>
      <span
        className={cn(
          "font-mono tabular-nums",
          strong ? "text-base font-bold" : "text-sm font-medium",
        )}
      >
        {value}
      </span>
    </div>
  );
}
