// An order as it is tracked by the store. Prices are in sen (1 MYR = 100 sen),
// matching the cart. The `token` is an unguessable id used in the management
// link sent to the team; the `orderNumber` is the human-facing reference.
export type OrderStatus =
  | "pending"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

// Per-drink fulfilment status. A barista works each line through
// pending -> preparing -> done; when every line is done the order is complete.
export type ItemStatus = "pending" | "preparing" | "done";

export type OrderLine = {
  name: string;
  quantity: number;
  sizeName?: string;
  addonNames: string[];
  // Per-unit price in sen.
  unitPrice: number;
  // unitPrice * quantity, in sen.
  lineTotal: number;
  // Fulfilment progress for this drink. New lines start "pending".
  status: ItemStatus;
  // Set when this line was added by redeeming a Beans reward. The base drink is
  // free; `rewardCost` is the Bean price, settled server-side at placement.
  isReward?: boolean;
  rewardCost?: number;
  // True when this line is an admin-entered custom drink (no menu product).
  // Maps to order_items.is_custom; drives the "Custom" badge and custom-drink
  // analytics.
  isCustom?: boolean;
  // Links order item back to menu product for live recipe lookup on the manage
  // page. null for custom drinks (no product).
  productId?: string | null;
  // Set when staff voided this drink on the manage screen: it stays on the order
  // for history but is struck through, excluded from the bill, and ignored by the
  // "all drinks done" check. ISO timestamp. Maps to order_items.voided_at.
  voidedAt?: string;
};

// A staff amendment to an order: a single drink voided or swapped for another.
// Drives the running list of price differences shown above the order total.
// `delta` is in sen — positive when the customer owes more, negative for a
// refund/cheaper swap. Maps to a public.order_adjustments row.
export type OrderAdjustment = {
  itemPosition: number;
  kind: "void" | "swap";
  // The drink as it was, e.g. "Latte (Large, Oat Milk)".
  fromLabel: string;
  // The replacement drink for a swap; absent for a void.
  toLabel?: string;
  delta: number;
  createdAt: string;
};

export type Order = {
  // Random uuid; also the lookup key and the path segment in the manage link.
  token: string;
  // Human reference, e.g. NAISE-000001.
  orderNumber: string;
  // The browser/account that placed this order. Stable id from
  // `lib/auth/owner-id` — same value for a guest and the member they later
  // become, so guest orders carry over to the new account on sign-up. Maps
  // onto `orders.user_id` (auth.uid()) in Supabase later.
  ownerId: string;
  // The signed-in member who placed this order, if any (absent for guests).
  // Maps to orders.user_id; used for server-side ownership checks.
  userId?: string;
  status: OrderStatus;
  paymentMethod: string;
  items: OrderLine[];
  // Pre-discount total, in sen.
  subtotal: number;
  // Amount due, in sen.
  total: number;
  notes?: string;
  // Receipt image for a QR/transfer payment, shown in the manage screen's
  // proof-of-payment section. Absent for cash and other on-counter methods.
  proofOfPaymentUrl?: string;
  // Unverified MY mobile (+60…) collected at checkout from the member or guest.
  // Used for the WhatsApp-ready handoff and the staff "NEW ORDER!" notice.
  // Absent when the customer skipped the prompt. Maps to orders.contact_phone.
  contactPhone?: string;
  // ISO timestamp.
  createdAt: string;
  // ISO timestamp set when every drink is done and the order flips to
  // completed; cleared if a drink is re-opened. Absent until then. Maps to
  // orders.completed_at in Supabase later.
  completedAt?: string;
  // Channel the order came from. Defaults to "online" for the storefront; the
  // in-store kiosk sets "store". Maps to orders.source.
  source?: "online" | "store" | "custom";
  // Staff amendments (voids/swaps) to this order, newest last. Populated on the
  // manage read path; absent elsewhere. Drives the amendments panel + recalced total.
  adjustments?: OrderAdjustment[];
};

// The fields a caller supplies when placing an order. The store fills in the
// token, order number, status, and timestamps.
export type OrderDraft = Omit<
  Order,
  "token" | "orderNumber" | "status" | "createdAt" | "completedAt"
>;
