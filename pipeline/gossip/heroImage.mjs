// GOSSIP — HERO IMAGE PICKER (Step 6). The owner's bar: the lead image must be POWERFUL and SPECIFIC to THIS
// gossip so a reader clicks through — never a flat/generic stock shot, and NEVER paparazzi (legal). So we pick in
// this order, most-specific-and-legal first:
//   1) THE RECEIPT — embed the actual YouTube clip / X / Bluesky post the rumor is ABOUT (it IS the moment;
//      platform-served = legally safest). Instagram slot built but DEFERRED until the owner finishes Meta review.
//   2) A CINEMATIC STILL — TMDB official backdrops (1280px stills from the person's biggest title) read far more
//      powerful than a headshot. Then profiles, then poster. TMDB images are official/promotional = legal.
//   3) A VISION GATE (gemini-2.5-flash-lite, cheap; never a premium model) looks at the candidate stills WITH the
//      story context and picks the one that is the RIGHT person AND the most striking + on-vibe. Fires only with
//      ≥2 candidates (saves credits). Fail-safe: any vision error ⇒ the deterministic order above.
// Wikimedia Commons is intentionally NOT used (owner: weak source, wastes credits).
// Output: { kind:"image"|"embed", src?, width?, height?, alt, caption, credit, source, embed?, score?, why? } | null.
import { getPersonImages, getTitleImages } from "../lib/tmdb.mjs";
import { chat } from "../lib/openrouter.mjs";

