// UNIVERSAL VERIFY GATE (trending-news rebuild, Step 3 — 2026-06-29). KILLS the ~7-type allowlist: instead of
// checking only platform/RT/director/box-office/awards/viewership/chart and passing everything else, it verifies
// EVERY checkable claim in the drafted article against the CONTENT BUNDLE (the real source text from findContent).
//
// Three things make it fail-CLOSED and un-gameable, the way the old design wasn't:
//   1. Claims are extracted INDEPENDENTLY from the article prose+fields (a cheap LLM), NOT taken from the writer's
//      self-authored claims[] — the writer can no longer choose what gets checked.
//   2. Support must be MECHANICAL: a deterministic fuzzy match against the bundle text, and for anything the match
//      can't confirm, a cheap-LLM entailment call whose returned supporting quote is then RE-CHECKED as a real
//      substring of the cited source (receiptIsReal) — a hallucinated "SUPPORTED" dies at the substring check.
//   3. Sensitive claims (death/legal/allegation) require a MAJOR outlet or >=2 independent owners in the bundle.
// Anything UNSUPPORTED/CONTRADICTED => the claim is cut; a contradiction or too many failures => the article is
// BLOCKED. Cheap model only (gemini-2.5-flash-lite — never Opus). The structured TMDB/OMDb/awards diffs in
// lib/verifyEngine.mjs remain an ADDITIONAL high-confidence layer on top; this is the universal coverage beneath it.
import { chat } from "./openrouter.mjs";
import { stripPunct, numberTokens, sigTokens, receiptIsReal } from "./claimcheck.mjs";
import { extractQuotes } from "./contentFinder.mjs";

// Claim types that must be backed by a MAJOR outlet (or >=2 independent owners) — never a lone tabloid/blog.
const SENSITIVE = /\b(died|death|passed away|dead|killed|suicide|arrest|arrested|charged|indicted|lawsuit|sued|alleg|accus|assault|abuse|harass|divorce|split|fired|axed|misconduct|investigat|overdose|rehab|hospitaliz|cancer|diagnos)\b/i;

// 1) EXTRACT every checkable specific from the article — INDEPENDENT of the writer's claims[].
async function extractClaims(article, model) {
  const sys = `You are a fact-checker's assistant. Extract EVERY checkable factual specific stated in this article, each as ONE atomic, self-contained claim. A checkable specific = a number / % / dollar figure, a date or year, a streaming platform, an award win or nomination, a chart position, a runtime, a film/TV credit (who did what), a job title or role, a DIRECT QUOTATION, a named deal/event, or a release status. SKIP pure opinion, analysis, and transitions. Decontextualize each claim so it stands on its own (resolve pronouns to names). Return JSON: {"claims":["...", "..."]}. Be thorough — capture every specific a reader could fact-check.`;
  const body = `TITLE: ${article.title}\nDEK: ${article.dek || ""}\n\nBODY:\n${article.body || ""}\n\nKEY TAKEAWAYS: ${(article.keyTakeaways || []).join(" | ")}\nFAQ: ${(article.faq || []).map((f) => `${f.q} ${f.a}`).join(" | ")}`;
  // Retry once on an empty/failed extraction — a flaky cheap-model response, or a truncated JSON list on a long
  // article, must NOT silently yield zero claims (the gate now treats zero-claims as a fail-closed BLOCK, so a
  // transient failure would needlessly block a good article). maxTokens 3000 so a long article's list isn't cut off.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data } = await chat({ model, system: sys, user: body, json: true, maxTokens: 3000, temperature: 0 });
      const claims = (Array.isArray(data?.claims) ? data.claims : []).filter((c) => typeof c === "string" && c.trim().length > 6).slice(0, 40);
      if (claims.length) return claims;
    } catch { /* retry */ }
  }
  return [];
}

// 2) Deterministic support: are the claim's NUMBERS all in the bundle, and is most of its content present?
function deterministicSupport(claim, haystackLoose) {
  const nums = numberTokens(claim);
  if (nums.some((n) => !haystackLoose.includes(n))) return false; // any figure not in ANY source = not confirmed here
  const toks = sigTokens(claim);
  if (toks.length < 2) return false;
  const hit = toks.filter((t) => haystackLoose.includes(t)).length;
  return hit / toks.length >= 0.85; // strict — a borderline (0.7-0.85) match falls through to the LLM entailment, not auto-SUPPORTED
}

// 3) LLM entailment for the residual claims the deterministic pass couldn't confirm (one batched cheap call).
async function entailmentCheck(claims, sources, model) {
  if (!claims.length) return {};
  const srcBlock = sources.map((s, i) => `[S${i + 1} · ${s.domain} · ${s.tier}]\n${(s.text || "").slice(0, 3500)}`).join("\n\n");
  const claimList = claims.map((c, i) => `${i + 1}. ${c}`).join("\n");
  const sys = `You are a STRICT fact-checker. For EACH numbered claim, decide ONLY from the SOURCE TEXTS (use NO outside knowledge): SUPPORTED = the claim's specific (number/date/platform/award/quote/credit/event) is stated in or directly follows from a source; CONTRADICTED = a source states otherwise; UNSUPPORTED = it is not in any source. If SUPPORTED or CONTRADICTED, return the source id (e.g. "S2") and the VERBATIM sentence from that source. Return JSON: {"results":[{"i":<claim#>,"verdict":"SUPPORTED|UNSUPPORTED|CONTRADICTED","source":"S#","quote":"verbatim source sentence"}]}.`;
  try {
    const { data } = await chat({ model, system: sys, user: `SOURCE TEXTS:\n${srcBlock}\n\nCLAIMS:\n${claimList}\n\nReturn the JSON.`, json: true, maxTokens: 3000, temperature: 0 });
    const out = {};
    for (const r of (data?.results || [])) if (r && Number.isInteger(r.i)) out[r.i] = r;
    return out;
  } catch { return {}; }
}

