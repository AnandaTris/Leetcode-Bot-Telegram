#!/usr/bin/env node
/**
 * Point the Telegram bot at the deployed webhook and register its command list.
 *
 *   TELEGRAM_BOT_TOKEN=... WEBHOOK_URL=https://your-app.vercel.app \
 *   TELEGRAM_WEBHOOK_SECRET=... npm run set-webhook
 *
 * Pass `--info` to just print the current webhook status instead of changing it.
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

async function api(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

if (process.argv.includes("--info")) {
  console.log(JSON.stringify(await api("getWebhookInfo"), null, 2));
  process.exit(0);
}

const DEFAULT_URL = "https://leetcode-daily-bot.vercel.app";

const base = (process.env.WEBHOOK_URL ?? process.argv[2] ?? DEFAULT_URL).replace(/\/+$/, "");

const url = `${base}/api/telegram`;
await api("setWebhook", {
  url,
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
  allowed_updates: ["message", "callback_query", "my_chat_member"],
  drop_pending_updates: true,
});
console.log(`✅ Webhook set to ${url}`);

await api("setMyCommands", {
  commands: [
    { command: "today", description: "Today's LeetCode daily problem" },
    { command: "chatid", description: "Show this chat's ID" },
    { command: "help", description: "What this bot does" },
  ],
});
console.log("✅ Command list registered");

const me = await api("getMe");
console.log(`✅ Live as @${me.username}`);
