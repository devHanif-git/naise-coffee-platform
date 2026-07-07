export type AnalyticsRange = { from: string; to: string }; // inclusive KL day-keys (YYYY-MM-DD)

export type DashboardMetrics = {
  // Range-driven aggregates (follow the selected window).
  range: { orders: number; revenue: number; activeCustomers: number; completed: number };
  trend: { date: string; revenue: number }[]; // per KL day within range, zero-filled
  topSellers: { name: string; quantity: number }[]; // within range, completed, top 5
  // Always-live store state (ignores the selected range).
  live: {
    inProgress: number; // today's pending+preparing+ready ("on the bar")
    statusBreakdown: { status: string; count: number }[]; // current snapshot, all orders
  };
};

export type ReportData = {
  range: AnalyticsRange;
  totals: {
    orders: number;
    revenue: number;
    redemptionBeans: number;
    rewardLines: number;
    itemsSold: number; // total quantity across completed orders
  };
  // Online vs in-store vs custom split of completed orders in the range.
  totalsBySource: {
    online: { orders: number; revenue: number };
    store: { orders: number; revenue: number };
    custom: { orders: number; revenue: number };
  };
  previous: { orders: number; revenue: number }; // equal-length window immediately before
  trend: { date: string; revenue: number; orders: number }[]; // per KL day, completed
  topItems: { name: string; quantity: number; revenue: number }[]; // top 10, completed
  topCustomItems: { name: string; quantity: number; revenue: number }[]; // top 10 custom drinks
  paymentBreakdown: { method: string; orders: number; revenue: number }[]; // completed
};
