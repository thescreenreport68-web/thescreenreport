import { chat } from "../lib/openrouter.mjs";
import { TAXONOMY } from "../config.mjs";

const CATS = Object.keys(TAXONOMY);

// Embed niches are known from the seed topic (not guessed) → snap them to their real home.
const NICHE_SUB = {
  trailer: "trailers", interview: "interviews", reaction: "reactions", news: "news", "box-office": "box-office", awards: "winners",
  // MUSIC formatTags → their music subcategory (FIND sets the formatTag; MAKE trusts it for routing).
  "music-news": "news", "music-awards": "awards", "music-profile": "profiles-artists", "screen-music": "screen-music",
  // PLAYBOOK new forms → their subcategory.
  watchguide: "where-to-watch", recap: "tv-reviews", predictions: "predictions",
};

// Assigns the URL-silo category + subcategory + tags + a format tag, validated against the fixed taxonomy.
export async function classify({ article, topic, model }) {
  const taxoText = Object.entries(TAXONOMY)
    .map(([c, subs]) => `${c}: ${subs.join(", ")}`)
    .join("\n");
  const user = `Classify this article into our fixed taxonomy. Pick the single best category, then a subcategory that BELONGS to that category.

TAXONOMY (category: allowed subcategories):
${taxoText}

ARTICLE TITLE: ${article.title}
DEK: ${article.dek}
FIRST 120 WORDS: ${(article.body || "").split(/\s+/).slice(0, 120).join(" ")}

Return strict JSON:
{ "category": "one of: ${CATS.join(", ")}",
  "subcategory": "a subcategory that belongs to the chosen category",
  "tags": ["3-6 lowercase tags"],
  "formatTag": "one of: news, list, explainer, review, reaction, interview, trailer, guide, recap, profile, box-office, awards, watchguide, predictions" }`;

  let data;
  try {
    ({ data } = await chat({
      model,
      system: "You are a precise content classifier for an entertainment news site. Output strict JSON only.",
      user,
      json: true,
      maxTokens: 300,
      temperature: 0,
    }));
  } catch (e) {
    data = {};
  }
  // validate / repair against the taxonomy
  if (!TAXONOMY[data?.category]) data = { ...data, category: CATS[0] };
  if (!(TAXONOMY[data.category] || []).includes(data.subcategory)) {
    data.subcategory = TAXONOMY[data.category][0];
  }
  data.tags = Array.isArray(data.tags) ? data.tags.slice(0, 6) : [];
  // Embed niches (trailer/interview/reaction) are known from the seed → trust it for routing + formatTag.
  if (topic?.formatTag && NICHE_SUB[topic.formatTag]) {
    data.formatTag = topic.formatTag;
    if (topic.category && TAXONOMY[topic.category]) data.category = topic.category;
    const wantSub = NICHE_SUB[topic.formatTag];
    if ((TAXONOMY[data.category] || []).includes(wantSub)) data.subcategory = wantSub;
    else if (topic.subcategory && (TAXONOMY[data.category] || []).includes(topic.subcategory)) data.subcategory = topic.subcategory;
  }
  return data;
}
