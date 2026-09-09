import { botToken } from "./config";

export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; url?: string; callback_data?: string }>>;
};

async function call<T = unknown>(method: string, payload: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) {
    throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
  }
  return json.result as T;
}

export function sendMessage(
  chatId: string | number,
  text: string,
  options: {
    replyMarkup?: InlineKeyboard;
    disablePreview?: boolean;
    /**
     * Forum topic to post into. Omitted, a message lands in "General" — which
     * is what happens by default in a group with Topics turned on, whether or
     * not that is where anyone is looking.
     */
    messageThreadId?: number | null;
  } = {},
) {
  return call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: options.disablePreview ?? true },
    reply_markup: options.replyMarkup,
    message_thread_id: options.messageThreadId ?? undefined,
  });
}

export function editMessageReplyMarkup(
  chatId: string | number,
  messageId: number,
  replyMarkup: InlineKeyboard,
) {
  return call("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

export function answerCallbackQuery(id: string, text: string, showAlert = false) {
  return call("answerCallbackQuery", { callback_query_id: id, text, show_alert: showAlert });
}

/** Telegram's HTML parse mode only needs these three escaped. */
export function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * React to a message with an emoji — how the bot acknowledges a solve without
 * adding a reply to every posted solution. Best effort: reactions can be
 * disabled per chat, and a failed 🔥 is not worth failing the request over.
 */
export async function react(
  chatId: string | number,
  messageId: number,
  emoji: string,
): Promise<boolean> {
  try {
    await call("setMessageReaction", {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: "emoji", emoji }],
    });
    return true;
  } catch (error) {
    console.warn("reaction failed:", error);
    return false;
  }
}
