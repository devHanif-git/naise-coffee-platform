// An order as it is tracked by the store. Prices are in sen (1 MYR = 100 sen),
// matching the cart. The `token` is an unguessable id used in the management
// link sent to the team; the `orderNumber` is the human-facing reference.
export type OrderStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

export type OrderLine = {
  name: string;
  quantity: number;
  sizeName?: string;
  addonNames: string[];
  // Per-unit price in sen.
  unitPrice: number;
  // unitPrice * quantity, in sen.
  lineTotal: number;
};

export type Order = {
  // Random uuid; also the lookup key and the path segment in the manage link.
  token: string;
  // Human reference, e.g. NAISE-000001.
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: string;
  items: OrderLine[];
  // Pre-discount total, in sen.
  subtotal: number;
  // Amount due, in sen.
  total: number;
  notes?: string;
  // ISO timestamp.
  createdAt: string;
};

// The fields a caller supplies when placing an order. The store fills in the
// token, order number, status, and timestamp.
export type OrderDraft = Omit<
  Order,
  "token" | "orderNumber" | "status" | "createdAt"
>;
