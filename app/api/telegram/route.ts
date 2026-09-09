import { allowedChatIds, groupChatId, groupTopicId, webhookSecret } from "@/lib/config";
import { fetchDailyChallenge } from "@/lib/leetcode";
import {
  groupReminder,
  keyboard,
  leaderboardMessage,
  personalReminder,
  postedKeyboard,
  statsMessage,
} from "@/lib/message";
import { displayName, looksLikeSolution, type MessageEntity } from "@/lib/proof";
import {
  clearPostTarget,
  leaderboard,
  recordSolve,
  registerParticipant,
  removeParticipant,
  setPostTarget,
  statsFor,
  storeConfigured,
  today,
} from "@/lib/store";
import {
  answerCallbackQuery,
  editMessageReplyMarkup,
  escapeHtml,
  type InlineKeyboard,
  react,
  sendMessage,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  text?: string;
  entities?: MessageEntity[];
  // A paste sent alongside an image arrives as a caption, not text — a common
  // way for solutions to show up from a phone.
  caption?: string;
  caption_entities?: MessageEntity[];
  // Forum topic this message sits in. Present only in groups with Topics on.
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: TelegramUser;
  chat: { id: number; type: string; title?: string };
};

type ChatMemberUpdate = {
  chat: { id: number; type: string; title?: string };
  old_chat_member?: { status: string };
  new_chat_member?: { status: string };
};

type TelegramUpdate = {
  message?: TelegramMessage;
  my_chat_member?: ChatMemberUpdate;
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};

const HELP = [
  "🤖 <b>LeetCode Daily Bot</b>",
  "",
  "The daily problem lands in the group at <b>08:00 SGT</b>, the moment LeetCode rotates it.",
  "<b>Just paste your code</b> in the chat when you're done — no formatting needed, I'll spot it and react \u{1F525}. At <b>23:00 SGT</b> I post the standings and roast whoever skipped.",
  "",
  "/today — today's problem",
  "/leaderboard — standings and streaks",
  "/me — your own stats",
  "/join — start being counted (and roasted)",
  "/leave — stop being counted",
  "/here — post the daily problem in this topic",
  "/chatid — this chat's ID",
  "/help — this message",
].join("\n");

const NO_STORE = "The leaderboard store isn't connected yet — tell Ado to finish the Upstash setup.";

/** Streak lengths worth interrupting the group for. */
const MILESTONES = new Set([3, 7, 14, 30, 50, 100, 365]);

export async function POST(request: Request) {
  const secret = webhookSecret();
  if (secret && request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    if (update.my_chat_member) {
      await handleMyChatMember(update.my_chat_member);
    } else if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
  } catch (error) {
    // Always 200 back to Telegram: a non-2xx makes it retry the same update
    // for hours, which would spam the chat once the bot recovers.
    console.error("webhook error:", error);
  }

  return Response.json({ ok: true });
}

