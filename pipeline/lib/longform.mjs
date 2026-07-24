// longform.mjs — 800-WORD STRUCTURED NEWS ARTICLES (owner directive 2026-07-24).
//
// 🔴 OFF BY DEFAULT. Owner: "Do not change anything on the live lane right now. We are building and
// testing it." Every behaviour here is gated on LONGFORM=1, which the live workflow does NOT set, so
// production output is byte-for-byte unchanged until we have proven 800 words end to end and the owner
// says connect it.
//
// ── THE MEASURED PROBLEM ─────────────────────────────────────────────────────────────────────────
// Last 20 published articles: median 228 words, min 110, avg 2.1 subheadings, and 18 of 20 had ZERO
// bullet points. Target is 800 words with real structure.
//
// ── WHY LENGTH ALONE IS THE WRONG LEVER ──────────────────────────────────────────────────────────
// The gatherer currently extracts ONE outlet, ~2100 chars ≈ 350 words of source. You cannot write 800
// honest words from 350 words of source; forcing it produces padding, and padding is exactly how
// invented facts entered the articles before. So longform mode widens the MATERIAL first (multi-outlet
// + the structured film/TV databases already wired in) and only then raises the target. The padding
// detector below is the safety net: if length was reached by repetition or filler rather than by
// covering more ground, the article is rejected — length must never buy itself with quality.
//
// READABILITY IS THE VETO (owner: "the number one priority"). Nothing here can override the existing
// run-on / density / keyword-stuffing blocks, and `paddingReport` adds a padding-specific block.

export const ON = process.env.LONGFORM === "1";

export const CFG = {
  // The enforced floor. Staged during testing (400 → 600 → 800) via LONGFORM_MIN_WORDS so we can prove
  // each rung before demanding the next; 800 is the owner's stated bare minimum for going live.
  MIN_WORDS: Number(process.env.LONGFORM_MIN_WORDS ?? 800),
  TARGET_WORDS: Number(process.env.LONGFORM_TARGET_WORDS ?? 950),
  MIN_H2: Number(process.env.LONGFORM_MIN_H2 ?? 4),
  MIN_BULLETS: Number(process.env.LONGFORM_MIN_BULLETS ?? 4),   // total list items, not lists
  // Source material needed before we may even ASK for the long form. ~6 chars/word, and a faithful
  // rewrite needs materially more source than output — below this the honest answer is a shorter piece.
  MIN_CHARS: Number(process.env.LONGFORM_MIN_CHARS ?? 6000),
  MIN_SOURCES: Number(process.env.LONGFORM_MIN_SOURCES ?? 2),
};

// ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
// A fixed news structure the writer fills, each section anchored to material we actually hold. Phrased
// as guidance rather than literal headings so the writer names them in the story's own words (a page
// of identical H2s across every article is its own quality problem).
export const SHAPE = `ARTICLE SHAPE — a real news article, not a brief. Build it in these movements, each one
earning its length from the REFERENCE FACTS. Use the story's own words for the headings; never paste these labels.

1. OPENING (no heading, 2-3 short paragraphs): the news in the first sentence — who/what/when, the single most
   specific verified detail. Then why it matters. No throat-clearing, no "in a move that", no restating the headline.
2. THE SPECIFICS (heading, phrased as the question a reader would ask): the confirmed detail — roles, dates,
   platform, figures, who said what. ⚠ INCLUDE A BULLET LIST HERE of the concrete items (cast and the parts they
   play, key dates, platform/studio, confirmed figures) — 3-6 items, each a real fact from the facts below, each a
   short phrase not a sentence. This is the section readers scan; a wall of prose wastes it.
3. THE PROJECT / THE PEOPLE (heading): what this film/series/artist actually is, grounded in the structured facts
   (cast, director, release window, prior work). This is where an 800-word piece earns its length honestly — real
   context a reader wants, all of it from the facts.
4. HOW IT FITS / WHY IT MATTERS (heading): the industry read — the pattern this belongs to, the stakes, the
   reaction. Analysis is allowed; INVENTION is not. Every claim traceable to the facts.
5. WHAT'S NEXT (heading): dated next steps — production start, release, the next confirmed milestone. If the
   sources give no next step, say plainly what remains unconfirmed rather than inventing a timeline.

RULES: 4-6 headings total. At least one bullet list (section 2), a second only if it genuinely helps.
Headings are descriptive and searchable ("When does it start filming?"), never generic ("Details", "More Info").
LENGTH COMES FROM COVERAGE, NEVER FROM PADDING: more verified ground, not more adjectives. If you find yourself
restating a point, adding "it remains to be seen", or describing what you cannot confirm — STOP and write shorter.
A tight, honest 500 words is far better than 800 words of filler, and filler is rejected automatically.`;

