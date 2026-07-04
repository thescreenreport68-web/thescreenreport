// Reaction niche: fetch public X posts via react-tweet's KEYLESS syndication API, cache the JSON
// (so the static build never depends on a live X call), and build a grounding block for the
// "consensus" synthesis. LEGAL: we embed + summarize public posts only — never re-host their media.
import fs from "node:fs";
import path from "node:path";
import { getTweet } from "react-tweet/api";

import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url)); // …/site/pipeline/lib
const CACHE = path.resolve(__dirname, "../../data/tweets");

// Fetch each id, cache <id>.json, return { tweets, ids } for the ones that resolved
// (silently drops deleted/protected ids so we never try to embed an unrenderable post).
export async function cacheTweets(ids = []) {
  fs.mkdirSync(CACHE, { recursive: true });
  const tweets = [];
  const ok = [];
  for (const id of ids) {
    try {
      const t = await getTweet(String(id));
      if (t && t.text) {
        fs.writeFileSync(path.join(CACHE, `${id}.json`), JSON.stringify(t));
        tweets.push(t);
        ok.push(String(id));
      } else {
        console.log(`    ⚠ tweet ${id} did not resolve (deleted/protected) — skipped`);
      }
    } catch (e) {
      console.log(`    ⚠ tweet ${id} fetch error — skipped`);
    }
  }
  return { tweets, ids: ok };
}

// Plain-text grounding for the synthesis: the REAL post text + author + likes. Synthesize ONLY from these.
export function reactionFactBlock(tweets) {
  return (
    "REAL PUBLIC AUDIENCE REACTIONS (these exact posts are embedded in the article; synthesize the overall sentiment ONLY from these — do NOT invent reactions, quote at length, or attribute views to anyone not here):\n" +
    tweets
      .map((t, i) => {
        const handle = t.user?.screen_name ? `@${t.user.screen_name}` : "user";
        const name = t.user?.name || "";
        const likes = typeof t.favorite_count === "number" ? ` (${t.favorite_count} likes)` : "";
        return `${i + 1}. ${name} ${handle}${likes}: ${(t.text || "").replace(/\s+/g, " ").trim()}`;
      })
      .join("\n")
  );
}
