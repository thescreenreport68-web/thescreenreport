// ASSEMBLE (inside) — frontmatter per the site contract (category/author/trendScore/signals/
// eventSlug/eventType/outletCount for the homepage engine) + the inside fields the UI renders
// (insideForm/parentEventSlug/reactions/anchorStatement/fanConsensus). gray-matter via
// createRequire (same as news/gossip assemble). NEVER emit an undefined key — gray-matter throws.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CONTENT_DIR, INSIDE_FORMAT_TAG, INSIDE_AUTHOR_SLUG, AI_DISCLOSURE, MONITOR_WINDOW_HOURS, FORMS, MAX_EMBEDS, NO_EMBEDS, routeForStory } from "./config.inside.mjs";
import { norm } from "./reactionFinder.mjs";
import { seoFinish, stripMd } from "./seo.mjs";
export { seoFinish }; // the lane's ONE SEO finisher lives in ./seo.mjs (owner audit 2026-07-16)

const require = createRequire(import.meta.url);
const matter = require("gray-matter");

// Slug capped at a WORD boundary — "…the-memes-ar" class artifacts read broken in the URL bar.
const slugify = (s) => {
  const full = (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (full.length <= 80) return full;
  const cut = full.slice(0, 80);
  return cut.includes("-") ? cut.replace(/-[^-]*$/, "") : cut;
};

// Headline hygiene (owner audit: a title trailed off "…and the Tributes Are a Masterclass in"). Drop a
// dangling em-dash tail, and if it still runs long, cut at the last sentence/clause boundary — never
// leave the headline ending on a preposition/connector.
const DANGLING_TAIL = /\s+(in|on|of|to|for|with|and|but|as|the|a|an|that|which|from|about|—and|- and)\s*$/i;
export function cleanTitle(title) {
  let t = (title || "").trim();
  if (t.length > 92) {
    const dash = t.search(/\s[—–-]\s?(and|but|as)\b/i);
    if (dash > 30) t = t.slice(0, dash).trim();          // drop a run-on "— and …" clause
  }
  if (t.length > 100) {
    const cut = t.slice(0, 100);
    const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(", "), cut.lastIndexOf(" — "));
    t = (stop > 40 ? cut.slice(0, stop) : cut.replace(/\s+\S*$/, "")).trim();
  }
  while (DANGLING_TAIL.test(t)) t = t.replace(DANGLING_TAIL, "").trim();
  return t.replace(/[\s,;:—–-]+$/, "").trim();
}
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

// ── SHARED QUOTE UI (owner 2026-07-25) ───────────────────────────────────────────────────────────
// Every lane displays a person's words through ONE site-wide component, fed by the `pullQuote`
// frontmatter contract: { text, attribution }. This maps this lane's anchor statement onto it.
//
// Attribution follows the house style other lanes already use ("Kevin Feige to TheWrap") — the
// speaker, then where they said it, so a reader can place the quote without leaving the card.
// Returns undefined (never a half-filled object) when there is no real speaker+quote, so `clean`
// drops the key entirely and the renderer stays silent rather than printing an empty box.
// An anonymous crowd label is honest in a reaction card but is not a person we can attribute a hero
// quote to by name. "Report" is this lane's marker for outlet prose — also not a person.
const CROWD_SPEAKER_RX = /^(a|one|another|some)\s+(viewer|fan|user|commenter|poster|redditor)s?$|^report$/i;
export const isCrowdSpeaker = (s) => CROWD_SPEAKER_RX.test(String(s || "").trim());

// A hero quote has to READ as a hero: long enough to carry weight, short enough not to become a wall.
// The floor differs by SOURCE. A harvested fan post needs 40 chars to prove it isn't noise ("same",
// "lol", "this"). An on-record statement is deliberate and curated, and a short one is often the
// BEST hero ("The ending is the point.") — so it only has to be a real sentence.
const HERO_MIN = 40, HERO_MIN_ONRECORD = 15, HERO_MAX = 240;
// Mastodon/Discord emoji shortcodes (":blobcatsadlife:") render as literal text and look broken at
// display size. Real harvested posts carry them; they belong in a card, not in the hero treatment.
const SHORTCODE_RX = /:[a-z0-9_+-]{2,}:/i;
// Real platforms only — the `platform` field also carries non-platform values ("statement").
const PLATFORM_RX = /^(x|twitter|bluesky|instagram|mastodon|threads|reddit|youtube|tiktok|facebook|tumblr)$/i;
const heroReadable = (t, min = HERO_MIN) => t.length >= min && t.length <= HERO_MAX && !SHORTCODE_RX.test(t);

