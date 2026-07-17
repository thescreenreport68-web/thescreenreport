// BOX-OFFICE RADAR SENTINEL (P4, BOX_OFFICE_UPGRADE_PLAN §L1) — a stateless Cloudflare Worker on the
// news-cron pattern. Fires every 2 MINUTES (was: one blind dispatch per hour) and does two jobs, both
// pure regex over the first 60KB of ~6 trade feeds (zero AI, zero state, free plan):
//
//  1. BREAKING FAST-PATH: a fresh Tier-S box-office headline (record / all-time / #1 debut / crosses a
//     round billion) → dispatch the drip NOW (max 1 breaking dispatch per firing). The drip's concurrency
//     group serializes it; borun's dedup/materiality/walls decide what actually publishes. Detection
//     latency drops from ≤60 min to ≤2 min.
//  2. BOUNDARY DRIP: on each :00/:30 boundary (minute%30 < 2) → the regular drip dispatch (limit=2;
//     the P3 pacing governor shapes down — an ahead-of-pace tick exits in seconds at ~$0, so the extra
//     boundary capacity costs nothing and is there the moment supply exists).
//
// STATELESS freshness: an item is "breaking-fresh" only if its pubDate is within the last 4 minutes —
// the window covers the 2-min firing interval so nothing is missed, and borun absorbs a rare double-see.
// Free-plan discipline (the news sentinel's lesson): 60KB feed slices (regex over a 500KB feed is CPU),
// ≤10 subrequests/firing.
//
// Secrets:  GH_TOKEN (fine-grained PAT, Actions read/write). Vars: GH_OWNER, GH_REPO, GH_REF.

const FEEDS = [
  "https://variety.com/t/box-office/feed/",
  "https://deadline.com/tag/box-office/feed/",
  "https://www.hollywoodreporter.com/t/box-office/feed/",
  "https://variety.com/feed/",
  "https://deadline.com/feed/",
  "https://www.thewrap.com/feed/",
];

// The beat scope (mirror of pipeline/boxoffice/find/sources.mjs BO_SCOPE).
const BO_SCOPE = /box[- ]?office|opening (weekend|day|night)|debut(ed|s)? (to|with) \$|gross(es|ed)?|cume\b|crosses \$|\$\d[\d.,]*\s?(million|billion|m\b|b\b)|now streaming|hits (netflix|max|hulu|disney|prime|peacock|paramount)|top ?10|watch[- ]?hours|viewership|weekend (estimates|actuals|preview|projections)|milestone|highest[- ]grossing/i;
// Tier-S: the stories worth a minutes-level dispatch (records, all-time marks, #1 debuts, billion crossings).
const S_CLASS = /\brecord\b|all[- ]time|biggest (opening|debut|weekend|day)|highest[- ]grossing|crosses \$\d|\$\d[\d.,]*\s?billion|shatters|smashes|no\.? ?1\b|number[- ]one (debut|opening)|#1 (debut|opening|weekend)/i;
const JUNK_RE = /\breview\b|\binterview\b|photos|gallery|red carpet|trailer\b|opinion|commentary|podcast|recap\b|awards? (race|season|predictions)/i;

// Streaming-first boundary hours (UTC) — ~5 of 24, spread through the day (the owner's 5-of-20 share;
// the 15/5 cap inside borun does the hard enforcement).
const STREAM_HOURS = new Set([2, 7, 12, 17, 22]);

const FRESH_MS = 4 * 60 * 1000;
const SLICE = 60 * 1024;

async function dispatch(env, inputs, label) {
  const url = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/boxoffice-drip.yml/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "boxoffice-radar-worker",
    },
    body: JSON.stringify({ ref: env.GH_REF || "main", inputs }),
  });
  console.log(res.ok ? `boxoffice-radar: dispatched (${label})` : `boxoffice-radar: dispatch FAILED ${res.status} (${label}) ${await res.text()}`);
  return res.ok;
}

export default {
  async scheduled(event, env, ctx) {
    const nowMs = event.scheduledTime || Date.now();
    const now = new Date(nowMs);

    // ── 1. BREAKING SWEEP — every firing, pure regex, fail-soft per feed ──
    let breaking = null;
    for (const feedUrl of FEEDS) {
      if (breaking) break;
      try {
        const res = await fetch(feedUrl, { headers: { "user-agent": "Mozilla/5.0 (compatible; TSR-radar)" }, cf: { cacheTtl: 60 } });
        if (!res.ok) continue;
        const xml = (await res.text()).slice(0, SLICE); // newest items sit at the top of the feed
        for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
          const b = m[1];
          const title = ((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
          const pub = Date.parse(((b.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || "").trim());
          if (!title || !Number.isFinite(pub)) continue;
          if (nowMs - pub > FRESH_MS) break; // items are newest-first; past the window → stop scanning this feed
          if (JUNK_RE.test(title) || !BO_SCOPE.test(title) || !S_CLASS.test(title)) continue;
          breaking = title;
          break;
        }
      } catch { /* a dead feed never kills the firing */ }
    }
    if (breaking) {
      await dispatch(env, { limit: "1", stream: "false" }, `BREAKING: ${breaking.slice(0, 80)}`);
    }

    // ── 2. BOUNDARY DRIP — the regular clock, on :00/:30 (minute%30 < 2 with a 2-min cron = exactly once) ──
    const minute = now.getUTCMinutes();
    if (minute % 30 < 2) {
      const stream = STREAM_HOURS.has(now.getUTCHours()) && minute < 30 ? "true" : "false";
      await dispatch(env, { limit: "2", stream }, `boundary ${now.getUTCHours()}:${String(minute).padStart(2, "0")} ${stream === "true" ? "streaming-first" : "box-office-first"}`);
    }
  },
};
