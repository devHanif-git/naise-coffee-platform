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
    );
  // Authorize the realtime socket with the caller's session before joining.
  // The orders tables are RLS-gated, so Realtime only streams rows the user
  // may read; without setAuth the socket is unauthenticated and delivers
  // nothing for RLS-protected sources.
  void supabase.realtime.setAuth().then(() => channel.subscribe());
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
    .on("broadcast", { event: "*" }, onChange);
  // Private channels only accept authorized joins: setAuth supplies the token
  // (member session, or the anon key for guests — the realtime.messages SELECT
  // policy grants both on order:* topics) BEFORE subscribing. Without this the
  // join authorization check fails and no broadcasts arrive.
  void supabase.realtime.setAuth().then(() => channel.subscribe());
  return () => {
    void supabase.removeChannel(channel);
  };
}
