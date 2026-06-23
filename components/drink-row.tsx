"use client";

import { useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderLine } from "@/types/order";
import { Sheet, SheetContent } from "@/components/ui/sheet";

// Per-drink fulfilment status. Lives client-side until the store/Supabase
// tracks status per line.
export type DrinkStatus = "pending" | "preparing" | "done";

// Past this horizontal drag distance (px) a swipe fires its action.
const SWIPE_THRESHOLD = 88;
const MAX_DRAG = 120;

const statusStyle: Record<
  DrinkStatus,
  { label: string; dot: string; text: string }
> = {
  pending: { label: "Pending", dot: "bg-amber-500", text: "text-amber-700" },
  preparing: { label: "Making", dot: "bg-blue-500", text: "text-blue-700" },
  done: { label: "Ready", dot: "bg-emerald-500", text: "text-emerald-700" },
};

// A single drink line that the barista swipes to update. Slide left to advance
// (pending -> making -> ready). The card dims and shows a strike once ready.
export function DrinkRow({
  item,
  status,
  onAdvance,
  recipeSteps,
}: {
  item: OrderLine;
  status: DrinkStatus;
  onAdvance: () => void;
  recipeSteps?: string[] | null;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [showRecipe, setShowRecipe] = useState(false);
  const startX = useRef<number | null>(null);

  const subtitle = [item.sizeName, ...item.addonNames].filter(Boolean).join(", ");
  const s = statusStyle[status];
  const canAdvance = status !== "done";

  // What slides into view as the drink is dragged.
  const advanceLabel = status === "pending" ? "Start making" : "Mark ready";

  function onPointerDown(e: React.PointerEvent) {
    startX.current = e.clientX;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (startX.current === null) return;
    const delta = e.clientX - startX.current;
    const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, delta));
    if (clamped > 0) return;
    if (clamped < 0 && !canAdvance) return;
    setDragX(clamped);
  }

  function onPointerUp() {
    if (startX.current === null) return;
    startX.current = null;
    setDragging(false);

    if (dragX <= -SWIPE_THRESHOLD && canAdvance) {
      onAdvance();
    }
    setDragX(0);
  }

  return (
    <li className="relative overflow-hidden border-b border-border last:border-b-0">
      {/* Action hints sit behind the row and show through as it slides. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 flex items-center justify-between px-2 text-xs font-bold uppercase tracking-wider",
          dragX === 0 && "opacity-0",
        )}
      >
        <span
          className={cn(
            "flex items-center gap-1.5 text-emerald-600",
            dragX >= 0 && "opacity-0",
          )}
        >
          {advanceLabel}
          <ChevronLeft className="size-4" strokeWidth={2.5} />
        </span>
      </div>

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ transform: `translateX(${dragX}px)` }}
        className={cn(
          "relative flex touch-pan-y items-center gap-3 bg-white py-3",
          !dragging &&
            "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          status === "done" && "opacity-70",
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-black text-sm font-bold tabular-nums text-white">
          {item.quantity}
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "truncate font-heading text-sm font-bold tracking-tight",
                status === "done" && "line-through",
              )}
            >
              {item.name}
            </span>
            {item.isCustom && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-amber-700">
                Custom
              </span>
            )}
          </span>
          {subtitle && (
            <span className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
          <span
            className={cn(
              "mt-1 inline-flex w-fit items-center gap-1.5 text-[0.6875rem] font-bold",
              s.text,
            )}
          >
            <span className={cn("size-1.5 rounded-full", s.dot)} />
            {s.label}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {recipeSteps && recipeSteps.length > 0 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowRecipe(true); }}
                aria-label={`Recipe for ${item.name}`}
                className="flex size-7 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Info className="size-3.5" strokeWidth={2.5} />
              </button>
              <Sheet open={showRecipe} onOpenChange={setShowRecipe}>
                <SheetContent side="bottom" className="max-h-[55vh] overflow-y-auto rounded-t-2xl px-4 pb-6 pt-4">
                  <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="font-heading text-base font-bold tracking-tight">
                      {item.name}
                    </h3>
                    <span className="rounded-full bg-black px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-white">
                      Recipe
                    </span>
                  </div>
                  <ol className="flex flex-col gap-2">
                    {recipeSteps.map((step, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm leading-snug">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-black text-[0.625rem] font-bold tabular-nums text-white">
                          {i + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </SheetContent>
              </Sheet>
            </>
          )}
          {canAdvance ? (
            <button
              type="button"
              onClick={onAdvance}
              aria-label={`${advanceLabel} — ${item.name}`}
              className="flex size-9 items-center justify-center rounded-full bg-black text-white transition-transform hover:scale-105 active:scale-95 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ChevronRight className="size-4" strokeWidth={2.5} aria-hidden />
            </button>
          ) : (
            <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500 text-white">
              <Check className="size-4" strokeWidth={2.5} aria-hidden />
            </span>
          )}
        </div>
      </div>
    </li>
  );
}
