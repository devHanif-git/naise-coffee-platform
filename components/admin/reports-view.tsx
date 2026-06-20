"use client";

import { useState, useTransition } from "react";
import type { ReportData, ReportRange } from "@/lib/analytics/types";
import { formatPrice } from "@/lib/format";
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
      <div className="flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r.value}
            onClick={() => pick(r.value)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              data.range === r.value ? "bg-black text-white" : "border border-border"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className={pending ? "opacity-50 transition-opacity" : "transition-opacity"}>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-border p-4">
            <span className="text-xs text-muted-foreground">Revenue</span>
            <p className="text-xl font-bold">{formatPrice(data.totals.revenue)}</p>
          </div>
          <div className="rounded-2xl border border-border p-4">
            <span className="text-xs text-muted-foreground">Completed orders</span>
            <p className="text-xl font-bold">{data.totals.orders}</p>
          </div>
        </div>

        <section className="mt-4 rounded-2xl border border-border p-4">
          <h2 className="mb-2 text-sm font-bold">Revenue trend</h2>
          <RevenueChart data={data.trend} />
        </section>

        <section className="mt-4 rounded-2xl border border-border p-4">
          <h2 className="mb-2 text-sm font-bold">Top items</h2>
          {data.topItems.length === 0 && (
            <p className="text-sm text-muted-foreground">No sales in this range.</p>
          )}
          {data.topItems.map((it, i) => (
            <div key={it.name} className="flex items-center justify-between text-sm">
              <span className="truncate">{i + 1}. {it.name}</span>
              <span className="text-muted-foreground">{it.quantity} · {formatPrice(it.revenue)}</span>
            </div>
          ))}
        </section>

        <section className="mt-4 rounded-2xl border border-border p-4">
          <h2 className="mb-2 text-sm font-bold">Payment methods</h2>
          {data.paymentBreakdown.map((p) => (
            <div key={p.method} className="flex items-center justify-between text-sm">
              <span className="capitalize">{p.method}</span>
              <span className="text-muted-foreground">{p.orders} · {formatPrice(p.revenue)}</span>
            </div>
          ))}
        </section>

        <section className="mt-4 rounded-2xl border border-border p-4">
          <h2 className="text-sm font-bold">Reward redemptions</h2>
          <p className="text-sm text-muted-foreground">
            {data.totals.rewardLines} free drink{data.totals.rewardLines === 1 ? "" : "s"} ·{" "}
            {data.totals.redemptionBeans} Beans redeemed
          </p>
        </section>
      </div>
    </div>
  );
}
