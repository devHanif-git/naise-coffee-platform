"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useMounted } from "@/hooks/use-mounted";

type Point = { date: string; revenue: number };

// Shared shaping: sen -> RM, and trim the YYYY- prefix off the day key.
function toChart(data: Point[]) {
  return data.map((d) => ({ label: d.date.slice(5), revenue: d.revenue / 100 }));
}

// Full revenue trend for the dashboard's wide card. Ink line over a soft fade —
// the accent colour is reserved for the live counter, so the trend stays calm.
export function RevenueArea({ data }: { data: Point[] }) {
  const mounted = useMounted();
  if (data.every((d) => d.revenue === 0)) {
    return (
      <div className="flex h-44 items-center justify-center text-sm text-muted-foreground">
        No completed sales in this range.
      </div>
    );
  }
  if (!mounted) return <div className="h-44 w-full" />;
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={toChart(data)} margin={{ top: 6, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="naise-revenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--foreground)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            stroke="var(--border)"
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            stroke="var(--border)"
            tickLine={false}
            width={44}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            formatter={(v) => [`RM ${(typeof v === "number" ? v : 0).toFixed(2)}`, "Revenue"]}
            labelStyle={{ fontSize: 12, color: "var(--foreground)" }}
            contentStyle={{
              fontSize: 12,
              borderRadius: 12,
              backgroundColor: "var(--card)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
            }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--foreground)"
            strokeWidth={2}
            fill="url(#naise-revenue)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Bare sparkline tucked under the month-revenue tile. No axes, no tooltip —
// just the shape of the trend.
export function Sparkline({ data }: { data: Point[] }) {
  const mounted = useMounted();
  if (data.every((d) => d.revenue === 0)) return <div className="h-9" />;
  if (!mounted) return <div className="h-9 w-full" />;
  return (
    <div className="h-9 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={toChart(data)} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="naise-spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--foreground)" stopOpacity={0.14} />
              <stop offset="100%" stopColor="var(--foreground)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--foreground)"
            strokeWidth={1.5}
            fill="url(#naise-spark)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
