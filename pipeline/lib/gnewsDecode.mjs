// GOOGLE-NEWS REDIRECT DECODER — turns a news.google.com/rss/articles/<ID> link into the REAL
// publisher URL without Jina. Anonymous r.jina.ai is per-IP throttled and blocked from datacenter
// ranges — the GitHub runners every 24/7 lane runs on — which killed the redirect-only extraction
// path in the 2026-07-10 inside-lane cloud run (gatherer starved: 1 extracted source/story vs ~6
// locally). Two KEYLESS strategies, in order:
//   1. FAST PATH (zero network): legacy IDs (CBMi…) are base64url protobuf blobs with the article
//      URL embedded — decode and pull the printable URL run.
//   2. BATCHEXECUTE: newer IDs (AU_yqL…) carry no URL; the article page ships data-n-a-sg /
//      data-n-a-ts attributes, and POSTing them to news.google.com's own batchexecute endpoint
//      (exactly what the page's JS does) returns the decoded URL.
// Both fail → null and the caller falls back to the existing Jina URL-Source path unchanged.
// Results (including failures) cache per-process — a run re-sees the same redirect across queries.

const CACHE = new Map();

// Host check by PARSED hostname (adversarial review 2026-07-10: a path-anchored regex missed the
// bare-host form and a substring check is spoofable via paths). Unparseable ⇒ treated as Google's
// own ⇒ skipped — a candidate we cannot classify is never returned.
const GOOGLE_HOST = /(^|\.)(google\.com|gstatic\.com|googleusercontent\.com|ampproject\.org)$/i;
const isGoogleOwn = (u) => {
  try { return GOOGLE_HOST.test(new URL(u).hostname); } catch { return true; }
};

export function gnewsArticleId(url) {
  try {
    const u = new URL(url);
    if (!/(^|\.)news\.google\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/\/(?:rss\/)?(?:articles|read)\/([^/?#]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Legacy CBMi… IDs: base64url → protobuf blob with the URL as a length-delimited field. Walk the
// blob and, at each offset, read a varint length and take EXACTLY that many bytes — never a regex
// run over raw bytes (adversarial review: a printable trailing tag byte GLUED onto the URL and a
// raw UTF-8 byte TRUNCATED it, both yielding wrong-but-valid URLs that would replace the working
// Jina-redirect fallback). A field is accepted only if every byte is printable ASCII and the whole
// field is one URL; anything else falls through to batchexecute/Jina.
export function decodeGnewsBase64(id) {
  try {
    const buf = Buffer.from(String(id).replace(/-/g, "+").replace(/_/g, "/"), "base64");
    for (let i = 0; i + 2 < buf.length; i++) {
      let len = 0, shift = 0, j = i + 1, ok = false;
      while (j < buf.length && shift <= 21) {
        const b = buf[j]; len |= (b & 0x7f) << shift; j++;
        if (!(b & 0x80)) { ok = true; break; }
        shift += 7;
      }
      if (!ok || len < 12 || len > 2048 || j + len > buf.length) continue;
      const s = buf.subarray(j, j + len).toString("latin1");
      if (!/^https?:\/\/[!-~]+$/.test(s)) continue; // full-field, every byte printable — no glue, no truncation
      if (isGoogleOwn(s)) continue;
      return s;
    }
    return null;
  } catch {
    return null;
  }
}

const UA = { "user-agent": "Mozilla/5.0 (compatible; ScreenReportBot)" };
const to = (ms) => ({ signal: AbortSignal.timeout(ms) });

async function batchexecute(id, { fetchImpl = fetch } = {}) {
  // 1. The article interstitial carries the signature + timestamp its own JS would send.
  const page = await fetchImpl(`https://news.google.com/rss/articles/${id}`, { headers: UA, ...to(8000) });
  if (!page.ok) return null;
  const html = await page.text();
  const sig = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1];
  const ts = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1];
  if (!sig || !ts) return null;
  // 2. Replay the page's own decode call.
  const inner = JSON.stringify([
    "garturlreq",
    [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id, Number(ts), sig,
  ]);
  const body = "f.req=" + encodeURIComponent(JSON.stringify([[["Fbv4je", inner, null, "generic"]]]));
  const res = await fetchImpl("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST",
    headers: { ...UA, "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body,
    ...to(8000),
  });
  if (!res.ok) return null;
  const raw = await res.text();
  // Response = `)]}'` guard + length-prefixed JSON lines; the payload line names our RPC id.
  const line = raw.split("\n").find((l) => l.includes("Fbv4je"));
  if (!line) return null;
  const payload = JSON.parse(JSON.parse(line)[0][2]);
  const real = payload?.[1];
  return typeof real === "string" && /^https?:\/\//.test(real) ? real : null;
}

export async function decodeGnewsUrl(url, { fetchImpl = fetch } = {}) {
  const id = gnewsArticleId(url);
  if (!id) return null;
  if (CACHE.has(id)) return CACHE.get(id);
  let real = decodeGnewsBase64(id);
  if (!real) real = await batchexecute(id, { fetchImpl }).catch(() => null);
  CACHE.set(id, real);
  return real;
}
