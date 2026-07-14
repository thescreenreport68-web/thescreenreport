// MAKE ONE CARD — the assembler: article → relevant photo → hook copy → SEO → render the locked template → QC.
// Returns the finished PNG path + the pin metadata. Throws if the story can't make a good card (caller falls back).
import path from "node:path";
import { readArticle } from "./curate.mjs";
import { pickImage } from "./imagePick.mjs";
import { copywriter, seo } from "./write.mjs";
import { renderCard } from "./render.mjs";
import { qcCard } from "./qc.mjs";
import { boardFor } from "./accounts.mjs";
import { PIN } from "./config.mjs";

export async function makeCard(slug) {
  const a = readArticle(slug);
  const img = await pickImage(a);                 // most-relevant photo, vision-verified
  if (!img.ok) throw new Error("image — " + img.reason);
  const copy = await copywriter(a);               // hook headline + condensed dek + kicker
  const meta = await seo(a, copy);                // keyword-rich pin title + description
  const outPng = path.join(PIN.outDir, slug.slice(0, 60) + ".png");
  await renderCard({ imgDataUri: img.imgDataUri, kicker: copy.kicker, headline: copy.headline, dek: copy.dek }, outPng);
  const qc = await qcCard(outPng);                // vision check of the finished card
  if (!qc.ok) throw new Error("qc — " + qc.issue);
  return {
    slug, category: a.category, pngPath: outPng,
    card: copy,
    meta: {
      title: meta.title, description: meta.description,
      articleUrl: `${PIN.articleBase}/${a.category}/${slug}/`,
      boardServiceId: boardFor(a.category),
    },
  };
}
