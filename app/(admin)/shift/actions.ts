"use server";

import { revalidatePath } from "next/cache";
import { canManageOrders } from "@/lib/auth/session";
import { openShift, addMovement, closeShift } from "@/lib/shifts/store";
import { movementDeltas, type ExchangeDirection } from "@/lib/shifts/reconcile";
import type { MovementKind } from "@/types/shift";

type Result = { ok: true } | { ok: false; error: string };

// Amounts arrive from the UI in whole RM; convert to sen at this boundary.
const toSen = (rm: number) => Math.max(Math.round(rm), 0) * 100;

export async function openShiftAction(openingFloatRm: number): Promise<Result> {
  if (!(await canManageOrders())) return { ok: false, error: "Not authorized." };
  const res = await openShift(toSen(openingFloatRm));
  if (!res.ok) return res;
  revalidatePath("/shift");
  return { ok: true };
}

export async function addMovementAction(input: {
  kind: MovementKind;
  direction: ExchangeDirection; // ignored unless kind === "exchange"
  amountRm: number;
  note?: string;
}): Promise<Result> {
  if (!(await canManageOrders())) return { ok: false, error: "Not authorized." };
  if (!(input.amountRm > 0)) return { ok: false, error: "Enter an amount." };
  const { cashDelta, qrDelta } = movementDeltas(
    input.kind,
    input.direction,
    toSen(input.amountRm),
  );
  const res = await addMovement(input.kind, cashDelta, qrDelta, input.note);
  if (!res.ok) return res;
  revalidatePath("/shift");
  return { ok: true };
}

export async function closeShiftAction(
  countedCashRm: number,
  note?: string,
): Promise<
  | { ok: true; expectedCash: number; cashDifference: number }
  | { ok: false; error: string }
> {
  if (!(await canManageOrders())) return { ok: false, error: "Not authorized." };
  const res = await closeShift(toSen(countedCashRm), note);
  if (!res.ok) return res;
  revalidatePath("/shift");
  return res;
}
