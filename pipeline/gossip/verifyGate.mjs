// GOSSIP — SPECIFICS VERIFY GATE (Step 5, the accuracy spine). The desk may SPECULATE about a STORY, but every
// CHECKABLE SPECIFIC — a DATE, a NUMBER (money/age/year/count/%), a PLACE, a PERSON, or a WORK TITLE — must be
// VERIFIED against the source, correct AND correctly attached. This is the owner's hard rule: never publish an
// unverified specific. Three layers:
//   L1 (deterministic): every claim the writer tagged with a `sourceQuote` must have that evidence really present.
//   L2 (deterministic FLOOR, always on): every number/year/date/italic-title in the body must appear in the source.
//       A specific that appears NOWHERE in the source is INVENTED — caught even if the LLM is down.
//   L3 (cheap LLM, gemini-flash): the CORRECTNESS + ATTACHMENT check. It reads the article vs the source and flags
//       any specific that is invented OR misattached (present but wrong — e.g. "married in 2022" when 2022 is an
//       interview year and they married in 2021), returning the CORRECT value from the source when it has one.
// Resolution (in run.mjs): a flagged specific is CORRECTED from the source, or — if it can't be — DROPPED. A mere
// speculative (non-specific) claim is hedged, not dropped. When the LLM can't run, L2 still drops invented
// specifics and we post the rest (owner: "drop the risky specific and post the rest").
import { agentChat } from "./models.mjs";

const norm = (s) =>
  String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const digits = (s) => String(s || "").replace(/[,\s]/g, "");

// EVERY reader-facing field that ASSERTS a fact — not just the body. A checkable specific (a date, number, name,
// title) hides in a keyTakeaway, a whatWeKnow bullet, a dek, a pull-quote, or an FAQ ANSWER just as easily as in
// the body, and those fields used to bypass the verifier entirely (the "filed May 18, 2024" wrong-year bug lived
// only in keyTakeaways/whatWeKnow). We DELIBERATELY exclude whatWeDont + FAQ questions — those state UNKNOWNS, not
// assertions, so a phrase there is not a claim to verify.
export function readerFacingText(article) {
  if (!article || typeof article !== "object") return String(article ?? "");
  const parts = [article.title, article.dek, article.body, article.pullQuote, article.gossipPull];
  for (const t of article.keyTakeaways || []) parts.push(t);
  for (const t of article.whatWeKnow || []) parts.push(t);
  for (const f of article.faq || []) if (f && f.a) parts.push(f.a);
  return parts.filter(Boolean).map(String).join("\n");
}

// token-coverage of `needle` inside one source's `hay` (near-verbatim fallback). 1.0 = every content word present.
function coverage(needle, hay) {
  const toks = norm(needle).split(" ").filter((w) => w.length > 2);
  if (!toks.length) return 0;
  let hit = 0;
  for (const t of toks) if (hay.includes(t)) hit++;
  return hit / toks.length;
}

// L1 — deterministic: a claim whose cited sourceQuote is NOT really in any SINGLE source cited fabricated evidence.
export function checkCitedEvidence(article, bundle) {
  const haystacks = (bundle?.sources || []).map((s) => norm(s.text)).filter(Boolean);
  const claims = Array.isArray(article?.claims) ? article.claims : [];
  if (!haystacks.length || !claims.length) return { unsupported: [], totalChecked: 0 };
  const unsupported = [];
  for (const c of claims) {
    const ev = (c?.sourceQuote || "").trim();
    if (!ev || ev.length < 8) continue;
    const evn = norm(ev);
    const ok = haystacks.some((h) => h.includes(evn) || coverage(ev, h) >= 0.85);
    if (!ok) unsupported.push({ claim: (c.text || "").slice(0, 200), why: `cited evidence not found in any source: "${ev.slice(0, 120)}"`, kind: "claim", problem: "invented", correction: null, isSpecific: false });
  }
  return { unsupported, totalChecked: claims.filter((c) => (c?.sourceQuote || "").length >= 8).length };
}