export function pullQuoteFrom(anchor) {
  const text = String(anchor?.quote || "").trim();
  const speaker = String(anchor?.speaker || "").trim();
  if (!text || !speaker) return undefined;
  // The shared UI is for someone ON RECORD; crowd voices stay in the cards.
  if (isCrowdSpeaker(speaker)) return undefined;
  const connection = String(anchor?.connection || "").trim();
  const platform = String(anchor?.platform || "").trim();
  let attribution = speaker;
  if (connection && !new RegExp(`\\b${connection.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(speaker)) {
    attribution += `, ${connection}`;
  }
  // "on X" only reads correctly for an actual PLATFORM. The harvest also stores values like
  // "statement" or "interview" in this field, and "Rob Bonta, Attorney General on statement" is
  // broken English — for those the connection already supplies the context, so drop it.
  if (PLATFORM_RX.test(platform)) attribution += ` on ${platform}`;
  // NOTE: `text` is passed through UNMODIFIED apart from trimming. It is a verbatim quote that has
  // already cleared the harvest's verbatim wall, and the QA fact-locks compare against that exact
  // string — running it through stripMd here would silently break both guarantees.
  return clean({ text, attribution: attribution.slice(0, 120) });
}

/**
 * Choose the ONE quote this article leads with, in the shared UI.
 * Tiered, because a measurement of the 126 live inside articles found ZERO anchor statements, 75
 * with a named speaker and 126 with reactions — anchor-only would have meant the new UI never
 * appeared. Returns { pullQuote, fromReactionQuote } so the caller can drop the chosen quote from
 * the cards below and avoid printing it twice on one page.
 */
export function pickPullQuote({ anchorStatement = null, reactions = [] } = {}) {
  // 1. the creator/subject speaking on the record — always the strongest lead if we have it
  const fromAnchor = pullQuoteFrom(anchorStatement);
  if (fromAnchor && heroReadable(fromAnchor.text, HERO_MIN_ONRECORD)) return { pullQuote: fromAnchor, fromReactionQuote: null };
  const ok = (r) => r?.quote && heroReadable(String(r.quote).trim());
  // 2. a NAMED voice among the harvested reactions (60% of articles have one)
  // 3. otherwise the top fan reaction — this is an audience-reaction desk, so a reader's words ARE
  //    the story. Only when ≥3 cards exist, so pulling one up still leaves a real card list below.
  const named = reactions.find((r) => ok(r) && !isCrowdSpeaker(r.speaker));
  const pick = named || (reactions.length >= 3 ? reactions.find(ok) : null);
  if (!pick) return { pullQuote: undefined, fromReactionQuote: null };
  const pq = pullQuoteFrom({ ...pick, speaker: pick.speaker || "A viewer" })
    // a crowd speaker is rejected by pullQuoteFrom, so build its attribution here: honest, unnamed.
    || clean({ text: String(pick.quote).trim(), attribution: [pick.speaker || "A viewer", pick.platform ? `on ${pick.platform}` : ""].filter(Boolean).join(" ") });
  return { pullQuote: pq, fromReactionQuote: String(pick.quote).trim() };
}

// INLINE EMBEDS (REV 3, owner): the real post renders DIRECTLY BELOW the paragraph that quotes it —
// never pooled at the bottom — so readers scroll through the receipts as they read. Deterministic:
// the harvest's own quote↔tweet pairing decides placement (once per post); Instagram posts (no
// quote pairing) slot after the first paragraph that speaks of Instagram, else right after the
// lede. Markers are their own blocks; ArticleBody renders them as the real embed components.
export function insertInlineEmbeds(body, factBlock, embeds = null) {
  const blocks = (body || "").trim().split(/\n\n+/).filter(Boolean);
  if (!blocks.length) return body || "";
  const anchorPool = [...(factBlock?.reactions || []), ...(factBlock?.aggregateFans || [])];
  const tweetPool = anchorPool.filter((h) => h.tweetId && h.quote);
  const used = new Set();
  const out = [];
  // Cap the inline embeds per article — the X-search pool can be large, but a wall of live iframes
  // hurts load + reads as spam. MAX_EMBEDS keeps it to a handful of the best-placed receipts.
  for (const blk of blocks) {
    out.push(blk);
    if (/^#/.test(blk.trim())) continue;
    if (used.size >= MAX_EMBEDS) continue;
    for (const m of blk.matchAll(/["“]([^"“”\n]{12,400})["”]/g)) {
      if (used.size >= MAX_EMBEDS) break;
      const nq = norm(m[1]);
      if (nq.length < 12) continue;
      const t = tweetPool.find((h) => !used.has(h.tweetId) && (norm(h.quote).includes(nq) || nq.includes(norm(h.quote))));
      if (t) { used.add(t.tweetId); out.push(`[embed:tweet:${t.tweetId}]`); }
    }
  }
  const igUrls = (embeds?.instagramUrls || []).slice(0, 2);
  if (igUrls.length) {
    let idx = out.findIndex((b) => /instagram/i.test(b) && !b.startsWith("[embed:"));
    if (idx === -1) idx = Math.min(1, out.length - 1);
    out.splice(idx + 1, 0, `[embed:instagram:${igUrls[0]}]`);
    if (igUrls[1]) {
      const mid = Math.min(out.length - 1, Math.max(idx + 3, Math.floor(out.length * 0.66)));
      out.splice(mid + 1, 0, `[embed:instagram:${igUrls[1]}]`);
    }
  }
  return { body: out.join("\n\n"), inlined: used };
}

export function buildInsideMarkdown({ article, trigger, angle, factBlock, image, embeds = null, dateISO }) {
  const route = routeForStory(trigger);
  // Markdown never ships in plain-text frontmatter (owner audit: readers saw literal *asterisks* in a
  // title + FAQ answers). Reaction QUOTES are exempt — they're verbatim posts, never restyled.
  const title = cleanTitle(stripMd(article.title));
  const slug = slugify(title);
  // Sibling inside-articles must not collapse into each other (or the parent) in the homepage's
  // eventSlug dedup — each gets a derived, unique eventSlug; parentEventSlug carries the cluster.
  const eventSlug = `${trigger.parentEventSlug || slugify(trigger.primaryEntity)}--in-${angle.form}`;
  const flagship = !!FORMS[angle.form]?.flagship;

  // Tweet↔quote pairing is DETERMINISTIC from the harvest's own knowledge (which anchor came from
  // which post) — never trust the writer's id pairing. Fall back to the writer's id only when it's
  // cached AND the harvest has no opinion.
  const tweetPool = [...(factBlock.reactions || []), ...(factBlock.aggregateFans || [])].filter((h) => h.tweetId && h.quote);
  const tweetIdFor = (q) => {
    const nq = norm(q);
    if (nq.length < 8) return undefined;
    return tweetPool.find((h) => norm(h.quote).includes(nq) || nq.includes(norm(h.quote)))?.tweetId;
  };
  const allAnchors = [...(factBlock.reactions || []), ...(factBlock.aggregateFans || [])];
  const anchorFor = (q) => {
    const nq = norm(q || "");
    if (nq.length < 8) return undefined;
    return allAnchors.find((h) => h.quote && (norm(h.quote).includes(nq) || nq.includes(norm(h.quote))));
  };
  // FREE MODE (NO_EMBEDS): zero iframe embeds — the body stays as-is (no [embed:] markers), and the
  // reaction display cards carry ONLY the quote text (no tweetId, so nothing renders an embed).
  const inlined = NO_EMBEDS ? { body: (article.body || "").trim(), inlined: new Set() }
    : insertInlineEmbeds((article.body || "").trim(), factBlock, embeds);
  // FREE MODE: reaction cards for ordinary people carry ONLY "A viewer" + the quote — no platform
  // name (owner: generic attribution) and no raw relative date ("6h"). Named voices keep attribution.
  const isNamed = (r) => r.speaker && r.speaker !== "A viewer";
  const okDate = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d) ? d : undefined);
  const reactions = (article.reactionsRender || [])
    .filter((r) => r && r.speaker !== undefined && r.quote)
    .map((r) => clean({
      speaker: r.speaker || "A viewer",
      connection: r.connection,
      platform: NO_EMBEDS && !isNamed(r) ? undefined : r.platform,
      date: NO_EMBEDS ? okDate(r.date) : r.date,
      quote: r.quote,
      ...(NO_EMBEDS ? {} : { tweetId: tweetIdFor(r.quote) ?? (factBlock.tweetIds.includes(r.tweetId) ? r.tweetId : undefined) }),
    }))
    // A post embedded INLINE is its own display — a duplicate bottom card would repeat it.
    .filter((r) => !(r.tweetId && inlined.inlined.has(r.tweetId)));

  // SHARED QUOTE UI: pick the one quote that leads the article, then drop it from the cards — the
  // same words printed as a hero AND again as a card three inches below reads as a mistake.
  const hero = pickPullQuote({ anchorStatement: article.anchorStatement, reactions });
  const cards = hero.fromReactionQuote
    ? reactions.filter((r) => String(r.quote).trim() !== hero.fromReactionQuote)
    : reactions;

  const fm = clean({
    title,
    slug,
    category: route.category,
    subcategory: route.subcategory,
    author: INSIDE_AUTHOR_SLUG,
    date: dateISO,
    dek: stripMd(article.dek) || "",
    ...seoFinish({
      metaTitle: article.metaTitle,
      title: article.title,
      metaDescription: article.metaDescription,
      dek: article.dek,
    }),
    tags: article.tags || [],
    keyTakeaways: (article.keyTakeaways || []).map((k) => stripMd(k)),
    faq: (article.faq || []).filter((f) => f?.q && f?.a).map((f) => ({ q: stripMd(f.q), a: stripMd(f.a) })),
    about: Array.isArray(article.about) ? article.about.filter((e) => e && e.name && e.type) : [],
    formatTag: INSIDE_FORMAT_TAG,
    insideForm: angle.form,
    parentEventSlug: trigger.parentEventSlug || undefined,
    parentSlug: trigger.parentSlug || undefined,
    parentTitle: trigger.parentTitle || undefined,
    reactions: cards,
    anchorStatement: article.anchorStatement?.speaker && article.anchorStatement?.quote
      ? clean(article.anchorStatement) : undefined,
    // SITE-WIDE QUOTE UI (owner 2026-07-25): the shared `pullQuote` contract every lane now emits —
    // `{ text, attribution }`, rendered as the standard hero pull-quote. Sourced from an already
    // verbatim-walled quote, so adopting the shared UI adds no new fabrication surface.
    pullQuote: hero.pullQuote,
    fanConsensus: stripMd(article.fanConsensus) || undefined, // the honest sentiment read, all forms
    tweetIds: NO_EMBEDS ? undefined : (embeds?.tweetIds?.length ? embeds.tweetIds : factBlock.tweetIds.length ? factBlock.tweetIds : undefined),
    instagramUrls: NO_EMBEDS ? undefined : (embeds?.instagramUrls?.length ? embeds.instagramUrls : undefined),
    updatedCount: 0,
    // Homepage placement contract. Non-flagship siblings run 5 under the parent's heat so one
    // story's angle set never monopolizes the fold.
    trendScore: Number.isFinite(trigger.priority) ? (flagship ? trigger.priority : Math.max(0, trigger.priority - 5)) : undefined,
    signals: trigger.signals && Object.keys(trigger.signals).length ? trigger.signals : undefined,
    eventSlug,
    eventType: trigger.eventType, // "discourse"
    outletCount: factBlock.sources.filter((s) => s.url).length || undefined,
    developing: true, // discourse builds — the monitor tops this article up
    aiDisclosure: AI_DISCLOSURE,
    dateModified: dateISO,
    provenance: clean({
      parentEventSlug: trigger.parentEventSlug || "",
      primaryEntity: trigger.primaryEntity || "",
      eventType: trigger.eventType || "discourse",
      monitor: true,
      monitorWindowH: MONITOR_WINDOW_HOURS,
      anchors: (factBlock.stats.namedVoices || 0) + (factBlock.stats.fanPosts || 0),
      publishedAt: dateISO,
    }),
    ...(image ? {
      image: image.image,
      imageAlt: stripMd(article.imageQuery) || `${trigger.primaryEntity}`,
      imageCredit: image.credit || "Photo via source",
      imageWidth: image.imageWidth,
      imageHeight: image.imageHeight,
    } : {}),
  });

  const md = matter.stringify("\n" + inlined.body + "\n", fm);
  return { slug, frontmatter: fm, md };
}

export function writeInsideArticle({ article, trigger, angle, factBlock, image, embeds = null, dateISO, dir = CONTENT_DIR, dryRun = false }) {
  const out = buildInsideMarkdown({ article, trigger, angle, factBlock, image, embeds, dateISO });
  if (!dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, out.slug + ".md"), out.md);
  }
  return { ...out, path: path.join(dir, out.slug + ".md"), written: !dryRun };
}
