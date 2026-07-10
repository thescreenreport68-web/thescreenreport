// AGENT 3 — EMBED (owner-requested specialist). Its one job: find the Instagram + X posts worth
// embedding in this article. X ids come from the harvest (keyless syndication cache = the receipt);
// Instagram URLs are scanned from the RAW HTML of the source pages (extraction strips embeds) with a
// caption-context snippet, then ONE cheap relevance classify picks the keepers. BEST-EFFORT ALWAYS:
// embeds are garnish — any failure here ships the article without embeds, never blocks it.
import { agentChat } from "../models.mjs";
import { MAX_EMBEDS } from "../config.inside.mjs";

const IG_URL_RX = /https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]{5,15})/g;

// Scan raw source-page HTML for IG post URLs + a nearby text snippet (usually the embed caption).
export async function scanPagesForInstagram(sources, { fetchImpl = fetch, maxPages = 4, timeoutMs = 8000 } = {}) {
  const found = new Map(); // shortcode -> { url, context }
  for (const s of (sources || []).filter((x) => x?.url && !/instagram\.com/.test(x.url)).slice(0, maxPages)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      t.unref?.();
      const res = await fetchImpl(s.url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; ScreenReportBot)" }, redirect: "follow" });
      const html = await res.text();
      clearTimeout(t);
      for (const m of html.matchAll(IG_URL_RX)) {
        const code = m[1];
        if (found.has(code)) continue;
        const at = m.index ?? 0;
        const context = html.slice(Math.max(0, at - 300), at + 300).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220);
        found.set(code, { url: `https://www.instagram.com/p/${code}/`, context });
      }
    } catch { /* dead/slow page — skip */ }
  }
  return [...found.values()];
}

// run(job) → job.embeds = { tweetIds[], instagramUrls[] }. Never throws.
export async function run(job, { scanImpl = scanPagesForInstagram, chatImpl = null } = {}) {
  const embeds = { tweetIds: (job.factBlock?.tweetIds || []).slice(0, MAX_EMBEDS), instagramUrls: [] };
  try {
    const sources = [...(job.bundle?.sources || []), ...(job.story?.sources || [])];
    const candidates = await scanImpl(sources);
    if (candidates.length) {
      // One cheap relevance pass over the caption contexts — keep only posts about THIS subject.
      const subject = job.story.work
        ? `the ${job.story.work.type === "tv" ? "TV series" : "movie"} "${job.story.work.title}"`
        : job.story.primaryEntity;
      const { data } = await agentChat("embed", {
        system: `You pick which Instagram posts belong in an article, from their caption context. Keep a post ONLY if its context is clearly about the SUBJECT (not an ad, another work, or unrelated). Output STRICT JSON only.`,
        user: `SUBJECT: ${subject}\nARTICLE ANGLE: ${job.angle.angle}\n\nCANDIDATES:\n${candidates.map((c, i) => `${i}. ${c.url} :: ${c.context || "(no context)"}`).join("\n")}\n\nJSON: {"keep":[0,2]}`,
      }, chatImpl ? { chatImpl } : {});
      const keep = Array.isArray(data?.keep) ? data.keep : [];
      embeds.instagramUrls = keep.map((i) => candidates[i]?.url).filter(Boolean);
    }
  } catch { /* best-effort: no IG embeds */ }
  // Total embed cap across platforms (page weight): X first (they carry the reaction text), then IG.
  const igRoom = Math.max(0, MAX_EMBEDS - embeds.tweetIds.length);
  embeds.instagramUrls = embeds.instagramUrls.slice(0, igRoom);
  job.embeds = embeds;
  return job;
}
