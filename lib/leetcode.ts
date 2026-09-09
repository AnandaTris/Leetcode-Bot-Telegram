export type DailyChallenge = {
  /** UTC date the challenge is active for, e.g. "2026-09-09". */
  date: string;
  url: string;
  id: string;
  title: string;
  slug: string;
  difficulty: "Easy" | "Medium" | "Hard" | string;
  isPaidOnly: boolean;
  /** Acceptance rate as a percentage, e.g. 77.13. */
  acRate: number;
  topics: string[];
};

const QUERY = `query dailyChallenge {
  activeDailyCodingChallengeQuestion {
    date
    link
    question {
      questionFrontendId
      title
      titleSlug
      difficulty
      isPaidOnly
      acRate
      topicTags { name }
    }
  }
}`;

/**
 * LeetCode rotates the daily problem at 00:00 UTC. We always ask for whatever
 * is currently active rather than computing a date ourselves, so the answer is
 * correct no matter which timezone the cron fires in.
 */
export async function fetchDailyChallenge(): Promise<DailyChallenge> {
  const res = await fetchWithRetry("https://leetcode.com/graphql", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // LeetCode rejects requests with no browser-ish user agent.
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      referer: "https://leetcode.com/problemset/",
    },
    body: JSON.stringify({ query: QUERY, operationName: "dailyChallenge" }),
  });

  const json = await res.json();
  const daily = json?.data?.activeDailyCodingChallengeQuestion;
  if (!daily?.question) {
    throw new Error(`Unexpected LeetCode response: ${JSON.stringify(json).slice(0, 400)}`);
  }

  const q = daily.question;
  return {
    date: daily.date,
    url: `https://leetcode.com${daily.link}`,
    id: q.questionFrontendId,
    title: q.title,
    slug: q.titleSlug,
    difficulty: q.difficulty,
    isPaidOnly: Boolean(q.isPaidOnly),
    acRate: typeof q.acRate === "number" ? q.acRate : 0,
    topics: (q.topicTags ?? []).map((t: { name: string }) => t.name),
  };
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { ...init, cache: "no-store" });
      if (res.ok) return res;
      lastError = new Error(`LeetCode returned ${res.status} ${res.statusText}`);
    } catch (error) {
      lastError = error;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
