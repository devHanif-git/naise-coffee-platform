"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowLeftRight,
  PlusCircle,
  MinusCircle,
  Wallet,
} from "lucide-react";
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

function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ShiftView({
  summary,
  history,
}: {
  summary: ShiftSummary | null;
  history: ShiftHistoryRow[];
}) {
  return (
    <div className="flex flex-col gap-7">
      {summary ? <OpenShiftSummary summary={summary} /> : <OpenShiftPanel />}
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
    <section className="naise-rise flex flex-col items-center gap-6 rounded-3xl border border-border bg-card px-6 py-9 text-center sm:px-8">
      <div className="flex flex-col items-center gap-3">
        <span className="flex size-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
          <Wallet className="size-6" strokeWidth={2} aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-xl font-bold tracking-tight">Open a shift</h2>
          <p className="mx-auto max-w-[16rem] text-sm text-muted-foreground">
            Enter the cash already in the drawer to start. Whole ringgit — no coins.
          </p>
        </div>
      </div>

      <div className="flex w-full flex-col items-center gap-2">
        <Eyebrow>Opening float</Eyebrow>
        <div className="flex items-center justify-center gap-2.5">
          <span className="text-xl font-bold text-muted-foreground">RM</span>
          <Input
            id="opening-float"
            inputMode="numeric"
            pattern="[0-9]*"
            value={floatRm}
            onChange={(e) => setFloatRm(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="50"
            className="h-14 w-32 text-center font-mono text-2xl font-bold tabular-nums"
          />
        </div>
      </div>

      {error && <p className="text-sm text-rose-600">{error}</p>}

      <PendingButton
        pending={pending}
        onClick={submit}
        className="h-12 w-full max-w-xs text-sm font-bold uppercase tracking-[0.1em]"
      >
        Open shift
      </PendingButton>
    </section>
  );
}

function OpenShiftSummary({ summary }: { summary: ShiftSummary }) {
  const [closing, setClosing] = useState(false);
  const closeRef = useRef<HTMLDivElement>(null);
  const { shift } = summary;

  // When the close panel opens, scroll it into view so staff focus on counting.
  useEffect(() => {
    if (closing) {
      closeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [closing]);

  return (
    <div className="flex flex-col gap-5">
      {/* Hero: expected cash headline with a live pulse, matching the dashboard. */}
      <section className="naise-rise relative overflow-hidden rounded-3xl bg-black px-6 py-7 text-white sm:px-8 sm:py-8">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-white/55">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-70 motion-reduce:hidden" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-400" />
            </span>
            Shift open
          </span>
          <span className="text-xs text-white/55">
            since {formatOrderTime(shift.openedAt)}
          </span>
        </div>

        <div className="mt-5 flex flex-col gap-1">
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-white/55">
            Expected cash
          </span>
          <span className="font-mono text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
            {formatPrice(summary.expectedCash)}
          </span>
          <span className="mt-1 text-sm text-white/65">
            float {formatPrice(shift.openingFloat)}
            <span className="px-1.5 text-white/30">·</span>
            cash {formatPrice(summary.cashSales)}
            <span className="px-1.5 text-white/30">·</span>
            moves {formatPrice(summary.movementsCash)}
          </span>
        </div>

        {!closing && (
          <button
            type="button"
            onClick={() => setClosing(true)}
            className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-amber-400 text-sm font-bold uppercase tracking-[0.1em] text-neutral-900 outline-none transition-transform hover:scale-[1.01] active:scale-[0.99] focus-visible:ring-3 focus-visible:ring-amber-300"
          >
            Close shift &amp; count
          </button>
        )}
      </section>

      {/* Stat tiles: the breakdown that feeds expected cash + informational QR. */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Opening float" value={formatPrice(shift.openingFloat)} />
        <StatTile label="Cash sales" value={formatPrice(summary.cashSales)} />
        <StatTile label="Movements (cash)" value={formatPrice(summary.movementsCash)} />
        <StatTile label="QR sales" value={formatPrice(summary.qrSales)} muted />
      </section>

      {closing ? (
        <div ref={closeRef} className="scroll-mt-4">
          <ShiftClosePanel summary={summary} onCancel={() => setClosing(false)} />
        </div>
      ) : (
        <AddMovementForm />
      )}

      <MovementsSection movements={summary.movements} />
    </div>
  );
}

function StatTile({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-2xl border border-border bg-card p-4",
        muted && "opacity-70",
      )}
    >
      <Eyebrow>{label}</Eyebrow>
      <span className="font-mono text-xl font-bold tabular-nums tracking-tight">{value}</span>
    </div>
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
    <section className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 sm:p-6">
      <Eyebrow>Add drawer movement</Eyebrow>

      {/* Movement kind — full-width segmented control. */}
      <div className="grid grid-cols-3 gap-1.5">
        {MOVEMENT_TABS.map((t) => {
          const Icon = t.icon;
          const active = kind === t.kind;
          return (
            <button
              key={t.kind}
              type="button"
              onClick={() => setKind(t.kind)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-xs font-semibold transition-colors",
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
        <div className="grid grid-cols-2 gap-1.5">
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
                "rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
                direction === d.dir
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-border text-muted-foreground hover:bg-neutral-50",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <span className="text-base font-bold text-muted-foreground">RM</span>
        <Input
          inputMode="numeric"
          pattern="[0-9]*"
          value={amountRm}
          onChange={(e) => setAmountRm(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="0"
          className="h-12 max-w-[9rem] font-mono text-lg font-bold tabular-nums"
        />
      </div>
      <Input
        value={note}
        onChange={(e) => setNote(capitalizeFirst(e.target.value))}
        placeholder="Note (optional)"
      />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <PendingButton pending={pending} onClick={submit} variant="outline" className="h-11 self-start px-6">
        Record movement
      </PendingButton>
    </section>
  );
}

const MOVEMENT_LABEL: Record<MovementKind, string> = {
  exchange: "Exchange",
  cash_in: "Cash in",
  cash_out: "Cash out",
};

function MovementsSection({ movements }: { movements: ShiftMovement[] }) {
  return (
    <section className="flex flex-col gap-3">
      <Eyebrow>Drawer movements</Eyebrow>
      {movements.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          No drawer movements yet.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {movements.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">{MOVEMENT_LABEL[m.kind]}</span>
                {m.note && (
                  <span className="truncate text-xs text-muted-foreground">{m.note}</span>
                )}
                <span className="text-[0.6875rem] text-muted-foreground">
                  {formatOrderTime(m.createdAt)}
                </span>
              </div>
              <div className="flex shrink-0 flex-col items-end font-mono text-sm tabular-nums">
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
      )}
    </section>
  );
}

function HistoryStat({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          muted && "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ShiftHistory({ history }: { history: ShiftHistoryRow[] }) {
  const closed = history.filter((s) => s.status === "closed");
  if (closed.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <Eyebrow>Past shifts</Eyebrow>
      <ul className="flex flex-col gap-3">
        {closed.map((s) => {
          const diff = s.cashDifference ?? 0;
          return (
            <li
              key={s.id}
              className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4"
            >
              {/* Top row: when it ran + reconciliation outcome pill. */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold">
                    {formatOrderTime(s.openedAt)}
                  </span>
                  {s.closedAt && (
                    <span className="text-xs text-muted-foreground">
                      Closed {formatOrderTime(s.closedAt)}
                    </span>
                  )}
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold tabular-nums",
                    diff === 0
                      ? "bg-neutral-100 text-neutral-600"
                      : diff > 0
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-rose-100 text-rose-700",
                  )}
                >
                  {diff === 0
                    ? "Balanced"
                    : diff > 0
                      ? `Over ${formatPrice(diff)}`
                      : `Short ${formatPrice(Math.abs(diff))}`}
                </span>
              </div>

              {/* Stats grid: cash reconciliation + the sales split incl. QR. */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3">
                <HistoryStat label="Counted" value={formatPrice(s.countedCash ?? 0)} />
                <HistoryStat label="Expected" value={formatPrice(s.expectedCash ?? 0)} />
                <HistoryStat label="Cash sales" value={formatPrice(s.cashSales)} />
                <HistoryStat label="QR sales" value={formatPrice(s.qrSales)} muted />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
