// NEWS — INDEPENDENT WEB REALITY-CHECK (the accuracy layer gossip does NOT need — gossip is attributed speculation;
// NEWS must be factually TRUE). Every other gate checks the article against the SAME source bundle the writer used,
// so a MISREAD of an ambiguous source (Tom Hanks = "coach" vs the real "sportswriter"), a STALE authoritative number
// ($10.5M vs the real $10.9M), or an INFERRED date (Billie Piper "2023" vs 2025) all pass — the check is circular.
// This step breaks the circle: it hands a CHEAP web-grounded model the finished article and asks it to verify the
// LOAD-BEARING specifics (who-plays-whom / roles, key $ numbers, dates/years, the core event) against the LIVE OPEN
// WEB, and return ONLY what is wrong, WITH the correct value — which the run loop then surgically corrects or cuts.
// Cheap + bounded: ONE web-grounded call per article (never a premium model; owner hard rule). Fail-SAFE: any error
// ⇒ { ran:false } and the deterministic gates still stand — an infra hiccup never blocks a clean article.
import { chat } from "./openrouter.mjs";
import { MODELS } from "../config.mjs";

const SYS = `You are a rigorous news fact-checker WITH LIVE WEB SEARCH. You are given a published entertainment-news article. Your ONE job: catch FALSE specifics by checking them against the current open web — this is real news, so a single wrong fact is a serious failure.

SEARCH THE WEB to verify the article's LOAD-BEARING specifics — the ones that, if wrong, break the story:
- WHO DOES WHAT: casting + roles (which actor plays which character / job), who directed/wrote, who did the action. (This catches an INVERTED premise, e.g. "X plays the coach" when X actually plays the reporter.)
- KEY NUMBERS: box-office/dollar figures, budgets, counts, ages, chart positions, ratings — check the exact value against current sources (Box Office Mojo, The Numbers, etc.). A stale or invented number is a failure.
- DATES / YEARS: release dates, when-something-aired, event dates.
- THE CORE EVENT: is the central claim of the headline actually what happened?

RULES:
- Only report a specific as WRONG if the web CONTRADICTS it or you cannot find ANY support for a checkable specific that matters. Give the CORRECT value from the web.
- Do NOT flag: opinion/framing/color, correctly-attributed reporting, or a detail that the web confirms (even if worded differently).
- Prefer authoritative sources (major trades, Box Office Mojo/The Numbers, Wikipedia, official) over blogs.
- If the web is ambiguous or you can't verify, mark it "unverifiable" (low confidence) — do NOT invent a correction.
Output STRICT JSON only.`;

// Build the compact article view the checker verifies (title + dek + body + the checkable structured fields).
function articleView(article) {
  const parts = [
    article.title ? `HEADLINE: ${article.title}` : "",
    article.dek ? `DEK: ${article.dek}` : "",
    article.boxOffice ? `BOX OFFICE (structured): ${JSON.stringify(article.boxOffice)}` : "",
    Array.isArray(article.keyTakeaways) && article.keyTakeaways.length ? `KEY TAKEAWAYS:\n- ${article.keyTakeaways.join("\n- ")}` : "",
    `BODY:\n${article.body || ""}`,
  ].filter(Boolean);
  return parts.join("\n\n").slice(0, 9000);
}

