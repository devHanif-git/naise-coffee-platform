import { formatPrice } from "@/lib/format";
import { toWaMeDigits } from "@/lib/phone";
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
  ];

  if (order.contactPhone) {
    parts.push(`Contact: ${order.contactPhone}`);
  }

  parts.push(
    "",
    "Items:",
    ...itemLines,
    "",
    `Total: ${formatPrice(order.total)}`,
  );

  if (order.notes?.trim()) {
    parts.push("", `Note: ${order.notes.trim()}`);
  }

  if (includeLink) {
    parts.push("", "🔗 Manage Order:", manageUrl);
  }

  return parts.join("\n");
}

// Buyer-facing pickup notice, sent when staff confirm the order is complete.
// Distinct from the staff "NEW ORDER!" format — this reads like a message to
// the customer. Sent to the same Telegram group for now.
export function buildOrderReadyMessage(order: Order): string {
  const itemLines = order.items.map((item) => {
    const options = [item.sizeName, ...item.addonNames]
      .filter(Boolean)
      .join(", ");
    const label = options ? `${item.name} (${options})` : item.name;
    return `• ${item.quantity}x ${label}`;
  });

  const parts = [
    "Your drink is ready!",
    "",
    `Order ${order.orderNumber} is ready for pickup.`,
    "",
    "Items:",
    ...itemLines,
    "",
    "Thank you for ordering with NAISE Coffee — see you at the counter!",
  ];

  return parts.join("\n");
}

// Builds a wa.me deep link that opens WhatsApp at the customer's chat with the
// "ready" notice pre-filled. Staff tap it and press send by hand (no API). Reuses
// buildOrderReadyMessage so the wording lives in one place. Returns null when the
// order has no contact number (caller falls back to the Telegram notice).
export function buildWhatsAppReadyLink(order: Order): string | null {
  if (!order.contactPhone) return null;
  const digits = toWaMeDigits(order.contactPhone);
  const text = encodeURIComponent(buildOrderReadyMessage(order));
  return `https://wa.me/${digits}?text=${text}`;
}
