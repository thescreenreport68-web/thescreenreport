// AGENT — PLATFORM METADATA: per-platform title/description/caption for the NEW platforms
// (Facebook + YouTube). Instagram keeps its own proven caption agent (agents/caption.mjs) untouched,
// so the live IG path can never regress; this ADDS the two new platforms so one build fans out to
// all three. Same hard rules as the IG caption: use only verified facts, NO source/outlet attribution,
// NO fourth wall, plus the light "AI-assisted" disclosure. Researched structures (2026):
//   Facebook — topic + CTA in the FIRST 125 chars, keyword-natural, 3-5 light hashtags.
//   YouTube  — keyword-front title + a keyworded description; #Shorts + entity hashtags + the article
//              link are appended deterministically.
//
// YOUTUBE SEO HARDENING (owner 2026-07-14, from a 5-dimension Shorts SEO audit + an adversarial code
// review). The TITLE + DESCRIPTION are the only searchable text on a Short, so they are where ranking
// is won. This agent now ENFORCES — not just requests — the audit's title/description rules so future
// videos self-correct instead of repeating the two shipped videos' mistakes:
//   • TITLE: target 40-55 chars (hard cap 70, word-boundary trim); LEAD with the PRIMARY entity + the
//     surprising fact/quote/number inside the first ~40 chars; never end on a soft generic tail.
//   • DESCRIPTION: the first sentence MUST begin with the SAME entity the TITLE leads with (title↔desc
//     consistency) — that is the search snippet and the fix for the "buried subject" bug.
//   • HASHTAGS: real entities/niche only, ranked ABOVE vague model free-text; vague tags dropped.
// PRIMARY = the story's actual subject, derived from the article SLUG (which reliably leads with the
// subject), NOT prose order — "X pays tribute to Y" opens on the sender, so prose order picks the wrong,
// less-searchable name. A deterministic validator checks the FINAL (source-stripped, length-trimmed)
// strings; on a violation it RE-PROMPTS the model (up to 2x) naming the exact problem, keeps the best
// draft (only its YouTube — Facebook is pinned to the first draft), then hard-trims. SEO NEVER holds a
// video (throughput > a perfect title) — a residual miss ships with a logged warning. Keyword-STUFFING
// is banned (natural/readable copy). Scope = title/description only; the video, thumbnail, and the
// separate YouTube keywords field are intentionally untouched.
import { llm } from "../models.mjs";

const AI_NOTE = "AI-assisted recap by The Screen Report.";
const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
// diacritic-insensitive lowercase, so a de-accented model title ("Beyonce") still matches an accented
// entity ("Beyoncé") and vice-versa — avoids needless re-prompts on names with accents. (review 2026-07-14)
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Deterministic source-attribution strip (mirrors the IG caption net) — an outlet name must NEVER
// reach a public caption even if the model slips one in. Independent copy (keeps this agent from
// importing/altering the live caption agent).
function stripSource(s) {
  return String(s || "")
    .replace(/[\s,;:—-]*\b(?:according to|as reported by|reported by|as per|sourced from)\b[^.?!]*(?=[.?!]|$)/gi, "")
    .replace(/[\s,;:—-]*\b(?:per|via)\s+[A-Z][A-Za-z.&'’-]+(?:\s+[A-Z][A-Za-z.&'’-]+){0,2}/g, "")
    .replace(/#\w+/g, "") // hashtags belong only in the tags array
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.?!,;:])/g, "$1")
    .trim();
}

// Vague/low-search tags that add no SEO value and must never spend a hashtag slot (extends the old
// viral ban). Applied to MODEL free-text only — real story entities are never vague-filtered (a film
// literally named "Legend"/"King" must survive). (SEO audit + review 2026-07-14)
const VAGUE_TAG = /^#(fyp|viral|reels?|trending|foryou|foryoupage|explore|shorts?|birthdaytribute|sweettribute|sweetmessage|sweetmoment|adorable|adorablemoment|rareglimpse|newinterview|latestnews|update|news|cutecouple|couplegoals|throwback|mood|vibes|omg|wow)$/i;