// ── PADDING DETECTOR — the safety net that lets us raise length without losing quality ───────────
// Deliberately measures the specific ways an LLM inflates a word count when it has run out of facts.
const FILLER = /\b(it remains to be seen|only time will tell|needless to say|it('s| is) worth noting|it('s| is) important to note|at the end of the day|one thing is (for )?certain|fans will (no doubt|surely)|stay tuned|watch this space|as (fans|viewers) eagerly await|has been making waves|no stranger to|when it comes to|in a move that|speaks volumes|the internet (is|was) (buzzing|abuzz)|took to social media to)\b/gi;
const HEDGE = /\b(reportedly|allegedly|apparently|seemingly|arguably|presumably|possibly|perhaps|may or may not)\b/gi;

const sentences = (t) => String(t || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 4);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Jaccard similarity over word sets — catches a sentence re-stated in fresh wording, which a literal
// duplicate check misses and which is the most common way padding actually appears.
function nearDup(a, b) {
  const A = new Set(norm(a).split(" ")), B = new Set(norm(b).split(" "));
  if (A.size < 4 || B.size < 4) return 0;
  const inter = [...A].filter((w) => B.has(w)).length;
  return inter / Math.min(A.size, B.size);
}

export function paddingReport(body, { title = "" } = {}) {
  const prose = String(body || "").replace(/^#{1,6}\s.*$/gm, "").replace(/^\s*[-*]\s+/gm, "");
  const sents = sentences(prose);
  const words = prose.split(/\s+/).filter(Boolean).length;

  const filler = (prose.match(FILLER) || []).length;
  const hedges = (prose.match(HEDGE) || []).length;

  // near-duplicate sentence pairs
  let dupPairs = 0;
  for (let i = 0; i < sents.length; i++) {
    for (let j = i + 1; j < sents.length; j++) if (nearDup(sents[i], sents[j]) >= 0.7) dupPairs++;
  }
  // headline restated in the body (a classic filler paragraph)
  const tset = new Set(norm(title).split(" ").filter((w) => w.length > 3));
  const restated = tset.size >= 3 ? sents.filter((s) => {
    const sset = new Set(norm(s).split(" "));
    return [...tset].filter((w) => sset.has(w)).length / tset.size >= 0.8;
  }).length : 0;

  const blocks = [];
  if (dupPairs >= 2) blocks.push(`${dupPairs} near-duplicate sentence pairs (padding by restatement)`);
  if (filler >= 3) blocks.push(`${filler} filler phrases ("it remains to be seen" class)`);
  if (restated >= 2) blocks.push(`headline restated ${restated}x in the body`);
  if (words >= 400 && hedges / Math.max(1, sents.length) > 0.5) blocks.push(`hedge-heavy (${hedges} hedges across ${sents.length} sentences — padding with uncertainty)`);

  return { words, sentences: sents.length, filler, hedges, dupPairs, restated, blocks, padded: blocks.length > 0 };
}

// ── STRUCTURE CHECK ──────────────────────────────────────────────────────────────────────────────
export function structureReport(body, cfg = CFG) {
  const b = String(body || "");
  const h2 = (b.match(/^##\s+\S/gm) || []).length;
  const bullets = (b.match(/^\s*[-*]\s+\S/gm) || []).length;
  const generic = (b.match(/^##\s+(details|more info(rmation)?|overview|background|conclusion|summary|final thoughts)\s*$/gim) || []).length;
  const blocks = [];
  if (h2 < cfg.MIN_H2) blocks.push(`${h2} subheadings < ${cfg.MIN_H2}`);
  if (bullets < cfg.MIN_BULLETS) blocks.push(`${bullets} bullet points < ${cfg.MIN_BULLETS}`);
  if (generic) blocks.push(`${generic} generic heading(s) ("Details"/"Overview" — name what the section actually says)`);
  return { h2, bullets, generic, blocks, ok: blocks.length === 0 };
}

// Is there enough real material to justify ASKING for the long form? Below this we deliberately keep the
// short form rather than invite padding — the whole point of gating length on material.
export function canGoLong(bundle, cfg = CFG) {
  const sources = (bundle && bundle.sources) || [];
  const chars = sources.reduce((n, s) => n + String(s?.text || "").length, 0);
  const ok = chars >= cfg.MIN_CHARS && sources.length >= cfg.MIN_SOURCES;
  return { ok, chars, sources: sources.length, need: cfg.MIN_CHARS, needSources: cfg.MIN_SOURCES,
    reason: ok ? `${chars} chars across ${sources.length} outlets — enough for the long form`
      : `only ${chars} chars / ${sources.length} outlet(s) — short form (never pad to reach a target)` };
}
