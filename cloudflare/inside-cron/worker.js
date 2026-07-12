// INSIDE-STORIES CRON CLOCK — a Cloudflare Worker with a Cron Trigger. Each firing it calls the GitHub
// `workflow_dispatch` API to run the `inside-agents` workflow (the multi-agent audience-reaction lane).
// Fires at :30 past EVEN UTC hours (owner 2026-07-12) so each Inside post lands BETWEEN the gossip
// (even :00) and news (odd :00) posts — the three lanes never collide. Same reliable external-clock
// mechanism as news-cron / gossip-cron (GitHub's own cron is drifty/dropped under load).
//
// Secret (`wrangler secret put GH_TOKEN`): a GitHub PAT with "Actions: Read and write" on the repo.
// Vars (wrangler.toml [vars]): GH_OWNER, GH_REPO, GH_REF (the branch the workflow runs on / commits to).
export default {
  async scheduled(event, env, ctx) {
    const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/inside-agents.yml/dispatches`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "inside-cron-worker",
      },
      body: JSON.stringify({ ref: env.GH_REF || "main", inputs: { limit: "1" } }),
    });
    console.log(res.ok ? "inside-cron: dispatched inside-agents" : `inside-cron: dispatch failed ${res.status} ${await res.text()}`);
  },
};
