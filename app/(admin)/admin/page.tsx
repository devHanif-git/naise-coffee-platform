import { getDashboardMetrics } from "@/lib/analytics/dashboard";
import { formatPrice } from "@/lib/format";

export const dynamic = "force-dynamic";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-2xl border border-border p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-bold tracking-tight">{value}</span>
    </div>
  );
}

export default async function AdminDashboardPage() {
  const m = await getDashboardMetrics();
  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <h1 className="font-heading text-lg font-bold tracking-tight">Dashboard</h1>

      <h2 className="text-sm font-semibold text-muted-foreground">Today</h2>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Orders" value={String(m.today.orders)} />
        <Metric label="Revenue" value={formatPrice(m.today.revenue)} />
        <Metric label="In progress" value={String(m.today.inProgress)} />
      </div>

      <h2 className="text-sm font-semibold text-muted-foreground">This month</h2>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Orders" value={String(m.month.orders)} />
        <Metric label="Revenue" value={formatPrice(m.month.revenue)} />
        <Metric label="Active" value={String(m.month.activeCustomers)} />
      </div>

      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h2 className="text-sm font-bold">Top sellers (this month)</h2>
        {m.topSellers.length === 0 && (
          <p className="text-sm text-muted-foreground">No completed orders yet.</p>
        )}
        {m.topSellers.map((s, i) => (
          <div key={s.name} className="flex items-center justify-between text-sm">
            <span className="truncate">{i + 1}. {s.name}</span>
            <span className="font-medium">{s.quantity}</span>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2 rounded-2xl border border-border p-4">
        <h2 className="text-sm font-bold">Orders by status</h2>
        {m.statusBreakdown.map((s) => (
          <div key={s.status} className="flex items-center justify-between text-sm">
            <span className="capitalize">{s.status}</span>
            <span className="font-medium">{s.count}</span>
          </div>
        ))}
      </section>
    </div>
  );
}
