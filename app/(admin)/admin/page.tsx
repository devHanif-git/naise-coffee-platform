import { getDashboardMetrics } from "@/lib/analytics/dashboard";
import { formatPrice } from "@/lib/format";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

export const dynamic = "force-dynamic";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="font-mono text-2xl font-bold tabular-nums tracking-tight">
        {value}
      </span>
    </div>
  );
}

export default async function AdminDashboardPage() {
  const m = await getDashboardMetrics();
  return (
    <div className="flex flex-col gap-8">
      <AdminPageHeader title="Dashboard" description="Store performance at a glance." />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">Today</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Metric label="Orders" value={String(m.today.orders)} />
          <Metric label="Revenue" value={formatPrice(m.today.revenue)} />
          <Metric label="In progress" value={String(m.today.inProgress)} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">This month</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Metric label="Orders" value={String(m.month.orders)} />
          <Metric label="Revenue" value={formatPrice(m.month.revenue)} />
          <Metric label="Active" value={String(m.month.activeCustomers)} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <h2 className="font-heading text-base font-semibold">
            Top sellers (this month)
          </h2>
          {m.topSellers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No completed orders yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {m.topSellers.map((s, i) => (
                <li
                  key={s.name}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {i + 1}
                    </span>
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="font-mono font-medium tabular-nums">
                    {s.quantity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <h2 className="font-heading text-base font-semibold">Orders by status</h2>
          <ul className="flex flex-col divide-y divide-border">
            {m.statusBreakdown.map((s) => (
              <li
                key={s.status}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="capitalize">{s.status}</span>
                <span className="font-mono font-medium tabular-nums">
                  {s.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
