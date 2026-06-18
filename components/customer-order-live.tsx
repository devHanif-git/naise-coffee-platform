"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CustomerOrderDetail } from "@/components/customer-order-detail";
import { subscribeToOrderBroadcast } from "@/lib/orders/realtime";
import type { Order } from "@/types/order";

// Customer-facing live tracking: refresh server data when the order's status is
// broadcast on its per-order topic. Works for guests and members alike.
export function CustomerOrderLive({
  order,
  backHref,
}: {
  order: Order;
  backHref: string;
}) {
  const router = useRouter();
  useEffect(
    () => subscribeToOrderBroadcast(order.token, () => router.refresh()),
    [order.token, router],
  );
  return <CustomerOrderDetail order={order} backHref={backHref} />;
}
