import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canManageOrders } from "@/lib/auth/session";
import { listOrders } from "@/lib/orders/store";
import { ManageOrdersLive } from "@/components/manage-orders-live";

export const metadata: Metadata = {
  title: "Manage Orders",
  robots: { index: false, follow: false },
};

export default async function ManageOrdersPage() {
  if (!(await canManageOrders())) redirect("/");
  const orders = await listOrders();
  return <ManageOrdersLive orders={orders} />;
}
