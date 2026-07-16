import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePaymentMethod } from "@/data/payment-methods";
import { expectedCash } from "@/lib/shifts/reconcile";
import type {
  Shift,
  ShiftHistoryRow,
  ShiftMovement,
  ShiftSummary,
} from "@/types/shift";
import type { SupabaseClient } from "@supabase/supabase-js";

type ShiftRow = {
  id: string;
  status: "open" | "closed";
  opened_by: string | null;
  opening_float: number;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  cash_difference: number | null;
  closing_note: string | null;
  last_reminder_at: string | null;
};

function mapShift(r: ShiftRow): Shift {
  return {
    id: r.id,
    status: r.status,
    openedBy: r.opened_by,
    openingFloat: r.opening_float,
    openedAt: r.opened_at,
    closedBy: r.closed_by,
    closedAt: r.closed_at ?? undefined,
    countedCash: r.counted_cash ?? undefined,
    expectedCash: r.expected_cash ?? undefined,
    cashDifference: r.cash_difference ?? undefined,
    closingNote: r.closing_note ?? undefined,
    lastReminderAt: r.last_reminder_at ?? undefined,
  };
}

const SHIFT_COLS =
  "id, status, opened_by, opening_float, opened_at, closed_by, closed_at, counted_cash, expected_cash, cash_difference, closing_note, last_reminder_at";

export async function getOpenShift(): Promise<Shift | null> {
  const db = await createClient();
  const { data } = await db
    .from("shifts")
    .select(SHIFT_COLS)
    .eq("status", "open")
    .maybeSingle();
  return data ? mapShift(data as ShiftRow) : null;
}

export async function getShiftSummary(): Promise<ShiftSummary | null> {
  const db = await createClient();
  const { data: shiftRow } = await db
    .from("shifts")
    .select(SHIFT_COLS)
    .eq("status", "open")
    .maybeSingle();
  if (!shiftRow) return null;
  const shift = mapShift(shiftRow as ShiftRow);

  const [{ data: orderRows }, { data: moveRows }] = await Promise.all([
    db
      .from("orders")
      .select("total, payment_method, status")
      .eq("shift_id", shift.id)
      .eq("status", "completed"),
    db
      .from("shift_movements")
      .select(
        "id, shift_id, kind, cash_delta, qr_delta, note, created_by, created_at",
      )
      .eq("shift_id", shift.id)
      .order("created_at", { ascending: false }),
  ]);

  let cashSales = 0;
  let qrSales = 0;
  for (const o of orderRows ?? []) {
    const method = normalizePaymentMethod(o.payment_method as string);
    if (method === "cash") cashSales += o.total as number;
    else if (method === "duitnow-qr") qrSales += o.total as number;
  }

  const movements: ShiftMovement[] = (moveRows ?? []).map((m) => ({
    id: m.id as string,
    shiftId: m.shift_id as string,
    kind: m.kind as ShiftMovement["kind"],
    cashDelta: m.cash_delta as number,
    qrDelta: m.qr_delta as number,
    note: (m.note as string | null) ?? undefined,
    createdBy: (m.created_by as string | null) ?? null,
    createdAt: m.created_at as string,
  }));
  const movementsCash = movements.reduce((s, m) => s + m.cashDelta, 0);
  const movementsQr = movements.reduce((s, m) => s + m.qrDelta, 0);

  return {
    shift,
    cashSales,
    qrSales,
    movementsCash,
    movementsQr,
    expectedCash: expectedCash(shift.openingFloat, cashSales, movementsCash),
    movements,
  };
}

export async function listShiftHistory(limit = 30): Promise<ShiftHistoryRow[]> {
  const db = await createClient();
  const { data } = await db
    .from("shifts")
    .select(SHIFT_COLS)
    .order("opened_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => mapShift(r as ShiftRow));
}

type Rpc = {
  ok: boolean;
  error?: string;
  id?: string;
  expected_cash?: number;
  cash_difference?: number;
};

export async function openShift(
  openingFloatSen: number,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = await createClient();
  const { data, error } = await db.rpc("open_shift", {
    p_opening_float: openingFloatSen,
  });
  if (error) return { ok: false, error: "Couldn't open the shift. Try again." };
  const r = data as unknown as Rpc;
  if (!r?.ok) return { ok: false, error: mapRpcError(r?.error) };
  return { ok: true, id: r.id! };
}

export async function addMovement(
  kind: ShiftMovement["kind"],
  cashDelta: number,
  qrDelta: number,
  note?: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = await createClient();
  const { data, error } = await db.rpc("add_shift_movement", {
    p_kind: kind,
    p_cash_delta: cashDelta,
    p_qr_delta: qrDelta,
    p_note: note ?? null,
  });
  if (error)
    return { ok: false, error: "Couldn't record the movement. Try again." };
  const r = data as unknown as Rpc;
  if (!r?.ok) return { ok: false, error: mapRpcError(r?.error) };
  return { ok: true, id: r.id! };
}

export async function closeShift(
  countedCashSen: number,
  note?: string,
): Promise<
  | { ok: true; expectedCash: number; cashDifference: number }
  | { ok: false; error: string }
> {
  const db = await createClient();
  const { data, error } = await db.rpc("close_shift", {
    p_counted_cash: countedCashSen,
    p_closing_note: note ?? null,
  });
  if (error) return { ok: false, error: "Couldn't close the shift. Try again." };
  const r = data as unknown as Rpc;
  if (!r?.ok) return { ok: false, error: mapRpcError(r?.error) };
  return {
    ok: true,
    expectedCash: r.expected_cash!,
    cashDifference: r.cash_difference!,
  };
}

// Service-role read of the open shift id — used by the kiosk order path, which
// has no staff Supabase session (RLS would hide the row). Read-only.
export async function getOpenShiftIdAdmin(
  db: SupabaseClient = createAdminClient(),
): Promise<string | null> {
  const { data } = await db
    .from("shifts")
    .select("id")
    .eq("status", "open")
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

function mapRpcError(code?: string): string {
  switch (code) {
    case "shift_already_open":
      return "A shift is already open. Close it first.";
    case "no_open_shift":
      return "No shift is open.";
    case "not_authorized":
      return "Not authorized.";
    default:
      return "Something went wrong. Try again.";
  }
}
