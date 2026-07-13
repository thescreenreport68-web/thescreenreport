// BOX-OFFICE CRON CLOCK — a Cloudflare Worker with a Cron Trigger. It fires every hour at :30 UTC and calls the
// GitHub `workflow_dispatch` API to run the `boxoffice-drip` workflow (which publishes one article per tick).
//
// The :30 slot is deliberately BETWEEN the other three lanes: news + gossip post at :00 (top of every hour) and the
// reaction lane at :23, so box-office never lands on an occupied minute. 24 fires/day; the node orchestrator caps
// publishing at MAX_ARTICLES_PER_DAY=20 and HOLDS anything that doesn't clear the accuracy gates, so it self-limits —
// a thin/obscure film is skipped that tick, never mis-published.
//
// MIX (owner: 15 box-office / 5 streaming): ~5 of the day's ticks run streaming-first (Netflix Top 10 / trending TV),
// the rest box-office-first. borun's finder + the daily cap absorb the natural variance.
//
// Secrets (set with `wrangler secret put`):  GH_TOKEN  (a fine-grained PAT with Actions: read/write on the repo)
// Vars (wrangler.toml [vars]):  GH_OWNER, GH_REPO, GH_REF (the DEFAULT branch — workflow_dispatch requires the
//                               workflow file to exist on the repo's default branch).

// The 5 UTC hours (of 24) whose :30 tick runs streaming-first — spread ~evenly so streaming is sprinkled through the
// day, not clustered. Every other tick is box-office-first. 5/24 fires ≈ the owner's 5-of-20 published streaming share.
const STREAM_HOURS = new Set([2, 7, 12, 17, 22]);

export default {
  async scheduled(event, env, ctx) {
    const now = new Date(event.scheduledTime || Date.now());
    const utcHour = now.getUTCHours();
    const stream = STREAM_HOURS.has(utcHour) ? "true" : "false";
    const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/boxoffice-drip.yml/dispatches`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "boxoffice-cron-worker",
      },
      body: JSON.stringify({ ref: env.GH_REF || "main", inputs: { limit: "1", stream } }),
    });
    if (!res.ok) {
      console.log(`boxoffice-cron: dispatch failed ${res.status} ${await res.text()}`);
    } else {
      console.log(`boxoffice-cron: dispatched boxoffice-drip (UTC ${utcHour}:30, ${stream === "true" ? "streaming-first" : "box-office-first"})`);
    }
  },
};
