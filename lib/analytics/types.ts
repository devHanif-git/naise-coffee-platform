export type DashboardMetrics = {
  today: { orders: number; revenue: number; inProgress: number; completed: number };
  month: { orders: number; revenue: number; activeCustomers: number; completed: number };
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
    redemptionBeans: number;
    rewardLines: number;
    itemsSold: number; // total quantity across completed orders
  };
  previous: { orders: number; revenue: number }; // equal-length window immediately before
  trend: { date: string; revenue: number; orders: number }[]; // per KL day, completed
  topItems: { name: string; quantity: number; revenue: number }[]; // top 10, completed
  paymentBreakdown: { method: string; orders: number; revenue: number }[]; // completed
};
