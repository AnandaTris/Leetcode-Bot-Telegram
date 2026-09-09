/**
 * Deciding whether a group message counts as proof of a solve.
 *
 * The rule Ado picked: posting your code in the group that day counts. No
 * judging correctness, no LeetCode account linking — just show your work.
 *
 * Formatting is NOT required. Typing ``` on a phone keyboard is miserable, so
 * a plain paste of `class Solution` has to count exactly like a fenced block.
 * That makes this a content classifier, not a formatting check.
 *
 * It is deliberately biased toward saying yes. A false positive credits someone
 * who was going to be credited on the honour system anyway; a false negative
 * means someone who actually did the work gets publicly roasted at 23:00. Those
 * two errors are not remotely equal.
 */

export type MessageEntity = {
  type: string;
  offset: number;
  length: number;
};

/** Inline `code` this short is almost always a word, not a solution. */
const MIN_INLINE_CODE = 30;

/** A literal ``` fence, for clients that send raw markdown instead of entities. */
const FENCE = /```[\s\S]{20,}?```/;

/**
 * Unmistakable declarations. One of these is enough on its own — no line count,
 * no corroboration. Nobody types `class Solution` in conversation.
 */
const DECLARATIONS: RegExp[] = [
  // The LeetCode boilerplate itself, in every language that uses it.
  /\bclass\s+Solution\b/,
  // Python: def two_sum(self, nums): — the colon is what makes it a definition.
  /\bdef\s+\w+\s*\([^)]*\)\s*(->[^:]+)?:/,
  // Java / C# / C++ method signature: public int foo(, static void bar(
  /\b(public|private|protected|static)\s+[\w<>\[\],\s.]+\s+\w+\s*\(/,
  // JS/TS: function foo(, function(, const foo = (a, b) =>
  /\bfunction\s*\w*\s*\(/,
  /\b(const|let|var)\s+\w+\s*=\s*(async\s*)?\([^)]*\)\s*=>/,
  // Go / Rust / Swift / Kotlin definitions.
  /\b(func|fn|fun)\s+\w+\s*\(/,
  // File preamble: imports and includes.
  /^\s*(#include\b|import\s+[\w{*]|from\s+[\w.]+\s+import\b|using\s+namespace\b|package\s+\w)/m,
  // C++ containers, which basically never appear in prose.
  /\b(vector|unordered_map|unordered_set|priority_queue)\s*</,
];

/**
 * Individually weak, but code-shaped. These need corroboration: several of
 * them, across more than one line. A single `[1,2,3]` in chat is not a solve.
 */
const SIGNALS: Array<[name: string, pattern: RegExp]> = [
  ["indent", /^[ \t]+\S/m],
  ["brace", /\{[\s\S]*\}/],
  ["semicolons", /;\s*$/m],
  ["control", /\b(for|while|if|else|elif|switch|return|break|continue)\b/],
  ["operator", /(==|!=|<=|>=|\+\+|--|\+=|-=|->|=>|::|&&|\|\|)/],
  ["index", /\w+\s*\[[^\]]*\]/],
  ["call", /\b\w+\s*\([^)]*\)/],
  ["blockOpen", /[:{]\s*$/m],
  ["assign", /^\s*\w+\s*=\s*\S/m],
  ["comment", /^\s*(\/\/|#\s|\/\*)/m],
];

/** Corroborating signals needed before a plain-text paste counts. */
const MIN_SIGNALS = 3;

/** Below this, it's a one-liner — chat, not a submission. */
const MIN_LINES = 2;

/**
 * Telegram parses ``` into a `pre` entity and strips the backticks from `text`,
 * so scanning the text for backticks alone would miss every properly formatted
 * code block. Entities are the strongest signal; past that we read the content.
 */
export function looksLikeSolution(text: string, entities: MessageEntity[] = []): boolean {
  for (const entity of entities) {
    if (entity.type === "pre") return true;
    if (entity.type === "code" && entity.length >= MIN_INLINE_CODE) return true;
  }
  if (FENCE.test(text)) return true;
  return readsAsCode(text);
}

/**
 * Content classification for unformatted pastes — the mobile path.
 *
 * Exported so its behaviour can be exercised directly; the bot itself only
 * ever calls `looksLikeSolution`.
 */
export function readsAsCode(text: string): boolean {
  const body = text.trim();
  if (!body) return false;

  // A URL-only message is someone sharing the problem, not solving it. Strip
  // links before judging, so query strings can't fake operators and brackets.
  const withoutLinks = body.replace(/https?:\/\/\S+/g, " ");
  if (!withoutLinks.trim()) return false;

  if (DECLARATIONS.some((pattern) => pattern.test(withoutLinks))) return true;

  const lines = withoutLinks.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < MIN_LINES) return false;

  const hits = SIGNALS.filter(([, pattern]) => pattern.test(withoutLinks));
  if (hits.length < MIN_SIGNALS) return false;

  // Prose can accumulate soft signals — "if", "return", a bracketed list — but
  // it does not indent, brace, or terminate statements. Demand one hard sign of
  // syntax so pasted problem statements and normal chatter stay out.
  const STRUCTURAL = new Set(["indent", "brace", "semicolons", "blockOpen", "comment"]);
  return hits.some(([name]) => STRUCTURAL.has(name));
}

/** Best display name available for a Telegram user. */
export function displayName(from: {
  first_name?: string;
  last_name?: string;
  username?: string;
  id: number;
}): string {
  const full = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return full || from.username || `User ${from.id}`;
}
