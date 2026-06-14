// Server-only Telegram helper. Never import this into a client component — it
// reads the bot token from a server-only env var.

const TELEGRAM_API = "https://api.telegram.org";

// A single tappable button that opens a URL. Telegram lays these out as an
// inline keyboard attached beneath the message.
export type TelegramUrlButton = { text: string; url: string };

type SendOptions = {
  // Rows of URL buttons rendered as an inline keyboard under the message.
  buttons?: TelegramUrlButton[][];
};

// Sends a plain-text message to the configured group/chat. Throws if Telegram
// is not configured or the API rejects the request, so callers can surface a
// useful error to the customer.
export async function sendTelegramMessage(
  text: string,
  options: SendOptions = {},
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error(
      "Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.",
    );
  }

  const res = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      // Plain text for now; keep the manage link as a tappable preview.
      disable_web_page_preview: false,
      ...(options.buttons?.length
        ? { reply_markup: { inline_keyboard: options.buttons } }
        : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage failed (${res.status}): ${detail}`);
  }
}
