// AGENT 5 — WRITER. Its one job: turn the brief into an original, engaging, readable article.
// Creativity ON (temp 0.7 fresh / 0.2 surgical corrections) — but the ACCURACY LINE is absolute:
// every quote copied EXACTLY from the anchor block, every named person must exist in it, no invented
// names/dates/times/titles, audience posts attributed in aggregate only. Readability + engagement
// are the goal; SEO stays basic (one natural keyword, no stuffing).
import { agentChat } from "../models.mjs";
import { FORMS, SEO } from "../config.inside.mjs";
import { norm } from "../reactionFinder.mjs";

const FORM_GUIDE = {
  "audience-reaction": `SKELETON — how people are reacting:
1. HOOK lede (from the brief): the work + the honest shape of the reaction, written to pull the reader in.
2. THE SPINE = the AUDIENCE posts (A1, A2…): characterize the mood in YOUR words, then SHOW the real posts
   as beats, grouped by sentiment, ALWAYS naming the platform ("one X user wrote…", "a fan on Reddit said…");
   if divided, both sides get real posts.
3. Critics/named voices: AT MOST one short "critics, meanwhile…" paragraph — never the spine.
4. One "why it's landing this way" beat (your analysis). 5. Close on where the conversation is heading.`,
  "the-debate": `SKELETON — the argument:
1. HOOK: the ONE specific thing people are arguing about.
2. Side A (framing + real AUDIENCE posts, platform named) → Side B (same); your voice between the quotes;
   named/critic quotes at most one beat.
3. "Why this hit a nerve" beat. 4. Close without forcing a winner.`,
  "creator-answers-critics": `SKELETON — a creator answers back:
1. HOOK: the criticism + that [named creator] has now responded.
2. The audience criticism (real posts, aggregate). 3. The creator's REAL response — verbatim, attributed
   by name. 4. Close on how it landed.`,
  "breakout-buzz": `SKELETON — who everyone's talking about:
1. HOOK: the moment that made them the talk of the internet. 2. Who they are + what people are saying
   (real posts; named praise verbatim). 3. "Why now" beat. 4. What's next.`,
};

const SYS = `You are the writer for The Screen Report's audience-reaction & discourse desk. You write
ORIGINAL, lively, scannable articles people finish.

THE ACCURACY LINE (machine-enforced; violations kill the article):
- Craft the narrative freely, anchored by the brief — but NEVER invent a quote, name, date, time, or title.
- Every quoted span must be copied EXACTLY from the ANCHOR block (find the anchor by its id) — with ZERO
  added formatting: never bold/italic markers or brackets inside quotation marks, never a leading space.
- QUOTATION MARKS ARE RESERVED for exact anchor copies. Your own analysis, the brief's summaries, and any
  characterization of what fans think must appear WITHOUT quotation marks — the wall reads every "…" span
  as a claimed real post and kills the article if it isn't one. If you can't find the exact anchor for a
  line, drop the quote marks and say it in your own words instead.
- AUDIENCE posts are the article's spine: attribute in aggregate WITH THE PLATFORM ("one X user wrote",
  "a fan on Reddit said") — never a name/handle for an ordinary person. Prefer posts with [tweet:id] (they
  render as the real embedded post). Named/critic quotes = one short beat at most. Never state a rumor as
  fact. No numbers not in the anchors.
- BOTH SIDES, HONESTLY — the good AND the ugly. Report the praise and the criticism. When reactions turn
  hateful — racist, sexist, bigoted, cruel — you REPORT it as the ugly side of the response and NAME IT
  PLAINLY for what it is, in the site's own critical voice ("the reaction also curdled into outright
  racism", "it's disheartening to see", "the uglier corner of the timeline"). You are the outlet EXPOSING
  bad behavior, never neutrally amplifying or endorsing it — never call a racist/sexist post "sarcasm",
  "spicy", "a hot take", or frame it approvingly. Show readers the good and the bad, and stand clearly on
  the right side of it.

CRAFT: hook first (use the brief's hook), short paragraphs, the real posts as visual beats, curiosity in
structure (build to the standout anchors — strongest last), at most ${SEO.maxQuestionH2s} question-style H2s,
one natural use of the SEO keyword — nothing stuffed.
VOICE (the genre's native register — the phrases matter): write like a real fans-react desk, not a
template. Natural expressions like "the internet went into full meltdown", "fans are losing it over",
"the replies did not disappoint" — a FEW, varied, never stacked. Subheadings must be STORY-SPECIFIC and a
little creative; generic meta questions ("Why is this happening now?", "How are fans reacting?", "Who is
everyone talking about?") are BANNED and machine-detected. For a death/illness/tragedy story the
register flips to restraint: warm, somber, no hype phrasing, no exclamation marks. Return STRICT JSON only.`;

