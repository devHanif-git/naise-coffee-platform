import Link from "next/link";
import { Plus, ClipboardList } from "lucide-react";
import { getDashboardMetrics } from "@/lib/analytics/dashboard";
import { formatPrice } from "@/lib/format";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { RevenueArea, Sparkline } from "@/components/admin/dashboard-charts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Order pipeline rendered as labelled meters. Colours match the barista board
// (drink-row.tsx): pending=amber, preparing=blue, ready=emerald.
const PIPELINE = [
  { key: "pending", label: "Pending", bar: "bg-amber-500" },
  { key: "preparing", label: "Preparing", bar: "bg-blue-500" },
  { key: "ready", label: "Ready", bar: "bg-emerald-500" },
  { key: "completed", label: "Completed", bar: "bg-foreground" },
  { key: "cancelled", label: "Cancelled", bar: "bg-muted-foreground/40" },
] as const;

function aov(revenue: number, completed: number) {
  return completed > 0 ? Math.round(revenue / completed) : 0;
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
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card p-4">
      <Eyebrow>{label}</Eyebrow>
      <span className="font-mono text-2xl font-bold tabular-nums tracking-tight">
        {value}
      </span>
      {children}
    </div>
  );
}

export default async function AdminDashboardPage() {
  const m = await getDashboardMetrics();
  const todayLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(new Date());

  const statusMap = new Map(m.statusBreakdown.map((s) => [s.status, s.count]));
  const pipelineMax = Math.max(1, ...PIPELINE.map((p) => statusMap.get(p.key) ?? 0));
  const sellerMax = Math.max(1, ...m.topSellers.map((s) => s.quantity));

  return (
    <div className="flex flex-col gap-7">
      <AdminPageHeader title="Dashboard" description="Store performance at a glance.">
        <Button asChild variant="outline" size="sm" className="rounded-full">
          <Link href="/manage">
            <ClipboardList className="size-4" aria-hidden />
            Orders
          </Link>
        </Button>
        <Button asChild size="sm" className="rounded-full">
          <Link href="/admin/menu/new">
            <Plus className="size-4" aria-hidden />
            New item
          </Link>
        </Button>
      </AdminPageHeader>

      {/* Service-counter hero: today's take in ink, the live "on the bar"
          count in amber — the one warm note, echoing the storefront's black
          hero so admin reads as the same brand. */}
      <section className="naise-rise relative overflow-hidden rounded-3xl bg-black px-6 py-7 text-white sm:px-8 sm:py-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-white/55">
              Today · {todayLabel}
            </span>
            <span className="font-mono text-4xl font-bold tabular-nums tracking-tight sm:text-5xl">
              {formatPrice(m.today.revenue)}
            </span>
            <span className="text-sm text-white/65">
              {m.today.orders} order{m.today.orders === 1 ? "" : "s"} placed
              <span className="px-1.5 text-white/30">·</span>
              avg {formatPrice(aov(m.today.revenue, m.today.completed))}
              <span className="px-1.5 text-white/30">·</span>
              profit {formatPrice(m.today.profit)}
            </span>
          </div>

          <div className="flex items-center gap-3 self-start rounded-2xl border border-white/15 bg-white/[0.06] px-5 py-4 sm:self-auto">
            <span className="relative flex size-2.5 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-70 motion-reduce:hidden" />
              <span className="relative inline-flex size-2.5 rounded-full bg-amber-400" />
            </span>
            <div className="flex flex-col leading-none">
              <span className="font-mono text-3xl font-bold tabular-nums text-amber-300">
                {m.today.inProgress}
              </span>
              <span className="mt-1 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-white/55">
                On the bar
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* This month — supporting figures, revenue tile carries a sparkline. */}
      <section className="flex flex-col gap-3">
        <Eyebrow>This month</Eyebrow>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Revenue" value={formatPrice(m.month.revenue)}>
            <Sparkline data={m.trend14} />
          </StatTile>
          <StatTile label="Net profit" value={formatPrice(m.month.profit)} />
          <StatTile label="Orders" value={String(m.month.orders)} />
          <StatTile label="Active customers" value={String(m.month.activeCustomers)} />
        </div>
      </section>

      {/* Revenue trend (wide) + order pipeline (narrow). */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="font-heading text-base font-semibold">Revenue trend</h2>
            <Eyebrow>Last 14 days</Eyebrow>
          </div>
          <RevenueArea data={m.trend14} />
        </section>

        <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
          <h2 className="font-heading text-base font-semibold">Order pipeline</h2>
          <ul className="flex flex-col gap-3">
            {PIPELINE.map((p) => {
              const count = statusMap.get(p.key) ?? 0;
              return (
                <li key={p.key} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{p.label}</span>
                    <span className="font-mono font-medium tabular-nums">{count}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full", p.bar)}
                      style={{ width: `${(count / pipelineMax) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {/* Top sellers — a genuine ranking, so numeric ranks carry meaning. */}
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-heading text-base font-semibold">Top sellers</h2>
          <Eyebrow>This month</Eyebrow>
        </div>
        {m.topSellers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed orders yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {m.topSellers.map((s, i) => (
              <li key={s.name} className="flex items-center gap-3 text-sm">
                <span className="w-4 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="w-32 shrink-0 truncate font-medium sm:w-44">{s.name}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-foreground"
                    style={{ width: `${(s.quantity / sellerMax) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right font-mono font-medium tabular-nums">
                  {s.quantity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
