// MAKE ONE CARD — the assembler: article → board routing → relevant photo → hook copy → SEO → render → QC.
// Returns the finished PNG path + the pin metadata (incl. the CONTENT-classified board). Throws if the story
// can't/shouldn't make a card (off-mandate, dead link, no photo, failed QC) so the caller falls to the next.
import path from "node:path";
import { readArticle } from "./curate.mjs";
import { pickImage } from "./imagePick.mjs";
import { classifyBoard, copywriter, seo } from "./write.mjs";
import { renderCard } from "./render.mjs";
import { qcCard } from "./qc.mjs";
import { boardById } from "./accounts.mjs";
import { PIN } from "./config.mjs";

// Is the article actually LIVE on the site? A pin's whole job is the click-through, so never pin a link that
// 404s. (This is exactly what left the first Moana pin pointing at a dead page — its article wasn't deployed.)
async function isLive(url) {
  try {
    let r = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (r.status === 405 || r.status === 501) r = await fetch(url, { method: "GET", redirect: "follow" });
    return !(r.status === 404 || r.status === 410); // definitively gone → skip; anything else → allow
  } catch { return true; } // network hiccup → fail-open so a transient error never zeroes out the day
}

export async function makeCard(slug) {
  const a = readArticle(slug);
  // 1) CONTENT ROUTER + on-brand gate FIRST (cheap): which board does this story belong on — or skip it?
  const route = await classifyBoard(a);
  if (route.board === "skip") throw new Error("off-mandate — " + route.why);
  // 2) never build a card that links to a dead page
  const articleUrl = `${PIN.articleBase}/${a.category}/${slug}/`;
  if (!(await isLive(articleUrl))) throw new Error("article not live (404) — " + articleUrl);
  // 3) the expensive steps
  const img = await pickImage(a);                 // most-relevant photo, vision-verified
  if (!img.ok) throw new Error("image — " + img.reason);
  const copy = await copywriter(a);               // hook headline + condensed dek + kicker
  const meta = await seo(a, copy);                // keyword-rich pin title + description
  const outPng = path.join(PIN.outDir, slug.slice(0, 60) + ".png");
  await renderCard({ imgDataUri: img.imgDataUri, kicker: copy.kicker, headline: copy.headline, dek: copy.dek }, outPng);
  const qc = await qcCard(outPng);                // vision check of the finished card
  if (!qc.ok) throw new Error("qc — " + qc.issue);
  return {
    slug, category: a.category, board: route.board, pngPath: outPng,
    card: copy,
    meta: {
      title: meta.title, description: meta.description,
      articleUrl,
      boardServiceId: boardById(route.board), // the board the CONTENT belongs on, not the raw tag
    },
  };
}