// Hashtag quality gate: ENTITY-derived tags (real person/film names) rank ABOVE the model's free-text,
// vague model tags are dropped, then the niche backfill fills to 5. So named co-stars/films beat filler
// like #BirthdayTribute. Shared by FB + YT (a strict improvement for both). (SEO audit 2026-07-14)
function normTags(arr, entities = []) {
  const clean = (t) => (String(t).startsWith("#") ? String(t) : "#" + String(t)).replace(/[^#A-Za-z0-9]/g, "");
  const entTags = (entities || []).map((e) => clean(e.name)).filter((t) => t.length > 2); // real entities: never vague-filtered
  const modelTags = (Array.isArray(arr) ? arr : []).map(clean).filter((t) => t.length > 2 && !VAGUE_TAG.test(t));
  const ordered = [...entTags, ...modelTags, "#MovieNews", "#Hollywood"]; // entities first (highest search value)
  const seen = new Set();
  const out = [];
  for (const t of ordered) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= 5) break;
  }
  return out;
}

// The subject to LEAD THE TITLE with = the entity the story is actually about. The CMS slug reliably
// leads with the subject (elliot-page-girlfriend-julia-... → Elliot Page), so rank entities by earliest
// slug position; then by kind (a real person/film beats a generic "event"); then by how many facts
// mention them. Prose order of storyOneLine is NOT used (it opens on the sender in tribute stories, the
// exact Video-2 bug). Falls back to kind+fact ranking when no slug. (review 2026-07-14)
function pickPrimaryEntity(facts, articleUrl = "") {
  const ents = facts.entities || [];
  if (!ents.length) return "";
  const slug = fold((String(articleUrl).split("/").filter(Boolean).pop() || "").replace(/-/g, " "));
  const kindRank = (k) => (/(person|actor|celebrity|director|musician|film|movie|show|series|title)/i.test(k || "") ? 0 : 1);
  const factHits = (name) => (facts.facts || []).filter((f) => fold(f.claim).includes(fold(name))).length;
  const scored = ents.map((e) => {
    const idx = slug ? slug.indexOf(fold(e.name)) : -1;
    return { name: e.name, slugIdx: idx < 0 ? Infinity : idx, kr: kindRank(e.kind), hits: factHits(e.name) };
  });
  scored.sort((a, b) => a.slugIdx - b.slugIdx || a.kr - b.kr || b.hits - a.hits);
  return scored[0].name;
}

// Which story entity does the finished TITLE actually lead with (earliest occurrence)? The description
// is then required to lead with the SAME entity — title↔description consistency is what really catches a
// buried-subject description, independent of how primary was picked. (review 2026-07-14)
function leadEntityOf(title, entities = []) {
  const h = fold(title);
  let best = "", bestIdx = Infinity;
  for (const e of entities || []) {
    const i = h.indexOf(fold(e.name));
    if (i >= 0 && i < bestIdx) { bestIdx = i; best = e.name; }
  }
  return best;
}

// does `text` lead with `name` inside its first `n` chars? Full-name match always counts; a first-name-
// only match counts ONLY when that first name is unique among the story's entities (so a title led by a
// DIFFERENT person who shares the first name can't sneak past). Empty name → nothing to enforce.
function leadsWith(text, name, n, entities = []) {
  const nm = fold(name).trim();
  if (!nm) return true;
  const head = fold(text).slice(0, n);
  if (head.includes(nm)) return true;
  const first = nm.split(/\s+/)[0];
  if (!first || first === nm) return false;
  const sharedFirst = (entities || []).filter((e) => fold(e.name).split(/\s+/)[0] === first).length;
  return sharedFirst <= 1 && head.includes(first);
}

// soft, generic title tails that carry no search value / no curiosity — end on the concrete fact instead.
// Kept to CLEARLY-soft phrases (dropped "new photo/new details/big news" which often front real news, to
// avoid needless re-prompts on legitimate reveal stories). (review 2026-07-14)
const GENERIC_TAIL = /\b(birthday message|sweet (message|tribute|moment|note)|heartfelt tribute|touching tribute|rare glimpse|adorable moment|cute moment|special moment)\s*[.!?]?\s*$/i;

// The final YouTube title exactly as it will ship: source-stripped, whitespace-collapsed, hard-capped at
// 70 chars on a word boundary. Used by BOTH the validator and the shipping code so they never disagree.
function finalTitle(raw) {
  let t = stripSource(raw).replace(/\s+/g, " ").trim();
  if (t.length > 70) t = t.slice(0, 70).replace(/\s+\S*$/, "").trim();
  return t;
}

