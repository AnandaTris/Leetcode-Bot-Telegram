/**
 * All configuration comes from environment variables. Nothing is persisted:
 * the bot is stateless, which is why it needs no database.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

/** Token from @BotFather. */
export function botToken(): string {
  return required("TELEGRAM_BOT_TOKEN");
}

/** Ado's own chat with the bot — where the daily reminder lands. */
export function ownerChatId(): string {
  return required("TELEGRAM_CHAT_ID");
}

/** Optional group the reminder can be forwarded into with one tap. */
export function groupChatId(): string | null {
  return process.env.TELEGRAM_GROUP_CHAT_ID?.trim() || null;
}

/**
 * Forum topic within the group to post into. Only meaningful when the group has
 * Topics enabled; without it every scheduled post lands in "General".
 */
export function groupTopicId(): number | null {
  const raw = process.env.TELEGRAM_GROUP_TOPIC_ID?.trim();
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Shared secret echoed by Telegram in X-Telegram-Bot-Api-Secret-Token.
 * Set it when registering the webhook so nobody else can post fake updates.
 */
export function webhookSecret(): string | null {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}

/** Vercel sends `Authorization: Bearer $CRON_SECRET` on scheduled invocations. */
export function cronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}

/** Chats allowed to issue commands. Everyone else is ignored. */
export function allowedChatIds(): Set<string> {
  const ids = new Set<string>([ownerChatId()]);
  const group = groupChatId();
  if (group) ids.add(group);
  return ids;
}