// The writer NEVER copies quote text for display cards — it picks anchors BY ID and the code
// substitutes the exact harvested text (cloud runs 2-3: every model mutation class — markdown
// leaked into quotes, light rephrasing, merged spans — died at the wall; a card the writer never
// types cannot mutate). Unknown/malformed ids drop the card; legacy full-card shapes pass through
// untouched (the wall still checks them).
function cardFor(factBlock, id) {
  const m = /^([RA])\s*(\d+)$/i.exec(String(id || "").trim());
  if (!m) return null;
  const list = m[1].toUpperCase() === "R" ? factBlock.reactions : factBlock.aggregateFans;
  const r = list?.[Number(m[2]) - 1];
  if (!r?.quote) return null;
  return {
    speaker: r.speaker || "", connection: r.connection || "", platform: r.platform || "",
    date: r.date || "", quote: r.quote, ...(r.tweetId ? { tweetId: r.tweetId } : { tweetId: "" }),
  };
}

function substituteAnchorCards(article, factBlock) {
  if (!article || !factBlock) return article;
  if (Array.isArray(article.reactionsRender)) {
    article.reactionsRender = article.reactionsRender
      .map((c) => {
        const snap = cardFor(factBlock, c?.anchorId);
        if (snap) return snap; // anchor's own tweetId only — a writer-guessed id could mispair
        return c?.anchorId ? null : c; // unknown id → drop; legacy full card → wall checks it
      })
      .filter((c) => c && c.quote);
  }
  if (article.anchorStatement?.anchorId) {
    const snap = cardFor(factBlock, article.anchorStatement.anchorId);
    article.anchorStatement = snap ? { speaker: snap.speaker, connection: snap.connection, quote: snap.quote, platform: snap.platform } : null;
  }
  return article;
}

