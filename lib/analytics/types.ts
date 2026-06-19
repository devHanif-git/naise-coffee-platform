export type DashboardMetrics = {
  today: { orders: number; revenue: number; inProgress: number };
  month: { orders: number; revenue: number; activeCustomers: number };
  topSellers: { name: string; quantity: number }[]; // this month, completed, top 5
  statusBreakdown: { status: string; count: number }[]; // current snapshot, all orders
};

export type ReportRange = "today" | "7d" | "30d" | "month";

export type ReportData = {
  range: ReportRange;
  totals: { orders: number; revenue: number; redemptionBeans: number; rewardLines: number };
  trend: { date: string; revenue: number; orders: number }[]; // per KL day, completed
  topItems: { name: string; quantity: number; revenue: number }[]; // top 10, completed
  paymentBreakdown: { method: string; orders: number; revenue: number }[]; // completed
};