async function handleMessage(message: TelegramMessage) {
  const chatId = String(message.chat.id);
  const text = message.text ?? "";
  // Strip the @botname suffix Telegram appends to commands used in groups.
  const command = text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();

  const isGroupChat = message.chat.type === "group" || message.chat.type === "supergroup";
  const configured = groupChatId();

  // Answer in the topic the question was asked in. Without this every reply
  // lands in "General" no matter which topic you are looking at, which is the
  // single most confusing thing a bot can do in a forum group.
  const topic = topicOf(message);
  const reply = (text: string, options: { replyMarkup?: InlineKeyboard } = {}) =>
    sendMessage(chatId, text, { ...options, messageThreadId: topic });

  // Always available, from any chat: it's how you discover a new group's ID,
  // and it leaks nothing the caller doesn't already know. It spells out which
  // kind of chat you're in, because a private ID and a group ID look similar
  // enough to copy the wrong one.
  if (command === "/chatid") {
    await reply(chatIdReply(chatId, isGroupChat, message.chat.title, topic));
    return;
  }

  // Before TELEGRAM_GROUP_CHAT_ID is set, trust any group the bot was added to,
  // so the leaderboard works from the very first message. Once it is set, only
  // that group can write to the store.
  const isTrackedGroup = isGroupChat && (!configured || configured === chatId);

  if (isTrackedGroup && !command.startsWith("/")) {
    await maybeCreditSolve(message);
    return;
  }

  if (!isTrackedGroup && !allowedChatIds().has(chatId)) return;

  switch (command) {
    case "/start":
    case "/help":
      await reply(HELP);
      return;

    case "/today": {
      const daily = await fetchDailyChallenge();
      await reply(isGroupChat ? groupReminder(daily) : personalReminder(daily), {
        replyMarkup: keyboard(daily, { withGroupButton: !isGroupChat && Boolean(configured) }),
      });
      return;
    }

    case "/leaderboard":
    case "/lb": {
      if (!storeConfigured()) {
        await reply(NO_STORE);
        return;
      }
      const day = today();
      await reply(leaderboardMessage(await leaderboard(day), day));
      return;
    }

    case "/me": {
      if (!message.from) return;
      if (!storeConfigured()) {
        await reply(NO_STORE);
        return;
      }
      const day = today();
      await reply(statsMessage(await statsFor(String(message.from.id), day), day));
      return;
    }

    case "/here": {
      if (!isGroupChat) {
        await reply("Send this inside the group topic you want the bot to post in.");
        return;
      }
      if (!storeConfigured()) {
        await reply(NO_STORE);
        return;
      }
      await setPostTarget({ chatId, topicId: topic });
      await reply(
        topic
          ? "📌 <b>Locked to this topic.</b> The 08:00 problem and the 23:00 roast will land right here."
          : "📌 <b>Locked to this chat.</b> Posts will land in <b>General</b> — send /here inside a topic to pin it there instead.",
      );
      return;
    }

    case "/unpin": {
      if (!storeConfigured()) {
        await reply(NO_STORE);
        return;
      }
      await clearPostTarget();
      await reply("Unpinned. Falling back to the configured group.");
      return;
    }

    case "/join": {
      if (!message.from) return;
      if (!storeConfigured()) {
        await reply(NO_STORE);
        return;
      }
      const name = displayName(message.from);
      await registerParticipant({ id: String(message.from.id), name });
      await reply(
        `✅ <b>${escapeHtml(name)}</b> is in. Paste your code each day, or get roasted at 23:00.`,
      );
      return;
    }

    case "/leave": {
      if (!message.from) return;
      if (!storeConfigured()) {
        await reply(NO_STORE);
        return;
      }
      const removed = await removeParticipant(String(message.from.id));
      await reply(
        removed
          ? "👋 Off the roast list. Your solve history is kept."
          : "You weren't on the list anyway.",
      );
      return;
    }

    default:
      return;
  }
}

/**
 * Any code posted in the group counts as that day's proof — the rule Ado
 * picked. Stays silent unless it actually banks a new solve, so ordinary
 * chatter and repeat pastes make no noise.
 */
async function maybeCreditSolve(message: TelegramMessage) {
  const from = message.from;
  if (!from || from.is_bot) return;

  const body = message.text ?? message.caption ?? "";
  const marks = message.entities ?? message.caption_entities;
  if (!looksLikeSolution(body, marks)) return;
  if (!storeConfigured()) return;

  const name = displayName(from);
  const result = await recordSolve({ id: String(from.id), name }, today());
  if (!result) return; // already counted today

  const chatId = String(message.chat.id);
  await react(chatId, message.message_id, "🔥");

  if (MILESTONES.has(result.streak)) {
    await sendMessage(
      chatId,
      `🔥 <b>${escapeHtml(name)}</b> is on a <b>${result.streak}-day</b> streak. Say something nice.`,
      { messageThreadId: topicOf(message) },
    );
  }
}

async function handleCallback(query: NonNullable<TelegramUpdate["callback_query"]>) {
  if (query.data === "noop") {
    await answerCallbackQuery(query.id, "Already sent.");
    return;
  }
  if (query.data !== "post_group") return;

  const originChatId = query.message ? String(query.message.chat.id) : null;
  if (!originChatId || !allowedChatIds().has(originChatId)) {
    await answerCallbackQuery(query.id, "Not allowed.");
    return;
  }

  const group = groupChatId();
  if (!group) {
    await answerCallbackQuery(query.id, "No group is configured yet.", true);
    return;
  }

  const daily = await fetchDailyChallenge();
  await sendMessage(group, groupReminder(daily), {
    replyMarkup: keyboard(daily, { withGroupButton: false }),
    messageThreadId: groupTopicId(),
  });
  await answerCallbackQuery(query.id, "Posted to the group ✅");

  if (query.message) {
    await editMessageReplyMarkup(originChatId, query.message.message_id, postedKeyboard(daily));
  }
}

