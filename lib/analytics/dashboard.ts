import { createClient } from "@/lib/supabase/server";
import type { DashboardMetrics } from "@/lib/analytics/types";

// KL-day key (YYYY-MM-DD) for an ISO timestamp — matches the rewards engine TZ.
const KL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
function klDate(iso: string): string {
  return KL.format(new Date(iso));
}
function klToday(): string {
  return KL.format(new Date());
}

const IN_PROGRESS = new Set(["pending", "preparing", "ready"]);

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const db = await createClient();
  const { data: orders, error } = await db
    .from("orders")
    .select("id, status, total, created_at, user_id");
  if (error) throw new Error(`getDashboardMetrics failed: ${error.message}`);

  const today = klToday();
  const month = today.slice(0, 7); // YYYY-MM
  const cutoff30 = KL.format(new Date(Date.now() - 30 * 86_400_000));

  let todayOrders = 0, todayRevenue = 0, todayInProgress = 0, todayCompleted = 0;
  let monthOrders = 0, monthRevenue = 0;
  const activeUsers = new Set<string>();
  const statusCounts = new Map<string, number>();
  const monthCompletedIds: string[] = [];
  const dayRevenue = new Map<string, number>(); // KL day -> completed revenue (sen)

  for (const o of orders ?? []) {
    const d = klDate(o.created_at);
    const m = d.slice(0, 7);
    statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1);
    if (o.status === "completed") {
      dayRevenue.set(d, (dayRevenue.get(d) ?? 0) + o.total);
    }

    if (d === today) {
      todayOrders++;
      if (o.status === "completed") {
        todayRevenue += o.total;
        todayCompleted++;
      }
      if (IN_PROGRESS.has(o.status)) todayInProgress++;
    }
    if (m === month) {
      monthOrders++;
      if (o.status === "completed") {
        monthRevenue += o.total;
        monthCompletedIds.push(o.id);
      }
    }
    if (d >= cutoff30 && o.user_id) activeUsers.add(o.user_id);
  }

  // Last 14 KL days, oldest -> newest, zero-filled so the trend line is continuous.
  const trend14 = Array.from({ length: 14 }, (_, i) => {
    const date = KL.format(new Date(Date.now() - (13 - i) * 86_400_000));
    return { date, revenue: dayRevenue.get(date) ?? 0 };
  });

  let topSellers: { name: string; quantity: number }[] = [];
  if (monthCompletedIds.length > 0) {
    const { data: items, error: itemsErr } = await db
      .from("order_items")
      .select("name, quantity, order_id")
      .in("order_id", monthCompletedIds);
    if (itemsErr) throw new Error(`getDashboardMetrics failed: ${itemsErr.message}`);
    const byName = new Map<string, number>();
    for (const it of items ?? []) {
      byName.set(it.name, (byName.get(it.name) ?? 0) + it.quantity);
    }
    topSellers = [...byName.entries()]
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }

  return {
    today: {
      orders: todayOrders,
      revenue: todayRevenue,
      inProgress: todayInProgress,
      completed: todayCompleted,
    },
    month: {
      orders: monthOrders,
      revenue: monthRevenue,
      activeCustomers: activeUsers.size,
      completed: monthCompletedIds.length,
    },
    trend14,
    topSellers,
    statusBreakdown: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
  };
}
