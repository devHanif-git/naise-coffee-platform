export type DashboardMetrics = {
  today: { orders: number; revenue: number; profit: number; inProgress: number; completed: number };
  month: { orders: number; revenue: number; profit: number; activeCustomers: number; completed: number };
  trend14: { date: string; revenue: number }[]; // last 14 KL days, completed revenue
  topSellers: { name: string; quantity: number }[]; // this month, completed, top 5
  statusBreakdown: { status: string; count: number }[]; // current snapshot, all orders
};

export type ReportRange = "today" | "7d" | "30d" | "month";

export type ReportData = {
  range: ReportRange;
  totals: {
    orders: number;
    revenue: number;
    cost: number; // goods cost of completed orders (sen), snapshotted at sale
    netProfit: number; // revenue - cost (sen)
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