// Validate the FINAL (shipped) YouTube title + description against the audit rules. Returns named,
// re-promptable issues (each weighted: a lead/empty miss outweighs a length/tail miss). Length uses a
// 60-char re-prompt threshold (target 40-55); the 70 hard cap is guaranteed by finalTitle. (audit + review)
function ytIssues(yt, primary, entities = []) {
  const title = finalTitle(yt?.title);
  const desc = stripSource(yt?.description).replace(/\s+/g, " ").trim();
  const issues = [];
  if (!title) issues.push({ kind: "empty", msg: "the YouTube title is empty" });
  else {
    if (!leadsWith(title, primary, 40, entities)) issues.push({ kind: "lead", msg: `the title must LEAD with "${primary}" inside the first 40 characters` });
    if (title.length > 60) issues.push({ kind: "length", msg: `the title is ${title.length} chars — cut it to 40-55 (max 70) while keeping the key fact` });
    if (GENERIC_TAIL.test(title)) issues.push({ kind: "tail", msg: "the title ends on a soft generic phrase — end on the concrete quote, number, or fact instead" });
  }
  if (!desc) issues.push({ kind: "empty", msg: "the YouTube description is empty" });
  else {
    const titleLead = leadEntityOf(title, entities) || primary; // the description must lead with whatever the title leads with
    if (!leadsWith(desc, titleLead, 40, entities)) issues.push({ kind: "lead", msg: `the description's FIRST sentence must start with "${titleLead}" (the same name the title leads with), before any other person` });
  }
  return issues;
}
const issueWeight = (issues) => issues.reduce((s, i) => s + (i.kind === "lead" || i.kind === "empty" ? 10 : 1), 0);

const SYS = `You write platform-native copy for a Hollywood movie/celebrity NEWS brand, from VERIFIED FACTS only. Produce copy for TWO platforms, each in its native style. Return STRICT JSON:
{"facebook":{"text":string,"hashtags":[string]},"youtube":{"title":string,"description":string,"hashtags":[string]}}

SHARED HARD RULES (both platforms):
- Use ONLY the provided facts. Never invent, infer, or embellish. State facts directly, first-hand.
- NEVER name, cite, or attribute a news outlet or source ("according to", "per <outlet>", "reports say", any publication name). NEVER reference "the article/report/story".
- No ALL-CAPS words, no clickbait, no bait phrases ("you won't believe", "wait for it", "tag a friend").
- Keyword-natural, NEVER keyword-stuffed: every line must read like a human wrote it. Do not repeat a name or cram keywords — readability first, keywords woven in naturally.

FACEBOOK (share-driven; the first ~125 characters show before "more"):
- text: lead with the topic + the single most surprising concrete fact in the FIRST 125 characters, then 1-2 more short factual sentences. Warm, direct, keyword-natural (full names, film titles, words like "box office"/"casting"/"trailer"). End with a short share-or-comment CTA. No hashtags inside the text.
- hashtags: 3-5 light, relevant (story entities + niche). Never generic (#fyp/#viral).

YOUTUBE SHORTS (the title + description are the ONLY searchable text — THIS is where ranking is won):
- title: TARGET 40-55 characters, hard cap 70. LEAD with the PRIMARY entity (named in PRIMARY below) in the FIRST 40 characters, immediately followed by the single most surprising concrete detail — a short quoted fragment, a number, or a hard fact — so the hook is visible before the feed truncates it. If the story's central subject is a film or franchise, include that exact name (it is the strongest search term); do NOT force in a film title that is only tangential context. NEVER end on a soft, generic phrase ("Sweet Birthday Message", "Rare Glimpse", "Adorable Moment") — end on the concrete fact. No hashtags in the title, no source names.
- description: 150-350 characters. The FIRST sentence MUST begin with the SAME PRIMARY entity as the title (before any secondary person) — it is the search snippet. Then 1-2 more factual sentences that naturally weave in the other searchable names (co-stars, film titles). Keyword-natural, never stuffed or repetitive. Do NOT add links or #Shorts (appended automatically).
- hashtags: 3-5, each a REAL story entity (a person or film name) or the exact niche — no vague descriptive tags ("BirthdayTribute", "SweetMoment", "CuteCouple"). Prefer named co-stars/films over generic words.`;

