// GOSSIP — FINAL POLISH (deterministic). Runs on the finished article right before publish to fix the mechanical
// SEO/readability defects the owner flagged: (1) a repeated sentence appearing twice (e.g. the "did not respond to
// a request for comment" boilerplate at both the top and the bottom — bad for SEO + looks broken); (2) empty
// keyTakeaways / faq / tags. All deterministic — no LLM, no new facts invented (derivations only reuse the
// article's OWN confirmed points), so it can never add a fabrication.

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

// The classic gossip repeat: a "reps did not respond to a request for comment" line placed at BOTH the top and
// the bottom (they're worded differently, so token-similarity alone misses them). Collapse to the first one.
const NO_COMMENT = /\b(did|does|didn'?t|do not|have not|has not)\b[^.?!]{0,50}\b(respond|reply|replied|responded)\b[^.?!]{0,40}\bcomment\b|\bdeclined to comment\b|\brequests? for comment\b/i;

// Remove a later sentence that is a NEAR-DUPLICATE of an earlier one (>=0.72 Jaccard token overlap) OR a SECOND
// no-comment boilerplate line — kills the doubled closing while preserving paragraph structure + everything unique.
export function dedupeSentences(body, threshold = 0.72) {
  if (!body) return body;
  const paras = String(body).split(/\n{2,}/);
  const keptSentences = [];
  let sawNoComment = false;
  const out = paras.map((para) => {
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

// CUT-AND-PUBLISH (owner rule: the gate never blocks — it corrects, and as a last resort CUTS the offending
// phrase so the clean article still publishes). Given the flagged texts (a fabricated quote, an unsupported claim,
// an unattributed damaging phrase), remove the SENTENCES that contain them, keeping everything else. Deterministic,
// so an article is never blocked over a few bad phrases — the bad phrases are simply removed.
export function cutFlagged(body, texts) {
  if (!body || !Array.isArray(texts) || !texts.length) return body;
  const targets = texts.map(norm).filter((t) => t.length >= 12);
  if (!targets.length) return body;
  const hit = (sentence) => {
    const ns = norm(sentence);
    return targets.some((t) => ns.includes(t.slice(0, 55)) || (ns.length >= 25 && t.includes(ns.slice(0, 45))));
  };
  const paras = String(body).split(/\n{2,}/).map((para) =>
    para.split(/(?<=[.!?])\s+/).filter((s) => s.trim() && !hit(s)).join(" ")
  );
  return paras.filter((p) => p.trim()).join("\n\n");
}

// keyTakeaways fallback: reuse the article's OWN confirmed/attributed points (whatWeKnow) — never invents.
export function ensureTakeaways(article) {
  const cur = (article.keyTakeaways || []).filter((x) => x && x.trim());
  if (cur.length >= 2) return cur.slice(0, 4);
  const fromKnow = (article.whatWeKnow || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 3);
  return (cur.length ? [...new Set([...cur, ...fromKnow])] : fromKnow).slice(0, 4);
}

// FAQ fallback: turn the article's OWN open questions (whatWeDont) into Q/A — the answer is the honest
// "not yet confirmed/public" state, never an invented fact. Only used when the writer returned none.
function toQuestion(s) {
  let q = String(s).trim().replace(/[.?!]+$/, "");
  if (/^whether /i.test(q)) q = "Will " + q.replace(/^whether /i, "");
  else if (/^if /i.test(q)) q = "Will " + q.replace(/^if /i, "");
  else if (/^the /i.test(q)) q = "What " + (/\b(are|were|include|allegations|details|reasons)\b/i.test(q) ? "are" : "is") + " " + q.replace(/^the /i, "the ");
  else q = q.charAt(0).toUpperCase() + q.slice(1);
  return q.replace(/\s+/g, " ").trim() + "?";
}
export function ensureFaq(article) {
  const cur = (article.faq || []).filter((f) => f && f.q && f.a);
  if (cur.length >= 1) return cur.slice(0, 4);
  return (article.whatWeDont || [])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((x) => ({ q: toQuestion(x), a: "This has not been confirmed or made public as of publication; we'll update the story as more is verified." }));
}

// Tags: the entity + the gossip angle + the category (deterministic, for internal-linking/SEO). No stuffing.
export function deriveTags(topic, article, category, gossipType) {
  const tags = [topic?.primaryEntity, category, gossipType, "celebrity gossip"].map((t) => String(t || "").trim()).filter(Boolean);
  return [...new Set(tags)].slice(0, 6);
}
