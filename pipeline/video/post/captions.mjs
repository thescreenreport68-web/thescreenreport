// DEDICATED PER-PLATFORM CAPTION ENGINE (owner 2026-07-05: "separate description + title for each
// platform, in that platform's way"). Runs on the POSTING side — takes a finished video's facts and
// writes platform-perfect copy. Does NOT touch the video pipeline (script/voice/image/render untouched).
// One cheap LLM call + hard deterministic guards (limits/markdown/hashtags) so every field is post-ready.
import { chat } from "../../lib/openrouter.mjs";
import { VIDEO } from "../config.mjs";

const SYS = `You are the social editor for The Screen Report, a Hollywood-news brand. Write the post copy for ONE short news video, tailored to EACH platform's native style. Punchy, accurate, scroll-stopping — never clickbait the facts don't support. STRICT JSON only.

PLATFORM RULES (obey exactly):
- facebook: 1-2 conversational sentences that tease the story + end with an engaging question. 0-1 hashtag. No "link in bio". (A link is added separately.)
- instagram: 2-3 punchy lines (an emoji or two is fine) + THEN a block of 10-14 specific, relevant hashtags (movie/show/actor names + #MovieNews/#TVNews/#CelebrityNews as fits). No links (IG captions can't link).
- youtube.title: <=90 chars, front-load the biggest keyword/entity, include the hook, end with #Shorts. No clickbait caps-lock.
- youtube.description: 2-3 sentences of real context + 5-8 hashtags. (A link line is added separately.)
- pinterest.title: <=95 chars, keyword-rich and searchable (people search Pinterest — front-load the searchable terms).
- pinterest.description: <=480 chars, keyword-rich, searchable, ends with a soft call to action. No hashtag wall (2-4 max).
- x: <=230 chars, 1-2 hashtags, NO link.
Use the REAL names/titles/numbers from the facts. Never invent. Match the story's tone (somber for tragedy).
Return ONLY: {"facebook":"...","instagram":"...","youtube":{"title":"...","description":"..."},"pinterest":{"title":"...","description":"..."},"x":"..."}`;

const strip = (s) => String(s || "").replace(/[*_`~]+/g, "").replace(/\s{2,}/g, " ").trim();
const clamp = (s, n) => { s = strip(s); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…"; };

// facts: { title, hook, lines:[spoken...], category }
export async function makeCaptions({ title, hook, lines = [], category = "" }, model = VIDEO.scriptModel) {
  const brief = `HEADLINE: ${title}\nCATEGORY: ${category}\nVIDEO HOOK: ${hook}\nVIDEO SCRIPT: ${lines.join(" ")}`;
  let data = {};
  try { ({ data } = await chat({ model, system: SYS, user: brief, json: true, maxTokens: 900, temperature: 0.6 })); }
  catch { data = {}; }
  // deterministic guards — every field post-ready regardless of the model
  const yt = data.youtube || {}, pin = data.pinterest || {};
  let ytTitle = clamp(yt.title || title, 90);
  if (!/#shorts/i.test(ytTitle)) ytTitle = clamp(ytTitle.replace(/#shorts/i, "").trim(), 80) + " #Shorts";
  return {
    facebook: clamp(data.facebook || title, 1800),
    instagram: clamp(data.instagram || title, 2100),
    youtube: { title: ytTitle, description: clamp(yt.description || title, 4900) },
    pinterest: { title: clamp(pin.title || title, 95), description: clamp(pin.description || title, 480) },
    x: clamp(data.x || title, 230),
  };
}
