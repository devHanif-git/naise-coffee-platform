"use client";

import { useState, useTransition } from "react";
import {
  ArrowLeftRight,
  PlusCircle,
  MinusCircle,
  Wallet,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PendingButton } from "@/components/ui/pending-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { capitalizeFirst, formatPrice, formatOrderTime } from "@/lib/format";
import type {
  MovementKind,
  ShiftHistoryRow,
  ShiftMovement,
  ShiftSummary,
} from "@/types/shift";
import type { ExchangeDirection } from "@/lib/shifts/reconcile";
import {
  openShiftAction,
  addMovementAction,
} from "@/app/(admin)/shift/actions";
import { ShiftClosePanel } from "@/components/admin/shift-close-dialog";

// Parse a whole-RM text input into a non-negative integer ringgit value, or
// null. A blank/whitespace-only string is null (not 0) so an empty field is
// rejected — Number("") is 0, which would otherwise pass as a valid amount.
function parseRm(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export function ShiftView({
  summary,
  history,
}: {
  summary: ShiftSummary | null;
  history: ShiftHistoryRow[];
}) {
  if (!summary) {
    return (
      <div className="flex flex-col gap-6">
        <OpenShiftPanel />
        <ShiftHistory history={history} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <OpenShiftSummary summary={summary} />
      <ShiftHistory history={history} />
    </div>
  );
}

function OpenShiftPanel() {
  const [floatRm, setFloatRm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const rm = parseRm(floatRm);
    if (rm === null) {
      setError("Enter the starting cash (whole ringgit).");
      return;
    }
    setError(null);
    start(async () => {
      const res = await openShiftAction(rm);
      if (!res.ok) setError(res.error);
      else setFloatRm("");
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border p-5">
      <div className="flex items-center gap-2">
        <Wallet className="size-5 text-emerald-600" strokeWidth={2} aria-hidden />
        <h2 className="font-heading text-lg font-bold tracking-tight">
          Open a shift
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        Enter the cash already in the drawer to start (whole ringgit — no coins).
      </p>
      <div className="flex flex-col gap-2">
        <label htmlFor="opening-float" className="text-xs font-semibold uppercase tracking-wide">
          Opening float
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground">RM</span>
          <Input
            id="opening-float"
            inputMode="numeric"
            value={floatRm}
            onChange={(e) => setFloatRm(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="50"
            className="max-w-[8rem]"
          />
        </div>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <PendingButton pending={pending} onClick={submit} className="self-start">
        Open shift
      </PendingButton>
    </section>
  );
}

function StatRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className={cn("text-sm", muted ? "text-muted-foreground" : "font-medium")}>
        {label}
      </span>
      <span className={cn("text-sm tabular-nums", muted ? "text-muted-foreground" : "font-semibold")}>
        {value}
      </span>
    </div>
  );
}

function OpenShiftSummary({ summary }: { summary: ShiftSummary }) {
  const [closing, setClosing] = useState(false);
  const { shift } = summary;

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-border p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
          <h2 className="font-heading text-lg font-bold tracking-tight">Shift open</h2>
        </div>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3.5" aria-hidden />
          since {formatOrderTime(shift.openedAt)}
        </span>
      </div>

      <div className="flex flex-col divide-y divide-border">
        <StatRow label="Opening float" value={formatPrice(shift.openingFloat)} />
        <StatRow label="Cash sales" value={formatPrice(summary.cashSales)} />
        <StatRow label="QR sales" value={formatPrice(summary.qrSales)} muted />
        <StatRow label="Drawer movements (cash)" value={formatPrice(summary.movementsCash)} />
        <StatRow label="Expected cash" value={formatPrice(summary.expectedCash)} />
      </div>

      {!closing && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setClosing(true)}>
            Close shift
          </Button>
        </div>
      )}

      {closing && (
        <ShiftClosePanel summary={summary} onCancel={() => setClosing(false)} />
      )}

      <AddMovementForm />
      <MovementsList movements={summary.movements} />
    </section>
  );
}

const MOVEMENT_TABS: { kind: MovementKind; label: string; icon: typeof ArrowLeftRight }[] = [
  { kind: "exchange", label: "Exchange", icon: ArrowLeftRight },
  { kind: "cash_in", label: "Cash in", icon: PlusCircle },
  { kind: "cash_out", label: "Cash out", icon: MinusCircle },
];

function AddMovementForm() {
  const [kind, setKind] = useState<MovementKind>("exchange");
  const [direction, setDirection] = useState<ExchangeDirection>("qr_to_cash");
  const [amountRm, setAmountRm] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const rm = parseRm(amountRm);
    if (rm === null || rm <= 0) {
      setError("Enter an amount (whole ringgit).");
      return;
    }
    setError(null);
    start(async () => {
      const res = await addMovementAction({ kind, direction, amountRm: rm, note: note.trim() || undefined });
      if (!res.ok) setError(res.error);
      else {
        setAmountRm("");
        setNote("");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <h3 className="text-xs font-bold uppercase tracking-wide">Add drawer movement</h3>
      <div className="flex flex-wrap gap-1.5">
        {MOVEMENT_TABS.map((t) => {
          const Icon = t.icon;
          const active = kind === t.kind;
          return (
            <button
              key={t.kind}
              type="button"
              onClick={() => setKind(t.kind)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-border text-muted-foreground hover:bg-neutral-50",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {kind === "exchange" && (
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { dir: "qr_to_cash", label: "QR → Cash" },
              { dir: "cash_to_qr", label: "Cash → QR" },
            ] as { dir: ExchangeDirection; label: string }[]
          ).map((d) => (
            <button
              key={d.dir}
              type="button"
              onClick={() => setDirection(d.dir)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                direction === d.dir
                  ? "border-neutral-800 bg-neutral-900 text-white"
                  : "border-border text-muted-foreground hover:bg-neutral-50",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-muted-foreground">RM</span>
        <Input
          inputMode="numeric"
          value={amountRm}
          onChange={(e) => setAmountRm(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="0"
          className="max-w-[8rem]"
        />
      </div>
      <Input
        value={note}
        onChange={(e) => setNote(capitalizeFirst(e.target.value))}
        placeholder="Note (optional)"
      />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <PendingButton pending={pending} onClick={submit} variant="outline" className="self-start">
        Record movement
      </PendingButton>
    </div>
  );
}

const MOVEMENT_LABEL: Record<MovementKind, string> = {
  exchange: "Exchange",
  cash_in: "Cash in",
  cash_out: "Cash out",
};

function MovementsList({ movements }: { movements: ShiftMovement[] }) {
  if (movements.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No drawer movements yet.</p>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {movements.map((m) => (
        <li key={m.id} className="flex items-center justify-between py-2.5">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{MOVEMENT_LABEL[m.kind]}</span>
            {m.note && <span className="text-xs text-muted-foreground">{m.note}</span>}
            <span className="text-[0.6875rem] text-muted-foreground">
              {formatOrderTime(m.createdAt)}
            </span>
          </div>
          <div className="flex flex-col items-end text-sm tabular-nums">
            <span className={cn(m.cashDelta < 0 ? "text-rose-600" : "text-emerald-700")}>
              {m.cashDelta < 0 ? "−" : "+"}
              {formatPrice(Math.abs(m.cashDelta))} cash
            </span>
            {m.qrDelta !== 0 && (
              <span className="text-xs text-muted-foreground">
                {m.qrDelta < 0 ? "−" : "+"}
                {formatPrice(Math.abs(m.qrDelta))} QR
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ShiftHistory({ history }: { history: ShiftHistoryRow[] }) {
  const closed = history.filter((s) => s.status === "closed");
  if (closed.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-bold uppercase tracking-wide">Past shifts</h2>
      <ul className="flex flex-col divide-y divide-border rounded-2xl border border-border">
        {closed.map((s) => {
          const diff = s.cashDifference ?? 0;
          return (
            <li key={s.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex flex-col">
                <span className="text-sm font-medium">
                  {formatOrderTime(s.openedAt)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {s.closedAt ? `Closed ${formatOrderTime(s.closedAt)}` : ""}
                </span>
              </div>
              <div className="flex flex-col items-end text-sm tabular-nums">
                <span>
                  {formatPrice(s.countedCash ?? 0)} / {formatPrice(s.expectedCash ?? 0)}
                </span>
                <span
                  className={cn(
                    "text-xs",
                    diff === 0
                      ? "text-muted-foreground"
                      : diff > 0
                        ? "text-emerald-700"
                        : "text-rose-600",
                  )}
                >
                  {diff === 0 ? "Balanced" : diff > 0 ? `Over ${formatPrice(diff)}` : `Short ${formatPrice(Math.abs(diff))}`}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
