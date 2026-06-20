import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/types/auth";
import type {
  CustomerDetail,
  CustomerLedgerEntry,
  CustomerOrderSummary,
  CustomerSummary,
} from "@/lib/customers/types";

// All reads run under the caller's RLS; the SELECT policies on profiles /
// reward_accounts / orders / bean_transactions permit admin, manager, and staff
// roles (not admin-only). The customer pages are gated to admin via the layout.

export async function listCustomers(search?: string): Promise<CustomerSummary[]> {
  const db = await createClient();
  const [profilesRes, accountsRes, ordersRes] = await Promise.all([
    db.from("profiles").select("id, display_name, phone, role, created_at").order("created_at", { ascending: false }),
    db.from("reward_accounts").select("user_id, balance"),
    db.from("orders").select("user_id"),
  ]);
  if (profilesRes.error) throw new Error(`listCustomers failed: ${profilesRes.error.message}`);
  if (accountsRes.error) throw new Error(`listCustomers failed: ${accountsRes.error.message}`);
  if (ordersRes.error) throw new Error(`listCustomers failed: ${ordersRes.error.message}`);

  const balanceByUser = new Map((accountsRes.data ?? []).map((a) => [a.user_id, a.balance]));
  const ordersByUser = new Map<string, number>();
  for (const o of ordersRes.data ?? []) {
    if (o.user_id) ordersByUser.set(o.user_id, (ordersByUser.get(o.user_id) ?? 0) + 1);
  }

  const term = search?.trim().toLowerCase();
  return (profilesRes.data ?? [])
    .map((p) => ({
      id: p.id,
      displayName: p.display_name,
      phone: p.phone,
      role: p.role as Role,
      beansBalance: balanceByUser.get(p.id) ?? 0,
      ordersCount: ordersByUser.get(p.id) ?? 0,
      joinedAt: p.created_at,
    }))
    .filter((c) =>
      !term ||
      (c.displayName?.toLowerCase().includes(term) ?? false) ||
      (c.phone?.toLowerCase().includes(term) ?? false),
    );
}

export async function getCustomerDetail(userId: string): Promise<CustomerDetail | null> {
  const db = await createClient();
  const [profileRes, accountRes, ordersRes, ledgerRes] = await Promise.all([
    db.from("profiles").select("id, display_name, phone, role, created_at").eq("id", userId).maybeSingle(),
    db.from("reward_accounts").select("balance").eq("user_id", userId).maybeSingle(),
    db.from("orders").select("id, order_number, status, total, created_at").eq("user_id", userId).order("created_at", { ascending: false }),
    db.from("bean_transactions").select("id, category, amount, label, is_reversal, created_at").eq("user_id", userId).order("created_at", { ascending: false }),
  ]);
  if (profileRes.error) throw new Error(`getCustomerDetail failed: ${profileRes.error.message}`);
  if (!profileRes.data) return null;
  if (accountRes.error) throw new Error(`getCustomerDetail failed: ${accountRes.error.message}`);
  if (ordersRes.error) throw new Error(`getCustomerDetail failed: ${ordersRes.error.message}`);
  if (ledgerRes.error) throw new Error(`getCustomerDetail failed: ${ledgerRes.error.message}`);

  const p = profileRes.data;
  const orders: CustomerOrderSummary[] = (ordersRes.data ?? []).map((o) => ({
    id: o.id,
    orderNumber: o.order_number ?? "",
    status: o.status,
    total: o.total,
    createdAt: o.created_at,
  }));
  const ledger: CustomerLedgerEntry[] = (ledgerRes.data ?? []).map((t) => ({
    id: t.id,
    category: t.category,
    amount: t.amount,
    label: t.label,
    isReversal: t.is_reversal,
    createdAt: t.created_at,
  }));

  return {
    summary: {
      id: p.id,
      displayName: p.display_name,
      phone: p.phone,
      role: p.role as Role,
      beansBalance: accountRes.data?.balance ?? 0,
      ordersCount: orders.length,
      joinedAt: p.created_at,
    },
    orders,
    ledger,
  };
}
