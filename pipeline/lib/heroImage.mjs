// NEWS — HERO IMAGE PICKER. Ported from the gossip automation's heroImage.mjs (`site-gossip/pipeline/gossip/`),
// which is the owner's image BAR: the lead image must be POWERFUL and SPECIFIC to THIS story so a reader clicks
// through — never a flat/generic stock headshot. We build candidates most-specific-first and let a cheap VISION
// gate pick the one that is the RIGHT subject AND the most striking + on-topic:
//   1) THE STORY PHOTO — the source outlet's og:image (the ACTUAL on-topic event photo the story is about; wide +
//      hooking). This is the single biggest upgrade over the old Wikimedia-headshot default.
//   2) CINEMATIC TMDB STILLS — official/promotional: a TITLE's clean backdrops (1280px) read far more powerful than
//      a headshot; then person profiles; then poster. TMDB images are official = legal.
//   3) (Wikimedia Commons stays as the caller's LAST-resort fallback — safe but generic — handled in run.mjs.)
// The VISION gate (gemini-2.5-flash-lite — cheap, NEVER a premium model) scores candidates on identity + impact +
// fit; fires only with >=2 candidates; any error falls back to the deterministic most-specific-first order.
// Output: { url, kind, credit, alt, caption, orientation, score, why, candidateCount } | null. The CALLER downloads
// the URL (static export needs local bytes) + validates size — same as the existing Wikimedia path.
import { getPersonImages, getTitleImages } from "./tmdb.mjs";
import { chat } from "./openrouter.mjs";
import { MODELS } from "../config.mjs";

const UA = "The Screen Report/1.0 (+https://thescreenreport.com)";
const VISION_MODEL = MODELS.verify || "google/gemini-2.5-flash-lite"; // cheap vision-capable model (owner: never premium)

// Request a bigger rendition of a CMS-resized image so the hero clears the >=1200px Discover floor. Major outlets
// (Deadline/Variety/THR = WordPress/PMC/Penske) serve og:image at ?w=1024 — bump the width param (and any resize/fit
// pair, keeping ratio) to 1600; the origin caps at the true original size, so this never upscales past what exists.
export function upsize(u, target = 1600) {
  try {
    let s = String(u);
    const wm = s.match(/[?&](?:w|width)=(\d+)/i);
    if (wm) {
      const w0 = Number(wm[1]);
      s = s.replace(/([?&](?:w|width)=)\d+/i, `$1${target}`);
      // Scale a standalone h/height param by the SAME factor — else a `?w=NNN&h=MMM` bounding box caps the render at
      // the small h and it fails the >=1200px gate (the common WordPress/Photon PMC/Penske pattern).
      if (w0 > 0) s = s.replace(/([?&](?:h|height)=)(\d+)/i, (m, p, h) => `${p}${Math.round((Number(h) * target) / w0)}`);
    }
    s = s.replace(/([?&](?:resize|fit)=)(\d+),(\d+)/i, (m, p, w, h) => `${p}${target},${Math.round((Number(h) / Number(w)) * target)}`);
    return s;
  } catch { return u; }
}

