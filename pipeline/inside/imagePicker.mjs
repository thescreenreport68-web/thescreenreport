// FEATURED IMAGE (REV 2) — mandatory, best-relevance. Owner: "the image must MATCH the article; do the
// exact same thing the news + gossip automations do; any owner is fine; never publish without one."
// Reuses the news lane's vetted machinery: pickHeroImage gathers candidates (source-page og:images
// [ANY owner] pushed to the front + TMDB title backdrops / person profiles) AND vision-RANKS them for
// relevance to THIS article (identity match + fit). We then measure and keep the first ≥1200px
// (landscape preferred). Commons is the last-resort fallback (news pattern). Nothing ≥1200px → null → HOLD.
import { pickHeroImage } from "../lib/heroImage.mjs";
import { sourceImage, measureRemote } from "../stages/image.mjs";

export async function pickInsideImage({
  trigger, angle, article, bundle,
  measureImpl = measureRemote,
  heroImpl = pickHeroImage,
  commonsImpl = sourceImage,
} = {}) {
  const isTitleStory = trigger?.subjectKind === "title";
  const topic = {
    primaryEntity: angle?.focusEntity || trigger?.primaryEntity,
    title: article?.title,
    titleHint: trigger?.work?.title || null,
    eventType: trigger?.eventType,
    formatTag: "inside",
    tmdbType: trigger?.work?.type || trigger?.tmdbType || "movie",
    // ANY-owner source photos: every article page we harvested + the discovered story URLs.
    sources: [...(bundle?.sources || []), ...(trigger?.sources || [])].filter((s) => s?.url),
  };

  // 1) Gather + vision-rank for relevance (news machinery), best-first.
  const hero = await heroImpl(
    { topic, article, bundle, isTitleStory, titleOverride: trigger?.work?.title || null },
  ).catch(() => null);

  const measurePick = async (cands) => {
    let portrait = null;
    for (const cand of cands) {
      const dims = await measureImpl(cand.url).catch(() => null);
      if (!dims || dims.imageWidth < 1200) continue; // Discover floor
      if (dims.imageWidth >= dims.imageHeight) return { image: cand.url, imageWidth: dims.imageWidth, imageHeight: dims.imageHeight, credit: cand.credit };
      if (!portrait) portrait = { image: cand.url, imageWidth: dims.imageWidth, imageHeight: dims.imageHeight, credit: cand.credit };
    }
    return portrait; // a passing portrait only if no landscape cleared
  };

  let pick = hero?.candidates?.length ? await measurePick(hero.candidates) : null;

  // 2) Commons last resort — any relevant free photo of the subject/work.
  if (!pick) {
    const queries = [...new Set([article?.imageQuery, trigger?.work?.title, angle?.focusEntity, trigger?.primaryEntity].filter(Boolean))];
    for (const q of queries) {
      const w = await commonsImpl(q).catch(() => null);
      if (!w) continue;
      const dims = await measureImpl(w.downloadUrl).catch(() => null);
      if (dims && dims.imageWidth >= 1200) { pick = { image: w.downloadUrl, imageWidth: dims.imageWidth, imageHeight: dims.imageHeight, credit: w.credit }; break; }
    }
  }

  return pick; // { image, imageWidth, imageHeight, credit } | null
}
