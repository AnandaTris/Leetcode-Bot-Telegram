import { botToken, groupChatId, webhookSecret } from "@/lib/config";
import { storeConfigured, storeHealth } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Registers the Telegram webhook using the deployment's own environment.
 *
 * Vercel stores Secret-type variables write-only: TELEGRAM_WEBHOOK_SECRET can
 * never be read back, so the webhook cannot be registered from a laptop. The
 * server can do it, because it holds both values already.
 */

/**
 * Browser-friendly registration. Deliberately unauthenticated: it takes no
 * input, always points the webhook at this same deployment with this same
 * secret, and so is fully idempotent. A stranger calling it achieves exactly
 * what a correct call achieves, which is why there is nothing here to guard.
 */
export async function GET(request: Request) {
  return register(request, { dropPending: false });
}

/**
 * Same thing, authenticated with the bot token, for scripted use. Kept because
 * it also clears any queued updates, which is worth having but worth guarding.
 */
export async function POST(request: Request) {
  const provided = request.headers.get("x-bot-token") ?? "";
  if (!timingSafeEqual(provided, botToken())) {
    return Response.json({ error: "Bad bot token" }, { status: 401 });
  }
  return register(request, { dropPending: true });
}

async function register(request: Request, opts: { dropPending: boolean }) {
  try {
    const origin = new URL(request.url).origin;
    const webhookUrl = `${origin}/api/telegram`;

    await telegram("setWebhook", {
      url: webhookUrl,
      secret_token: webhookSecret() ?? undefined,
      // my_chat_member lets the bot announce a group's ID the moment it joins,
      // which is delivered even under group privacy mode.
      allowed_updates: ["message", "callback_query", "my_chat_member"],
      drop_pending_updates: opts.dropPending,
    });

    await telegram("setMyCommands", {
      commands: [
        { command: "today", description: "Today's LeetCode daily problem" },
        { command: "leaderboard", description: "Standings and streaks" },
        { command: "me", description: "Your own stats" },
        { command: "join", description: "Start being counted (and roasted)" },
        { command: "leave", description: "Stop being counted" },
        { command: "here", description: "Post the daily problem in this topic" },
        { command: "chatid", description: "Show this chat's ID" },
        { command: "help", description: "What this bot does" },
      ],
    });

    const me = await telegram<{ username: string }>("getMe", {});
    const info = await telegram<{ url: string }>("getWebhookInfo", {});

    return Response.json({
      ok: true,
      bot: `@${me.username}`,
      webhook: info.url,
      secretConfigured: Boolean(webhookSecret()),
      group: await describeGroup(),
      store: storeConfigured() ? await storeHealth() : { ok: false as const, error: "not configured" },
    });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

async function telegram<T = unknown>(method: string, payload: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
  return json.result as T;
}

/** Constant-time compare so the token can't be recovered by timing the endpoint. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Proves the stored TELEGRAM_GROUP_CHAT_ID is real and reachable without
 * posting anything into the group. Secret-type variables can't be read back
 * from Vercel, so this round trip is the only way to confirm the value landed
 * intact — a swallowed minus sign would otherwise go unnoticed until 08:05.
 */
async function describeGroup() {
  const id = groupChatId();
  if (!id) return { configured: false as const };

  try {
    const chat = await telegram<{ id: number; type: string; title?: string }>("getChat", {
      chat_id: id,
    });
    const admins = await telegram<Array<{ user: { username?: string } }>>(
      "getChatAdministrators",
      { chat_id: id },
    ).catch(() => []);
    const me = await telegram<{ username: string }>("getMe", {});

    return {
      configured: true as const,
      reachable: true as const,
      title: chat.title ?? null,
      type: chat.type,
      botIsAdmin: admins.some((entry) => entry.user?.username === me.username),
    };
  } catch (error) {
    return {
      configured: true as const,
      reachable: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
