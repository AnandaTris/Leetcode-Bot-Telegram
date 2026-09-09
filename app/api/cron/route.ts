import { cronSecret, groupChatId, groupTopicId, ownerChatId } from "@/lib/config";
import { fetchDailyChallenge } from "@/lib/leetcode";
import { groupReminder, keyboard, personalReminder } from "@/lib/message";
import { getPostTarget } from "@/lib/store";
import { escapeHtml, sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Fired once a day by the Vercel cron in vercel.json. Sends the daily problem
 * to Ado's own chat, with a button to forward it into the group.
 */
export async function GET(request: Request) {
  const secret = cronSecret();
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const daily = await fetchDailyChallenge();

    // A /here pin wins over the configured group, so the destination can be
    // moved from inside Telegram without a redeploy.
    const pinned = await getPostTarget();
    const group = pinned?.chatId ?? groupChatId();
    const thread = pinned ? pinned.topicId : groupTopicId();

    // The group gets it automatically, so the personal copy no longer needs a
    // "send to group" button — that button only makes sense for manual /today.
    await sendMessage(ownerChatId(), personalReminder(daily), {
      replyMarkup: keyboard(daily, { withGroupButton: false }),
    });

    if (group) {
      await sendMessage(group, groupReminder(daily), {
        replyMarkup: keyboard(daily, { withGroupButton: false }),
        messageThreadId: thread,
      });
    }

    return Response.json({
      ok: true,
      date: daily.date,
      problem: daily.title,
      sentToGroup: Boolean(group),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("daily cron failed:", message);
    // Best effort: tell Ado the reminder broke rather than failing silently.
    try {
      await sendMessage(
        ownerChatId(),
        `⚠️ Couldn't fetch today's LeetCode daily.\n\n<code>${escapeHtml(message)}</code>`,
      );
    } catch {
      // Telegram is down too — nothing left to do but log.
    }
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
