"use client";

import { useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderLine } from "@/types/order";

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
// (pending -> making -> ready); slide right to undo a step. Buttons mirror the
// gestures for keyboard/desktop. The card dims and shows a strike once ready.
export function DrinkRow({
  item,
  status,
  onAdvance,
  onReset,
}: {
  item: OrderLine;
  status: DrinkStatus;
  onAdvance: () => void;
  onReset: () => void;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef<number | null>(null);

  const subtitle = [item.sizeName, ...item.addonNames].filter(Boolean).join(", ");
  const s = statusStyle[status];
  const canAdvance = status !== "done";
  const canReset = status !== "pending";

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
    // Left needs a next step; right needs something to undo.
    if (clamped < 0 && !canAdvance) return;
    if (clamped > 0 && !canReset) return;
    setDragX(clamped);
  }

  function onPointerUp() {
    if (startX.current === null) return;
    startX.current = null;
    setDragging(false);

    if (dragX <= -SWIPE_THRESHOLD && canAdvance) {
      onAdvance();
    } else if (dragX >= SWIPE_THRESHOLD && canReset) {
      onReset();
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
            "flex items-center gap-1.5 text-muted-foreground",
            dragX <= 0 && "opacity-0",
          )}
        >
          <RotateCcw className="size-4" strokeWidth={2.5} />
          Undo
        </span>
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
          <span
            className={cn(
              "truncate font-heading text-sm font-bold tracking-tight",
              status === "done" && "line-through",
            )}
          >
            {item.name}
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
          {canReset && (
            <button
              type="button"
              onClick={onReset}
              aria-label={`Undo step for ${item.name}`}
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-neutral-100 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <RotateCcw className="size-3.5" strokeWidth={2.5} aria-hidden />
            </button>
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
