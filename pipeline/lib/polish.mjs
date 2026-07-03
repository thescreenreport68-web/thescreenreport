// FINAL POLISH (deterministic, gossip-automation port 2026-07-03). Runs on the finished article right before
// assemble to fix the mechanical defects cut passes and cheap-model output leave behind: (1) a repeated
// sentence appearing twice (bad for SEO + looks broken); (2) a dangling truncated fragment at the end.
// All deterministic — no LLM, no new facts, so it can never add a fabrication.

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const contentTokens = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 3));

// token-Jaccard similarity of two sentences (content words only).
function jaccard(a, b) {
  const A = contentTokens(a), B = contentTokens(b);
  if (A.size < 4 || B.size < 4) return 0; // too short to judge as a "duplicate"
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

// The classic repeat: a "did not respond to a request for comment" line placed at BOTH the top and the bottom
// (worded differently, so token-similarity alone misses them). Collapse to the first one.
const NO_COMMENT = /\b(did|does|didn'?t|do not|have not|has not)\b[^.?!]{0,50}\b(respond|reply|replied|responded)\b[^.?!]{0,40}\bcomment\b|\bdeclined to comment\b|\brequests? for comment\b/i;

// Remove a later sentence that is a NEAR-DUPLICATE of an earlier one (>=0.72 Jaccard token overlap) OR a SECOND
// no-comment boilerplate line — kills doubled closings while preserving paragraph structure + everything unique.
export function dedupeSentences(body, threshold = 0.72) {
  if (!body) return body;
  const paras = String(body).split(/\n{2,}/);
  const keptSentences = [];
  let sawNoComment = false;
  const out = paras.map((para) => {
    if (/^\s*(#{1,6}\s|[-*]\s|\|)/.test(para)) return para; // headings/lists/tables pass through untouched
    const parts = para.split(/(?<=[.!?])\s+/);
    const kept = [];
    for (const s of parts) {
      const t = s.trim();
      if (!t) continue;
      if (NO_COMMENT.test(t)) {
        if (sawNoComment) continue; // a no-comment line already appeared — drop this repeat
        sawNoComment = true;
      }
      if (keptSentences.some((prev) => jaccard(t, prev) >= threshold)) continue; // near-duplicate → drop
      keptSentences.push(t);
      kept.push(s);
    }
    return kept.join(" ");
  });
  return out.filter((p) => p.trim()).join("\n\n");
}

// TRIM a dangling incomplete sentence from the end (truncation backstop): if the generation got cut off
// mid-sentence — or a cut pass left a fragment — drop it so the published article never ends mid-thought.
export function trimIncomplete(body) {
  if (!body) return body;
  let paras = String(body).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  // 1) Drop a MID-BODY orphan incomplete-quote fragment (its own paragraph with an UNCLOSED quote AND a dangling
  //    ellipsis or very short) — e.g. a lone `"It's more like...` the writer opened and never finished.
  paras = paras.filter((p) => {
    if (/^\s*(#{1,6}\s|[-*]\s|\|)/.test(p)) return true; // structure passes through
    const unclosedQuote = ((p.match(/"/g) || []).length % 2) !== 0;
    const dangling = /(\.\.\.|…)\s*$/.test(p) || p.split(/\s+/).filter(Boolean).length < 6;
    return !(unclosedQuote && dangling);
  });
  // 2) Trim a trailing incomplete sentence from the end (the cut-off-generation case).
  for (let i = paras.length - 1; i >= 0; i--) {
    if (/^\s*(#{1,6}\s|[-*]\s|\|)/.test(paras[i])) break; // a heading/list end is structurally fine
    const sents = paras[i].split(/(?<=[.!?"'”’])\s+/);
    // drop a trailing fragment with no terminal punctuation OR an unclosed markdown bold (a cut-off heading/label).
    const bad = (s) => !/[.!?"'”’)\]]\s*$/.test(s) || ((s.match(/\*\*/g) || []).length % 2 !== 0);
    while (sents.length && bad(sents[sents.length - 1])) sents.pop();
    paras[i] = sents.join(" ");
    if (paras[i]) break;          // kept a complete paragraph — done
    paras.splice(i, 1);           // that paragraph was entirely a fragment — drop it and check the previous one
  }
  return paras.filter(Boolean).join("\n\n");
}
