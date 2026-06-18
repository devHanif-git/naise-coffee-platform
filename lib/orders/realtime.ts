"use client";

import { createClient } from "@/lib/supabase/client";

// Staff board/detail: refetch whenever any order or order_item row changes.
// RLS on the tables restricts what staff actually receive.
export function subscribeToOrders(onChange: () => void): () => void {
  const supabase = createClient();
  const channel = supabase
    .channel("manage-orders")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "orders" },
      onChange,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "order_items" },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// Customer tracking (guest or member): listen on the per-order broadcast topic
// keyed by the unguessable token.
export function subscribeToOrderBroadcast(
  token: string,
  onChange: () => void,
): () => void {
  const supabase = createClient();
  const channel = supabase
    .channel(`order:${token}`, { config: { private: true } })
    .on("broadcast", { event: "*" }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
