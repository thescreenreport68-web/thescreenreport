// THE inside lane's ONE SEO finisher (owner audit 2026-07-16 — consolidates the three divergent
// metaTitle implementations that lived in inside/seo.mjs, assemble.mjs trimAtWord, and the writer
// prompt into a single tested module). The reader-facing display `title` is NEVER shortened; these
// shape ONLY the stored metaTitle/metaDescription frontmatter. RENDER CONTRACT: the site honors a
// stored metaTitle of 30–65 chars verbatim; metaDescription must be ≤160 or the render collapses it.
//
// RULES (owner):
// - metaTitle: target 45–55, hard ceiling 65. A CUT must end clean — never on a verb ("…Sparks",
//   "…Teases"), pronoun, or function word; never splitting a proper name; never orphaning a quote.
//   If no clean cut exists in 45–60, ship the FULL metaTitle (≤65) rather than a fragment.
// - metaDescription: 140–160 preferred, COMPLETE SENTENCE(S). Prefer sentence-boundary cuts; append
//   "…" only when no sentence boundary is usable.
// - All plain-text fields are markdown-free (the writer is told; stripMd is the deterministic net).

// ── plain-text hygiene ─────────────────────────────────────────────────────────────────────────────
// Strip markdown tokens from a PLAIN-TEXT field (title/dek/meta/FAQ) — readers saw literal *asterisks*
// (*The Odyssey* in a title, *120 Minutes* in a FAQ answer). Links → their text; emphasis/code tokens
// dropped; whitespace collapsed. NEVER applied to reaction quotes (those are verbatim posts).
export const stripMd = (s) =>
  String(s || "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")     // [text](url) → text
    .replace(/(\*\*|__)(.+?)\1/g, "$2")           // **bold**
    .replace(/(^|[\s(“"'])\*([^*\n]+)\*(?=[\s).,;:!?”"']|$)/g, "$1$2") // *italic* (not mid-word)
    .replace(/(^|[\s(“"'])_([^_\n]+)_(?=[\s).,;:!?”"']|$)/g, "$1$2")   // _italic_
    .replace(/`([^`]*)`/g, "$1")                  // `code`
    .replace(/[*_`]{2,}/g, "")                    // stray runs
    .replace(/\s+/g, " ")
    .trim();

export const stripBrand = (s) =>
  String(s || "").replace(/\s*[—–|:-]\s*(the\s+)?screen\s+report\s*$/i, "").replace(/\s+/g, " ").trim();

// ── clean-ending machinery ─────────────────────────────────────────────────────────────────────────
const FUNCTION_WORDS = new Set(
  ("a an the of to in on at for with and or but nor as is are was were be been being it its this that these those from by per via vs versus into onto over under after before while when where who whom whose which what why how than then so if because amid despite during about against between among around through across behind beyond within without toward towards up down off out not no & de la le da").split(/\s+/));
const PRONOUNS = new Set("he she they them him her his hers their theirs we us our ours you your yours i me my mine".split(/\s+/));
// Headline verbs that read broken when a cut ends on them ("Finale Cliffhanger Sparks", "Trailer
// Teases"). ONLY unambiguous verb forms — words that are also common NOUNS (debate, show, calls, wins,
// looks, the reveal, the feels…) are legitimate title endings and must NOT be here (the Paramount case:
// "…Sparks Fierce Debate" is complete; flagging "debate" produced the worse "…Sparks Fierce").
const DANGLING_VERBS = new Set(
  ("sparks spark teases says say said reveals slams drops stuns stun sees takes gets get goes go has have had makes make leaves sends send brings bring keeps keep gives give asks ask tells tell seems seem confirms confirm announces announce admits admit denies deny defends defend blasts blast mocks mock praises praise reacts react responds respond weighs weigh divides divide ignites ignite fuels fuel becomes become remains remain earns earn belongs belong proves prove puts pushes push arrives arrive mourns mourn joins join").split(/\s+/));
// Modifiers that dangle when a cut lands on them ("Delay & New", "…Sparks Fierce").
const DANGLING_MODS = new Set("new first last final major big huge own next other early late top only every another fierce heated intense divisive sheer utter".split(/\s+/));
// Modals and degree adverbs ALWAYS take a following verb/phrase, so a title ending on one is provably
// cut mid-clause. Four of twelve live metaTitles ended this way ("…Creators Are Already", "…Cast Hints
// Pink May") because neither list covered them — they are nouns to no reading (07-19 audit).
const DANGLING_TAILS = new Set(
  ("may might will would shall should must can could already just still yet soon never always almost nearly really quite rather even ever barely hardly simply merely finally actually apparently reportedly allegedly").split(/\s+/));

const lastWordOf = (s) => (String(s).toLowerCase().replace(/[^a-z0-9'’&\s]+/g, " ").trim().split(/\s+/).pop() || "").replace(/[’']s?$/, "");
export const endsClean = (s) => {
  const w = lastWordOf(s);
  if (!w) return false;
  // "Sparks a Wave", "That Has Fans" — an article/quantifier two words back leaves a noun phrase whose
  // complement got cut ("a wave OF anticipation"). The noun itself looks like a clean ending, so the
  // check has to look behind it.
  const toks = String(s).toLowerCase().replace(/[^a-z0-9'’&\s]+/g, " ").trim().split(/\s+/);
  if (toks.length >= 2 && /^(a|an)$/.test(toks[toks.length - 2])) return false;
  return !(FUNCTION_WORDS.has(w) || PRONOUNS.has(w) || DANGLING_VERBS.has(w) || DANGLING_MODS.has(w) || DANGLING_TAILS.has(w));
};
// Quote characters must be paired — a cut must never orphan an opening quote.
export const quotesBalanced = (s) => {
  const t = String(s);
  if (((t.match(/"/g) || []).length) % 2) return false;
  if ((t.match(/“/g) || []).length !== (t.match(/”/g) || []).length) return false;
  const openSingle = (t.match(/(^|[\s(—–-])['‘](?=\S)/g) || []).length;
  const closeSingle = (t.match(/\S['’](?=[\s).,;:!?]|$)/g) || []).length; // mid-word apostrophes don't count
  return openSingle <= closeSingle;
};
const cleanEdges = (s) => String(s).replace(/^[\s—–\-|:,;&]+/, "").replace(/[\s—–\-|:,;&]+$/, "").trim();

// A cut must not split a run of capitalized words (a person/work name). In Title-Case headlines EVERY
// word is capitalized, so bare capitalization can't discriminate — a next-word that is a known
// function/verb/modifier word is a clause boundary, not a name continuation ("Cliffhanger | Sparks" is
// cuttable; "George | Lucas" and "Artificial | Intelligence" are not).
const KNOWN_BOUNDARY = () => {
  const s = new Set();
  for (const set of [FUNCTION_WORDS, PRONOUNS, DANGLING_VERBS, DANGLING_MODS]) for (const w of set) s.add(w);
  return s;
};
const BOUNDARY_WORDS = KNOWN_BOUNDARY();
const splitsName = (words, i) => {
  if (i >= words.length) return false; // full string — nothing after
  const prev = words[i - 1] || "", next = words[i] || "";
  if (!/^[A-Z0-9]/.test(next) || !/^[A-Z0-9“"']/.test(prev)) return false;
  return !BOUNDARY_WORDS.has(next.toLowerCase().replace(/[^a-z'’&]+/g, ""));
};

// All CLEAN cut candidates of s (word prefixes passing every ending rule).
function cleanCuts(s) {
  const words = String(s).split(/\s+/).filter(Boolean);
  const out = [];
  let acc = "";
  for (let i = 0; i < words.length; i++) {
    acc = acc ? `${acc} ${words[i]}` : words[i];
    if (i + 1 === words.length) break; // the full string is handled separately, not as a "cut"
    const cand = cleanEdges(acc);
    if (!cand) continue;
    if (!endsClean(cand)) continue;
    if (!quotesBalanced(cand)) continue;
    if (splitsName(words, i + 1)) continue;
    out.push({ text: cand, len: cand.length });
  }
  return out;
}

// ── metaTitle (the ONE implementation) ────────────────────────────────────────────────────────────
// Precedence: (1) the writer's crafted metaTitle whole, if 45–55 and clean; (2) the best clean CUT of
// it in 45–55; (3) it whole at 56–65 and clean (a complete clause ≤65 beats any fragment — the render
// honors it verbatim); (4) a clean cut 56–60; then the same ladder over the display title. Last resort
// = longest clean cut ≥30, else a bad-tail-trimmed 60-char word cut. Hard ceiling 65 everywhere.
export function metaTitleFor({ metaTitle, title } = {}) {
  const model = cleanEdges(stripBrand(stripMd(metaTitle)));
  const display = cleanEdges(stripBrand(stripMd(title)).replace(/\s*\(\d{4}\)\s*$/, ""));
  const wholeOk = (s) => s && s.length >= 45 && s.length <= 65 && endsClean(s) && quotesBalanced(s);

  for (const src of [model, display]) {
    if (!src) continue;
    if (wholeOk(src) && src.length <= 55) return src;                       // crafted, in band, clean
    const cuts = cleanCuts(src);
    const inBand = cuts.filter((c) => c.len >= 45 && c.len <= 55);
    if (inBand.length) return inBand.sort((a, b) => b.len - a.len)[0].text; // best clean cut 45–55
    if (wholeOk(src)) return src;                                           // whole 56–65 clean beats a fragment
    const wide = cuts.filter((c) => c.len >= 45 && c.len <= 60);
    if (wide.length) return wide.sort((a, b) => b.len - a.len)[0].text;     // clean cut 56–60
  }
  // Nothing clean in band from either source — degrade gracefully, still never a dangler if avoidable.
  for (const src of [model, display]) {
    if (!src) continue;
    if (src.length <= 65 && src.length >= 30 && endsClean(src) && quotesBalanced(src)) return src; // short-but-whole ≤65
    const any = cleanCuts(src).filter((c) => c.len >= 30 && c.len <= 65);
    if (any.length) return any.sort((a, b) => b.len - a.len)[0].text;
  }
  // Ultimate fallback: word-boundary 60-cut, then iteratively drop trailing bad words.
  let s = (display || model || "").slice(0, 61);
  s = s.includes(" ") ? s.replace(/\s+\S*$/, "") : s;
  for (let i = 0; i < 4 && s && !endsClean(s); i++) s = cleanEdges(s.replace(/\s+\S+$/, ""));
  return cleanEdges(s) || (display || model || "").slice(0, 60);
}

// ── metaDescription ───────────────────────────────────────────────────────────────────────────────
// Writer targets 140–155 ending on a complete sentence. Finisher: ≤160 with terminal punctuation ships
// as-is; over-length prefers the last full SENTENCE boundary ≥90; "…" only when no boundary is usable.
const SENT_END = /[.!?…](?=["'”’)\]]*\s|["'”’)\]]*$)/g;
export function metaDescriptionFor({ metaDescription, dek } = {}) {
  const candidates = [metaDescription, dek];
  // PASS 1 — a genuinely COMPLETE result from any source: already-terminated ≤160, or a real inner
  // sentence boundary (≥90 so we keep substance). A truncated phrase NEVER gets a fake period —
  // "…saving their teenage." reads broken; the dek (complete sentences by construction) wins instead.
  for (const raw of candidates) {
    const t = stripMd(raw);
    if (!t || t.length < 60) continue;
    if (t.length <= 160 && /[.!?…]["'”’)\]]*$/.test(t)) return t;
    const head = t.slice(0, 160);
    const m = [...head.matchAll(SENT_END)];
    if (m.length && m[m.length - 1].index >= 90) return head.slice(0, m[m.length - 1].index + 1);
  }
  // PASS 2 — nothing complete anywhere: unavoidable "…" after backing off any dangling tail words.
  for (const raw of candidates) {
    const t = stripMd(raw);
    if (!t || t.length < 60) continue;
    let cut = t.length <= 160 ? t : t.slice(0, 158).replace(/\s+\S*$/, "");
    for (let i = 0; i < 4 && cut && !endsClean(cut); i++) cut = cleanEdges(cut.replace(/\s+\S+$/, ""));
    if (cut.length >= 80) return cleanEdges(cut) + "…";
  }
  const t = stripMd(metaDescription) || stripMd(dek);
  return t.length <= 160 ? t : t.slice(0, 157).replace(/\s+\S*$/, "") + "…";
}

// Convenience wrapper for assemble: both finished fields at once.
export const seoFinish = ({ metaTitle, title, metaDescription, dek }) => ({
  metaTitle: metaTitleFor({ metaTitle, title }),
  metaDescription: metaDescriptionFor({ metaDescription, dek }),
});

// ── TITLE-HOOK VARIETY (owner: "has fans in a chokehold" ×7, "The Internet Had Thoughts" ×8) ───────
// A rolling ledger of recent titles yields the currently-overused hook phrases; the writer is told to
// avoid them and agentrun deterministically demands a rewrite when one slips through anyway.
const STATIC_HOOKS = ["in a chokehold", "the internet had thoughts", "internet had thoughts", "isn t having it"];
const normHook = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
export function bannedHooksFrom(recentTitles, { min = 2, cap = 18 } = {}) {
  const counts = new Map();
  for (const t of recentTitles || []) {
    const words = normHook(t).split(" ").filter(Boolean);
    const seen = new Set();
    for (let n = 3; n <= 5; n++)
      for (let i = 0; i + n <= words.length; i++) {
        const g = words.slice(i, i + n).join(" ");
        if (seen.has(g)) continue;
        seen.add(g);
        counts.set(g, (counts.get(g) || 0) + 1);
      }
  }
  // longest-first so containing grams win; a gram inside an already-kept longer gram is redundant
  const dyn = [...counts].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .map(([g]) => g).filter((g, _, arr) => !arr.some((o) => o !== g && o.includes(g)));
  return [...new Set([...STATIC_HOOKS, ...dyn])].slice(0, cap);
}
// The banned hook present in `title`, ignoring hooks made purely of the story's own subject words
// (a legit follow-up may share the entity phrase; the near-duplicate guard handles real repeats).
export function hookHit(title, hooks, { allowTokens = new Set() } = {}) {
  const t = ` ${normHook(title)} `;
  for (const h of hooks || []) {
    if (!h || !t.includes(` ${h} `)) continue;
    const words = h.split(" ").filter((w) => w.length >= 4);
    if (words.length && words.every((w) => allowTokens.has(w))) continue; // pure entity phrase
    return h;
  }
  return null;
}
