"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ManageOrdersScreen } from "@/components/manage-orders-screen";
import { subscribeToOrders } from "@/lib/orders/realtime";
import type { Order } from "@/types/order";

// Renders the staff board and refreshes server data when any order changes.
export function ManageOrdersLive({ orders }: { orders: Order[] }) {
  const router = useRouter();
  useEffect(() => subscribeToOrders(() => router.refresh()), [router]);
  return <ManageOrdersScreen orders={orders} />;
}
