"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Revenue per day. `data` dates are YYYY-MM-DD; revenue is sen → shown as RM.
export function RevenueChart({ data }: { data: { date: string; revenue: number }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No completed sales in this range.</p>;
  }
  const chartData = data.map((d) => ({ date: d.date.slice(5), revenue: d.revenue / 100 }));
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            stroke="var(--border)"
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
            stroke="var(--border)"
            width={40}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            formatter={(v) => {
              const val = typeof v === "number" ? v : 0;
              return [`RM ${val.toFixed(2)}`, "Revenue"];
            }}
            labelStyle={{ fontSize: 12, color: "var(--foreground)" }}
            contentStyle={{
              fontSize: 12,
              borderRadius: 12,
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
            }}
          />
          <Bar dataKey="revenue" fill="var(--primary)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
