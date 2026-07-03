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
import { chat } from "../lib/openrouter.mjs";

const norm = (s) =>
  String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const digits = (s) => String(s || "").replace(/[,\s]/g, "");

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

// L2 — DETERMINISTIC FLOOR: the cleanly-extractable specifics (numbers, years, month-dates, italic work titles).
// Each MUST appear in the source; one that doesn't is invented. (This is the always-on net when the LLM is down.)
const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
export function extractDeterministicSpecifics(body) {
  const t = String(body || "");
  const out = [];
  const push = (text, kind, needle) => { if (text && !out.some((o) => o.text === text)) out.push({ text, kind, needle }); };
  for (const m of t.matchAll(/\$\s?[\d.,]+\s?(?:million|billion|thousand|m|bn|b|k)?\b/gi)) push(m[0].trim(), "number", digits(m[0].replace(/[^\d.,]/g, "")));
  for (const m of t.matchAll(/[\d.,]+\s?%/g)) push(m[0].trim(), "number", digits(m[0]));
  for (const m of t.matchAll(/\b(?:19|20)\d{2}\b/g)) push(m[0], "date", m[0]);
  for (const m of t.matchAll(new RegExp(`\\b(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"))) push(m[0].trim(), "date", null);
  for (const m of t.matchAll(/\b\d[\d,]{2,}\b/g)) { const d = digits(m[0]); if (!/^(?:19|20)\d{2}$/.test(d)) push(m[0], "number", d); }
  for (const m of t.matchAll(/\*([A-Z][^*\n]{1,60})\*/g)) push(m[1].trim(), "title", null); // *Knocked Up* etc.
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
  for (const spec of extractDeterministicSpecifics(article?.body || "")) {
    if (!presentInBundle(spec, hayNorm, hayRaw)) bad.push({ claim: spec.text, why: `the ${spec.kind} "${spec.text}" appears NOWHERE in the source — it is invented`, kind: spec.kind, problem: "invented", correction: null, isSpecific: true });
  }
  return bad;
}

// L3 — the cheap-LLM CORRECTNESS + ATTACHMENT check over EVERY specific. Model = gemini-2.5-flash (owner rule:
// cheap, never premium; flash is more reliable than flash-lite for this accuracy-critical pass).
const VERIFY_SYS = `You are a strict fact-checker for a celebrity gossip desk. You get an ARTICLE and the SOURCE BUNDLE it was written from. This desk MAY speculate about a STORY, but every CHECKABLE SPECIFIC must be exactly supported by the source.
A SPECIFIC = a DATE, a NUMBER (money/age/year/count/percent), a PLACE name, a PERSON name, or a WORK TITLE (album/show/movie/song/book/tour).
For EVERY specific in the article, check the source supports it EXACTLY AS USED — the right value, attached to the right thing. Flag a specific if:
  • it is NOT in the source at all (invented), OR
  • the source attaches it to something DIFFERENT / gives a different value (misattached) — e.g. the article says "married in 2022" but the source only mentions a 2022 interview and says the marriage was 2021; or a quote/number/role credited to the wrong person or outlet.
Also flag any statement the source directly CONTRADICTS.
DO NOT FLAG: paraphrase or rewording of a supported fact; characterization/color/idiom ("whirlwind romance", "sparked speculation"); attributed speculation about the STORY ("reportedly", "a source claims", "fans think", "appears to"); a reasonable non-specific inference. Only SPECIFICS must be exact — speculation about the story is fine.
For each flagged item, give the CORRECT value from the source if the source contains it, else null (meaning: it must be removed).
Output strict JSON only.`;
async function llmSpecifics(article, bundle, model) {
  const sources = (bundle?.sources || []).map((s, i) => `[S${i + 1}] ${s.outlet}: ${(s.text || "").slice(0, 1800)}`).join("\n\n");
  if (!sources) return { list: [], ran: false };
  const user = `SOURCE BUNDLE (the ONLY facts that count):
${sources}

ARTICLE:
${JSON.stringify({ title: article.title, dek: article.dek, body: article.body }).slice(0, 8000)}

Return STRICT JSON:
{ "flagged": [ { "text": "the exact specific/phrase from the article", "kind": "date|number|place|person|title|claim", "problem": "invented|misattached|contradicted", "correction": "the correct value from the source, or null to remove" } ] }`;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data } = await chat({ model, system: VERIFY_SYS, user, json: true, maxTokens: 900, temperature: 0 });
      const list = Array.isArray(data?.flagged) ? data.flagged.filter((u) => u && u.text) : [];
      return { list, ran: true };
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 1200 * (attempt + 1))); }
  }
  return { list: [], ran: false, error: String(lastErr?.message || lastErr || "").slice(0, 80) };
}

// verifyGate — merges the three layers. Returns { ok, unsupported:[{claim,why,kind,problem,correction,contradicted,
// isSpecific}], contradicted, severity, brokenRatio, degraded }. `degraded` = the L3 LLM couldn't run.
export async function verifyGate({ article, bundle, model = "google/gemini-2.5-flash", llmImpl = llmSpecifics } = {}) {
  const l1 = checkCitedEvidence(article, bundle);
  const l2 = deterministicSpecifics(article, bundle);
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
  for (const u of [...l1.unsupported, ...l2, ...fromL3]) {
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
