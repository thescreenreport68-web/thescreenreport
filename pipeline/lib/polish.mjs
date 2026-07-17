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
  // 3) Drop a MID-BODY cut-off clause hiding behind a corporate abbreviation (root-fix 2026-07-17: a live
  //    paragraph ended "…which also owns rights to music catalogs from Warner Bros." — the relative clause
  //    was never completed, but "Bros." looks like terminal punctuation to rule 2). If a paragraph's last
  //    sentence ends on "<connector> <Something> Bros./Inc./Co./Corp./Ltd." with a dangling subordinate
  //    clause opener earlier in it, trim that sentence.
  paras = paras.map((p) => {
    if (/^\s*(#{1,6}\s|[-*]\s|\|)/.test(p)) return p;
    const sents = p.split(/(?<=[.!?"'”’])\s+/);
    const last = sents[sents.length - 1] || "";
    const danglingCorp = /,\s+(which|who|that)\b[^.]*\b(from|with|by|to|of|and)\s+[A-Z][\w&.'’ -]{0,40}\b(Bros|Inc|Co|Corp|Ltd)\.\s*$/.test(last);
    if (danglingCorp) sents.pop();
    return sents.join(" ");
  }).filter(Boolean);
  return paras.filter(Boolean).join("\n\n");
}

// DROP an orphaned QUESTION subheading the body never answers (owner 2026-07-06 — the "## What is the reported salary?"
// bug: a question-H2 followed by a paragraph that never states one). Deterministic backstop to the writer's
// answerable-only rule. Conservative: only touches interrogative (`?`) H2s, only when the section beneath is either
// near-empty OR a numeric/date question with no number/date in it, and it removes ONLY the heading line (the paragraph
// is kept, flowing into the prior section) so no reporting is ever lost.
const NUMERIC_Q = /\b(salary|salaries|pay|paid|worth|net worth|cost|costs?|price|budget|how much|how many|figure|revenue|gross|earn(ed|ings)?)\b/i;
const DATE_Q = /\b(when|what date|which date|release date|premiere date|air date|come out|hit (theaters|streaming))\b/i;
const HAS_NUM = /\d|\$|\bmillion\b|\bbillion\b|\bpercent\b|%/i;
const HAS_DATE = /\d|\b(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|yesterday|next (week|month|year)|this (week|month|year))\b/i;
export function dropOrphanHeadings(body) {
  if (!body) return body;
  const lines = String(body).split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+.*\?\s*$/.test(lines[i])) {
      let j = i + 1, txt = "";
      while (j < lines.length && !/^#{2,3}\s/.test(lines[j])) { txt += " " + lines[j]; j++; }
      const words = txt.trim().split(/\s+/).filter(Boolean).length;
      // (audit 2026-07-06) Only strip a TRULY-EMPTY question-H2 (heading directly followed by another heading/end) or a
      // numeric/date question the section never answers. A valid SHORT answer ("It hits theaters July 18.", "Yes, on
      // Netflix now.") is KEPT — the old `words < 8` wrongly stripped those.
      const unanswered =
        words === 0 ||
        (NUMERIC_Q.test(lines[i]) && !HAS_NUM.test(txt)) ||
        (DATE_Q.test(lines[i]) && !HAS_DATE.test(txt));
      if (unanswered) continue; // drop the heading line only; the paragraph below stays (flows into the prior section)
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}
