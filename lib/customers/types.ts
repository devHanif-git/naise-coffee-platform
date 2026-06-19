import type { Role } from "@/types/auth";

export type CustomerSummary = {
  id: string;
  displayName: string | null;
  phone: string | null;
  role: Role;
  beansBalance: number;
  ordersCount: number;
  joinedAt: string; // ISO
};

export type CustomerLedgerEntry = {
  id: string;
  category: "earn" | "redeem" | "streak_bonus" | "referral" | "adjustment";
  amount: number;
  label: string;
  isReversal: boolean;
  createdAt: string;
};

export type CustomerOrderSummary = {
  id: string;
  orderNumber: string;
  status: "pending" | "preparing" | "ready" | "completed" | "cancelled";
  total: number;
  createdAt: string;
};

export type CustomerDetail = {
  summary: CustomerSummary;
  orders: CustomerOrderSummary[];
  ledger: CustomerLedgerEntry[];
};