// MAIN. article = the generate() draft; bundle = findContent() output. Returns a fail-closed verdict + corrections.
export async function verifyGate({ article, bundle, model = "google/gemini-2.5-flash-lite", minSupportRate = 0.85 }) {
  if (!bundle || bundle.blocked || !bundle.sources?.length) {
    return { verdict: "BLOCK", reason: "no verified content bundle to check against", supportRate: 0, claims: [], unsupported: [], corrections: "" };
  }
  const sources = bundle.sources;
  const haystackLoose = stripPunct(sources.map((s) => `${s.text || ""} ${(s.quotes || []).join(" ")}`).join("\n"));
  // Trust bar for sensitive claims counts ONLY real-reporting sources — structured facts (tier 'fact') don't count,
  // so a death/legal claim grounded only in TMDB/OMDb metadata is NOT treated as corroborated by a major outlet.
  const realSources = sources.filter((s) => s.tier !== "fact");
  const majorOrTwo = realSources.some((s) => s.tier === "major") || new Set(realSources.map((s) => s.owner)).size >= 2;

  const claims = await extractClaims(article, model);
  if (!claims.length) return { verdict: "BLOCK", reason: "could not extract any checkable claim to verify", supportRate: 0, claims: [], unsupported: [], corrections: "" };

  const results = claims.map((c) => ({ claim: c, status: deterministicSupport(c, haystackLoose) ? "SUPPORTED" : "PENDING", via: "deterministic" }));

  const pendingIdx = results.map((r, i) => (r.status === "PENDING" ? i : -1)).filter((i) => i >= 0);
  if (pendingIdx.length) {
    const ent = await entailmentCheck(pendingIdx.map((i) => results[i].claim), sources, model);
    pendingIdx.forEach((origIdx, k) => {
      const r = ent[k + 1];
      if (!r) { results[origIdx].status = "UNSUPPORTED"; results[origIdx].via = "llm-no-result"; return; }
      const srcNum = parseInt(String(r.source || "").replace(/[^0-9]/g, ""), 10);
      const src = sources[srcNum - 1];
      const quoteReal = r.quote && src && receiptIsReal(r.quote, stripPunct(src.text || ""));
      if (r.verdict === "SUPPORTED" && quoteReal) { Object.assign(results[origIdx], { status: "SUPPORTED", via: "llm+receipt", source: src.domain, quote: r.quote }); }
      else if (r.verdict === "CONTRADICTED" && quoteReal) { Object.assign(results[origIdx], { status: "CONTRADICTED", via: "llm", source: src?.domain, quote: r.quote }); }
      else { results[origIdx].status = "UNSUPPORTED"; results[origIdx].via = r.verdict === "SUPPORTED" ? "llm-fake-quote" : "llm-unsupported"; }
    });
  }

  // Sensitivity tier enforcement — a supported sensitive claim still needs a trusted source behind the bundle.
  for (const r of results) {
    if (r.status === "SUPPORTED" && SENSITIVE.test(r.claim) && !majorOrTwo) { r.status = "UNSUPPORTED"; r.via = "sensitive-untrusted"; }
  }

  // DEDICATED QUOTE CHECK — invented quotes are the highest legal risk. Pull every ATTRIBUTED quote the article
  // asserts (the same grammar-anchored extractor the content finder uses) and confirm each appears in a source. A
  // quote not found in ANY gathered source is a FABRICATED QUOTE — fatal.
  const articleText = `${article.title || ""}. ${article.dek || ""}. ${article.body || ""}`;
  for (const q of extractQuotes(articleText)) {
    const grounded = sources.some((s) => receiptIsReal(q, stripPunct(`${s.text || ""} ${(s.quotes || []).join(" ")}`)));
    if (!grounded) results.push({ claim: `QUOTE: "${q.slice(0, 120)}"`, status: "UNSUPPORTED", via: "fabricated-quote" });
  }

  const unsupported = results.filter((r) => r.status === "UNSUPPORTED" || r.status === "CONTRADICTED");
  const supportRate = results.length ? (results.length - unsupported.length) / results.length : 0;
  const fatalQuote = results.some((r) => r.via === "fabricated-quote");
  let verdict = "PASS";
  if (results.some((r) => r.status === "CONTRADICTED") || fatalQuote) verdict = "BLOCK"; // a contradiction or an invented quote is fatal
  else if (supportRate < minSupportRate) verdict = "BLOCK";                              // too much unverifiable => block
  else if (unsupported.length) verdict = "CUT";                                          // a few strays => cut + regen once
  const corrections = unsupported
    .map((r) => `- "${r.claim.slice(0, 150)}" — ${r.status} (not found in the gathered source text). Remove it or rewrite it qualitatively; never state a specific the sources don't.`)
    .join("\n");
  return { verdict, supportRate, claimCount: results.length, claims: results, unsupported, corrections, majorOrTwo };
}
