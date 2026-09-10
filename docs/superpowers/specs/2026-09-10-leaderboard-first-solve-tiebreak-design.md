# Leaderboard tie-break: first solve of the day wins

**Date:** 2026-09-10
**Status:** implemented 2026-09-10

## The problem

Ado, in the group: several people sit on the same all-time total, and the person
who solved today's problem *first* is ranked **below** someone who solved it
later. Nothing about submission order reaches the board.

It can't. `recordSolve` writes today's solvers into `solved:<day>`, a Redis
**SET** — unordered by definition. The bot records *that* you solved, never
*when*. The current sort is:

```ts
b.total - a.total || b.streak - a.streak || a.name.localeCompare(b.name)
```

so equal totals fall through to streak and then alphabetical order, which is
where the wrong ordering comes from.

## What "first" means here

**Today's race.** Among people on the same total, whoever pasted *today's*
solution earlier ranks higher. It resets daily — tomorrow's board is ordered by
tomorrow's submission times.

Chosen over two alternatives that were considered and rejected:

- *Seniority at that score* (who reached the total first, historically): stable,
  but today's speed never moves you, which is the opposite of the intent.
- *Lifetime early-bird count* (who wins the most mornings): needs a second
  counter and ignores today entirely.

At equal total, someone who solved today ranks above someone who hasn't. This
was settled explicitly — it is the behaviour in the approved example.

## Storage: the timestamp rides the write that already happens

`recordSolve` already issues:

```ts
await db.hset(KEYS.streak(user.id), { current: streak, best, last: day });
```

and `leaderboard()` already pipelines `hgetall(KEYS.streak(id))` for every
participant. Adding a `lastAt` field to that hash costs **zero extra Redis
commands on both the read and the write**, needs no new key, changes no key's
type, and orphans nothing.

Two alternatives were rejected:

- **A dedicated ZSET `solves:<day>`** scored by timestamp. Equivalent command
  count, but `solved:<day>` already exists as a SET and a key cannot change
  type without `WRONGTYPE`, so live solve data would be orphaned.
- **A ZSET alongside the existing SET.** No migration risk, but +1 command on
  every solve and every board render. The store is on the Upstash free plan,
  whose budget is a daily command count.

The cost of this choice: only the *last* solve time is kept, not a history of
all of them. The bot has no use for a history.

## Changes

**`lib/store.ts`**

- `recordSolve` adds `lastAt: Date.now()` to the existing `hset`. No new command.
- `StreakRecord` gains `lastAt?: number`.
- `LeaderboardRow` gains `solvedAt: number | null` — set only when
  `record.last === day`, so it always means "when they solved *today*", and is
  `null` on every other day.
- The sort becomes, in order:
  1. `total` descending
  2. position in today's race, earliest first — a single comparator over
     "solved today, at this time", with not-solved-today sorting last
  3. `streak` descending
  4. `name` alphabetically

  Keys 2 and 3 of the original draft ("solved-today first", then "earliest
  `solvedAt`") are one key, not two: not-solved-today *is* last place in the
  race. Two comparators encoding one rule drift apart the first time either is
  touched.

**`lib/message.ts`**

- `standings()` appends the submission time to a row that has one:
  `🥇 ✅ Carol — 12 · 🔥5 · 08:14`. Rendered in **SGT (UTC+8)**, the group's
  timezone, from the stored epoch ms.
- A row with no recorded time renders exactly as it does today.

Both `/leaderboard` and the 23:00 roast read `leaderboard(day)` and render
through `standings()`, so both inherit this from the one change.

## Legacy solves with no timestamp

There is live solve data already, written before `lastAt` existed. Those records
have `last === day` but no `lastAt`.

**An untimed solve that counts for today sorts as the earliest**, not the
latest. Such a solve necessarily happened before this change deployed, and
therefore before any timestamp this change will ever write. Ranking it last
would reproduce the exact bug being fixed.

`LeaderboardRow.solvedAt` stays honestly `number | null` — `null` means "no time
recorded", and the renderer relies on that to omit the time. The ±Infinity
substitution happens **only inside the comparator**, which reads a row as
`-Infinity` when it is solved today but untimed, and `+Infinity` when it isn't
solved today at all. Two untimed rows tie and fall through to streak, then name.
The condition disappears on its own once everyone has solved once under the new
code.

## Testing

No test framework in this repo. Verified with a throwaway harness (the pattern
already used this session for the `/me` fix): stub `fetch` for the Upstash REST
wire format, including its base64 response encoding, and drive the real
`leaderboard()` and `standings()`.

Cases that must pass:

1. Equal totals, both solved today, different times → earlier time ranks first.
2. Equal totals, one solved today and one didn't → solver ranks first.
3. Equal totals, one timed and one untimed, both solved today → untimed first.
4. Different totals → total still dominates; time never overrides it.
5. Nobody solved today → order matches today's output exactly (no regression).
6. Times render in SGT, and a row without a time is unchanged.

## Out of scope

- Per-day speed history or an all-time "fastest" statistic.
- Any change to what counts as proof of a solve.
- Backfilling times onto past solves — the data does not exist.
