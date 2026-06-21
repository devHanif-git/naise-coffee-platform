"use client";

import { useState, useTransition } from "react";
import type { ReportData, ReportRange } from "@/lib/analytics/types";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RevenueChart } from "@/components/admin/revenue-chart";

const RANGES: { value: ReportRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "month", label: "Month" },
];

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => pick(r.value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50",
              data.range === r.value
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className={pending ? "opacity-50 transition-opacity" : "transition-opacity"}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <span className="text-xs text-muted-foreground">Revenue</span>
            <p className="font-mono text-2xl font-bold tabular-nums">
              {formatPrice(data.totals.revenue)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <span className="text-xs text-muted-foreground">Completed orders</span>
            <p className="font-mono text-2xl font-bold tabular-nums">{data.totals.orders}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <span className="text-xs text-muted-foreground">Free drinks</span>
            <p className="font-mono text-2xl font-bold tabular-nums">{data.totals.rewardLines}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <span className="text-xs text-muted-foreground">Beans redeemed</span>
            <p className="font-mono text-2xl font-bold tabular-nums">
              {data.totals.redemptionBeans}
            </p>
          </div>
        </div>

        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <h2 className="mb-2 font-heading text-base font-semibold">Revenue trend</h2>
          <RevenueChart data={data.trend} />
        </section>

        <section className="mt-4 flex flex-col gap-3">
          <h2 className="font-heading text-base font-semibold">Top items</h2>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Item</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.topItems.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-6 text-center text-sm text-muted-foreground"
                    >
                      No sales in this range.
                    </td>
                  </tr>
                ) : (
                  data.topItems.map((it, i) => (
                    <tr
                      key={it.name}
                      className="border-b border-border last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-4 py-2">
                        <span className="text-muted-foreground">{i + 1}.</span>{" "}
                        <span className="truncate">{it.name}</span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {it.quantity}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {formatPrice(it.revenue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-4 flex flex-col gap-3">
          <h2 className="font-heading text-base font-semibold">Payment methods</h2>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 text-left font-medium">Method</th>
                  <th className="px-4 py-2 text-right font-medium">Orders</th>
                  <th className="px-4 py-2 text-right font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {data.paymentBreakdown.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-4 py-6 text-center text-sm text-muted-foreground"
                    >
                      No payments in this range.
                    </td>
                  </tr>
                ) : (
                  data.paymentBreakdown.map((p) => (
                    <tr
                      key={p.method}
                      className="border-b border-border last:border-0 hover:bg-muted/50"
                    >
                      <td className="px-4 py-2 capitalize">{p.method}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{p.orders}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">
                        {formatPrice(p.revenue)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          <h2 className="font-heading text-base font-semibold">Reward redemptions</h2>
          <p className="text-sm text-muted-foreground">
            {data.totals.rewardLines} free drink{data.totals.rewardLines === 1 ? "" : "s"} {"·"}{" "}
            {data.totals.redemptionBeans} Beans redeemed
          </p>
        </section>
      </div>
    </div>
  );
}
