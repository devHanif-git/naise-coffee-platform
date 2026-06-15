import type { ItemStatus, Order, OrderDraft, OrderStatus } from "@/types/order";

// MOCK order store. State is kept on globalThis so it survives Next.js dev hot
// reloads and is shared across the (separately bundled) server action and
// manage page — a plain module-level Map gets duplicated/reset between them in
// dev, which makes freshly-created orders look "not found". This is still
// per-server-process and resets on a full restart, which is fine before
// Supabase. Swap createOrder/getOrderByToken/listOrders/setItemStatus for
// Supabase queries later; the signatures are designed to stay the same (lookup
// by token, NAISE-XXXXXX).

type OrderStore = {
  orders: Map<string, Order>;
  lastSequence: number;
};

const globalForOrders = globalThis as unknown as {
  __naiseOrderStore?: OrderStore;
};

const store: OrderStore = (globalForOrders.__naiseOrderStore ??= seedStore());

// The order's overall status is derived from its drinks: every drink done means
// the order is complete; any drink in progress (or some done, some not) means
// preparing; otherwise it's still pending. Cancelled is set explicitly and
// isn't derived here.
export function deriveOrderStatus(items: { status: ItemStatus }[]): OrderStatus {
  if (items.length > 0 && items.every((i) => i.status === "done")) {
    return "completed";
  }
  if (items.some((i) => i.status !== "pending")) {
    return "preparing";
  }
  return "pending";
}

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

// All orders, newest first. Replace with a Supabase select ordered by
// created_at desc (scoped by RLS to staff roles) when the DB lands.
export function listOrders(): Order[] {
  return [...store.orders.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

// Set one drink's fulfilment status, then re-derive the order's overall status
// from all its drinks. Returns the updated order (or null if unknown). Replace
// with a Supabase update + realtime broadcast later; the signature stays the
// same. When the derived status flips to "completed", that's where the backend
// will notify the buyer over WhatsApp and mark the manage link complete.
export function setItemStatus(
  token: string,
  itemIndex: number,
  status: ItemStatus,
): Order | null {
  const order = store.orders.get(token);
  if (!order || itemIndex < 0 || itemIndex >= order.items.length) return null;

  const items = order.items.map((item, i) =>
    i === itemIndex ? { ...item, status } : item,
  );
  const derived = deriveOrderStatus(items);
  const updated: Order = {
    ...order,
    items,
    status: derived,
    // Stamp the completion time when the order first flips to completed; clear
    // it if a drink is re-opened and the order is no longer done.
    completedAt:
      derived === "completed"
        ? (order.completedAt ?? new Date().toISOString())
        : undefined,
  };
  store.orders.set(token, updated);
  return updated;
}

// Cancel an order outright (a manual override, not derived from drinks).
export function cancelOrder(token: string): Order | null {
  const order = store.orders.get(token);
  if (!order) return null;
  const updated: Order = { ...order, status: "cancelled" };
  store.orders.set(token, updated);
  return updated;
}

// Seed a handful of mock orders so the manage screen has content before
// Supabase. Timestamps are relative to process start. Remove once real orders
// flow through createOrder against the database.
function seedStore(): OrderStore {
  const orders = new Map<string, Order>();
  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

  const seeds: Order[] = [
    {
      token: "seed-1023",
      orderNumber: "NAISE-001023",
      status: "pending",
      paymentMethod: "DuitNow QR",
      proofOfPaymentUrl: "/brand/coffee_with_logo.png",
      createdAt: minutesAgo(2),
      items: [
        {
          name: "Naise Signature Latte",
          quantity: 1,
          sizeName: "Regular",
          addonNames: ["Extra Shot"],
          unitPrice: 1290,
          lineTotal: 1290,
          status: "pending",
        },
        {
          name: "Mocha",
          quantity: 1,
          sizeName: "Regular",
          addonNames: [],
          unitPrice: 1390,
          lineTotal: 1390,
          status: "pending",
        },
      ],
      subtotal: 2680,
      total: 2680,
    },
    {
      token: "seed-1022",
      orderNumber: "NAISE-001022",
      status: "preparing",
      paymentMethod: "Cash",
      createdAt: minutesAgo(5),
      items: [
        {
          name: "Spanish Latte",
          quantity: 1,
          sizeName: "Regular",
          addonNames: [],
          unitPrice: 1390,
          lineTotal: 1390,
          status: "preparing",
        },
      ],
      subtotal: 1390,
      total: 1390,
    },
    {
      token: "seed-1021",
      orderNumber: "NAISE-001021",
      status: "pending",
      paymentMethod: "DuitNow QR",
      proofOfPaymentUrl: "/brand/coffee_with_logo.png",
      createdAt: minutesAgo(8),
      items: [
        {
          name: "Americano",
          quantity: 1,
          sizeName: "Regular",
          addonNames: [],
          unitPrice: 990,
          lineTotal: 990,
          status: "pending",
        },
        {
          name: "Caramel Macchiato",
          quantity: 1,
          sizeName: "Regular",
          addonNames: [],
          unitPrice: 1390,
          lineTotal: 1390,
          status: "pending",
        },
      ],
      subtotal: 2380,
      total: 2380,
    },
    {
      token: "seed-1020",
      orderNumber: "NAISE-001020",
      status: "completed",
      paymentMethod: "Cash",
      createdAt: minutesAgo(24),
      completedAt: minutesAgo(18),
      items: [
        {
          name: "Matcha Latte",
          quantity: 2,
          sizeName: "Large",
          addonNames: ["Oat Milk"],
          unitPrice: 1690,
          lineTotal: 3380,
          status: "done",
        },
      ],
      subtotal: 3380,
      total: 3380,
    },
  ];

  for (const order of seeds) orders.set(order.token, order);

  return { orders, lastSequence: 1023 };
}
