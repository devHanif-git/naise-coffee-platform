"use client";

import { Plus, Minus } from "lucide-react";
import { useBeans } from "@/store/beans";
import { cn } from "@/lib/utils";

// Client view of the full Bean activity feed. Reads the live ledger so newly
// earned/redeemed entries appear; shows an empty list until the store hydrates
// (matching the server-rendered HTML to avoid a mismatch).
export function RewardsActivity() {
  const { activity } = useBeans();
  const entries = activity;

  return (
    <main className="px-5 pb-8 pt-2">
      {entries.length === 0 ? (
        <div className="mt-2 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-10 text-center naise-rise">
          <p className="text-sm text-muted-foreground">No Bean activity yet.</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border naise-rise">
          {entries.map((item) => {
            const earned = item.amount > 0;
            return (
              <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full",
                    earned ? "bg-black text-white" : "bg-neutral-100 text-foreground",
                  )}
                >
                  {earned ? (
                    <Plus className="size-3.5" strokeWidth={2.5} aria-hidden />
                  ) : (
                    <Minus className="size-3.5" strokeWidth={2.5} aria-hidden />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="text-sm font-bold tabular-nums">
                    {Math.abs(item.amount)}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {item.label}
                  </span>
                </div>
                <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                  {item.when}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