// L2 — DETERMINISTIC FLOOR: the cleanly-extractable specifics (numbers, years, month-dates, work titles).
// Each MUST appear in the source; one that doesn't is invented. (This is the always-on net when the LLM is down.)
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
const STOP = new Set(["a", "an", "the", "of", "to", "in", "on", "at", "for", "and", "or", "my", "his", "her", "up", "as", "by", "is"]);
// A QUOTED phrase that looks like a work title (song/album/show/movie) rather than a spoken sentence: short (≤7
// words) and mostly Title-Case or ALL-CAPS. This is what catches a fabricated song like Kesha's "Grow a Pear" —
// it sits below quoteGuard's 12-char floor and isn't italicized, so it had no deterministic net before.
function looksLikeTitle(phrase) {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 7) return false;
  const sig = words.filter((w) => w.replace(/[^A-Za-z]/g, "").length > 2 && !STOP.has(w.toLowerCase().replace(/[^a-z]/g, "")));
  if (!sig.length) return false;
  const capped = sig.filter((w) => /^[A-Z]/.test(w) || /^[A-Z0-9'!?.-]+$/.test(w)).length;
  return capped / sig.length >= 0.6; // ≥60% of significant words start capital / are all-caps ⇒ a title, not a sentence
}
export function extractDeterministicSpecifics(body) {
  const t = String(body || "");
  const out = [];
  const push = (text, kind, needle) => { if (text && !out.some((o) => o.text === text)) out.push({ text, kind, needle }); };
  for (const m of t.matchAll(/\$\s?[\d.,]+\s?(?:million|billion|thousand|m|bn|b|k)?\b/gi)) push(m[0].trim(), "number", digits(m[0].replace(/[^\d.,]/g, "")));
  for (const m of t.matchAll(/[\d.,]+\s?%/g)) push(m[0].trim(), "number", digits(m[0]));
  for (const m of t.matchAll(/\b(?:19|20)\d{2}\b/g)) push(m[0], "date", m[0]);
  for (const m of t.matchAll(new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"))) push(m[0].trim(), "date", null);
  for (const m of t.matchAll(/\b\d[\d,]{2,}\b/g)) { const d = digits(m[0]); if (!/^(?:19|20)\d{2}$/.test(d)) push(m[0], "number", d); }
  for (const m of t.matchAll(/\*([A-Z][^*\n]{1,60})\*/g)) push(m[1].trim(), "title", null); // *Knocked Up* (italic)
  // QUOTED work-titles: a title-like phrase in "quotes" or 'quotes' (a song/album/show), e.g. Kesha's "Grow a Pear".
  for (const m of t.matchAll(/[“"]([^”"\n]{2,60})[”"]/g)) { const p = m[1].trim(); if (looksLikeTitle(p)) push(p, "title", null); }
  return out;
}
function presentInBundle(spec, hayNorm, hayRaw) {
  if (spec.needle) return hayRaw.replace(/[,\s]/g, "").includes(spec.needle); // numbers: digit run present
  return hayNorm.includes(norm(spec.text)) || coverage(spec.text, hayNorm) >= 0.8; // dates/titles: phrase present
}
function deterministicSpecifics(article, bundle) {
  const hayNorm = norm((bundle?.sources || []).map((s) => s.text).join("  "));
  const hayRaw = (bundle?.sources || []).map((s) => s.text).join("  ");
  if (!hayNorm) return [];
  const bad = [];
  for (const spec of extractDeterministicSpecifics(readerFacingText(article))) {
    if (!presentInBundle(spec, hayNorm, hayRaw)) bad.push({ claim: spec.text, why: `the ${spec.kind} "${spec.text}" appears NOWHERE in the source — it is invented`, kind: spec.kind, problem: "invented", correction: null, isSpecific: true });
  }
  return bad;
}

// L2.5 — DATE-ATTACHMENT check. The presence check above passes any YEAR that appears ANYWHERE in the source. But
// the writer's #1 background-fact error is MISATTACHING a real year: the source says "dating since 2023", the writer
// writes "engaged in 2023". The year is present, so L2 passes it, and the cheap LLM misses it. This catches it
// deterministically: a year the article ties to a historical EVENT (engaged/married/born/died/released…) must have
// that same event next to that year in the SOURCE too — else it is misattached. Conservative + synonym-aware ("wed"
// ≈ "married"), and it only fires when the source NEVER puts the event near that year, so a correct date is safe.
const ANCHOR_GROUPS = [
  ["engaged", "engagement", "propose", "proposal"],
  ["married", "marry", "marries", "wed ", "weds", "wedding", "nuptials", "tied the knot"],
  ["born", "birth"],
  ["died", "death", "passed away", "passing", " dead"],
  ["divorce", "split", "separated", "separation", "broke up", "breakup"],
  ["released", "dropped", "debuted", "premiered", "launched", "came out"],
  ["founded", "co founded", "formed the"],
  ["dating", "dated", "romance", "began dating", "first linked"],
  ["first met", " met "],
  ["arrested", "charged", "convicted", "sentenced", "pleaded"],
  ["hospitalized", "diagnosed"],
  ["joined", "signed", "cast in", "hired", "left the", "exited", "quit"],
];
function dateAttachmentCheck(article, bundle) {
  const body = readerFacingText(article);
  const srcLow = norm((bundle?.sources || []).map((s) => s.text || "").join("  ")); // lowercased, letters+digits+spaces
  if (!srcLow) return [];
  const bad = [];
  const seen = new Set();
  const MAXD = 55; // the event word must be within ~10 words of the year to count as "attached"
  // the anchor GROUP whose word sits CLOSEST to `pos` in the source (within MAXD), or -1 if none is close.
  const nearestGroupTo = (pos, ylen) => {
    let bestGi = -1, bestDist = Infinity;
    ANCHOR_GROUPS.forEach((g, gi) => {
      for (const w of g) {
        const word = w.trim();
        for (let idx = srcLow.indexOf(word, Math.max(0, pos - MAXD)); idx >= 0 && idx <= pos + ylen + MAXD; idx = srcLow.indexOf(word, idx + 1)) {
          const d = idx < pos ? pos - (idx + word.length) : idx - (pos + ylen);
          if (d >= 0 && d <= MAXD && d < bestDist) { bestDist = d; bestGi = gi; }
        }
      }
    });
    return bestGi;
  };
  for (const m of body.matchAll(/\b(?:19|20)\d{2}\b/g)) {
    const year = m[0];
    if (seen.has(year)) continue;
    const ctx = body.slice(Math.max(0, m.index - 130), m.index + 130).toLowerCase();
    const artGroups = new Set();
    ANCHOR_GROUPS.forEach((g, gi) => { if (g.some((w) => ctx.includes(w.trim()))) artGroups.add(gi); });
    if (!artGroups.size) continue;        // the year is not tied to a historical event → don't check (avoid false flags)
    if (!srcLow.includes(year)) continue; // year absent from the source → L2 already flags it as invented
    // The year is CORRECTLY attached only if, at some occurrence in the source, the CLOSEST event word to it belongs
    // to the SAME event group the article ties it to. If the source's nearest event to that year is a DIFFERENT
    // event (or none), the writer misattached it.
    let attached = false;
    for (let i = srcLow.indexOf(year); i >= 0 && !attached; i = srcLow.indexOf(year, i + 1)) {
      const gi = nearestGroupTo(i, year.length);
      if (gi >= 0 && artGroups.has(gi)) attached = true;
    }
    if (!attached) {
      seen.add(year);
      const ev = ANCHOR_GROUPS[[...artGroups][0]][0].trim();
      bad.push({ claim: year, why: `the year ${year} is in the source but not tied to "${ev}" there (the source dates a different event to ${year}) — misattached; use the year the source gives for that event, or remove it`, kind: "date", problem: "misattached", correction: null, isSpecific: true });
    }
  }
  return bad;
}

// L3 — the cheap-LLM CORRECTNESS + ATTACHMENT check over EVERY specific. Model = gemini-2.5-flash (owner rule:
// cheap, never premium; flash is more reliable than flash-lite for this accuracy-critical pass).
const VERIFY_SYS = `You are a strict fact-checker for a celebrity gossip desk. You get an ARTICLE and the SOURCE BUNDLE it was written from. This desk MAY speculate about a STORY, but every CHECKABLE SPECIFIC must be exactly supported by the source.
A SPECIFIC = a DATE, a NUMBER (money/age/year/count/percent), a PLACE name, a PERSON name, or a WORK TITLE (album/show/movie/song/book/tour). PAY SPECIAL ATTENTION to named SONGS / TRACKS / ALBUMS / SHOWS and to "did X" details (e.g. "danced to <song>", "wore <brand>", "performed at <venue>"): a real artist's real song is STILL invented for THIS story if the SOURCE does not say it — flag it. Do not trust a title just because it sounds real.
VERIFY THE SPEAKER OF EVERY QUOTE: a quotation credited to a person ("X said", "the sentiment X once shared") must be attributed to the SAME person the SOURCE names as saying it. A real, verbatim quote pinned to the WRONG speaker is a fabrication — flag it with kind "person", problem "misattached", and set correction to the CORRECT speaker from the source (or null to remove the quote). Treat a vague cover attribution ("in a past interview", "once said") on a quote the source does not tie to that person as misattached.
For EVERY specific in the article, check the source supports it EXACTLY AS USED — the right value, attached to the right thing. Flag a specific if:
  • it is NOT in the source at all (invented), OR
  • the source attaches it to something DIFFERENT / gives a different value (misattached) — e.g. the article says "married in 2022" but the source only mentions a 2022 interview and says the marriage was 2021; or a quote/number/role credited to the wrong person or outlet.
BE ESPECIALLY STRICT ON BACKGROUND / HISTORICAL YEARS: a YEAR attached to a PAST event (an engagement year, a marriage/wedding year, a birth or death year, a release year, a "dating since" year) is MISATTACHED if the source ties that year to a DIFFERENT event. Example: the source says the couple began DATING in 2023 but the article says they got ENGAGED in 2023 — the engagement year is wrong. The year for an event must be the exact year the SOURCE gives FOR THAT EVENT; if the source gives no year for that event, the writer must not state one. Flag it (kind "date", problem "misattached") and set correction to the year the source actually gives for that event, or null to remove it.
Also flag any statement the source directly CONTRADICTS.
DO NOT FLAG: paraphrase or rewording of a supported fact; characterization/color/idiom ("whirlwind romance", "sparked speculation"); attributed speculation about the STORY ("reportedly", "a source claims", "fans think", "appears to"); a reasonable non-specific inference. Only SPECIFICS must be exact — speculation about the story is fine.
For each flagged item, give the CORRECT value from the source if the source contains it, else null (meaning: it must be removed).
Output strict JSON only.`;
async function llmSpecifics(article, bundle, model) {
  const sources = (bundle?.sources || []).map((s, i) => `[S${i + 1}] ${s.outlet}: ${(s.text || "").slice(0, 1800)}`).join("\n\n");
  if (!sources) return { list: [], ran: false };
  const user = `SOURCE BUNDLE (the ONLY facts that count):
${sources}

ARTICLE (check the body AND the structured fields — a wrong specific hides in a takeaway, a whatWeKnow bullet, or an FAQ answer just as easily as in the body):
${JSON.stringify({ title: article.title, dek: article.dek, body: article.body, keyTakeaways: article.keyTakeaways || [], whatWeKnow: article.whatWeKnow || [], faqAnswers: (article.faq || []).map((f) => f && f.a).filter(Boolean) }).slice(0, 9000)}

Return STRICT JSON:
{ "flagged": [ { "text": "the exact specific/phrase from the article", "kind": "date|number|place|person|title|claim", "problem": "invented|misattached|contradicted", "correction": "the correct value from the source, or null to remove" } ] }`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data } = await agentChat("verify", { model: model || undefined, system: VERIFY_SYS, user, json: true, retries: 1 });
      const list = Array.isArray(data?.flagged) ? data.flagged.filter((u) => u && u.text) : [];
      return { list, ran: true };
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 1200 * (attempt + 1))); }
  }
  return { list: [], ran: false, error: String(lastErr?.message || lastErr || "").slice(0, 80) };
}