export async function writePlatformMeta({ facts, segment, engage, articleUrl = "" }) {
  const primaryEntity = pickPrimaryEntity(facts, articleUrl);
  const baseUser = `STORY: ${facts.storyOneLine}\nPRIMARY (lead the YouTube title AND description with this exact name): ${primaryEntity || "(the story's main subject)"}\nENTITIES: ${facts.entities.map((e) => `${e.name} (${e.kind})`).join(", ")}\nFACTS:\n${facts.facts.map((f) => `- ${f.claim}`).join("\n")}\nSEGMENT: ${segment || "news"}\nENGAGEMENT GOAL: ${engage?.goal || "shares"}`;

  const gen = (user) => llm({ role: "caption", system: SYS, user, temp: 0.4, maxTokens: 600, json: true });

  let res;
  try {
    res = await gen(baseUser);
  } catch (e) {
    return { meta: null, hold: `platformMeta failed: ${String(e.message || e).slice(0, 120)}` };
  }

  // SELF-CORRECTING SEO LOOP: validate the YouTube title/description against the audit rules and, if a
  // rule is broken, RE-PROMPT with the exact problem named (up to 2 retries), keeping whichever draft
  // has the lowest-weighted violations. Only the retry's YOUTUBE is adopted — Facebook stays pinned to
  // the first draft, so an SEO retry can neither change FB (out of scope) nor hold the video on a short
  // retry FB. This is what makes the automation stop repeating these mistakes. (review 2026-07-14)
  let best = res, bestIssues = ytIssues(res.youtube, primaryEntity, facts.entities);
  for (let attempt = 1; attempt <= 2 && bestIssues.length; attempt++) {
    const fixUser = `${baseUser}\n\nYour previous YouTube draft had these SEO problems — FIX every one while keeping all facts accurate and the copy natural (do NOT keyword-stuff or pad):\n- ${bestIssues.map((i) => i.msg).join("\n- ")}`;
    const retry = await gen(fixUser).catch(() => null);
    if (!retry) break;
    const rIssues = ytIssues(retry.youtube, primaryEntity, facts.entities);
    if (issueWeight(rIssues) < issueWeight(bestIssues)) { best = { ...best, youtube: retry.youtube }; bestIssues = rIssues; }
  }
  res = best;
  if (bestIssues.length) console.warn(`  ⚠ platformMeta YouTube SEO (shipping best draft): ${bestIssues.map((i) => i.msg).join("; ")}`);

  const fb = res.facebook || {};
  const yt = res.youtube || {};

  // ---- Facebook: text + AI-note + light hashtags ----
  const fbText = stripSource(fb.text);
  const fbTags = normTags(fb.hashtags, facts.entities);
  const facebook = {
    text: fbText,
    hashtags: fbTags,
    full: [fbText, "", AI_NOTE, "", fbTags.join(" ")].join("\n").trim(),
  };

  // ---- YouTube: title (final, ≤70, word-boundary) + description + link + tags ----
  const title = finalTitle(yt.title);
  const ytDesc = stripSource(yt.description);
  const ytTags = normTags(yt.hashtags, facts.entities);
  // #Shorts moved to the END so the first-3 (clickable, above-title) slots go to entity/niche tags —
  // higher search value than #Shorts, which YouTube auto-detects anyway. (SEO audit 2026-07-14)
  const tagLine = [...ytTags.filter((t) => t.toLowerCase() !== "#shorts"), "#Shorts"].slice(0, 6).join(" ");
  const description = [ytDesc, "", AI_NOTE, articleUrl ? `\nWatch more: ${articleUrl}` : "", "", tagLine].filter((l) => l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const youtube = { title, description, hashtags: ytTags, seoWarnings: bestIssues.map((i) => i.msg) };

  // light validity gate — a broken/empty field holds rather than posts garbage (SEO misses do NOT hold)
  if (!facebook.text || wc(facebook.text) < 6 || !title || !ytDesc) {
    return { meta: null, hold: "platformMeta produced an empty/too-short field" };
  }
  return { meta: { facebook, youtube } };
}

// Pure SEO guards exposed for the offline suite (no LLM) so the "never repeat these mistakes" behavior
// is regression-locked. Not used at runtime. (2026-07-14)
export const __test = { pickPrimaryEntity, leadEntityOf, leadsWith, ytIssues, normTags, finalTitle };
