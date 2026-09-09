/**
 * Persistence for solves, streaks and the leaderboard.
 *
 * Upstash Redis, provisioned through the Vercel Marketplace. Reads degrade
 * gracefully when it isn't configured yet, so the daily reminder keeps working
 * even before the store exists.
 */
import { Redis } from "@upstash/redis";

export type Participant = {
  id: string;
  name: string;
};

export type LeaderboardRow = {
  id: string;
  name: string;
  total: number;
  streak: number;
  best: number;
  solvedToday: boolean;
};

const KEYS = {
  users: "users",
  participants: "participants",
  total: "total",
  target: "post-target",
  solved: (day: string) => `solved:${day}`,
  streak: (id: string) => `streak:${id}`,
};

/** Where the scheduled posts go: a chat, and optionally a forum topic in it. */
export type PostTarget = { chatId: string; topicId: number | null };

/**
 * Set by /here from inside the destination chat. Stored rather than configured
 * so moving the bot to a different group or topic doesn't need an env var edit
 * and a redeploy — the people using it can just point it somewhere else.
 */
export async function setPostTarget(target: PostTarget): Promise<void> {
  await redis().set(KEYS.target, target);
}

export async function getPostTarget(): Promise<PostTarget | null> {
  if (!storeConfigured()) return null;
  try {
    const stored = await redis().get<PostTarget>(KEYS.target);
    return stored?.chatId ? stored : null;
  } catch (error) {
    // Never let a store hiccup stop the daily problem going out; the caller
    // falls back to the configured environment.
    console.warn("post target lookup failed:", error);
    return null;
  }
}

export async function clearPostTarget(): Promise<void> {
  await redis().del(KEYS.target);
}

function credentials(): { url: string; token: string } | null {
  // The Vercel Upstash integration injects KV_-prefixed names; a standalone
  // Upstash project uses UPSTASH_-prefixed ones. Accept either so setup can't
  // get this wrong.
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const secret = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !secret) return null;
  return { url, token: secret };
}

/** True once a Redis backend is wired up. Lets the bot degrade instead of crash. */
export function storeConfigured(): boolean {
  return credentials() !== null;
}

let client: Redis | null = null;

function redis(): Redis {
  const creds = credentials();
  if (!creds) throw new Error("No Redis configured — add the Upstash integration");
  // Built lazily: constructing at module scope would blow up `next build`
  // before the integration has provisioned its environment variables.
  client ??= new Redis(creds);
  return client;
}

/**
 * A real write-read-delete against the store. `storeConfigured()` only proves
 * the variables exist; this proves the credentials actually work, which is the
 * difference between "the leaderboard is wired" and "the leaderboard will fail
 * silently at 23:00".
 */
export async function storeHealth(): Promise<
  { ok: true; roundTripMs: number } | { ok: false; error: string }
> {
  const started = Date.now();
  const probe = `health:${started}`;
  try {
    const db = redis();
    await db.set(probe, "ok", { ex: 60 });
    const echoed = await db.get<string>(probe);
    await db.del(probe);
    if (echoed !== "ok") return { ok: false, error: `wrote "ok", read back ${JSON.stringify(echoed)}` };
    return { ok: true, roundTripMs: Date.now() - started };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The day key. UTC date, which is exactly LeetCode's own rotation boundary. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function previousDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export async function registerParticipant(user: Participant): Promise<void> {
  const db = redis();
  await Promise.all([
    db.hset(KEYS.users, { [user.id]: user.name }),
    db.sadd(KEYS.participants, user.id),
  ]);
}

export async function removeParticipant(id: string): Promise<boolean> {
  return (await redis().srem(KEYS.participants, id)) > 0;
}

type StreakRecord = { current?: number; best?: number; last?: string };

/**
 * Credits a solve. Returns null when this user already had today's solve
 * recorded, so callers can stay quiet instead of reacting to every message.
 */
export async function recordSolve(
  user: Participant,
  day: string,
): Promise<{ total: number; streak: number; best: number } | null> {
  const db = redis();
  await registerParticipant(user);

  const added = await db.sadd(KEYS.solved(day), user.id);
  if (added === 0) return null; // already counted today

  const total = await db.zincrby(KEYS.total, 1, user.id);

  const record = (await db.hgetall<StreakRecord>(KEYS.streak(user.id))) ?? {};
  // A streak survives only if yesterday was solved too; anything older is a
  // lapse, and starts over at one.
  const streak = record.last === previousDay(day) ? Number(record.current ?? 0) + 1 : 1;
  const best = Math.max(Number(record.best ?? 0), streak);

  await db.hset(KEYS.streak(user.id), { current: streak, best, last: day });

  return { total: Number(total), streak, best };
}

export async function solversOn(day: string): Promise<string[]> {
  return (await redis().smembers(KEYS.solved(day))) ?? [];
}

export async function leaderboard(day: string): Promise<LeaderboardRow[]> {
  const db = redis();
  const ids = (await db.smembers(KEYS.participants)) ?? [];
  if (!ids.length) return [];

  const [names, solvedToday] = await Promise.all([
    db.hgetall<Record<string, string>>(KEYS.users),
    solversOn(day),
  ]);
  const solvedSet = new Set(solvedToday);

  // One pipeline instead of 2N round trips — Upstash bills per command and the
  // free tier is a daily budget worth not spending on a leaderboard render.
  const pipeline = db.pipeline();
  for (const id of ids) {
    pipeline.zscore(KEYS.total, id);
    pipeline.hgetall(KEYS.streak(id));
  }
  const results = await pipeline.exec();

  const rows = ids.map((id, index): LeaderboardRow => {
    const total = Number(results[index * 2] ?? 0);
    const record = (results[index * 2 + 1] as StreakRecord | null) ?? {};
    // A streak only counts as alive if the last solve was today or yesterday;
    // otherwise it lapsed silently and should read as zero.
    const alive = record.last === day || record.last === previousDay(day);

    return {
      id,
      name: names?.[id] ?? `User ${id}`,
      total,
      streak: alive ? Number(record.current ?? 0) : 0,
      best: Number(record.best ?? 0),
      solvedToday: solvedSet.has(id),
    };
  });

  return rows.sort(
    (a, b) => b.total - a.total || b.streak - a.streak || a.name.localeCompare(b.name),
  );
}

export async function statsFor(id: string, day: string): Promise<LeaderboardRow | null> {
  return (await leaderboard(day)).find((row) => row.id === id) ?? null;
}
