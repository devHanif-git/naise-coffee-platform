"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { subscribeToOrderBroadcast } from "@/lib/orders/realtime";

// Keeps the profile's recent-orders preview live. Subscribes to each order's
// per-token broadcast topic and refreshes server data when any of their
// statuses change. Token-keyed (same model as the order detail page), so it
// works for guests and members alike. Renders nothing — it only drives the
// refresh of the server-rendered card.
export function ProfileOrdersLive({ tokens }: { tokens: string[] }) {
  const router = useRouter();
  // Join into a stable string so the effect re-runs only when the set of
  // tracked orders actually changes, not on every render.
  const key = tokens.join(",");
  useEffect(() => {
    const list = key ? key.split(",") : [];
    const unsubscribes = list.map((token) =>
      subscribeToOrderBroadcast(token, () => router.refresh()),
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [key, router]);
  return null;
}
