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
import { agentChat } from "./models.mjs";

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
// Bounded — the hero picker og-fetches source URLs in the hot path; a hanging outlet must not stall the run.
const OG_TIMEOUT_MS = 8000;
const defaultFetch = (url, opts = {}) => fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(OG_TIMEOUT_MS) });

// THE STORY PHOTO (owner directive): use the actual event photo the story is ABOUT — the source outlet's
// og:image, which is usually the wide, on-topic (often paparazzi/agency) shot that HOOKS, instead of a tight TMDB
// headshot. HOTLINKED (not re-hosted). Fail-safe: any issue ⇒ skip and fall back to TMDB. (Policy note: these are
// unlicensed agency photos — owner accepts the copyright exposure pre-audience; revisit before launch.)
export async function fetchOgImage(url, fetchImpl = defaultFetch) {
  try {
    const r = await fetchImpl(url, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const html = (await r.text()).slice(0, 250000);
    // Parse each <meta> tag and match the property/name EXACTLY — otherwise "og:image:width" (content "1200") gets
    // grabbed instead of the real "og:image" URL (Page Six emits the width tag first). Order-independent within a tag.
    const metas = html.match(/<meta\b[^>]*>/gi) || [];
    let src = "";
    for (const target of ["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"]) {
      for (const tag of metas) {
        const prop = (tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1] || "").toLowerCase();
        if (prop !== target) continue;
        const c = (tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1] || "").trim().replace(/&amp;/g, "&");
        if (c && !/^\d+$/.test(c)) { src = c; break; } // skip a bare number (a stray width/height value)
      }
      if (src) break;
    }
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

// VISION GATE — two modes:
//   mode "source" (for the outlet's own STORY photos): we TRUST the photo depicts the story (the outlet ran it
//     WITH the article — it may show the person among others, at the event, or from afar). Vision only REJECTS a
//     logo / ad / graphic / unrelated image (usable=false). This stops a wide, relevant story photo from losing
//     to a generic headshot just because the face isn't a tight close-up.
//   mode "identity" (for the TMDB fallback): the image MUST depict the right person (guards wrong-person matches).
// Fail-safe: any error ⇒ null (caller falls back).
async function rankByVision(candidates, ctx, { model, visionImpl, mode = "identity" } = {}) {
  const impl = visionImpl || (async (imgs, prompt) => {
    const { data } = await agentChat("image", { model: model || undefined, images: imgs, json: true,
      system: "You are an entertainment photo editor choosing the lead image for a celebrity news/gossip story. Output strict JSON only.",
      user: prompt });
    return data;
  });
  const imgs = candidates.map((c) => c.url).slice(0, 4);
  const people = [ctx.entity, ...(ctx.coSubjects || [])].filter(Boolean).join(" and/or ");
  const head = `STORY: ${ctx.headline}\nABOUT: ${people || ctx.entity}${ctx.title ? ` (context: ${ctx.title})` : ""}\nTYPE: ${ctx.gossipType}\n\nYou are shown ${imgs.length} candidate images, indexed 0..${imgs.length - 1} in order.`;
  const prompt = mode === "source"
    ? `${head}\nThese are images the outlets published near this story. The RIGHT image shows ${people || ctx.entity} (or the event/people in the story) — a wide shot, an event photo, a candid, or the person among a crowd is all GOOD. For EACH image set usable=true ONLY if it plausibly shows ${people || ctx.entity} or the actual event/people of THIS story. Set usable=false for: a logo/ad/graphic/text screenshot, OR a photo of a CLEARLY DIFFERENT person, a generic stock/model image, or anything not connected to this story (a mismatched gallery-cover image is NOT usable, even if it's a real photo). Rate visual impact + story fit.\nReturn STRICT JSON: { "ranked": [ { "index": 0, "usable": true, "impact": 0-10, "fit": 0-10, "who": "who is actually shown", "why": "short" } ] }`
    : `${head}\nFor EACH, judge whether it actually DEPICTS ${ctx.entity} (the correct person), plus its visual impact and story fit.\nReturn STRICT JSON: { "ranked": [ { "index": 0, "identityMatch": true, "impact": 0-10, "fit": 0-10, "why": "short" } ] }`;
  try {
    const data = await impl(imgs, prompt);
    const ranked = Array.isArray(data?.ranked) ? data.ranked : [];
    if (!ranked.length) return null;
    const ok = (r) => (mode === "source" ? r.usable !== false : !!r.identityMatch);
    const score = (r) => (ok(r) ? 100 : 0) + (Number(r.impact) || 0) + (Number(r.fit) || 0);
    ranked.sort((a, b) => score(b) - score(a));
    const top = ranked.find((r) => candidates[r.index] && ok(r)); // must be usable (source) / the right person (identity)
    // { pick } = a good image; { allRejected } = it RAN but nothing was usable/matched (fall back); null = an error.
    return top ? { pick: candidates[top.index], score: score(top), why: top.why || "", who: (top.who || "").trim() } : { pick: null, allRejected: true };
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

// Build the final image-hero result object (credit / caption / alt / serving dims / orientation).
// CAPTION SAFETY: only name a subject we are SURE of. A TMDB image is vision-identity-verified ⇒ we may say
// "Pictured: <entity>". A source (outlet) photo may show anyone (a gallery cover, a crowd), so we caption it with
// who vision actually SAW (chosen.who) if known, else NO name at all — never a confident wrong "Pictured: X".
function buildImageHero(chosen, { entity, headline, embed, score, why, candidateCount }) {
  const credit = chosen.kind === "source-photo" ? `Photo via ${chosen.outlet || "the source"}`
    : chosen.kind === "video-thumb" ? "Still via YouTube"
    : "Image: The Movie Database (TMDB)";
  const namedSubject = chosen.kind === "source-photo"
    ? (chosen.who || "")                                  // source photo: only the person vision positively saw
    : chosen.kind === "video-thumb" ? ""                  // a video still: don't assert who
    : (entity || "");                                     // TMDB: identity-verified, safe to name the entity
  const caption = namedSubject ? `Pictured: ${namedSubject}${chosen.titleContext ? ` in ${chosen.titleContext}` : ""}.` : (chosen.titleContext || "");
  const alt = namedSubject ? `${namedSubject}${chosen.titleContext ? ` in ${chosen.titleContext}` : ""}` : (entity || headline || "hero image");
  // Story photos / backdrops / yt thumbs = 16:9 landscape (fill the wide hero, no tight crop); profiles/posters = 2:3.
  const DIMS = { "source-photo": [1200, 675], backdrop: [1280, 720], "video-thumb": [1280, 720], poster: [800, 1200], profile: [800, 1200] };
  const [width, height] = DIMS[chosen.kind] || [1200, 675];
  return {
    kind: "image", src: chosen.url, width, height, orientation: width >= height ? "landscape" : "portrait",
    alt, caption, credit, source: chosen.kind === "source-photo" ? "source" : chosen.kind === "video-thumb" ? "youtube" : "tmdb",
    embed: embed || null, score, why, candidateCount,
  };
}

export async function pickHero(
  { topic, article, bundle, frame } = {},
  { getPersonImagesImpl = getPersonImages, getTitleImagesImpl = getTitleImages, visionImpl, model, vision = true, fetchImpl = defaultFetch, ogImpl = fetchOgImage, sourcePhoto = true, maxSourcePhotos = 3 } = {}
) {
  const entity = topic?.primaryEntity || article?.entity || "";
  const headline = article?.title || topic?.title || "";
  const gossipType = topic?.gossipType || article?.gossipType || "general";
  const titleHint = topic?.titleHint || topic?.title?.match(/["“]([^"”]{2,60})["”]/)?.[1] || null;
  const ctx = { entity, headline, gossipType, title: titleHint, coSubjects: topic?.coSubjects || [] };
  const embed = detectEmbed(collectUrls(topic, bundle));

  // ── 1) THE STORY PHOTO (STRONGLY PREFERRED) — the image the outlets ran WITH this story (og:image). It matches
  // the article: it shows the right people/event (a "spotted with X" story gets a photo of BOTH), not a lone
  // headshot. We TRUST it depicts the story; vision only rejects a logo/ad/graphic. This is the image quality the
  // owner wants on EVERY article.
  if (sourcePhoto) {
    const photos = [];
    const seenDom = new Set();
    if (embed?.platform === "youtube" && embed.thumb) photos.push({ url: embed.thumb, kind: "video-thumb", outlet: "YouTube" });
    // primary (non-corroborating) sources first — the primary source's photo is THE story photo — then corroborating.
    const ordered = [...(bundle?.sources || []).filter((s) => s?.url && !s.corroborating), ...(bundle?.sources || []).filter((s) => s?.url && s.corroborating)];
    for (const s of ordered) {
      if (photos.length >= maxSourcePhotos) break;
      const dom = (s.url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || "").toLowerCase();
      if (seenDom.has(dom)) continue;
      seenDom.add(dom);
      try { const og = await ogImpl(s.url, fetchImpl); if (og && !photos.some((p) => p.url === og)) photos.push({ url: og, kind: "source-photo", outlet: outletLabel(s) }); } catch { /* skip */ }
    }
    if (photos.length) {
      let picked = photos[0], score = null, why = "the outlet's own story photo";
      if (vision) {
        const r = await rankByVision(photos, ctx, { model, visionImpl, mode: "source" });
        if (r?.pick) { picked = r.pick; picked.who = r.who || ""; score = r.score; why = r.why || why; }
        else if (r?.allRejected) picked = null; // vision ran and every source photo was a logo/ad/wrong-person → fall to TMDB
        // r === null ⇒ vision unavailable (error) → keep photos[0] (trust the outlet), but with a NEUTRAL caption (who unknown).
      }
      if (picked) return buildImageHero(picked, { entity, headline, embed, score, why, candidateCount: photos.length });
    }
  }

  // ── 2) TMDB FALLBACK (only when there's NO usable story photo) — REQUIRE an identity match so we never show a
  // wrong-person image (the "random backdrop" problem). Prefer a backdrop, then the person's profile.
  let personSet = null, titleSet = null;
  try { if (entity) personSet = await getPersonImagesImpl(entity); } catch { /* skip */ }
  try { if (titleHint) titleSet = await getTitleImagesImpl(titleHint); } catch { /* skip */ }
  const tmdb = stillCandidates(personSet, titleSet);
  if (tmdb.length) {
    let picked = null, score = null, why = "TMDB match";
    if (vision) {
      const r = await rankByVision(tmdb, ctx, { model, visionImpl, mode: "identity" });
      if (r?.pick) { picked = r.pick; score = r.score; why = r.why || why; }
      else if (r?.allRejected) picked = null; // vision says NONE of the TMDB images is the right person → show no wrong image
      // r===null: vision unavailable → we CANNOT verify identity, so only the person's OWN profile headshot (from a
      // getPersonImages(entity) lookup = the correct person) is safe. NEVER fall back to a title backdrop (a random
      // movie scene that may not even show them) — no image beats a wrong image.
      else picked = tmdb.find((c) => c.kind === "profile") || null;
    } else picked = tmdb[0]; // vision deliberately OFF (offline/config) — deterministic top; production always runs vision on
    if (picked) return buildImageHero(picked, { entity, headline, embed, score, why, candidateCount: tmdb.length });
  }

  // ── 3) No still resolved — lead with the receipt embed if we have one; else no hero.
  if (embed) return { kind: "embed", embed, alt: headline, caption: entity ? `Pictured: ${entity}.` : "", credit: `Via ${embed.platform}`, source: embed.platform, score: null, why: "no still resolved — leading with the source post", candidateCount: 0 };
  return null;
}
