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
export async function webVerifyArticle({ article, topic, model = MODELS.webVerify || MODELS.judge || "google/gemini-2.5-flash", webMaxResults = 4, chatImpl = chat } = {}) {
  const view = articleView(article);
  if (!view || view.length < 120) return { ran: false, ok: true, contradictions: [], checked: [] };
  const user = `ARTICLE ABOUT: ${topic?.primaryEntity || topic?.title || ""}
${topic?.eventType ? `EVENT TYPE: ${topic.eventType}` : ""}

THE PUBLISHED ARTICLE TO FACT-CHECK AGAINST THE WEB:
${view}

Search the web and verify the load-bearing specifics. Return STRICT JSON:
{ "contradictions": [ { "claim": "the exact phrase/specific from the article that is wrong", "problem": "what the web says is wrong with it", "correct": "the correct fact per the web (concise)", "confidence": "high" | "medium" | "low" } ],
  "checked": [ "each load-bearing specific you CONFIRMED correct against the web (short)" ] }`;
  try {
    const { data } = await chatImpl({ model, system: SYS, user, web: true, webMaxResults, json: true, maxTokens: 900, temperature: 0 });
    const raw = Array.isArray(data?.contradictions) ? data.contradictions : [];
    // Keep only ACTIONABLE contradictions: a real claim string + a correct value + high/medium confidence (a "low"
    // is the model's own uncertainty — never "correct" the article from an unsure web read).
    const contradictions = raw
      .filter((c) => c && typeof c.claim === "string" && c.claim.trim().length >= 4 && /^(high|medium)$/i.test(String(c.confidence || "")))
      .map((c) => ({ claim: c.claim.trim(), problem: String(c.problem || "").slice(0, 200), correct: String(c.correct || "").slice(0, 200), confidence: String(c.confidence).toLowerCase() }));
    return { ran: true, ok: contradictions.length === 0, contradictions, checked: Array.isArray(data?.checked) ? data.checked.slice(0, 20) : [] };
  } catch (e) {
    // Fail-safe: never block a clean article on a web/infra error — the deterministic gates remain the floor.
    return { ran: false, ok: true, contradictions: [], checked: [], error: String(e?.message || e).slice(0, 100) };
  }
}
