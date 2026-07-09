"use client";

import { useRef, useState } from "react";
import {
  ArrowLeftRight,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderLine } from "@/types/order";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

// Per-drink fulfilment status. Lives client-side until the store/Supabase
// tracks status per line.
export type DrinkStatus = "pending" | "preparing" | "done";

// Past this horizontal drag distance (px) a swipe fires its action.
const SWIPE_THRESHOLD = 88;
const MAX_DRAG = 120;
// How far the row shifts right to reveal the amend tray (Swap + Void).
const TRAY_WIDTH = 148;

const statusStyle: Record<
  DrinkStatus,
  { label: string; dot: string; text: string }
> = {
  pending: { label: "Pending", dot: "bg-amber-500", text: "text-amber-700" },
  preparing: { label: "Making", dot: "bg-blue-500", text: "text-blue-700" },
  done: { label: "Ready", dot: "bg-emerald-500", text: "text-emerald-700" },
};

// A single drink line the barista works by swiping. Slide LEFT to advance
// fulfilment (pending -> making -> ready); the card dims and strikes once ready.
// Slide RIGHT (when amendable) to reveal a tray with Swap and Void — the tools
// for a customer changing their mind mid-order. A voided line renders struck
// through and inert, kept for history.
export function DrinkRow({
  item,
  status,
  amendable,
  onAdvance,
  onSwap,
  onVoid,
  recipeSteps,
}: {
  item: OrderLine;
  status: DrinkStatus;
  // Whether Swap/Void are offered. False for done/voided/reward lines and
  // terminal orders — the tray stays closed and right-drag is inert.
  amendable: boolean;
  onAdvance: () => void;
  onSwap: () => void;
  onVoid: () => void;
  recipeSteps?: string[] | null;
}) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Whether the amend tray is latched open (after a right-swipe or tapping).
  // Only meaningful while the line is amendable — a line that just went ready or
  // was voided force-closes the tray via `showTray` below.
  const [trayOpen, setTrayOpen] = useState(false);
  const [showRecipe, setShowRecipe] = useState(false);
  const startX = useRef<number | null>(null);
  const voided = Boolean(item.voidedAt);

  const subtitle = [item.sizeName, ...item.addonNames].filter(Boolean).join(", ");
  const s = statusStyle[status];
  const canAdvance = status !== "done" && !voided;
  // The tray only rests open while the line is still amendable.
  const showTray = trayOpen && amendable;

  // What slides into view as the drink is dragged left.
  const advanceLabel = status === "pending" ? "Start making" : "Mark ready";

  function onPointerDown(e: React.PointerEvent) {
    if (voided) return;
    startX.current = e.clientX;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (startX.current === null) return;
    // Drag is measured from the resting position (tray open or closed).
    const base = trayOpen ? TRAY_WIDTH : 0;
    const delta = e.clientX - startX.current + base;
    const clamped = Math.max(-MAX_DRAG, Math.min(MAX_DRAG, delta));
    // Left drag advances status; only allowed when the drink can advance.
    if (clamped < 0 && !canAdvance) return;
    // Right drag reveals the tray; only when amendable.
    if (clamped > 0 && !amendable) return;
    setDragX(clamped);
  }

  function onPointerUp() {
    if (startX.current === null) return;
    startX.current = null;
    setDragging(false);

    // Left past threshold: advance fulfilment.
    if (dragX <= -SWIPE_THRESHOLD && canAdvance) {
      onAdvance();
      setDragX(0);
      setTrayOpen(false);
      return;
    }
    // Right past threshold: latch the tray open. Otherwise settle to whichever
    // resting state we're nearest.
    if (amendable && dragX >= SWIPE_THRESHOLD) {
      setTrayOpen(true);
    } else if (dragX <= TRAY_WIDTH / 2) {
      setTrayOpen(false);
    }
    setDragX(0);
  }

  // Resting offset: the tray peeks out when latched open.
  const restX = showTray ? TRAY_WIDTH : 0;
  const offsetX = dragging ? dragX : restX;

  return (
    <li className="relative overflow-hidden border-b border-border last:border-b-0">
      {/* Left action hint (advance) — shows as the row slides left. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 flex items-center justify-end px-2 text-xs font-bold uppercase tracking-wider",
          offsetX >= 0 && "opacity-0",
        )}
      >
        <span className="flex items-center gap-1.5 text-emerald-600">
          {advanceLabel}
          <ChevronLeft className="size-4" strokeWidth={2.5} />
        </span>
      </div>

      {/* Amend tray (Swap + Void) — sits behind the row on the left, revealed as
          it slides right. Real buttons so keyboard users reach them when open. */}
      {amendable && (
        <div
          className={cn(
            "absolute inset-y-0 left-0 flex items-stretch",
            offsetX <= 0 && "pointer-events-none opacity-0",
          )}
        >
          <button
            type="button"
            onClick={() => {
              setTrayOpen(false);
              onSwap();
            }}
            tabIndex={showTray ? 0 : -1}
            aria-label={`Swap ${item.name}`}
            className="flex w-[74px] flex-col items-center justify-center gap-1 bg-neutral-900 text-white outline-none transition-colors hover:bg-black focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-white/40"
          >
            <ArrowLeftRight className="size-4" strokeWidth={2.5} aria-hidden />
            <span className="text-[0.625rem] font-bold uppercase tracking-wider">
              Swap
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTrayOpen(false);
              onVoid();
            }}
            tabIndex={showTray ? 0 : -1}
            aria-label={`Void ${item.name}`}
            className="flex w-[74px] flex-col items-center justify-center gap-1 bg-rose-600 text-white outline-none transition-colors hover:bg-rose-700 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-white/40"
          >
            <Ban className="size-4" strokeWidth={2.5} aria-hidden />
            <span className="text-[0.625rem] font-bold uppercase tracking-wider">
              Void
            </span>
          </button>
        </div>
      )}

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ transform: `translateX(${offsetX}px)` }}
        className={cn(
          "relative flex touch-pan-y items-center gap-3 bg-white py-3",
          !dragging &&
            "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          (status === "done" || voided) && "opacity-70",
        )}
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold tabular-nums text-white",
            voided ? "bg-neutral-400" : "bg-black",
          )}
        >
          {item.quantity}
        </span>

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={cn(
                "truncate font-heading text-sm font-bold tracking-tight",
                (status === "done" || voided) && "line-through",
                voided && "text-muted-foreground",
              )}
            >
              {item.name}
            </span>
            {voided ? (
              <span className="shrink-0 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-rose-700">
                Voided
              </span>
            ) : (
              <>
                {item.isCustom && (
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-amber-700">
                    Custom
                  </span>
                )}
                {/* Promo flag: the line was sold below its menu price. Amount is
                    shown in the order totals, not here (this is a prep sheet). */}
                {!item.isReward &&
                  item.unitOriginalPrice != null &&
                  item.unitOriginalPrice > item.unitPrice && (
                    <span className="shrink-0 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-rose-700">
                      Promo
                    </span>
                  )}
              </>
            )}
          </span>
          {subtitle && (
            <span className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
          {!voided && (
            <span
              className={cn(
                "mt-1 inline-flex w-fit items-center gap-1.5 text-[0.6875rem] font-bold",
                s.text,
              )}
            >
              <span className={cn("size-1.5 rounded-full", s.dot)} />
              {s.label}
            </span>
          )}
        </div>

        {!voided && (
          <div className="flex shrink-0 items-center gap-2">
            {recipeSteps && recipeSteps.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowRecipe(true); }}
                  aria-label={`Recipe for ${item.name}`}
                  className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Info className="size-3.5" strokeWidth={2.5} />
                </button>
                <Sheet open={showRecipe} onOpenChange={setShowRecipe}>
                  <SheetContent side="bottom" aria-describedby={undefined} className="max-h-[55vh] overflow-y-auto rounded-t-2xl px-4 pb-6 pt-4">
                    <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
                    <div className="mb-2 flex items-center gap-2">
                      <SheetTitle className="font-heading text-base font-bold tracking-tight">
                        {item.name}
                      </SheetTitle>
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
        )}
      </div>
    </li>
  );
}
