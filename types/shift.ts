// Shift = one shared cash-drawer session. Money in sen everywhere here; the UI
// converts to/from whole RM at its edges.
export type MovementKind = "exchange" | "cash_in" | "cash_out";

export type Shift = {
  id: string;
  status: "open" | "closed";
  openedBy: string | null;
  openingFloat: number; // sen
  openedAt: string; // ISO
  closedBy: string | null;
  closedAt?: string; // ISO
  countedCash?: number; // sen
  expectedCash?: number; // sen
  cashDifference?: number; // sen (counted - expected; + over, - short)
  closingNote?: string;
  lastReminderAt?: string; // ISO
};

export type ShiftMovement = {
  id: string;
  shiftId: string;
  kind: MovementKind;
  cashDelta: number; // sen (+ in, - out)
  qrDelta: number; // sen
  note?: string;
  createdBy: string | null;
  createdAt: string; // ISO
};

// Live figures for the currently-open shift, all sen.
export type ShiftSummary = {
  shift: Shift;
  cashSales: number; // completed cash orders on this shift
  qrSales: number; // completed duitnow-qr orders on this shift (informational)
  movementsCash: number; // sum of movement cash_delta
  movementsQr: number; // sum of movement qr_delta
  expectedCash: number; // opening_float + cashSales + movementsCash
  movements: ShiftMovement[];
};

// A closed (or open) shift row for the history list.
export type ShiftHistoryRow = Shift;
