// GOSSIP CRON CLOCK — a Cloudflare Worker with a Cron Trigger (hourly). Each firing it calls the GitHub
// `workflow_dispatch` API to run the `gossip-drip` workflow. It ticks 24/7; the node SCHEDULER decides whether to
// actually publish — it posts ~1 article every ~2 hours, around the clock (see scheduler.mjs's interval gate). This
// is the same reliable external-clock mechanism the news automation uses (GitHub's own cron is drifty).
//
// Secrets (`wrangler secret put`): GH_TOKEN (a PAT with Actions: read/write on the repo).
// Vars (wrangler.toml [vars]): GH_OWNER, GH_REPO, GH_REF (the DEFAULT branch — workflow_dispatch needs the workflow
//                              file to exist on the repo's default branch).

export default {
  async scheduled(event, env, ctx) {
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
    console.log(res.ok ? "gossip-cron: dispatched gossip-drip" : `gossip-cron: dispatch failed ${res.status} ${await res.text()}`);
  },
};
