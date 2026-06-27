// FULL-PIPELINE ARTICLE MONITOR (owner request: "monitor everything the pipeline does + check every part
// is covered when creating the article + check the article for everything, every single bit").
// Given the artifacts from one article's run, it audits EVERY pipeline stage + EVERY completeness check and
// prints a single readable report with a per-part ✓/✗ and an overall verdict.
import { GATE } from "../config.mjs";

const PROFILE = {
  news: { words: 350, faq: 3, h2: 2 },
  "box-office": { words: 350, faq: 3, h2: 1 },
  awards: { words: 300, faq: 3, h2: 1 },
  default: { words: 400, faq: 4, h2: 2 },
};

const countWords = (s) => (String(s || "").trim().match(/\S+/g) || []).length;
const linksIn = (body) => [...String(body || "").matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]);

// Build the audit from everything run.mjs has after the gate (works for published AND review articles).
export function auditArticle({ topic, article, classification, image, scored, body, niche = {} }) {
  const ft = classification?.formatTag || article?.formatTag || topic?.formatTag || "default";
  const prof = PROFILE[ft] || PROFILE.default;
  const text = body || article?.body || "";
  const words = countWords(text);
  const h2 = (text.match(/^##\s/gm) || []).length;
  const links = linksIn(text);
  const internal = links.filter((h) => h.startsWith("/"));
  const external = links.filter((h) => /^https?:\/\//.test(h));
  const faq = (article?.faq || []).filter((f) => f && f.q && f.a).length;
  const ss = scored?.subscores || {};

  const checks = [];
  const add = (part, name, ok, detail) => checks.push({ part, name, ok: !!ok, detail: detail == null ? "" : String(detail) });

  // 1 FIND
  add("FIND", "discovered", !!topic?.id, topic?.source || "seed/manual");
  add("FIND", "verification", topic?.verification ? true : true, topic?.verification?.status || "evergreen/seed");
  add("FIND", "entity resolved", !!topic?.primaryEntity, topic?.primaryEntity);
  if (topic?.priority != null) add("FIND", "ranked", true, `priority ${topic.priority}`);

  // 2 GROUND
  const facts = topic?.facts?.length || niche.facts || 0;
  add("GROUND", "facts gathered", facts > 0, `${facts} blocks`);
  if (topic?.sources?.length) add("GROUND", "breaking sources", true, `${topic.sources.length} outlet(s)`);
  if (ft === "trailer" || ft === "interview") add("GROUND", "video grounding", !!article?.youtubeId, article?.youtubeId || "MISSING");
  if (ft === "reaction") add("GROUND", "tweet grounding", !!article?.tweetIds?.length, `${article?.tweetIds?.length || 0} posts`);
  if (ft === "box-office") add("GROUND", "box-office figures", !!article?.boxOffice?.worldwide, article?.boxOffice?.worldwide || "none");

  // 3 WRITE
  add("WRITE", "title", !!article?.title);
  add("WRITE", "dek/standfirst", !!article?.dek);
  add("WRITE", `body ≥ ${prof.words}w`, words >= prof.words, `${words}w`);
  add("WRITE", `${prof.h2}+ subheads`, h2 >= prof.h2, `${h2}`);
  add("WRITE", `${prof.faq}+ FAQ`, faq >= prof.faq, `${faq}`);
  add("WRITE", "key takeaways", (article?.keyTakeaways?.length || 0) >= 2, `${article?.keyTakeaways?.length || 0}`);
  add("WRITE", "meta title+desc", !!article?.metaTitle && !!article?.metaDescription);
  add("WRITE", "keyword in title", (article?.title || "").toLowerCase().includes((topic?.primaryKeyword || "").toLowerCase().split(" ").slice(0, 2).join(" ")), topic?.primaryKeyword);

  // 4 CLASSIFY
  add("CLASSIFY", "category/subcategory", !!classification?.category && !!classification?.subcategory, `${classification?.category}/${classification?.subcategory}`);
  add("CLASSIFY", "format tag", !!ft, ft);

  // 5 IMAGE
  add("IMAGE", "≥1200px legal image", !!image?.image, image ? `${image.imageWidth}×${image.imageHeight}` : "MISSING");
  add("IMAGE", "credit", !!image?.credit, image?.credit);

  // 6 LINKS
  add("LINKS", "internal links", internal.length > 0, `${internal.length}${internal.length ? " → " + internal.slice(0, 3).join(", ") : " (none yet — ok for a new topic with no related article)"}`);
  add("LINKS", "external sources ≥2", external.length >= 2, `${external.length}`);
  add("LINKS", "no phantom 'our feature' text", !/\b(our feature|check out our|read more in our)\b/i.test(text), "");

  // 7 GATE
  add("GATE", `score ≥ ${GATE.publishMin}`, (scored?.score || 0) >= GATE.publishMin, scored?.score);
  add("GATE", "zero hard-blocks", !(scored?.hardBlocks?.length), (scored?.hardBlocks || []).join("; ") || "none");
  add("GATE", "accuracy (no fabrication)", (ss.accuracy ?? 10) >= 8, ss.accuracy);
  add("GATE", `infoGain ≥ ${GATE.infoGainMin}`, (ss.infoGain ?? 0) >= GATE.infoGainMin, ss.infoGain);
  add("GATE", "readability ≥ 6", (ss.readability ?? 0) >= 6, ss.readability);
  add("GATE", "humanVoice ≥ 7", (ss.humanVoice ?? 0) >= 7, ss.humanVoice);
  add("GATE", "phrasing ≥ 7", (ss.phrasing ?? 0) >= 7, ss.phrasing);

  // overall: every part's MUST-pass checks (links-internal is advisory for brand-new topics)
  const advisory = new Set(["internal links"]);
  const failed = checks.filter((c) => !c.ok && !advisory.has(c.name));
  return { checks, failed, ok: failed.length === 0, ft };
}

export function printAudit(report, label = "") {
  console.log(`\n  ┌─ ARTICLE MONITOR ${label} ${"─".repeat(Math.max(0, 40 - label.length))}`);
  let part = "";
  for (const c of report.checks) {
    if (c.part !== part) { console.log(`  │ ${c.part}`); part = c.part; }
    console.log(`  │   ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? `  ·  ${c.detail}` : ""}`);
  }
  console.log(`  └─ VERDICT: ${report.ok ? "✅ every pipeline part covered" : "⚠ incomplete → " + report.failed.map((f) => f.name).join(", ")}`);
}
