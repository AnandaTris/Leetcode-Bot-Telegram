# LeetCode Daily Bot

A Telegram bot that posts the LeetCode daily challenge to a group the moment it
rotates, takes your pasted code as proof you solved it, keeps a leaderboard of
totals and streaks, and roasts whoever skipped at the end of the day.

- **08:00 SGT** — a Vercel cron hits `/api/cron` and posts today's problem to the
  group and to your own chat. LeetCode rotates at 00:00 UTC, which *is* 08:00 SGT,
  so the schedule is `5 0 * * *` — five minutes of slack after the rotation.
- **All day** — paste your solution in the group. No formatting needed: the bot
  recognises code by its content, reacts 🔥 and banks the solve. Correctness
  isn't judged.
- **23:00 SGT** — `/api/roast` posts the standings and names everyone who didn't.
- **On demand** — `/today`, `/leaderboard`, `/me`, `/join`, `/leave`, `/here`.

In a group with **Topics** enabled, send `/here` in the topic you want the bot to
use — otherwise every scheduled post lands in General. Replies always go back to
whichever topic the command was sent from.

## Layout

| Path | What it does |
| --- | --- |
| `app/api/cron/route.ts` | The 08:00 SGT send, to the group and to you. |
| `app/api/roast/route.ts` | The 23:00 SGT standings + roast. |
| `app/api/telegram/route.ts` | Webhook: commands, and proof-of-solve detection. |
| `app/api/preview/route.ts` | Renders the message variants as JSON without sending. |
| `app/api/setup/route.ts` | Registers the Telegram webhook from the server. |
| `lib/leetcode.ts` | Queries LeetCode's GraphQL API for the active daily challenge. |
| `lib/message.ts` | Renders every message: reminders, leaderboard, roast, stats. |
| `lib/proof.ts` | Decides whether a message is code. |
| `lib/store.ts` | Solves, streaks and totals in Upstash Redis. |
| `lib/telegram.ts` | Thin Telegram Bot API client. |
| `vercel.json` | Both cron schedules, and the `sin1` function region. |

## Environment variables

| Variable | Required | What it is |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes | From @BotFather after `/newbot`. |
| `TELEGRAM_CHAT_ID` | yes | Your own chat with the bot. DM the bot `/chatid` to get it. |
| `TELEGRAM_GROUP_CHAT_ID` | yes, for the group | The group to post into. Add the bot, send `/chatid` there, paste the (negative) number. |
| `TELEGRAM_WEBHOOK_SECRET` | recommended | Any random string. Telegram echoes it back, so forged webhook calls are rejected. |
| `CRON_SECRET` | recommended | Authenticates both cron routes. Vercel offers to generate it. |
| `KV_REST_API_URL` + token | for the leaderboard | Injected automatically by the Upstash Marketplace integration. `UPSTASH_REDIS_REST_*` names work too. |

Vercel stores Secret-type variables **write-only** — once set through the CLI
they can never be pulled back. That is why the webhook registers itself from the
server (`/api/setup`) rather than from a laptop script.

## Setup

**1. Create the bot** — message [@BotFather](https://t.me/BotFather), `/newbot`,
pick a name and username, keep the token.

**2. Deploy** — `vercel link` then `vercel --prod`.

**3. Add the environment variables** in the Vercel dashboard, then redeploy.

**4. Register the webhook** — open `https://<your-app>.vercel.app/api/setup` in a
browser. It takes no input, always targets its own origin with its own secret,
and is idempotent.

**5. Provision the leaderboard store:**

```sh
vercel integration add upstash/upstash-kv --plan free -m primaryRegion=sin1 -m autoUpgrade=false
```

The first run stops at a terms-acceptance link — accept in the browser, then run
it again. Environment variables are injected automatically; redeploy afterwards.

**6. Add the bot to the group and make it an admin.** By default a bot only sees
messages addressed to it, so it would never see the solutions people paste. An
**admin** bot sees everything regardless of that setting, and needs no
permissions ticked — so promoting it is simpler than the BotFather Group Privacy
toggle, which only takes effect on join and would mean removing and re-adding.

**7. Wire the group** — on join the bot posts the group's ID by itself. (Or send
`/chatid` there.) Put that negative number in `TELEGRAM_GROUP_CHAT_ID`, redeploy,
then open `/api/setup` again — it reports the group's title and whether the bot
is an admin, which is the only way to check a write-only env var landed right.

## How scoring works

- **A solve** is any code posted in the group that day, formatted or not.
  Formatting is checked first: Telegram sends a ``` fence as a `pre` entity and
  strips the backticks from the message text, so `lib/proof.ts` reads entities
  rather than scanning for backticks. Inline `code` counts only past 30
  characters, so typing `lol` in backticks doesn't.
- **Unformatted pastes are classified by content**, because typing ``` on a
  phone keyboard is miserable. A declaration like `class Solution`, a `def f():`,
  a Java signature or an `#include` counts on its own. Anything else needs three
  code-shaped signals across two or more lines, *and* at least one structural
  one — indentation, braces, a trailing `;` or `:`, a comment. That last
  requirement is what keeps a pasted problem statement out: prose accumulates
  brackets and the word "return", but it never indents or braces.
- **The classifier leans toward yes.** A false positive credits someone on what
  is already an honour system; a false negative gets someone who did the work
  roasted at 23:00. Those errors are not equal.
- **The day** is the UTC date, which is exactly LeetCode's rotation window: the
  problem drops at 00:00 UTC (08:00 SGT) and the roast fires at 15:00 UTC
  (23:00 SGT) on the same UTC date.
- **Streaks** survive only if the previous day was also solved. A gap resets to
  one; a lapsed streak displays as 0 without being overwritten.
- **Who gets roasted** — anyone who has solved at least once, or sent `/join`.
  `/leave` removes you from the roast list and keeps your history.

## Changing the times

Both schedules live in `vercel.json` and are **UTC**.

| Want | SGT | Cron |
| --- | --- | --- |
| Problem drops | 08:00 | `5 0 * * *` |
| Roast | 23:00 | `0 15 * * *` |
| Roast | 22:00 | `0 14 * * *` |

Hobby runs each cron once a day, which is what this needs — but its firing time
is approximate and can drift by up to an hour. For 08:00 on the dot, trigger
`/api/cron` from a GitHub Actions schedule instead and keep the same secret.