/**
 * The forum topic a message was posted in, or null in an ordinary group.
 *
 * Telegram sets message_thread_id on replies too, so is_topic_message is what
 * distinguishes "in a topic" from "replying to someone". Topic 1 is General,
 * which is also the default target, so it is treated as no topic at all.
 */
function topicOf(message: TelegramMessage): number | null {
  if (!message.is_topic_message) return null;
  const id = message.message_thread_id;
  return typeof id === "number" && id > 1 ? id : null;
}

/**
 * Told apart explicitly, because "paste the group ID" is easy to answer with a
 * private chat ID — they are both just long numbers.
 */
function chatIdReply(
  chatId: string,
  isGroupChat: boolean,
  title?: string,
  topic?: number | null,
): string {
  if (isGroupChat) {
    return [
      `👥 <b>Group ID</b>${title ? ` — ${escapeHtml(title)}` : ""}`,
      "",
      `<code>${escapeHtml(chatId)}</code>`,
      "",
      ...(topic
        ? [
            "🧵 <b>Topic ID</b> (this topic)",
            "",
            `<code>${topic}</code>`,
            "",
            "<i>Send Ado both numbers and the bot will post here instead of General.</i>",
          ]
        : [
            "<i>This is the one. Send it to Ado for TELEGRAM_GROUP_CHAT_ID.</i>",
            "",
            "<i>You're in General. To pin the bot to a specific topic, send /chatid inside that topic instead.</i>",
          ]),
    ].join("\n");
  }
  return [
    "👤 <b>Your private chat ID</b>",
    "",
    `<code>${escapeHtml(chatId)}</code>`,
    "",
    "<i>This is NOT the group ID — it's just you and me here. Add me to the group and send /chatid there instead. A group's ID is negative and usually starts with -100.</i>",
  ].join("\n");
}

/**
 * Fires when the bot's own membership changes — added to a group, or promoted.
 * It announces the group ID unprompted, because asking someone to run a slash
 * command just to read a number back is friction for no reason. Delivered even
 * in privacy mode, so it works before anything else is configured.
 */
async function handleMyChatMember(event: ChatMemberUpdate) {
  if (event.chat.type !== "group" && event.chat.type !== "supergroup") return;

  const inChat = (status?: string) => status === "member" || status === "administrator";
  const now = event.new_chat_member?.status;
  const before = event.old_chat_member?.status;
  if (!inChat(now)) return;

  const chatId = String(event.chat.id);
  const title = event.chat.title;
  const isAdmin = now === "administrator";

  const idBlock = [
    `\u{1F465} <b>Group ID</b>${title ? ` \u2014 ${escapeHtml(title)}` : ""}`,
    `<code>${escapeHtml(chatId)}</code>`,
    "",
    "<i>Ado: that's the value for TELEGRAM_GROUP_CHAT_ID.</i>",
  ];

  // Already a member and just promoted: only the admin news plus the ID again,
  // since the welcome has already been said.
  if (inChat(before)) {
    if (!isAdmin) return;
    await sendMessage(
      chatId,
      ["\u2705 <b>Admin now.</b> I can see the code you paste, so solves will count.", "", ...idBlock].join("\n"),
    );
    return;
  }

  const lines = [
    "\u{1F44B} <b>I'm in.</b>",
    "",
    ...idBlock,
    "",
    "Daily problem at <b>08:00 SGT</b> \u00b7 just paste your code to log it \u00b7 standings and roasting at <b>23:00 SGT</b>.",
  ];
  if (!isAdmin) {
    lines.push(
      "",
      "\u26a0\ufe0f I'm not an admin, so I can only see commands \u2014 not the code you paste. Promote me to admin (no permissions needed) and solves will start counting.",
    );
  }
  await sendMessage(chatId, lines.join("\n"));
}
