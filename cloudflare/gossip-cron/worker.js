// GOSSIP CRON CLOCK — a Cloudflare Worker with a Cron Trigger (every ~5 min). Each firing, IF it's inside Los
// Angeles posting hours (10am-10pm PT), it calls the GitHub `workflow_dispatch` API to run the `gossip-drip`
// workflow (which publishes one article). This is the SAME reliable external-clock mechanism the news automation
// uses — GitHub's own cron is delayed/dropped under load, so we drive it from here instead.
//
// The node scheduler ALSO gates on LA hours (belt-and-suspenders), so a stray dispatch never posts off-hours.
//
// Secrets (set with `wrangler secret put`):  GH_TOKEN  (a fine-grained PAT with Actions: read/write on the repo)
// Vars (wrangler.toml [vars]):  GH_OWNER, GH_REPO, GH_REF (the DEFAULT branch — workflow_dispatch requires the
//                               workflow file to exist on the repo's default branch)

function laHour(date) {
  try {
    return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hourCycle: "h23" }).format(date));
  } catch {
    return -1; // if ICU/timezone is unavailable, return -1 so we DISPATCH and let the node scheduler do the gating
  }
}

export default {
  async scheduled(event, env, ctx) {
    const now = new Date(event.scheduledTime || Date.now());
    const h = laHour(now);
    // -1 = couldn't resolve TZ here → dispatch anyway (the node scheduler gates). Otherwise gate to 10:00–21:59 PT.
    if (h !== -1 && (h < 10 || h >= 22)) {
      console.log(`gossip-cron: LA hour ${h} outside 10-22, skip`);
      return;
    }
    const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/gossip-drip.yml/dispatches`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "gossip-cron-worker",
      },
      body: JSON.stringify({ ref: env.GH_REF || "main", inputs: { limit: "1" } }),
    });
    if (!res.ok) {
      console.log(`gossip-cron: dispatch failed ${res.status} ${await res.text()}`);
    } else {
      console.log(`gossip-cron: dispatched gossip-drip (LA hour ${h})`);
    }
  },
};
