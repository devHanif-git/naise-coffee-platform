import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canManageOrders } from "@/lib/auth/session";
import { listOrders } from "@/lib/orders/store";
import { ManageOrdersScreen } from "@/components/manage-orders-screen";

export const runtime = "edge";

// Internal management view — keep it out of search results.
export const metadata: Metadata = {
  title: "Manage Orders",
  robots: { index: false, follow: false },
};

export default async function ManageOrdersPage() {
  // Gate first: only staff roles may open the order board.
  if (!(await canManageOrders())) redirect("/");

  const orders = listOrders();

  return <ManageOrdersScreen orders={orders} />;
}
