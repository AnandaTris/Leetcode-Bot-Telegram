# ROADMAP — LeetCode Daily Bot

## The end goal

A Telegram bot that makes the group actually do LeetCode every day: it posts the
daily problem the moment it rotates, records who proved they solved it, and
publicly roasts whoever didn't.

**Done means** all four gates pass on a real day, in the real group:

1. The problem lands in the group — in the right topic — at 08:00 SGT without
   anyone triggering it.
2. Pasting your code — plain, unformatted — gets a 🔥 and increments that
   person's total and streak.
3. `/leaderboard` shows correct totals and streaks.
4. The 23:00 SGT message names the people who didn't solve.

Nothing blocks these now. Gates 2–4 need a real day in the group to prove.

## State — 2026-09-10

Deployed: <https://leetcode-daily-bot.vercel.app> · bot **@biarkitapinternBOT** ·
Vercel scope `ados-projects-95524fc3` (personal, deliberately not 8x Plays).

**Fixed 2026-09-10 — `/me` never found anyone.** Reported by Ado as "the /me is
not working". `statsFor` looked its caller up with `row.id === id` against a
string, but `@upstash/redis` hands set members back already `JSON.parse`'d, so a
numeric user id stored as `"1234567890"` came back as the *number*
`1234567890`. The strict compare could never match, so `/me` always answered
"You're not on the board yet" — including for people with solves banked.
`/leaderboard` was unaffected, which is why only this one command looked broken:
it never compares an id to a string, and `names?.[id]` coerces the key anyway.
Fixed at the boundary in `lib/store.ts` — both `smembers` reads now coerce back
to `string`, so `LeaderboardRow.id` matches its declared type. Verified with a
harness that stubs the Upstash REST wire format (base64) and runs the real
`leaderboard()`/`statsFor()`; `/leaderboard` output is byte-identical before and
after.

**Verified against production:**

- `/api/setup` reports every dependency healthy in one response: webhook
  registered, secret configured, group reachable as "[UROP + BSF] Fames.com"
  (supergroup) with the bot an **admin**, and the store round-tripping a real
  write-read-delete.
- Upstash Redis provisioned (free plan, `sin1`, `autoUpgrade=false`) and
  connected to the project; its REST credentials are injected into all three
  environments.
- Functions pinned to `sin1` to sit beside the store. Round-trip went from
  **~680ms to ~11ms** — the default `iad1` put every Redis op on a trans-Pacific
  hop.
- Both cron jobs registered — `vercel crons ls` shows `/api/cron` at `5 0 * * *`
  and `/api/roast` at `0 15 * * *`. Both return 401 unauthenticated.
- LeetCode GraphQL fetch, live against production (`/api/preview`).
- Message rendering, run against fixtures: leaderboard, roast (solved / partial /
  nobody / empty board), `/me`, empty states. HTML escaping holds against a name
  containing `<script>`.
- Roast lines rotate — 9 distinct lines over 14 consecutive days.
- Forum topics supported. Replies thread back into the topic the command was
  asked in, and `/here` pins the scheduled posts to a topic.
- Proof detection: 23/23 cases. 10 real unformatted solutions (Python, Java,
  C++, two JS styles, Go, a bare loop, an import block, a one-liner, a comment
  block), 11 pieces of realistic group chatter that must NOT count (including a
  pasted problem statement, a bare LeetCode link, and bracketed chat), plus both
  entity paths.

**Connected but never exercised for real:**

- `/here` and topic-targeted posting. Written and deployed, but no topic has
  been pinned yet, so `message_thread_id` has never actually been sent.
- ~~Nobody has posted a solve yet~~ — **wrong as of 2026-09-10.** Ado confirms
  real solves are banked. `recordSolve`, the 🔥 reaction and the streak
  arithmetic therefore have live data, not just connectivity. This entry sat
  stale long enough to nearly cost a data migration: the first-solve tie-break
  design assumed an empty store on this line's word.
- Neither cron has fired on schedule. Only their handlers and rendering are proven.

## What's next

1. **Send `/here` in the LeetCode topic** so the 08:00 and 23:00 posts stop
   landing in General.
2. **Prove gate 2** — paste code in the group, expect a 🔥, then check
   `/leaderboard`. This is the one thing that cannot be verified from here.
3. **Get the others to `/join`.** Solving once puts you on the roast list
   automatically, but `/join` puts someone on it *before* their first solve —
   which is the entire point of a roast.
4. **Watch the first real 08:05 and 23:00 firings** before trusting either.
5. **Decide on cron precision.** Vercel Hobby cron times drift by up to an hour,
   so "08:05" is really "sometime in the 08:00 hour". If Ado wants it on the dot,
   move the trigger to a GitHub Actions schedule hitting `/api/cron` with the
   same `CRON_SECRET`. Offered, not yet accepted.
6. **Consider deleting the unauthenticated `GET /api/setup`** now that setup is
   done. It is idempotent and takes no input, so it grants nothing — but it now
   also reports store health and group membership, which is more than a stranger
   needs. Offered, not yet accepted.