const RX = {
  youtube: /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
  x: /(?:twitter\.com|x\.com)\/([^/]+)\/status\/(\d+)/i,
  bluesky: /bsky\.app\/profile\/([^/]+)\/post\/([A-Za-z0-9]+)/i,
  instagram: /instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i,
  // Facebook: ONLY post-bearing paths embed as a receipt — /{page}/posts/, permalink.php?, story.php?, /videos/,
  // watch?, photo.php?, /photos/, share/{p|v|r}/, reel/. A bare profile / group / login / sharer / plugins URL is
  // NOT a post and would render a broken/empty iframe, so it must NOT match.
  facebook: /(?:^|\/\/)(?:www\.|m\.|web\.)?facebook\.com\/(?:[^/?#]+\/posts\/|permalink\.php\?|story\.php\?|[^/?#]+\/videos\/|watch\/?\?|photo\.php\?|[^/?#]+\/photos\/|share\/(?:p|v|r)\/|reel\/)/i,
};

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";
const defaultFetch = (url, opts) => fetch(url, opts);

// THE STORY PHOTO (owner directive): use the actual event photo the story is ABOUT — the source outlet's
// og:image, which is usually the wide, on-topic (often paparazzi/agency) shot that HOOKS, instead of a tight TMDB
// headshot. HOTLINKED (not re-hosted). Fail-safe: any issue ⇒ skip and fall back to TMDB. (Policy note: these are
// unlicensed agency photos — owner accepts the copyright exposure pre-audience; revisit before launch.)
export async function fetchOgImage(url, fetchImpl = defaultFetch) {
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 80000);
    const m =
      html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    let src = (m?.[1] || "").trim().replace(/&amp;/g, "&");
    if (!src) return null;
    if (src.startsWith("//")) src = "https:" + src;
    else if (src.startsWith("/")) { try { src = new URL(src, url).href; } catch { return null; } }
    if (!/^https?:\/\//i.test(src)) return null;
    // Validate it's a real, directly-loadable image (filters 404s / non-image og:images so we never hotlink a
    // broken hero). Can't fully predict browser hotlink-protection, but this catches the obvious failures.
    try {
      const ir = await fetchImpl(src, { headers: { "User-Agent": UA } });
      const ct = ir?.headers?.get?.("content-type") || "";
      if (!ir?.ok || !/^image\//i.test(ct)) return null;
    } catch { return null; }
    return src;
  } catch {
    return null;
  }
}

// registrable-domain-ish outlet label for the photo credit.
const outletLabel = (s) => s?.outlet || (s?.url ? (s.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]) : "the source");

// Every URL we might embed: the topic's own link + every source URL (incl. corroborating). Deduped, order kept.
export function collectUrls(topic, bundle) {
  const urls = [topic?.url, topic?.link, ...((topic?.sources || []).map((s) => s.url)), ...((bundle?.sources || []).map((s) => s.url))];
  return [...new Set(urls.filter(Boolean))];
}

// The strongest embeddable receipt among the URLs. ALL of these embed CLIENT-SIDE from just the public post URL —
// no Meta developer account / app / token (verified 2026). Priority: YouTube (also yields a hero thumbnail) >
// Instagram > X > Facebook > Bluesky.
export function detectEmbed(urls) {
  let yt, ig, x, fb, bsky;
  for (const u of urls) {
    let m;
    if (!yt && (m = u.match(RX.youtube))) yt = { platform: "youtube", videoId: m[1], sourceUrl: u, embedUrl: `https://www.youtube.com/embed/${m[1]}`, thumb: `https://i.ytimg.com/vi/${m[1]}/maxresdefault.jpg` };
    else if (!ig && (m = u.match(RX.instagram))) ig = { platform: "instagram", shortcode: m[1], sourceUrl: u };
    else if (!x && (m = u.match(RX.x))) x = { platform: "x", handle: m[1], tweetId: m[2], sourceUrl: u };
    else if (!fb && RX.facebook.test(u)) fb = { platform: "facebook", sourceUrl: u, embedUrl: `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(u)}&show_text=true&width=500` };
    else if (!bsky && (m = u.match(RX.bluesky))) bsky = { platform: "bluesky", handle: m[1], rkey: m[2], sourceUrl: u };
  }
  return yt || ig || x || fb || bsky || null;
}

// VISION GATE — pick the best still among candidates by identity match + impact + story fit. Fail-safe.
async function rankByVision(candidates, ctx, { model, visionImpl }) {
  const impl = visionImpl || (async (imgs, prompt) => {
    const { data } = await chat({ model: model || "google/gemini-2.5-flash-lite", images: imgs, json: true, maxTokens: 400, temperature: 0,
      system: "You are an entertainment photo editor choosing a lead image for a celebrity gossip story. Be strict about identity and pick the most striking, on-topic, tasteful shot. Output strict JSON only.",
      user: prompt });
    return data;
  });
  const imgs = candidates.map((c) => c.url).slice(0, 4);
  const prompt = `STORY: ${ctx.headline}
ABOUT: ${ctx.entity}${ctx.title ? ` (context: ${ctx.title})` : ""}
TYPE: ${ctx.gossipType}

You are shown ${imgs.length} candidate images, indexed 0..${imgs.length - 1} in order.
For EACH, judge whether it actually depicts ${ctx.entity}, plus its visual impact and fit for this story.
Return STRICT JSON: { "ranked": [ { "index": 0, "identityMatch": true, "impact": 0-10, "fit": 0-10, "why": "short" } ] }`;
  try {
    const data = await impl(imgs, prompt);
    const ranked = Array.isArray(data?.ranked) ? data.ranked : [];
    if (!ranked.length) return null;
    const score = (r) => (r.identityMatch ? 100 : 0) + (Number(r.impact) || 0) + (Number(r.fit) || 0);
    ranked.sort((a, b) => score(b) - score(a));
    const top = ranked.find((r) => candidates[r.index]);
    return top ? { pick: candidates[top.index], score: score(top), why: top.why || "" } : null;
  } catch {
    return null;
  }
}

// Build the ordered still candidates from TMDB (most "powerful" first: title backdrop > person backdrop >
// profiles > poster). Each = { url, kind, w?, h?, titleContext? }.
function stillCandidates(personSet, titleSet) {
  const out = [];
  if (titleSet?.backdrops?.length) for (const url of titleSet.backdrops.slice(0, 2)) out.push({ url, kind: "backdrop", titleContext: titleSet.title });
  if (personSet?.backdrop?.url) out.push({ url: personSet.backdrop.url, kind: "backdrop", titleContext: personSet.backdrop.title });
  for (const p of personSet?.profiles || []) out.push({ url: p.url, kind: "profile", w: p.w, h: p.h });
  if (titleSet?.poster) out.push({ url: titleSet.poster, kind: "poster", titleContext: titleSet?.title });
  // de-dupe by URL, keep order
  const seen = new Set();
  return out.filter((c) => c.url && !seen.has(c.url) && seen.add(c.url));
}

export async function pickHero(
  { topic, article, bundle, frame } = {},
  { getPersonImagesImpl = getPersonImages, getTitleImagesImpl = getTitleImages, visionImpl, model, vision = true, fetchImpl = defaultFetch, ogImpl = fetchOgImage, sourcePhoto = true, maxSourcePhotos = 2 } = {}
) {
  const entity = topic?.primaryEntity || article?.entity || "";
  const headline = article?.title || topic?.title || "";
  const gossipType = topic?.gossipType || article?.gossipType || "general";
  const titleHint = topic?.titleHint || topic?.title?.match(/["“]([^"”]{2,60})["”]/)?.[1] || null;

  // 1) THE RECEIPT embed (kept alongside the hero image as in-body media; becomes the hero only if no still resolves).
  const embed = detectEmbed(collectUrls(topic, bundle));

  // 2) TMDB stills (fail-safe: a lookup miss is fine, we just have fewer candidates).
  let personSet = null, titleSet = null;
  try { if (entity) personSet = await getPersonImagesImpl(entity); } catch { /* skip */ }
  try { if (titleHint) titleSet = await getTitleImagesImpl(titleHint); } catch { /* skip */ }
  const candidates = stillCandidates(personSet, titleSet);
  // the YouTube receipt's thumbnail is also a still candidate (often the most on-topic visual).
  if (embed?.platform === "youtube" && embed.thumb) candidates.unshift({ url: embed.thumb, kind: "video-thumb", titleContext: "" });

  // 2b) THE STORY PHOTO — the source outlet's og:image (the actual event/paparazzi shot; wide + hooking). Prepend
  // it so it competes as (usually) the strongest candidate. Only the primary NON-corroborating sources with a URL.
  if (sourcePhoto) {
    const seenDom = new Set();
    const srcs = (bundle?.sources || []).filter((s) => s?.url && !s.corroborating);
    let added = 0;
    for (const s of srcs) {
      if (added >= maxSourcePhotos) break;
      const dom = (s.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || "").toLowerCase();
      if (seenDom.has(dom)) continue;
      seenDom.add(dom);
      try {
        const og = await ogImpl(s.url, fetchImpl);
        if (og) { candidates.unshift({ url: og, kind: "source-photo", outlet: outletLabel(s), titleContext: "" }); added++; }
      } catch { /* skip */ }
    }
  }

  // 3) Pick the still — vision-ranked when there are ≥2 candidates; otherwise the deterministic top.
  let chosen = candidates[0] || null, score = null, why = "deterministic top candidate";
  if (candidates.length >= 2 && vision) {
    const r = await rankByVision(candidates, { entity, headline, gossipType, title: titleHint }, { model, visionImpl });
    if (r?.pick) { chosen = r.pick; score = r.score; why = r.why || why; }
  }

  const credit = !chosen ? null
    : chosen.kind === "source-photo" ? `Photo via ${chosen.outlet || "the source"}`
    : chosen.kind === "video-thumb" ? "Still via YouTube"
    : "Image: The Movie Database (TMDB)";
  // Caption is deliberately NEUTRAL — it must NOT restate an unconfirmed claim as fact (legal). "Pictured: X".
  const caption = entity ? `Pictured: ${entity}${chosen?.titleContext ? ` in ${chosen.titleContext}` : ""}.` : (chosen?.titleContext || "");
  const alt = entity ? `${entity}${chosen?.titleContext ? ` in ${chosen.titleContext}` : ""}` : (headline || "hero image");

  if (chosen) {
    // Serving dimensions by kind (for next/image layout + the OG card). Story photos / TMDB backdrops / yt thumbs
    // = 16:9 landscape (fill the wide hero with NO tight crop); profiles/posters = 2:3 portrait.
    const DIMS = { "source-photo": [1200, 675], backdrop: [1280, 720], "video-thumb": [1280, 720], poster: [800, 1200], profile: [800, 1200] };
    const [width, height] = DIMS[chosen.kind] || [1280, 720];
    const orientation = width >= height ? "landscape" : "portrait";
    return {
      kind: "image", src: chosen.url, width, height, orientation,
      alt, caption, credit, source: chosen.kind === "source-photo" ? "source" : chosen.kind === "video-thumb" ? "youtube" : "tmdb",
      embed: embed || null, // the originating post rides along as the in-body "receipt" (all embeds are account-free)
      score, why, candidateCount: candidates.length,
    };
  }
  // No still resolved — lead with the receipt embed if we have one; else no hero.
  if (embed) return { kind: "embed", embed, alt: headline, caption: entity ? `Pictured: ${entity}.` : "", credit: `Via ${embed.platform}`, source: embed.platform, score: null, why: "no still resolved — leading with the source post", candidateCount: 0 };
  return null;
}
