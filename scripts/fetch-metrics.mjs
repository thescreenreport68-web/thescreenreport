#!/usr/bin/env node
// Pull aggregate pageview counts from Cloudflare Workers Analytics Engine into
// data/homepage-metrics.json (HOMEPAGE_PROGRAMMING_PLAN.md Phase 2). Runs as
// `prebuild` — ALWAYS exits 0 so a missing token / dataset never blocks a
// build; the homepage just falls back to supply-side signals.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "homepage-metrics.json");

// Load the parent .env (same convention as the pipeline).
try {
  const env = fs.readFileSync(path.join(ROOT, "..", ".env"), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=("?)(.*)\2\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[3];
  }
} catch {}

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;

async function sql(query) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: query,
    }
  );
  if (!res.ok) throw new Error(`AE SQL ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data ?? [];
}

async function main() {
  if (!ACCOUNT || !TOKEN) throw new Error("no Cloudflare creds in env");
  const q = (interval) => `
    SELECT blob1 AS path, SUM(_sample_interval) AS views
    FROM tsr_metrics
    WHERE timestamp > NOW() - INTERVAL '${interval}' MINUTE
    GROUP BY path ORDER BY views DESC LIMIT 500`;
  const [h24, h1, h2] = await Promise.all([sql(q(1440)), sql(q(60)), sql(q(120))]);

  const views = {};
  for (const r of h24) views[r.path] = { v24: Number(r.views) || 0, v1: 0, vPrev: 0 };
  for (const r of h1) (views[r.path] ??= { v24: 0, v1: 0, vPrev: 0 }).v1 = Number(r.views) || 0;
  for (const r of h2) {
    const rec = (views[r.path] ??= { v24: 0, v1: 0, vPrev: 0 });
    rec.vPrev = Math.max(0, (Number(r.views) || 0) - rec.v1); // previous hour = last2h − last1h
  }

  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), views }, null, 2));
  console.log(`[metrics] wrote ${Object.keys(views).length} paths → data/homepage-metrics.json`);
}

main().catch((e) => {
  console.warn(`[metrics] skipped (${e.message}) — homepage uses supply-side signals only`);
  process.exit(0);
});
