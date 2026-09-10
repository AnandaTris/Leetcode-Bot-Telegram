import type { DailyChallenge } from "./leetcode";
import { escapeHtml, type InlineKeyboard } from "./telegram";
import type { LeaderboardRow } from "./store";

const DIFFICULTY_EMOJI: Record<string, string> = {
  Easy: "🟢",
  Medium: "🟡",
  Hard: "🔴",
};

function humanDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** The problem block that both the personal and group messages are built from. */
function problemBlock(daily: DailyChallenge): string {
  const emoji = DIFFICULTY_EMOJI[daily.difficulty] ?? "⚪️";
  const lines = [
    `<b>${escapeHtml(daily.id)}. ${escapeHtml(daily.title)}</b>`,
    `${emoji} ${escapeHtml(daily.difficulty)} · ${daily.acRate.toFixed(1)}% acceptance`,
  ];
  if (daily.topics.length) {
    lines.push(`🏷 ${daily.topics.map((t) => escapeHtml(t)).join(", ")}`);
  }
  if (daily.isPaidOnly) {
    lines.push("🔒 Premium-only today");
  }
  lines.push("", `🔗 ${escapeHtml(daily.url)}`);
  return lines.join("\n");
}

/** The message Ado gets in his own chat every morning. */
export function personalReminder(daily: DailyChallenge): string {
  return [
    `⏰ <b>LeetCode Daily</b> — ${escapeHtml(humanDate(daily.date))}`,
    "",
    problemBlock(daily),
    "",
    "<i>One problem. Do it before anything else.</i>",
  ].join("\n");
}

/** The message that gets posted into the group. */
export function groupReminder(daily: DailyChallenge): string {
  return [
    `⏰ <b>LeetCode Daily</b> — ${escapeHtml(humanDate(daily.date))}`,
    "",
    problemBlock(daily),
    "",
    "<i>Drop your solution in the thread when you're done 👇</i>",
  ].join("\n");
}

export function keyboard(daily: DailyChallenge, opts: { withGroupButton: boolean }): InlineKeyboard {
  const rows: InlineKeyboard["inline_keyboard"] = [
    [{ text: "Open on LeetCode ↗", url: daily.url }],
  ];
  if (opts.withGroupButton) {
    rows.push([{ text: "📣 Send to group", callback_data: "post_group" }]);
  }
  return { inline_keyboard: rows };
}

/** Keyboard shown after the reminder has been forwarded, so the tap isn't repeatable by accident. */
export function postedKeyboard(daily: DailyChallenge): InlineKeyboard {
  return {
    inline_keyboard: [
      [{ text: "Open on LeetCode ↗", url: daily.url }],
      [{ text: "✅ Sent to group", callback_data: "noop" }],
    ],
  };
}

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Submission time on the group's clock. The day key is UTC because that is
 * LeetCode's rotation, but nobody reading the board thinks in UTC.
 */
function solveTime(epochMs: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Singapore",
  }).format(new Date(epochMs));
}

/**
 * One line per person: rank, today's status, all-time total, live streak, and
 * the time they posted.
 *
 * The time is shown because it is what breaks ties. Without it the board
 * reorders for reasons nobody can see, which reads as a bug rather than a race.
 */
function standings(rows: LeaderboardRow[]): string[] {
  return rows.map((row, index) => {
    const rank = MEDALS[index] ?? `<b>${index + 1}.</b>`;
    const mark = row.solvedToday ? "✅" : "❌";
    const streak = row.streak > 0 ? ` · 🔥${row.streak}` : "";
    const at = row.solvedAt !== null ? ` · ${solveTime(row.solvedAt)}` : "";
    return `${rank} ${mark} ${escapeHtml(row.name)} — <b>${row.total}</b>${streak}${at}`;
  });
}

const EMPTY_BOARD = [
  "🏆 <b>LeetCode Leaderboard</b>",
  "",
  "Nobody's on the board yet.",
  "",
  "<i>Just paste your code in the chat after you solve \u2014 no formatting needed. Or send /join to be counted.</i>",
].join("\n");

export function leaderboardMessage(rows: LeaderboardRow[], day: string): string {
  if (!rows.length) return EMPTY_BOARD;

  const done = rows.filter((row) => row.solvedToday).length;
  return [
    "🏆 <b>LeetCode Leaderboard</b>",
    `${escapeHtml(humanDate(day))} · <b>${done}/${rows.length}</b> done today`,
    "",
    ...standings(rows),
    "",
    "<i>✅ solved today · 🔥 current streak · number = all-time solves · time posted (SGT) breaks ties</i>",
  ].join("\n");
}

/**
 * Roast lines, one of which is chosen per day. Keyed off the date so the same
 * day always gets the same line but consecutive days don't repeat.
 */
const ROASTS = [
  "{names} — the array stays unsorted. Disappointing.",
  "{names} chose violence against their own streak today.",
  "Somewhere a recruiter just closed the tab on {names}.",
  "{names}: Time Limit Exceeded. On the entire day.",
  "Complexity analysis for {names} today: O(0).",
  "{names} left the daily on read.",
  "Streaks reset to zero for {names}. Like the commitment.",
  "{names} — segmentation fault (streak dumped).",
  "Tomorrow's is harder, {names}. Just so you know.",
  "{names} skipped it. It was <i>right there</i>.",
];

function pickRoast(day: string, names: string): string {
  // Cheap deterministic hash of the date, so the line is stable within a day.
  let hash = 0;
  for (const char of day) hash = (hash * 31 + char.charCodeAt(0)) % 100000;
  return ROASTS[hash % ROASTS.length].replace("{names}", names);
}

/** The end-of-day recap: who showed up, who didn't, and the standings. */
export function roastMessage(rows: LeaderboardRow[], day: string): string {
  const header = `🌙 <b>Day's up</b> — ${escapeHtml(humanDate(day))}`;
  if (!rows.length) return [header, "", "Nobody is being tracked yet, so nobody gets roasted. Send /join."].join("\n");

  const solved = rows.filter((row) => row.solvedToday);
  const missed = rows.filter((row) => !row.solvedToday);
  const list = (subset: LeaderboardRow[]) =>
    subset.map((row) => escapeHtml(row.name)).join(", ");

  const verdict = !missed.length
    ? "🎉 Everyone showed up. Nobody to roast today."
    : !solved.length
      ? "💀 A clean sweep of nothing. Every single one of you."
      : pickRoast(day, list(missed));

  const lines = [header, ""];
  if (solved.length) lines.push(`✅ <b>Solved:</b> ${list(solved)}`);
  if (missed.length) lines.push(`❌ <b>Didn't:</b> ${list(missed)}`);
  lines.push("", verdict, "", ...standings(rows));
  return lines.join("\n");
}

/** Personal stats, for /me. */
export function statsMessage(row: LeaderboardRow | null, day: string): string {
  if (!row) {
    return "You're not on the board yet. Send /join, or just paste your code in the group after you solve.";
  }
  return [
    `📊 <b>${escapeHtml(row.name)}</b> — ${escapeHtml(humanDate(day))}`,
    "",
    `Today: ${row.solvedToday ? "✅ done" : "❌ not yet"}`,
    `All-time: <b>${row.total}</b> solves`,
    `Streak: 🔥 ${row.streak} (best ${row.best})`,
  ].join("\n");
}
