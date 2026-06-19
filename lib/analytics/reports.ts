import { createClient } from "@/lib/supabase/server";
import type { ReportData, ReportRange } from "@/lib/analytics/types";

const KL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
function klDate(iso: string): string {
  return KL.format(new Date(iso));
}
function klToday(): string {
  return KL.format(new Date());
}

// Inclusive start day (YYYY-MM-DD) for a range, in KL time.
function rangeStart(range: ReportRange, today: string): string {
  if (range === "today") return today;
  if (range === "month") return `${today.slice(0, 7)}-01`;
  const days = range === "7d" ? 6 : 29; // inclusive of today
  return KL.format(new Date(Date.now() - days * 86_400_000));
}

export async function getReportData(range: ReportRange): Promise<ReportData> {
  const db = await createClient();
  const start = rangeStart(range, klToday());

  const { data: orders, error } = await db
    .from("orders")
    .select("id, status, total, payment_method, created_at");
  if (error) throw new Error(`getReportData failed: ${error.message}`);

  const completed = (orders ?? []).filter(
    (o) => klDate(o.created_at) >= start && o.status === "completed",
  );

  const totalsRevenue = completed.reduce((s, o) => s + o.total, 0);

  const trendMap = new Map<string, { revenue: number; orders: number }>();
  const payMap = new Map<string, { orders: number; revenue: number }>();
  for (const o of completed) {
    const d = klDate(o.created_at);
    const t = trendMap.get(d) ?? { revenue: 0, orders: 0 };
    t.revenue += o.total; t.orders += 1;
    trendMap.set(d, t);

    const p = payMap.get(o.payment_method) ?? { orders: 0, revenue: 0 };
    p.orders += 1; p.revenue += o.total;
    payMap.set(o.payment_method, p);
  }

  const trend = [...trendMap.entries()]
    .map(([date, v]) => ({ date, revenue: v.revenue, orders: v.orders }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const paymentBreakdown = [...payMap.entries()]
    .map(([method, v]) => ({ method, orders: v.orders, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const ids = completed.map((o) => o.id);
  let topItems: { name: string; quantity: number; revenue: number }[] = [];
  let redemptionBeans = 0;
  let rewardLines = 0;
  if (ids.length > 0) {
    const { data: items, error: itemsErr } = await db
      .from("order_items")
      .select("name, quantity, line_total, is_reward, reward_cost, order_id")
      .in("order_id", ids);
    if (itemsErr) throw new Error(`getReportData failed: ${itemsErr.message}`);
    const map = new Map<string, { quantity: number; revenue: number }>();
    for (const it of items ?? []) {
      const cur = map.get(it.name) ?? { quantity: 0, revenue: 0 };
      cur.quantity += it.quantity; cur.revenue += it.line_total;
      map.set(it.name, cur);
      if (it.is_reward) { rewardLines += 1; redemptionBeans += it.reward_cost; }
    }
    topItems = [...map.entries()]
      .map(([name, v]) => ({ name, quantity: v.quantity, revenue: v.revenue }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);
  }

  return {
    range,
    totals: { orders: completed.length, revenue: totalsRevenue, redemptionBeans, rewardLines },
    trend,
    topItems,
    paymentBreakdown,
  };
}