// Deterministic repair of body-prose quotes BEFORE QA: (1) markdown the model leaked INSIDE a
// quotation heals when the stripped span is verbatim; (2) a span that is a prefix of exactly ONE
// anchor snaps to that anchor's full text (kills truncation scars). Anything else is left for the
// wall — repair never invents, it only restores the harvested original.
export function repairBodyQuotes(article, factBlock) {
  if (!article?.body || !factBlock) return 0;
  const anchors = [...(factBlock.reactions || []), ...(factBlock.aggregateFans || [])]
    .map((r) => r.quote).filter(Boolean);
  const nA = anchors.map((a) => ({ a, n: norm(a) }));
  let repairs = 0;
  article.body = article.body.replace(/([“"])([^“”"\n]{20,400})([”"])/g, (m, o, span, c) => {
    const ns = norm(span);
    if (!ns) return m;
    const at = (x) => x.n.indexOf(ns);
    if (nA.some((x) => at(x) >= 0)) {
      // Substring of an anchor. A word-boundary shortening is a legitimate quote (the wall passes
      // it); a MID-WORD truncation is the scar class the QA guard hard-blocks — snap it to the one
      // anchor it was cut from.
      const cleanHit = nA.some((x) => { const i = at(x); return i >= 0 && !/[a-z0-9]/.test(x.n[i + ns.length] || ""); });
      if (cleanHit) return m;
      const scarred = nA.filter((x) => { const i = at(x); return i >= 0 && /[a-z0-9]/.test(x.n[i + ns.length] || ""); });
      if (ns.length >= 20 && scarred.length === 1) { repairs++; return o + scarred[0].a + c; }
      return m;
    }
    const stripped = span.replace(/(\*\*|\*|__|`)/g, "");
    if (stripped !== span && nA.some((x) => x.n.includes(norm(stripped)))) { repairs++; return o + stripped + c; }
    return m; // genuinely unanchored — the wall blocks it, corrections handle it
  });
  return repairs;
}

// run(job, {corrections, previousArticle}) → job.article
export async function run(job, { corrections = null, previousArticle = null, chatImpl = null } = {}) {
  const form = FORMS[job.angle.form];
  const [lo, hi] = form.words;
  const anchors = (job.factBlock.stats.namedVoices || 0) + (job.factBlock.stats.fanPosts || 0);
  const budget = Math.min(hi, Math.max(lo, lo + anchors * 40));

  const schema = `{"title":"","metaTitle":"<=60 chars","dek":"1-2 engaging sentences","metaDescription":"<=155 chars",
"keyTakeaways":["3-4 items"],"body":"markdown with ## H2s","faq":[{"q":"","a":"40-60 word answer"},{"q":"2-3 REAL questions a reader would search","a":""}],
"about":[{"name":"","type":"Person|Movie|TVSeries|Organization"}],"tags":["4-8"],"imageQuery":"image search phrase",
"reactionsRender":[{"anchorId":"R1 or A3 — the anchor to show as a display card","tweetId":""}],
"anchorStatement":{"anchorId":"R# — creator-answers-critics ONLY, else omit"},
"fanConsensus":"one-line honest sentiment read","claims":[{"text":"hard fact used","sourceQuote":"anchor line"}]}`;

  const user = `Write the article.

FORM: ${job.angle.form} — ${form.label}
${FORM_GUIDE[job.angle.form]}

THE BRIEF (your editor's distillation — follow it):
${JSON.stringify(job.brief, null, 1)}

THE ANCHOR BLOCK (the ONLY quotes/voices that exist — copy quotes EXACTLY from here by ref):
${job.factText}

WORD BUDGET: ~${budget} words. SEO keyword (use once, naturally): ${job.brief.seoKeyword}
Available X embed ids (use in reactionsRender only if the post matches): ${job.embeds?.tweetIds?.join(", ") || "none"}
reactionsRender = 6-12 display cards chosen BY ANCHOR ID (the exact quote text is substituted
mechanically from the block — you never copy it), ordered to build to the standouts. anchorStatement ONLY
for creator-answers-critics. ${corrections ? `\n⚠⚠ MANDATORY CORRECTIONS — fix ONLY these, change nothing else:\n${corrections}` : ""}

Return JSON with EXACTLY these fields: ${schema}`;

  if (previousArticle && corrections) {
    const { data } = await agentChat("writer", { system: SYS, user, surgical: true }, chatImpl ? { chatImpl } : {});
    job.article = substituteAnchorCards({ ...previousArticle, ...(data || {}) }, job.factBlock);
    repairBodyQuotes(job.article, job.factBlock);
    return job;
  }

  let article = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const suffix = attempt ? "\n\n⚠ Your previous output was INCOMPLETE. Return the FULL JSON." : "";
    const { data } = await agentChat("writer", { system: SYS, user: user + suffix }, chatImpl ? { chatImpl } : {});
    article = data;
    const words = (article?.body || "").split(/\s+/).filter(Boolean).length;
    if (article && words >= Math.min(lo, 300) && (article.keyTakeaways || []).length >= 3 && (article.faq || []).length >= 2) break;
  }
  job.article = substituteAnchorCards(article, job.factBlock);
  repairBodyQuotes(job.article, job.factBlock);
  return job;
}
