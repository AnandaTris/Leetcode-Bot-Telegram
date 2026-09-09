import { fetchDailyChallenge } from "@/lib/leetcode";
import { groupReminder, personalReminder } from "@/lib/message";

export const dynamic = "force-dynamic";

/**
 * Renders both message variants without sending anything, so formatting can be
 * checked without spamming the chat. Only exposes public LeetCode data.
 */
export async function GET() {
  const daily = await fetchDailyChallenge();
  return Response.json({
    challenge: daily,
    personal: personalReminder(daily),
    group: groupReminder(daily),
  });
}
