// SPECIFICS GUARD (deterministic, gossip-automation port 2026-07-03, news-scoped). Model-independent battery
// pass: every significant NUMBER in the reader-visible copy — a $ amount, a %, a 4-digit year, any 3+-digit
// figure — must exist somewhere in the GROUNDING (the gathered source text + the structured authoritative fact
// blocks), and every "according to <Outlet>" attribution must name an outlet that is actually in the bundle.
// Catches the two classic news failures (a wrong year, a credit to an outlet that never reported it) at $0,
// every time — no LLM extraction step to miss them. Findings are CUTTABLE claims (fix-or-cut, never a dead end).
const normNum = (s) => String(s).toLowerCase().replace(/[^a-z0-9$%. ]/g, " ").replace(/\s+/g, " ").trim();

// Significant-number tokens in a text: $12.5M/$1,200, 45%, 1998/2026, 1,200, 300 (3+ digits).
const NUM_RX = /\$\s?\d[\d,]*(?:\.\d+)?\s?(?:million|billion|m|b)?|\b\d+(?:\.\d+)?%|\b(?:19|20)\d{2}\b|\b\d{1,3}(?:,\d{3})+\b|\b\d{3,}\b/gi;
// The numeric CORE of a token ("$72.5 million" → "72.5"; "1,200" → "1200") — what must appear in the grounding.
const numCore = (t) => String(t).replace(/[$,%\s]|million|billion|\bm\b|\bb\b/gi, "").trim();

export function specificsGuard(article, sources, topic) {
  const bad = [];
  const hayRaw = [
    ...(sources || []).map((s) => `${s.text || ""} ${(s.quotes || []).join(" ")}`),
    ...((topic?.facts || []).map((f) => f.extract || "")),
  ].join("\n");
  const hay = normNum(hayRaw);
  const hayDigits = hay.replace(/[,]/g, "");

  const copy = [
    article?.title, article?.dek, article?.body,
    ...(article?.keyTakeaways || []),
    ...(article?.faq || []).flatMap((f) => [f?.q, f?.a]),
  ].filter(Boolean).join("\n");

  // 1) NUMBERS: every significant figure must exist in the grounding (by numeric core).
  const seen = new Set();
  for (const m of copy.matchAll(NUM_RX)) {
    const tok = m[0].trim();
    const core = numCore(tok);
    if (!core || core.length < 2 || seen.has(core)) continue; // single digits are prose ("3-part"), not specifics
    seen.add(core);
    if (!hayDigits.includes(core)) bad.push({ text: tok, why: `figure "${tok}" not found in any gathered source or authoritative fact` });
  }

  // 2) OUTLET ATTRIBUTIONS: "according to X" must name an outlet present in the bundle/verification metadata
  // OR named anywhere in the gathered text itself (a source body saying "Variety reports…" legitimately grounds
  // an "according to Variety" — checking metadata alone would false-positive on that common case).
  const outletHay = normNum([
    ...(sources || []).flatMap((s) => [s.owner, s.domain, s.outlet]),
    ...((topic?.sources || []).map((s) => s.outlet)),
    topic?.verification?.attribution,
  ].filter(Boolean).join(" ")) + " " + hay;
  for (const m of copy.matchAll(/\baccording to ((?:the )?[A-Z][A-Za-z!&'’. ]{2,28}?)(?=[,.;:\n)]|$)/gm)) {
    const name = m[1].replace(/^the /i, "").trim();
    if (name.split(/\s+/).length > 4) continue; // a clause, not an outlet name
    const nn = normNum(name);
    // match loosely: full name, or its distinctive first token (>=4 chars) appearing in the outlet haystack
    const first = nn.split(" ")[0];
    if (!nn || outletHay.includes(nn) || (first.length >= 4 && outletHay.includes(first))) continue;
    bad.push({ text: `according to ${name}`, why: `attributed to "${name}", which is not among the gathered sources` });
  }

  const corrections = bad
    .map((b) => `- ${b.why}. Use only figures/outlets present in the REFERENCE FACTS, or cut the sentence.`)
    .join("\n");
  return { ok: bad.length === 0, bad, corrections };
}
