// FEATURED IMAGE — mandatory, best-relevance (plan §11). Reuses the SHARED pickHeroImage machinery
// (candidate ladder = source-page og:images [any owner] + TMDB poster/backdrop → vision-ranked for
// relevance to THIS film) then measures + keeps the first >=1200px (landscape preferred). Commons is
// the last resort. Nothing >=1200px → null → HOLD. measureRemote/sourceImage are the lane's own
// decoupled copies (imageUtil.mjs), never another lane's module.
import { pickHeroImage } from "../lib/heroImage.mjs";
import { measureRemote, sourceImage } from "./imageUtil.mjs";

export async function pickBoxOfficeImage({
  trigger, angle, film, article, bundle,
  measureImpl = measureRemote,
  heroImpl = pickHeroImage,
  commonsImpl = sourceImage,
  visionModel = null,
} = {}) {
  const topic = {
    primaryEntity: film?.title || trigger?.primaryEntity,
    title: article?.title,
    titleHint: film?.title || null,
    eventType: "boxoffice",
    formatTag: "box-office",
    tmdbType: "movie",
    sources: [...(bundle?.sources || []), ...(trigger?.sources || [])].filter((s) => s?.url),
  };

  const hero = await heroImpl(
    { topic, article, bundle, isTitleStory: true, titleOverride: film?.title || null },
    visionModel ? { model: visionModel } : {},
  ).catch(() => null);

  const measurePick = async (cands) => {
    let portrait = null;
    for (const cand of cands) {
      const dims = await measureImpl(cand.url).catch(() => null);
      if (!dims || dims.imageWidth < 1200) continue;
      if (dims.imageWidth >= dims.imageHeight) return { image: cand.url, imageWidth: dims.imageWidth, imageHeight: dims.imageHeight, credit: cand.credit };
      if (!portrait) portrait = { image: cand.url, imageWidth: dims.imageWidth, imageHeight: dims.imageHeight, credit: cand.credit };
    }
    return portrait;
  };

  let pick = hero?.candidates?.length ? await measurePick(hero.candidates) : null;

  if (!pick) {
    const queries = [...new Set([article?.imageQuery, film?.title, angle?.star, trigger?.primaryEntity].filter(Boolean))];
    for (const qq of queries) {
      const w = await commonsImpl(qq).catch(() => null);
      if (!w) continue;
      const dims = await measureImpl(w.downloadUrl).catch(() => null);
      if (dims && dims.imageWidth >= 1200) { pick = { image: w.downloadUrl, imageWidth: dims.imageWidth, imageHeight: dims.imageHeight, credit: w.credit }; break; }
    }
  }
  return pick; // { image, imageWidth, imageHeight, credit } | null
}
