import type { Order, OrderDraft } from "@/types/order";

// MOCK order store. State is kept on globalThis so it survives Next.js dev hot
// reloads and is shared across the (separately bundled) server action and
// manage page — a plain module-level Map gets duplicated/reset between them in
// dev, which makes freshly-created orders look "not found". This is still
// per-server-process and resets on a full restart, which is fine before
// Supabase. Swap createOrder/getOrderByToken for Supabase queries later; the
// signatures are designed to stay the same (lookup by token, NAISE-XXXXXX).

type OrderStore = {
  orders: Map<string, Order>;
  lastSequence: number;
};

const globalForOrders = globalThis as unknown as {
  __naiseOrderStore?: OrderStore;
};

const store: OrderStore = (globalForOrders.__naiseOrderStore ??= {
  orders: new Map<string, Order>(),
  lastSequence: 0,
});

// NAISE-000001, NAISE-000002, ... Increasing, zero-padded to six digits.
function nextOrderNumber(): string {
  store.lastSequence += 1;
  return `NAISE-${String(store.lastSequence).padStart(6, "0")}`;
}

export function createOrder(draft: OrderDraft): Order {
  const order: Order = {
    token: crypto.randomUUID(),
    orderNumber: nextOrderNumber(),
    status: "pending",
    createdAt: new Date().toISOString(),
    ...draft,
  };
  store.orders.set(order.token, order);
  return order;
}

export function getOrderByToken(token: string): Order | null {
  return store.orders.get(token) ?? null;
}
