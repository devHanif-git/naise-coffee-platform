import { formatPrice } from "@/lib/format";
import type { Order } from "@/types/order";

// Builds the plain-text message posted to the team's Telegram group. Kept
// simple and readable so handoff stays systematic; the manage link is the
// entry point to full order detail.
//
// When the manage link is delivered as a tappable inline button (production),
// pass includeLink=false to keep the body clean. Locally, where Telegram
// rejects localhost button URLs, pass true to fall back to a raw-text link.
export function buildOrderMessage(
  order: Order,
  manageUrl: string,
  includeLink = true,
): string {
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

  if (includeLink) {
    parts.push("", "🔗 Manage Order:", manageUrl);
  }

  return parts.join("\n");
}
