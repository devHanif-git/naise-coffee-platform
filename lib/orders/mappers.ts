import type { Tables } from "@/types/database";
import type { Order, OrderLine } from "@/types/order";

export type OrderRow = Tables<"orders">;
export type OrderItemRow = Tables<"order_items">;

// Maps one order_items row to the domain OrderLine. addon_names is never null
// (DB default '{}'), but guard anyway.
export function rowToOrderLine(item: OrderItemRow): OrderLine {
  return {
    name: item.name,
    quantity: item.quantity,
    sizeName: item.size_name ?? undefined,
    addonNames: item.addon_names ?? [],
    unitPrice: item.unit_price,
    lineTotal: item.line_total,
    status: item.status,
    isCustom: item.is_custom,
    productId: item.product_id ?? undefined,
  };
}

// Maps an orders row + its item rows to the domain Order. Items are sorted by
// position so the manage screen's itemIndex matches the DB `position`.
export function rowToOrder(order: OrderRow, items: OrderItemRow[]): Order {
  const lines = [...items]
    .sort((a, b) => a.position - b.position)
    .map(rowToOrderLine);
  return {
    token: order.token,
    orderNumber: order.order_number!,
    ownerId: order.owner_id,
    userId: order.user_id ?? undefined,
    status: order.status,
    paymentMethod: order.payment_method,
    items: lines,
    subtotal: order.subtotal,
    total: order.total,
    notes: order.notes ?? undefined,
    contactPhone: order.contact_phone ?? undefined,
    proofOfPaymentUrl: order.proof_of_payment_url ?? undefined,
    createdAt: order.created_at,
    completedAt: order.completed_at ?? undefined,
    source: order.source,
  };
}
