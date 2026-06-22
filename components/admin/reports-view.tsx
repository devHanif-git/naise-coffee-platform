"use client";

import { useState, useTransition } from "react";
import { TrendingUp, TrendingDown, Gift } from "lucide-react";
import type { ReportData, ReportRange } from "@/lib/analytics/types";
import { paymentMethodLabel } from "@/data/payment-methods";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RevenueArea } from "@/components/admin/dashboard-charts";

const RANGES: { value: ReportRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "month", label: "Month" },
];

const PERIOD_LABEL: Record<ReportRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  month: "This month",
};
const PREV_LABEL: Record<ReportRange, string> = {
  today: "yesterday",
  "7d": "prev 7 days",
  "30d": "prev 30 days",
  month: "prior period",
};

// Percentage change vs the prior period. null when there's no baseline.
function delta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function DeltaChip({ current, previous }: { current: number; previous: number }) {
  const pct = delta(current, previous);
  if (pct === null) {
    return current > 0 ? (
      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-semibold text-muted-foreground">
        New
      </span>
    ) : null;
  }
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-bold tabular-nums",
        up ? "bg-emerald-500/15 text-emerald-600" : "bg-destructive/10 text-destructive",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {up ? "+" : ""}
      {pct}%
    </span>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </span>
  );
}

function StatTile({
  label,
  value,
  foot,
}: {
  label: string;
  value: string;
  foot?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4">
      <Eyebrow>{label}</Eyebrow>
      <span className="font-mono text-2xl font-bold tabular-nums tracking-tight">
        {value}
      </span>
      {foot && <div className="mt-0.5">{foot}</div>}
    </div>
  );
}

export function ReportsView({
  initial,
  load,
}: {
  initial: ReportData;
  load: (range: ReportRange) => Promise<ReportData>;
}) {
  const [data, setData] = useState(initial);
  const [pending, startTransition] = useTransition();

  function pick(range: ReportRange) {
    if (range === data.range) return;
    startTransition(async () => setData(await load(range)));
  }

  const aov = data.totals.orders > 0 ? Math.round(data.totals.revenue / data.totals.orders) : 0;
  const payTotal = data.paymentBreakdown.reduce((s, p) => s + p.revenue, 0);
  const itemMax = Math.max(1, ...data.topItems.map((i) => i.quantity));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => pick(r.value)}
              aria-pressed={data.range === r.value}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                data.range === r.value
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Eyebrow>{PERIOD_LABEL[data.range]}</Eyebrow>
      </div>

      <div
        className={cn(
          "flex flex-col gap-4 transition-opacity",
          pending && "pointer-events-none opacity-50",
        )}
      >
        {/* Revenue centerpiece + headline stats. */}
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 lg:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <Eyebrow>Revenue</Eyebrow>
                <span className="font-mono text-4xl font-bold tabular-nums tracking-tight">
                  {formatPrice(data.totals.revenue)}
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <DeltaChip current={data.totals.revenue} previous={data.previous.revenue} />
                  vs {PREV_LABEL[data.range]} ({formatPrice(data.previous.revenue)})
                </span>
              </div>
            </div>
            <RevenueArea data={data.trend} />
          </section>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
            <StatTile
              label="Completed orders"
              value={String(data.totals.orders)}
              foot={<DeltaChip current={data.totals.orders} previous={data.previous.orders} />}
            />
            <StatTile label="Avg order" value={formatPrice(aov)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile label="Items sold" value={String(data.totals.itemsSold)} />
          <StatTile label="Free drinks" value={String(data.totals.rewardLines)} />
          <StatTile label="Beans redeemed" value={data.totals.redemptionBeans.toLocaleString()} />
          <StatTile
            label="Payment methods"
            value={String(data.paymentBreakdown.length)}
          />
        </div>

        {/* Online vs in-store vs custom split. */}
        <div className="grid grid-cols-3 gap-4">
          <StatTile
            label="Online orders"
            value={String(data.totalsBySource.online.orders)}
            foot={<span className="text-xs text-muted-foreground">{formatPrice(data.totalsBySource.online.revenue)}</span>}
          />
          <StatTile
            label="In-store orders"
            value={String(data.totalsBySource.store.orders)}
            foot={<span className="text-xs text-muted-foreground">{formatPrice(data.totalsBySource.store.revenue)}</span>}
          />
          <StatTile
            label="Custom orders"
            value={String(data.totalsBySource.custom.orders)}
            foot={<span className="text-xs text-muted-foreground">{formatPrice(data.totalsBySource.custom.revenue)}</span>}
          />
        </div>

        {/* Top items + payment mix. */}
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-heading text-base font-semibold">Top items</h2>
              <Eyebrow>By quantity</Eyebrow>
            </div>
            {data.topItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales in this range.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.topItems.map((it, i) => (
                  <li key={it.name} className="flex items-center gap-3 text-sm">
                    <span className="w-4 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="w-28 shrink-0 truncate font-medium sm:w-36">
                      {it.name}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-foreground"
                        style={{ width: `${(it.quantity / itemMax) * 100}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right font-mono tabular-nums">
                      {it.quantity}
                    </span>
                    <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {formatPrice(it.revenue)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-heading text-base font-semibold">Payment mix</h2>
              <Eyebrow>Share of revenue</Eyebrow>
            </div>
            {data.paymentBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments in this range.</p>
            ) : (
              <ul className="flex flex-col gap-3.5">
                {data.paymentBreakdown.map((p) => {
                  const share = payTotal > 0 ? Math.round((p.revenue / payTotal) * 100) : 0;
                  return (
                    <li key={p.method} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{paymentMethodLabel(p.method)}</span>
                        <span className="shrink-0 text-muted-foreground">
                          <span className="font-mono tabular-nums">{p.orders}</span> orders
                          <span className="px-1.5 text-border">·</span>
                          <span className="font-mono tabular-nums text-foreground">
                            {formatPrice(p.revenue)}
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-foreground"
                            style={{ width: `${share}%` }}
                          />
                        </div>
                        <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {share}%
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Top custom drinks — off-menu drinks ranked by quantity. A trending
            one here is a candidate to promote to the real menu. */}
        {data.topCustomItems.length > 0 && (
          <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-heading text-base font-semibold">Top custom drinks</h2>
              <Eyebrow>Off-menu, by quantity</Eyebrow>
            </div>
            <ul className="flex flex-col gap-3">
              {data.topCustomItems.map((it, i) => (
                <li key={it.name} className="flex items-center gap-3 text-sm">
                  <span className="w-4 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{it.name}</span>
                  <span className="w-8 shrink-0 text-right font-mono tabular-nums">{it.quantity}</span>
                  <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{formatPrice(it.revenue)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Reward cost — what loyalty is giving away this period. */}
        <section className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-600">
            <Gift className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col">
            <h2 className="font-heading text-base font-semibold">Reward redemptions</h2>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono font-medium tabular-nums text-foreground">
                {data.totals.rewardLines}
              </span>{" "}
              free drink{data.totals.rewardLines === 1 ? "" : "s"} given
              <span className="px-1.5 text-border">·</span>
              <span className="font-mono font-medium tabular-nums text-foreground">
                {data.totals.redemptionBeans.toLocaleString()}
              </span>{" "}
              Beans redeemed
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