// THE STORY PHOTO — pull the source page's og:image / twitter:image (the on-topic hero the outlet chose). Validates
// it resolves to a real, directly-loadable image so we never pick a broken/placeholder hero. Fail-safe → null.
export async function fetchOgImage(url, fetchImpl = fetch) {
  try {
    // Timeout-bounded (the run loop is sequential, so a stalled outlet must never hang the article/batch).
    const r = await fetchImpl(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    // Search a generous window — PMC/Penske article pages front-load ~500k of inline script before the <head> meta
    // tags, so an 80k slice misses og:image entirely. 2M covers real article pages while bounding pathological ones.
    const html = (await r.text()).slice(0, 2_000_000);
    const m =
      html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    let src = (m?.[1] || "").trim().replace(/&amp;/gi, "&").replace(/&#0*38;/g, "&"); // decode named + numeric ampersand entities (some CMSs encode og:image URLs)
    if (!src) return null;
    if (src.startsWith("//")) src = "https:" + src;
    else if (src.startsWith("/")) { try { src = new URL(src, url).href; } catch { return null; } }
    if (!/^https?:\/\//i.test(src)) return null;
    try {
      const ir = await fetchImpl(src, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
      const ct = ir?.headers?.get?.("content-type") || "";
      if (!ir?.ok || !/^image\//i.test(ct)) return null;
    } catch { return null; }
    return src;
  } catch {
    return null;
  }
}

// Derive a clean outlet name for the credit. Strips CDN/asset subdomains (static0.slashfilm.com → SlashFilm) and
// rejects garbage tokens so we never publish "Photo via Static"/"Photo via Cdn" (2026-07-03 fix).
const CDN_LABEL = /^(static\d*|cdn\d*|img\d*|images?|i|media\d*|assets?|s\d+|photos?|www\d*)$/i;
function outletLabel(s) {
  if (s?.outlet && !CDN_LABEL.test(String(s.outlet))) return s.outlet;
  if (s?.owner && !CDN_LABEL.test(String(s.owner)) && !/^(structured|other)$/i.test(String(s.owner))) return s.owner;
  let d = String(s?.url || s?.domain || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
  const parts = d.split(".").filter((p) => !CDN_LABEL.test(p)); // drop static0/cdn/img labels
  const name = (parts.length >= 2 ? parts[parts.length - 2] : parts[0]) || "";
  if (!name || CDN_LABEL.test(name)) return "the source";
  return name.charAt(0).toUpperCase() + name.slice(1);
}
// A source URL that is an evergreen SEO/explainer page (not a report of THIS event) — its og:image is usually an
// off-topic movie still (the SlashFilm "silence-of-the-lambs-ending-explained" bug), so never use it as the hero.
const OFFTOPIC_URL = /(ending-explained|-explained|\/explained|-review\b|\/reviews?\/|-ranked\b|ranking|best-|worst-|-movies-|-films-|\/gallery|\/lists?\/|listicle|every-.*-ranked|things-you)/i;

// Every source URL we might read an og:image from: the topic's own link + the FIND sources + the content bundle's
// sources. Deduped, order kept (freshest/most-primary first).
function collectSourceUrls(topic, bundle) {
  const urls = [
    topic?.url, topic?.link,
    ...((topic?.sources || []).map((s) => s.url)),
    ...((bundle?.sources || []).map((s) => s.url)),
  ];
  return [...new Set(urls.filter(Boolean))];
}

// Build the ordered TMDB still candidates: a TITLE's clean backdrops (most powerful) > person profiles > poster.
function stillCandidates(personSet, titleSet) {
  const out = [];
  if (titleSet?.backdrops?.length) for (const url of titleSet.backdrops.slice(0, 2)) out.push({ url, kind: "backdrop", titleContext: titleSet.title });
  for (const url of personSet?.profiles || []) out.push({ url, kind: "profile" });
  if (titleSet?.poster) out.push({ url: titleSet.poster, kind: "poster", titleContext: titleSet?.title });
  const seen = new Set();
  return out.filter((c) => c.url && !seen.has(c.url) && seen.add(c.url));
}

// VISION GATE — pick the best candidate by identity match + visual impact + story fit. Cheap model, fail-safe.
async function rankByVision(candidates, ctx, { model, visionImpl } = {}) {
  const impl = visionImpl || (async (imgs, prompt) => {
    const { data } = await chat({
      model: model || VISION_MODEL, images: imgs, json: true, maxTokens: 400, temperature: 0,
      system: "You are a news photo editor choosing the lead image for an entertainment-news story. Be strict about identity (is the right person/title actually shown?) and pick the most striking, on-topic, tasteful shot. Output strict JSON only.",
      user: prompt,
    });
    return data;
  });
  const imgs = candidates.map((c) => c.url).slice(0, 4);
  const prompt = `STORY: ${ctx.headline}
ABOUT: ${ctx.entity}${ctx.titleContext ? ` (context: ${ctx.titleContext})` : ""}
TYPE: ${ctx.newsType}

You are shown ${imgs.length} candidate images, indexed 0..${imgs.length - 1} in order.
For EACH, judge whether it actually depicts ${ctx.entity} (or the named title), plus its visual impact and fit for THIS story. Penalize hard (identityMatch:false OR fit 0-2): logos, collages, wrong-subject images, AND OFF-TOPIC images — a still/poster from a DIFFERENT or OLDER film than this story, or a generic scene unrelated to the news event, even if the right person's face appears in it (a decades-old movie still is a POOR lead for a current news story). Prefer a current, on-topic, editorial photo of the subject.
Return STRICT JSON: { "ranked": [ { "index": 0, "identityMatch": true, "impact": 0-10, "fit": 0-10, "why": "short" } ] }`;
  try {
    const data = await impl(imgs, prompt);
    const ranked = Array.isArray(data?.ranked) ? data.ranked : [];
    if (!ranked.length) return null;
    const score = (r) => (r.identityMatch ? 100 : 0) + (Number(r.impact) || 0) + (Number(r.fit) || 0);
    // DROP a candidate the vision gate says is the WRONG subject / off-topic (identityMatch:false AND low fit) — a
    // wrong hero is worse than none (2026-07-03). If everything is rejected the caller falls back to Wikimedia/holds.
    const isReject = (r) => r.identityMatch === false && (Number(r.fit) || 0) <= 3;
    const withScore = ranked.filter((r) => candidates[r.index] && !isReject(r)).map((r) => ({ cand: candidates[r.index], s: score(r), why: r.why || "" }));
    if (!withScore.length) return null;
    withScore.sort((a, b) => b.s - a.s);
    // Return the FULL candidate list reordered best-first (so the caller can fall through to the next pick if the top
    // one fails to download / is under-size), with any unranked candidates appended in their original order.
    const rankedSet = new Set(withScore.map((w) => w.cand));
    const ordered = [...withScore.map((w) => ({ ...w.cand, _score: w.s, _why: w.why })), ...candidates.filter((c) => !rankedSet.has(c))];
    return { ordered, topScore: withScore[0].s, topWhy: withScore[0].why };
  } catch {
    return null;
  }
}

// Pick the hero image for a news topic. `isTitleStory` decides TMDB lane (title backdrops vs person profiles).
export async function pickHeroImage(
  { topic, article, bundle, isTitleStory, titleOverride = null } = {},
  { getPersonImagesImpl = getPersonImages, getTitleImagesImpl = getTitleImages, visionImpl, model, vision = true, ogImpl = fetchOgImage, sourcePhoto = true, maxSourcePhotos = 3, fetchImpl = fetch } = {}
) {
  // For a TITLE story, the image MUST be searched by the WORK (e.g. "Silo"), NOT by topic.primaryEntity — the
  // editorial gate may have corrected the subject to a PERSON ("Michael Dinner"), and searching TMDB with that name
  // grabbed a wrong same-name cooking show's chef backdrop (2026-07-03 Silo bug). titleOverride carries the real
  // resolved work from the caller (editorial.work.title / the authoritative TMDB title).
  const titleQuery = (isTitleStory && titleOverride) ? titleOverride : (topic?.primaryEntity || topic?.title || "");
  const entity = isTitleStory ? titleQuery : (topic?.primaryEntity || article?.entity || topic?.title || "");
  const headline = article?.title || topic?.title || "";
  const newsType = topic?.eventType || topic?.formatTag || "news";
  const titleContext = isTitleStory ? (titleQuery || null) : (topic?.titleHint || null);

  // 1) TMDB stills (fail-safe: a miss just means fewer candidates).
  let personSet = null, titleSet = null, workSet = null;
  const tmdbType = topic?.tmdbType === "tv" ? "tv" : "movie";
  try {
    if (isTitleStory && titleQuery) titleSet = await getTitleImagesImpl(titleQuery, tmdbType);
    else if (entity) personSet = await getPersonImagesImpl(entity);
  } catch { /* skip */ }
  // For a PERSON story (e.g. an actor's death), ALSO pull the associated FILM/SHOW's TMDB backdrops from the
  // article's `about` — a still from the work they're known for (Mad Max 2 for Kjell Nilsson) is a strong, relevant
  // lead when TMDB has no person profile and the only free photo is a fan cosplay (2026-07-04 Kjell fix).
  if (!isTitleStory && !(personSet?.profiles?.length)) {
    const work = (article?.about || []).find((a) => a && a.name && /movie|film|tv|show|series/i.test(a.type || ""));
    if (work) {
      try { workSet = await getTitleImagesImpl(work.name, /tv|show|series/i.test(work.type || "") ? "tv" : "movie"); } catch { /* skip */ }
      if (workSet?.title) workSet.title = work.name;
    }
  }
  const candidates = stillCandidates(personSet, titleSet || workSet);

  // 2) THE STORY PHOTO — the source outlets' og:image, prepended so it competes as (usually) the strongest, most
  // on-topic candidate. One per distinct domain, primary sources first.
  if (sourcePhoto) {
    const seenDom = new Set();
    let added = 0;
    const srcs = [...(topic?.sources || []), ...((bundle?.sources || []).filter((s) => !s.corroborating))];
    for (const s of srcs) {
      if (added >= maxSourcePhotos) break;
      const u = s?.url;
      if (!u) continue;
      if (OFFTOPIC_URL.test(u)) continue; // skip evergreen explainer/review/list pages — their og:image is off-topic
      const dom = (String(u).replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || "").toLowerCase();
      if (seenDom.has(dom)) continue;
      seenDom.add(dom);
      try {
        const og = await ogImpl(u, fetchImpl);
        if (og) { candidates.unshift({ url: upsize(og), kind: "source-photo", outlet: outletLabel(s) }); added++; }
      } catch { /* skip */ }
    }
  }

  if (!candidates.length) return null;

  // 3) Rank — vision-ranked best-first when >=2 candidates, else the deterministic most-specific-first order.
  let ordered = candidates, topScore = null, topWhy = "deterministic order";
  if (candidates.length >= 2 && vision) {
    const r = await rankByVision(candidates, { entity, headline, newsType, titleContext }, { model, visionImpl });
    if (r?.ordered?.length) { ordered = r.ordered; topScore = r.topScore; topWhy = r.topWhy || topWhy; }
  }

  // Return the ORDERED, ready-to-serve descriptors (best-first). The caller MEASURES each remotely (no re-host) and
  // keeps the first that passes the >=1200px + landscape preference — so a vision-preferred-but-undersize/portrait
  // TMDB still falls through to the real source photo instead of dropping to a generic Wikimedia headshot.
  const describe = (ch) => ({
    url: ch.url,
    kind: ch.kind,
    credit: ch.kind === "source-photo" ? `Photo via ${ch.outlet || "the source"}` : "The Movie Database (TMDB)",
    alt: entity ? `${entity}${ch.titleContext ? ` in ${ch.titleContext}` : ""}` : (headline || "hero image"),
  });
  return { candidates: ordered.map(describe), score: topScore, why: topWhy, candidateCount: candidates.length };
}
