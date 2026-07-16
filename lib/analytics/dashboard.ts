import { createClient } from "@/lib/supabase/server";
import type { AnalyticsRange, DashboardMetrics } from "@/lib/analytics/types";
import { klToday, eachDay } from "@/lib/analytics/range";

const KL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
function klDate(iso: string): string {
  return KL.format(new Date(iso));
}

const IN_PROGRESS = new Set(["pending", "preparing", "ready"]);

export async function getDashboardMetrics(range: AnalyticsRange): Promise<DashboardMetrics> {
  const db = await createClient();
  const { data: orders, error } = await db
    .from("orders")
    .select("id, status, total, created_at, user_id");
  if (error) throw new Error(`getDashboardMetrics failed: ${error.message}`);

  const { from, to } = range;
  const today = klToday();

  let rangeOrders = 0;
  let rangeRevenue = 0;
  let liveInProgress = 0;
  const activeUsers = new Set<string>();
  const statusCounts = new Map<string, number>();
  const rangeCompletedIds: string[] = [];
  const dayRevenue = new Map<string, number>(); // KL day -> completed revenue (sen)

  for (const o of orders ?? []) {
    const d = klDate(o.created_at);
    // Live: current snapshot of all orders by status; today's in-progress.
    statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1);
    if (d === today && IN_PROGRESS.has(o.status)) liveInProgress++;

    // Range-driven aggregates.
    if (d >= from && d <= to) {
      rangeOrders++;
      if (o.user_id) activeUsers.add(o.user_id);
      if (o.status === "completed") {
        rangeRevenue += o.total;
        rangeCompletedIds.push(o.id);
        dayRevenue.set(d, (dayRevenue.get(d) ?? 0) + o.total);
      }
    }
  }

  // Per-day revenue across the range, zero-filled so the trend line is continuous.
  const trend = eachDay(range).map((date) => ({ date, revenue: dayRevenue.get(date) ?? 0 }));

  let topSellers: { name: string; quantity: number }[] = [];
  let rangeCost = 0;
  if (rangeCompletedIds.length > 0) {
    // Fetch line items in ID chunks: a single `.in()` over a wide range inlines
    // every ID into the request URL, which overflows the server/proxy URL limit
    // and surfaces as `TypeError: fetch failed`.
    const CHUNK = 100;
    const items: {
      name: string;
      quantity: number;
      unit_cost: number | null;
      is_custom: boolean;
      order_id: string;
      products: { name: string } | null;
    }[] = [];
    for (let i = 0; i < rangeCompletedIds.length; i += CHUNK) {
      const ids = rangeCompletedIds.slice(i, i + CHUNK);
      const { data, error: itemsErr } = await db
        .from("order_items")
        .select("name, quantity, unit_cost, is_custom, order_id, products(name)")
        .in("order_id", ids);
      if (itemsErr) throw new Error(`getDashboardMetrics failed: ${itemsErr.message}`);
      if (data) items.push(...data);
    }
    const byName = new Map<string, number>();
    for (const it of items) {
      // Goods cost snapshotted at sale; null for legacy/unlinked lines -> 0.
      rangeCost += (it.unit_cost ?? 0) * it.quantity;
      if (it.is_custom) continue; // best-sellers is for featurable menu items only
      // Prefer the current product name so renames flow through; fall back to the
      // snapshot name for unlinked legacy rows.
      const displayName = it.products?.name ?? it.name;
      byName.set(displayName, (byName.get(displayName) ?? 0) + it.quantity);
    }
    topSellers = [...byName.entries()]
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);
  }

  return {
    range: {
      orders: rangeOrders,
      revenue: rangeRevenue,
      profit: rangeRevenue - rangeCost,
      activeCustomers: activeUsers.size,
      completed: rangeCompletedIds.length,
    },
    trend,
    topSellers,
    live: {
      inProgress: liveInProgress,
      statusBreakdown: [...statusCounts.entries()].map(([status, count]) => ({ status, count })),
    },
  };
}
