import { createClient } from "@/lib/supabase/server";
import { normalizePaymentMethod } from "@/data/payment-methods";
import type { ReportData, ReportRange } from "@/lib/analytics/types";

const KL = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
function klDate(iso: string): string {
  return KL.format(new Date(iso));
}
function klToday(): string {
  return KL.format(new Date());
}

const DAY_MS = 86_400_000;

// Inclusive start day (YYYY-MM-DD) for a range, in KL time.
function rangeStart(range: ReportRange, today: string): string {
  if (range === "today") return today;
  if (range === "month") return `${today.slice(0, 7)}-01`;
  const days = range === "7d" ? 6 : 29; // inclusive of today
  return KL.format(new Date(Date.now() - days * DAY_MS));
}

// Shift a YYYY-MM-DD day key by whole days. Day keys are only ever compared as
// calendar days, so plain UTC arithmetic is safe here.
function shiftDay(dayKey: string, deltaDays: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + deltaDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export async function getReportData(range: ReportRange): Promise<ReportData> {
  const db = await createClient();
  const today = klToday();
  const start = rangeStart(range, today);

  // Equal-length window immediately before `start`, for period-over-period deltas.
  const windowDays =
    Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS,
    ) + 1;
  const prevEnd = shiftDay(start, -1);
  const prevStart = shiftDay(start, -windowDays);

  const { data: orders, error } = await db
    .from("orders")
    .select("id, status, total, payment_method, source, created_at");
  if (error) throw new Error(`getReportData failed: ${error.message}`);

  const completed = (orders ?? []).filter(
    (o) => klDate(o.created_at) >= start && o.status === "completed",
  );

  // Online vs in-store vs custom split (completed orders in range).
  const bySource = (src: "online" | "store" | "custom") => {
    const rows = completed.filter((o) => (o.source ?? "online") === src);
    return { orders: rows.length, revenue: rows.reduce((s, o) => s + o.total, 0) };
  };
  const totalsBySource = {
    online: bySource("online"),
    store: bySource("store"),
    custom: bySource("custom"),
  };

  // Prior-period completed totals (revenue + order count) for delta arrows.
  let prevRevenue = 0;
  let prevOrders = 0;
  for (const o of orders ?? []) {
    if (o.status !== "completed") continue;
    const d = klDate(o.created_at);
    if (d >= prevStart && d <= prevEnd) {
      prevRevenue += o.total;
      prevOrders += 1;
    }
  }

  const totalsRevenue = completed.reduce((s, o) => s + o.total, 0);

  const trendMap = new Map<string, { revenue: number; orders: number }>();
  const payMap = new Map<string, { orders: number; revenue: number }>();
  for (const o of completed) {
    const d = klDate(o.created_at);
    const t = trendMap.get(d) ?? { revenue: 0, orders: 0 };
    t.revenue += o.total; t.orders += 1;
    trendMap.set(d, t);

    // Group on the canonical method id so legacy display-name variants
    // ("DuitNow QR", "Duitnow QR") collapse into the same method as "duitnow-qr".
    const method = normalizePaymentMethod(o.payment_method);
    const p = payMap.get(method) ?? { orders: 0, revenue: 0 };
    p.orders += 1; p.revenue += o.total;
    payMap.set(method, p);
  }

  const trend = [...trendMap.entries()]
    .map(([date, v]) => ({ date, revenue: v.revenue, orders: v.orders }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const paymentBreakdown = [...payMap.entries()]
    .map(([method, v]) => ({ method, orders: v.orders, revenue: v.revenue }))
    .sort((a, b) => b.revenue - a.revenue);

  const ids = completed.map((o) => o.id);
  let topItems: { name: string; quantity: number; revenue: number }[] = [];
  let topCustomItems: { name: string; quantity: number; revenue: number }[] = [];
  let redemptionBeans = 0;
  let rewardLines = 0;
  let itemsSold = 0;
  if (ids.length > 0) {
    const { data: items, error: itemsErr } = await db
      .from("order_items")
      .select("name, quantity, line_total, is_reward, reward_cost, is_custom, order_id")
      .in("order_id", ids);
    if (itemsErr) throw new Error(`getReportData failed: ${itemsErr.message}`);
    const map = new Map<string, { quantity: number; revenue: number }>();
    const customMap = new Map<string, { quantity: number; revenue: number }>();
    for (const it of items ?? []) {
      const cur = map.get(it.name) ?? { quantity: 0, revenue: 0 };
      cur.quantity += it.quantity; cur.revenue += it.line_total;
      map.set(it.name, cur);
      itemsSold += it.quantity;
      if (it.is_reward) { rewardLines += 1; redemptionBeans += it.reward_cost; }
      if (it.is_custom) {
        const c = customMap.get(it.name) ?? { quantity: 0, revenue: 0 };
        c.quantity += it.quantity; c.revenue += it.line_total;
        customMap.set(it.name, c);
      }
    }
    const rank = (m: Map<string, { quantity: number; revenue: number }>) =>
      [...m.entries()]
        .map(([name, v]) => ({ name, quantity: v.quantity, revenue: v.revenue }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10);
    topItems = rank(map);
    topCustomItems = rank(customMap);
  }

  return {
    range,
    totals: { orders: completed.length, revenue: totalsRevenue, redemptionBeans, rewardLines, itemsSold },
    totalsBySource,
    previous: { orders: prevOrders, revenue: prevRevenue },
    trend,
    topItems,
    topCustomItems,
    paymentBreakdown,
  };
}
