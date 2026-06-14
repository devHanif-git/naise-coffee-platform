import { formatPrice } from "@/lib/format";
import type { Order } from "@/types/order";

// Builds the plain-text message posted to the team's Telegram group. Kept
// simple and readable so handoff stays systematic; the manage link is the
// entry point to full order detail.
export function buildOrderMessage(order: Order, manageUrl: string): string {
  const itemLines = order.items.map((item) => {
    const options = [item.sizeName, ...item.addonNames]
      .filter(Boolean)
      .join(", ");
    const label = options ? `${item.name} (${options})` : item.name;
    return `• ${item.quantity}x ${label} — ${formatPrice(item.lineTotal)}`;
  });

  const parts = [
    "NEW ORDER!",
    "",
    `Order: ${order.orderNumber}`,
    `Payment: ${order.paymentMethod}`,
    "",
    "Items:",
    ...itemLines,
    "",
    `Total: ${formatPrice(order.total)}`,
  ];

  if (order.notes?.trim()) {
    parts.push("", `Note: ${order.notes.trim()}`);
  }

  // Remove the <a> tags and just put the raw URL on its own line
  parts.push("", `🔗 Manage Order:`);
  parts.push(manageUrl);

  return parts.join("\n");
}
