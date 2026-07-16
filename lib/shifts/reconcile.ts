import { klDayKey } from "@/lib/analytics/range";
import type { MovementKind } from "@/types/shift";

// A shift is "stale" (should be closed) once it has crossed into a new KL day
// since it opened, OR no order has touched it for this many hours. Whichever
// first. Named constant so a late-trading shop is a one-line change.
export const STALE_AFTER_HOURS = 6;
const HOUR_MS = 3_600_000;

// Expected physical cash at close (sen).
export function expectedCash(
  openingFloat: number,
  cashSales: number,
  movementsCash: number,
): number {
  return openingFloat + cashSales + movementsCash;
}

export type ExchangeDirection = "qr_to_cash" | "cash_to_qr";

// Translate a movement into signed cash/qr deltas (sen). Amount is a positive
// magnitude. Exchange moves money between buckets; cash_in/out touch cash only.
export function movementDeltas(
  kind: MovementKind,
  direction: ExchangeDirection,
  amountSen: number,
): { cashDelta: number; qrDelta: number } {
  const amt = Math.max(Math.round(amountSen), 0);
  if (kind === "cash_in") return { cashDelta: amt, qrDelta: 0 };
  if (kind === "cash_out") return { cashDelta: -amt, qrDelta: 0 };
  // exchange: customer QR->cash empties the drawer (+qr, -cash); reverse flips.
  return direction === "qr_to_cash"
    ? { cashDelta: -amt, qrDelta: amt }
    : { cashDelta: amt, qrDelta: -amt };
}

// Should staff be nudged to close? true once past midnight KL since open, or no
// order for STALE_AFTER_HOURS. `now`/timestamps are epoch ms and ISO strings.
export function isShiftStale(
  openedAtISO: string,
  lastOrderAtISO: string | null,
  now: number = Date.now(),
): boolean {
  const crossedDay = klDayKey(Date.parse(openedAtISO)) !== klDayKey(now);
  const ref = lastOrderAtISO ? Date.parse(lastOrderAtISO) : Date.parse(openedAtISO);
  const idleTooLong = now - ref >= STALE_AFTER_HOURS * HOUR_MS;
  return crossedDay || idleTooLong;
}
