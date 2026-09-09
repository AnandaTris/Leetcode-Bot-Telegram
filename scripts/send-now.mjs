#!/usr/bin/env node
/**
 * Fire the daily reminder on demand, exactly the way the cron does — useful for
 * checking the whole path works without waiting until tomorrow morning.
 *
 *   DEPLOY_URL=https://your-app.vercel.app CRON_SECRET=... npm run send-now
 */

const DEFAULT_URL = "https://leetcode-daily-bot.vercel.app";

const base = (process.env.DEPLOY_URL ?? process.argv[2] ?? DEFAULT_URL).replace(/\/+$/, "");

const headers = {};
if (process.env.CRON_SECRET) {
  headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
}

const res = await fetch(`${base}/api/cron`, { headers });
const body = await res.text();
console.log(`${res.status} ${res.statusText}`);
console.log(body);
process.exit(res.ok ? 0 : 1);
