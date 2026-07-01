// GOSSIP — CLAIM-LEVEL VERIFY GATE (Step 5, the writer's self-check). quoteGuard catches misquotes; this catches
// the OTHER fabrication class — a FACTUAL claim (a date, a number, a "they were spotted in Paris", a "reps
// confirmed") that simply ISN'T in the bundle. It produces a STRUCTURED list of the specific bad claims so the
// writer can SURGICALLY fix only those (find the real content, attribute it, soften it, or cut it) instead of
// rewriting the whole piece. Two layers:
//   L1 (deterministic, free): every claim the writer tagged with a `sourceQuote` must have that evidence really
//      present in the bundle text — a claim citing fake evidence is unsupported, no LLM needed.
//   L2 (cheap LLM): read the BODY against the bundle and list any factual statement not supported by it (catches
//      body claims the writer never put in claims[]). Model = flash-lite (owner hard rule: never a premium model).
// Fail-SAFE, not fail-shut: if the L2 LLM call errors, we DON'T block a clean piece on an infra hiccup — we fall
// back to L1 and flag `degraded`, because the JUDGE (also an independent LLM read) is the explicit backstop.
import { chat } from "../lib/openrouter.mjs";

// String-coerce defensively — an LLM can return a non-string claim/why, and a raw .toLowerCase() on it would throw
// and (uncaught) drop a clean publishable article. Coercion makes coverage()/the merge key robust.
const norm = (s) =>
  String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// token-coverage of `needle` inside one source's `hay` (near-verbatim fallback). 1.0 = every content word present.
function coverage(needle, hay) {
  const toks = norm(needle).split(" ").filter((w) => w.length > 2);
  if (!toks.length) return 0; // no checkable content words ⇒ can't claim support (don't silently auto-pass)
  let hit = 0;
  for (const t of toks) if (hay.includes(t)) hit++;
  return hit / toks.length;
}

// L1 — deterministic: a claim whose cited sourceQuote is NOT really in any SINGLE source is fabricated evidence.
// Phrase-aware + PER-SOURCE (substring first, token-coverage fallback within one source's text) — never across the
// concatenation, so token bleed from several sources can't manufacture a false match for a fabricated quote.
export function checkCitedEvidence(article, bundle) {
  const haystacks = (bundle?.sources || []).map((s) => norm(s.text)).filter(Boolean);
  const claims = Array.isArray(article?.claims) ? article.claims : [];
  if (!haystacks.length || !claims.length) return { unsupported: [], totalChecked: 0 };
  const unsupported = [];
  for (const c of claims) {
    const ev = (c?.sourceQuote || "").trim();
    if (!ev || ev.length < 8) continue; // claim cited no evidence — L2/judge will weigh it; L1 only catches FAKE evidence
    const evn = norm(ev);
    const ok = haystacks.some((h) => h.includes(evn) || coverage(ev, h) >= 0.85);
    if (!ok) unsupported.push({ claim: (c.text || "").slice(0, 200), why: `cited evidence not found in any source: "${ev.slice(0, 120)}"` });
  }
  return { unsupported, totalChecked: claims.filter((c) => (c?.sourceQuote || "").length >= 8).length };
}

const VERIFY_SYS = "You are a fact-checker for a gossip desk. You receive an ARTICLE and the SOURCE BUNDLE it was supposed to be written from. List ONLY the article's factual statements that are NOT supported by the bundle (a name, date, number, place, action, or a 'reps/source said/confirmed' that the bundle never states), and any statement the bundle CONTRADICTS. Attributed speculation ('fans think', 'appears to') is fine if the bundle shows that conversation. Do NOT list style issues. Output strict JSON only.";

// L2 — cheap LLM entailment over the body. Returns [] on any error (caller marks degraded + leans on L1 + judge).
async function llmUnsupported(article, bundle, model) {
  const sources = (bundle?.sources || []).map((s, i) => `[S${i + 1}] ${s.outlet}: ${(s.text || "").slice(0, 1600)}`).join("\n\n");
  if (!sources) return { list: [], ran: false };
  const user = `SOURCE BUNDLE (the ONLY allowed facts):
${sources}

ARTICLE:
${JSON.stringify({ title: article.title, dek: article.dek, body: article.body }).slice(0, 8000)}

Return STRICT JSON:
{ "unsupported": [ { "claim": "the exact phrase/sentence from the article", "why": "not in the bundle | bundle says otherwise (quote it)", "contradicted": true|false } ] }`;
  // The verify check is the accuracy spine — the owner requires the SPECIFICS to be machine-verified, so don't
  // give up on the first transient error (rate-limit bursts during a run were degrading it). Retry a couple of
  // times before falling back to L1 + the judge.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data } = await chat({ model, system: VERIFY_SYS, user, json: true, maxTokens: 700, temperature: 0 });
      const list = Array.isArray(data?.unsupported) ? data.unsupported.filter((u) => u && u.claim) : [];
      return { list, ran: true };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  return { list: [], ran: false, error: String(lastErr?.message || lastErr || "").slice(0, 80) };
}

// verifyGate — the article's self-check. Returns { ok, unsupported:[{claim,why,contradicted?}], contradicted:bool,
// severity:"minor"|"major", brokenRatio, degraded }. ok === true ⇒ no unsupported claims found.
export async function verifyGate({ article, bundle, model = "google/gemini-2.5-flash-lite", llmImpl = llmUnsupported } = {}) {
  const l1 = checkCitedEvidence(article, bundle);
  const l2 = await llmImpl(article, bundle, model);
  // merge, de-duplicating by the normalized claim text (L1 + L2 often catch the same bad claim)
  const seen = new Set();
  const unsupported = [];
  for (const u of [...l1.unsupported, ...(l2.list || [])]) {
    // Fall back to the raw claim text so a symbol/emoji-only claim (which normalizes to "") is NOT silently dropped.
    const k = norm(u.claim).slice(0, 60) || String(u.claim ?? "").trim().slice(0, 60);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    unsupported.push({ claim: u.claim, why: u.why || "not supported by the bundle", contradicted: !!u.contradicted });
  }
  const contradicted = unsupported.some((u) => u.contradicted);
  // brokenRatio relative to the writer's own claim count (a proxy for "how much of the piece is unsupported")
  const denom = Math.max(l1.totalChecked, (Array.isArray(article?.claims) ? article.claims.length : 0), unsupported.length, 1);
  const brokenRatio = unsupported.length / denom;
  const severity = contradicted || brokenRatio > 0.5 ? "major" : "minor";
  return { ok: unsupported.length === 0, unsupported, contradicted, severity, brokenRatio, degraded: !l2.ran };
}

export const _internals = { coverage, norm };