// verifyGate — merges the three layers. Returns { ok, unsupported:[{claim,why,kind,problem,correction,contradicted,
// isSpecific}], contradicted, severity, brokenRatio, degraded }. `degraded` = the L3 LLM couldn't run.
export async function verifyGate({ article, bundle, model = null, llmImpl = llmSpecifics } = {}) {
  const l1 = checkCitedEvidence(article, bundle);
  const l2 = deterministicSpecifics(article, bundle);
  const l2b = dateAttachmentCheck(article, bundle); // catch a present-but-MISATTACHED historical year
  const l3 = await llmImpl(article, bundle, model);
  const fromL3 = (l3.list || []).map((u) => {
    const problem = ["invented", "misattached", "contradicted"].includes(u.problem) ? u.problem : "invented";
    const correction = (u.correction && String(u.correction).trim() && !/^null$/i.test(String(u.correction).trim())) ? String(u.correction).trim() : null;
    const isSpecific = ["date", "number", "place", "person", "title"].includes(u.kind);
    return { claim: u.text, why: `${problem}${correction ? ` — the source says: ${correction}` : " — not supported by the source"}`, kind: u.kind || "claim", problem, correction, isSpecific };
  });
  // merge, de-dup by normalized claim text
  const seen = new Set();
  const unsupported = [];
  for (const u of [...l1.unsupported, ...l2, ...l2b, ...fromL3]) {
    const k = norm(u.claim).slice(0, 60) || String(u.claim ?? "").trim().slice(0, 60);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    unsupported.push({ contradicted: u.problem === "contradicted", ...u });
  }
  const contradicted = unsupported.some((u) => u.contradicted);
  const denom = Math.max(l1.totalChecked, (Array.isArray(article?.claims) ? article.claims.length : 0), unsupported.length, 1);
  const brokenRatio = unsupported.length / denom;
  const severity = contradicted || brokenRatio > 0.5 ? "major" : "minor";
  return { ok: unsupported.length === 0, unsupported, contradicted, severity, brokenRatio, degraded: !l3.ran };
}

export const _internals = { coverage, norm, deterministicSpecifics, extractDeterministicSpecifics };
