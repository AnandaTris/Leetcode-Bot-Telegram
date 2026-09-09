import { cronSecret, groupChatId, groupTopicId, ownerChatId } from "@/lib/config";
import { roastMessage } from "@/lib/message";
import { getPostTarget, leaderboard, storeConfigured, today } from "@/lib/store";
import { sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * The 23:00 SGT reckoning (15:00 UTC in vercel.json). Posts the day's standings
 * and roasts whoever didn't paste a solution.
 *
 * The day key is the UTC date, which is the same window LeetCode uses: the
 * problem drops at 00:00 UTC / 08:00 SGT, and this fires 15 hours later on the
 * same UTC date. Nobody gets roasted for a problem they haven't seen.
 */
export async function GET(request: Request) {
  const secret = cronSecret();
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!storeConfigured()) {
    return Response.json({ ok: false, error: "No leaderboard store configured" }, { status: 503 });
  }

  try {
    const day = today();
    const rows = await leaderboard(day);

    // Nothing to say if nobody has ever been tracked — better silence than a
    // nightly message to an empty board.
    if (!rows.length) {
      return Response.json({ ok: true, day, skipped: "no participants" });
    }

    // Falls back to Ado's own chat so the recap isn't lost before the group is
    // wired up.
    const pinned = await getPostTarget();
    const group = pinned?.chatId ?? groupChatId();
    const target = group ?? ownerChatId();
    await sendMessage(target, roastMessage(rows, day), {
      // Only thread it when posting to the group; a DM has no topics.
      messageThreadId: group ? (pinned ? pinned.topicId : groupTopicId()) : null,
    });

    return Response.json({
      ok: true,
      day,
      participants: rows.length,
      solved: rows.filter((row) => row.solvedToday).length,
      sentToGroup: Boolean(group),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("roast cron failed:", message);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