// webVerifyArticle — returns { ran, ok, contradictions:[{claim,problem,correct,confidence}], checked:[...] }.
// contradictions (confidence high/medium) drive the surgical correct-or-cut loop in run.mjs.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function webVerifyArticle({ article, topic, model = process.env.WEB_VERIFY_MODEL || MODELS.webVerify || "perplexity/sonar", webMaxResults = 8, chatImpl = chat, attempts = 3 } = {}) {
  const view = articleView(article);
  // Too little to check is NOT a failure to verify — a headline-only stub has nothing load-bearing. ran:true, empty.
  if (!view || view.length < 120) return { ran: true, ok: true, contradictions: [], checked: [], note: "nothing-to-check" };
  const user = `ARTICLE ABOUT: ${topic?.primaryEntity || topic?.title || ""}
${topic?.eventType ? `EVENT TYPE: ${topic.eventType}` : ""}

THE PUBLISHED ARTICLE TO FACT-CHECK AGAINST THE WEB:
${view}

Search the web and verify the load-bearing specifics. Return STRICT JSON. Every contradiction MUST carry a
RECEIPT — the source URL you actually read and the verbatim quote from it that establishes the correct fact —
or it will be ignored (no receipt = you did not really verify it):
{ "contradictions": [ { "claim": "the exact phrase/specific from the article that is wrong", "problem": "what the web says is wrong with it", "correct": "the correct fact per the web (concise)", "source": "https://the-exact-url-you-read", "quote": "the verbatim sentence from that source proving the correct fact", "confidence": "high" | "medium" | "low" } ],
  "checked": [ "each load-bearing specific you CONFIRMED correct against the web — include the source URL you saw it on" ] }`;
  // FAIL-CLOSED RETRY (2026-07-03): this is the ONLY non-circular accuracy layer. A transient web/API hiccup must
  // NOT be silently swallowed and the article published unverified (the Thor `ran:false`-then-published failure).
  // Retry up to `attempts` times with backoff; only after ALL fail do we return ran:false so run.mjs can HOLD.
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    try {
      const { data, citations = [] } = await chatImpl({ model, system: SYS, user, web: true, webMaxResults, json: true, maxTokens: 1500, temperature: 0 });
      if (!data || typeof data !== "object") { lastErr = "empty/non-JSON response"; await sleep(1500 * (i + 1)); continue; }
      const raw = Array.isArray(data.contradictions) ? data.contradictions : [];
      // Keep only ACTIONABLE contradictions: a real claim + high/medium confidence + a RECEIPT (a source URL AND a
      // verbatim quote). No receipt = the model didn't really verify it — do NOT cut/correct a true sentence on an
      // unbacked verdict (2026-07-03 audit #6: this is how a TRUE credit got deleted). A "low" is the model's own
      // uncertainty — never act on it.
      const contradictions = raw
        .filter((c) => c && typeof c.claim === "string" && c.claim.trim().length >= 4 && /^(high|medium)$/i.test(String(c.confidence || "")))
        .filter((c) => /^https?:\/\//.test(String(c.source || "")) && String(c.quote || "").trim().length >= 8)
        .map((c) => ({ claim: c.claim.trim(), problem: String(c.problem || "").slice(0, 200), correct: String(c.correct || "").slice(0, 200), source: String(c.source).trim().slice(0, 300), quote: String(c.quote).trim().slice(0, 300), confidence: String(c.confidence).toLowerCase() }));
      const checked = Array.isArray(data.checked) ? data.checked.slice(0, 20) : [];
      // POSITIVE-EVIDENCE GATE (2026-07-03 audit #1/#9): "no contradiction" only means "verified" if the check
      // ACTUALLY consulted the web. Proof of a real lookup = plugin citations, OR the model reported specifics it
      // checked, OR it produced receipted contradictions. If NONE of those on an article WITH load-bearing content,
      // the web plugin no-op'd (returned {} from priors) — treat as a FAILURE to verify → retry, then HOLD.
      const sawEvidence = citations.length > 0 || checked.length > 0 || contradictions.length > 0;
      if (!sawEvidence) { lastErr = "web-check produced no evidence (no citations, no checks) — plugin likely returned nothing"; await sleep(1500 * (i + 1)); continue; }
      return { ran: true, ok: contradictions.length === 0, contradictions, checked, checkedCount: checked.length, citations };
    } catch (e) {
      lastErr = String(e?.message || e).slice(0, 120);
      await sleep(1500 * (i + 1));
    }
  }
  // Exhausted retries — the world-check genuinely could not run (or produced no evidence). run.mjs HOLDS (never publish unverified).
  return { ran: false, ok: false, contradictions: [], checked: [], error: lastErr || "web check failed after retries" };
}