## Locked decisions

- **Any code counts as proof.** No correctness checking, no LeetCode account
  linking. Chosen because the point is the habit, not the verification, and
  anything stricter needs credentials nobody wants to hand over.
- **Formatting is NOT required — proof is classified by content.** Ado's words:
  "I cant do it on my phone also quite complicated". Requiring a ``` fence made
  the bot unusable from the device everyone actually uses, so `lib/proof.ts`
  recognises `class Solution` and friends in plain text. Do not reintroduce a
  formatting requirement.
- **The classifier is deliberately biased toward yes.** A false positive credits
  someone on what is already an honour system; a false negative roasts someone
  who did the work. Those errors are not equal, so ambiguity resolves to a
  solve. The one guard against runaway yes is the structural requirement —
  indentation, braces or a trailing `;`/`:` — which is what keeps a pasted
  problem statement from counting.
- **Scoring is all-time total + current streak.** No weekly reset.
- **Roast fires 23:00 SGT the same day**, not the next morning.
- **The day key is the UTC date.** This is not a shortcut — it is exactly
  LeetCode's rotation window. The problem drops 00:00 UTC (08:00 SGT) and the
  roast fires 15:00 UTC (23:00 SGT) on the same UTC date, so nobody is ever
  roasted for a problem they haven't been shown.
- **Proof detection reads Telegram entities, not backticks.** Telegram parses
  ``` into a `pre` entity and strips the backticks from `message.text`, so a
  regex over the text would miss every properly formatted code block. The fence
  regex remains only as a fallback for clients that send raw markdown.
- **`/api/setup` registers the webhook server-side.** Vercel Secret-type env
  vars are write-only and can never be pulled back, which makes any
  laptop-side `setWebhook` script permanently unusable. The server holds both
  values already. This cost a wasted setup attempt before it was understood —
  do not reintroduce the local-script flow.
- **The bot is a group admin rather than having Group Privacy turned off.** An
  admin bot receives all messages regardless of privacy mode, which avoids a
  BotFather round trip plus a remove/re-add (the privacy setting only applies at
  join time). It holds no admin permissions.
- **Raw `fetch` was rejected in favour of `@upstash/redis`**, per the
  `vercel-storage` skill — the SDK handles pipelining and value deserialization.
  Caveat learned the hard way: that deserialization is *automatic and lossy for
  ids*. Anything that round-trips through Redis and looks numeric comes back a
  `number`, whatever the TypeScript signature claims. Coerce at the boundary —
  never trust `smembers`/`hgetall` to hand back the type it declares.
- **Upstash free plan, `sin1`, `autoUpgrade=false`** so the bot can never
  silently start billing.
- **Functions pinned to `sin1` in `vercel.json`.** Vercel defaults to `iad1`,
  which put every Redis op on a trans-Pacific round trip — measured at ~225ms
  each, ~11ms after colocating. The store's region is the one that matters here;
  Telegram and LeetCode are both fronted globally.
- **The post destination is stored, not configured.** `/here` writes the chat
  and topic into Redis, and both crons prefer it over the configured group and
  topic. Otherwise moving the bot to a new group or topic means a settings edit
  plus a redeploy every time — and Ado is planning a dedicated LeetCode group.
  The configured values stay as the fallback.
- **Solves count from anywhere in the group, not just the pinned topic.** Same
  bias as the proof classifier: pasting in the wrong topic is not a reason to
  roast someone who did the work.
- **`/api/setup` probes the store with a real write-read-delete.** Checking that
  the variables merely *exist* would report healthy even with wrong credentials,
  and the failure would then surface at 23:00 in front of the whole group.

## Slips

- The first webhook setup path was built around `npm run set-webhook`, which
  could never work: `TELEGRAM_WEBHOOK_SECRET` was generated straight into Vercel
  as a Secret and was therefore unreadable by anyone, forever. Replaced by
  `/api/setup`. Cost: one dead end and a confusing setup message to Ado.
- Setup was initially handed over as shell one-liners, including bash-only
  `read -rs -p` syntax on a zsh host. Ado's reply was "how do i do this Im so
  confiused". Corrected to a browser-openable URL doing the work server-side.
- Proof was originally gated on a ``` code block, which is fine on a laptop and
  unusable on a phone — "I cant do it on my phone also quite complicated". The
  bot would have silently failed to credit most of the group's real solves and
  then roasted them for it. Replaced with content classification.
- `/me` shipped broken and stayed broken through the whole "verified against
  production" pass above. The `/me` rendering test at line "Message rendering,
  run against fixtures" passed because it fed `statsMessage` a hand-built row —
  it never went through `statsFor`, which is where the bug was. A fixture test
  that skips the lookup layer proves the layer that wasn't broken.
- Asking Ado to run `/chatid` in the group to fetch its ID failed twice — he
  sent his private chat ID both times. Fixed at the root: `/chatid` now says
  which kind of chat it is, and the bot announces the group ID unprompted when
  it joins or is promoted (`my_chat_member`), so the command isn't needed at all.
