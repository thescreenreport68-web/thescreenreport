// AGENT — PLATFORM METADATA: per-platform title/description/caption for the NEW platforms
// (Facebook + YouTube). Instagram keeps its own proven caption agent (agents/caption.mjs) untouched,
// so the live IG path can never regress; this ADDS the two new platforms so one build fans out to
// all three. Same hard rules as the IG caption: use only verified facts, NO source/outlet attribution,
// NO fourth wall, plus the light "AI-assisted" disclosure. Researched structures (2026):
//   Facebook — topic + CTA in the FIRST 125 chars, keyword-natural, 3-5 light hashtags.
//   YouTube  — keyword-front title <=70 chars + a 150-350 char keyworded description; #Shorts +
//              3-5 hashtags + the article link are appended deterministically.
import { llm } from "../models.mjs";
import { normWords } from "../lib/util.mjs";

const AI_NOTE = "AI-assisted recap by The Screen Report.";
const wc = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

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

function normTags(arr, entities = []) {
  let tags = (Array.isArray(arr) ? arr : []).map((t) => (String(t).startsWith("#") ? String(t) : `#${t}`));
  tags = [...new Map(tags.map((t) => [t.toLowerCase(), t.replace(/[^#A-Za-z0-9]/g, "")])).values()].filter((t) => t.length > 2 && !/^#(fyp|viral|reels|trending|foryou|explore)$/i.test(t));
  const entTags = entities.map((e) => "#" + String(e.name).replace(/[^A-Za-z0-9]/g, ""));
  for (const t of [...entTags, "#MovieNews", "#Hollywood"]) {
    if (tags.length >= 5) break;
    if (t.length > 2 && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
  }
  return tags.slice(0, 5);
}

const SYS = `You write platform-native copy for a Hollywood movie/celebrity NEWS brand, from VERIFIED FACTS only. Produce copy for TWO platforms, each in its native style. Return STRICT JSON:
{"facebook":{"text":string,"hashtags":[string]},"youtube":{"title":string,"description":string,"hashtags":[string]}}

SHARED HARD RULES (both platforms):
- Use ONLY the provided facts. Never invent, infer, or embellish. State facts directly, first-hand.
- NEVER name, cite, or attribute a news outlet or source ("according to", "per <outlet>", "reports say", any publication name). NEVER reference "the article/report/story".
- No ALL-CAPS words, no clickbait, no bait phrases ("you won't believe", "wait for it", "tag a friend").

FACEBOOK (share-driven; the first ~125 characters show before "more"):
- text: lead with the topic + the single most surprising concrete fact in the FIRST 125 characters, then 1-2 more short factual sentences. Warm, direct, keyword-natural (full names, film titles, words like "box office"/"casting"/"trailer"). End with a short share-or-comment CTA. No hashtags inside the text.
- hashtags: 3-5 light, relevant (story entities + niche). Never generic (#fyp/#viral).

YOUTUBE SHORTS (search + suggested; title is a real field):
- title: <= 70 characters. Front-load the #1 keyword (star/film name) AND the surprising fact; a curiosity angle helps. No hashtags in the title. No source names.
- description: 150-350 characters. The FIRST sentence carries the keyword + hook (it is the search snippet). Then 1-2 more factual sentences. Keyword-natural. Do NOT add links or #Shorts (appended automatically).
- hashtags: 3-5 (story entities + niche).`;

export async function writePlatformMeta({ facts, segment, engage, articleUrl = "" }) {
  const user = `STORY: ${facts.storyOneLine}\nENTITIES: ${facts.entities.map((e) => `${e.name} (${e.kind})`).join(", ")}\nFACTS:\n${facts.facts.map((f) => `- ${f.claim}`).join("\n")}\nSEGMENT: ${segment || "news"}\nENGAGEMENT GOAL: ${engage?.goal || "shares"}`;

  let res;
  try {
    res = await llm({ role: "caption", system: SYS, user, temp: 0.4, maxTokens: 600, json: true });
  } catch (e) {
    return { meta: null, hold: `platformMeta failed: ${String(e.message || e).slice(0, 120)}` };
  }

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

  // ---- YouTube: title (<=100 hard, aim <=70) + description + link + #Shorts + tags ----
  let title = stripSource(yt.title).replace(/\s+/g, " ").trim();
  if (title.length > 100) { // hard YT limit; trim at a word boundary
    title = title.slice(0, 100).replace(/\s+\S*$/, "").trim();
  }
  const ytDesc = stripSource(yt.description);
  const ytTags = normTags(yt.hashtags, facts.entities);
  const tagLine = ["#Shorts", ...ytTags.filter((t) => t.toLowerCase() !== "#shorts")].slice(0, 6).join(" ");
  const description = [ytDesc, "", AI_NOTE, articleUrl ? `\nWatch more: ${articleUrl}` : "", "", tagLine].filter((l) => l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const youtube = { title, description, hashtags: ytTags };

  // light validity gate — a broken/empty field holds rather than posts garbage
  if (!facebook.text || wc(facebook.text) < 6 || !title || !ytDesc) {
    return { meta: null, hold: "platformMeta produced an empty/too-short field" };
  }
  return { meta: { facebook, youtube } };
}
