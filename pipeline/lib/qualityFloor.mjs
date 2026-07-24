// qualityFloor.mjs — RECOVERY-MODE QUALITY BAR (owner directive 2026-07-24).
//
// 🔴 THE DIRECTIVE: "no thin stories, no single-source shorts, and fix the backwards behaviour where
// the system lowers its standards when a story is weak. Skip those stories completely. Let the daily
// count land wherever real quality takes it."
//
// ── WHAT WAS BACKWARDS ───────────────────────────────────────────────────────────────────────────
// gate.mjs used to RELAX its floors when grounding was thin: words 400→220, H2s→1, FAQ→2, takeaways
// →0, external links→0, Sources section→not required. So the WEAKER the story, the LOWER the bar it
// had to clear — and the thin single-source brief published anyway. Measured consequence: 138 news
// articles published in the 4–7 days to 2026-07-24 earned ZERO Google impressions between them,
// while the site sat crawl-parked after a thin/dup flood. Publishing those cost money and returned
// nothing. The floor now goes the other way: too little material ⇒ the story is SKIPPED.
//
// ── WHY THE CHECK LIVES BEFORE THE WRITER ────────────────────────────────────────────────────────
// Assessed straight after the content finder and BEFORE the editorial gate, so a story we would
// never publish costs ZERO LLM calls (previously it paid for editorial gate + writer + judge + image
// and was then held at the gate). This is the cost-saving half of the same change.
//
// ── FAIL-SAFE DIRECTION ──────────────────────────────────────────────────────────────────────────
// Only the MEASURED material decides. If the bundle is missing entirely we do NOT skip here — other
// grounding paths (authoritative title/awards/person facts) can still carry a real article, and the
// gate's word floor remains the backstop. We refuse to guess a story into the bin.

// One outlet is the normal case for this lane (trust-the-source model), so a single source is not by
// itself disqualifying — a THIN one is. A lone outlet must therefore carry noticeably more real text
// before it can support a publishable piece.
export const CFG = {
  // absolute minimum extracted source text (chars) for any story
  MIN_CHARS: Number(process.env.QUALITY_MIN_CHARS ?? 1500),
  // a story resting on ONE outlet must be richer than that — this is the "no single-source shorts" rule
  MIN_CHARS_SINGLE: Number(process.env.QUALITY_MIN_CHARS_SINGLE ?? 2200),
  // hard word floor for anything that publishes; never relaxed, for any format, for any reason
  MIN_WORDS: Number(process.env.QUALITY_MIN_WORDS ?? 250),
};

// Measure the real material behind a topic. Returns a decision + the numbers that drove it, so every
// skip is explainable in the run log (and so the thresholds can be tuned from observed distribution
// rather than guesswork).
export function assessGrounding(bundle, cfg = CFG) {
  const sources = (bundle && bundle.sources) || [];
  const chars = sources.reduce((n, s) => n + String(s?.text || "").length, 0);
  const quotes = sources.reduce((n, s) => n + ((s?.quotes || []).length), 0);
  const owners = (bundle && bundle.independentOwners?.length) || 0;
  const single = sources.length <= 1;

  // No bundle at all → not our call. Structured grounding may still carry it; the gate is the backstop.
  if (!bundle || !sources.length) return { ok: true, skip: false, reason: "no bundle (structured grounding may carry it)", chars, sources: sources.length, quotes };

  const need = single ? cfg.MIN_CHARS_SINGLE : cfg.MIN_CHARS;
  if (chars < need) {
    return {
      ok: false, skip: true, chars, sources: sources.length, quotes, owners, need,
      reason: single
        ? `single-source short: ${chars} chars from 1 outlet < ${need} required (no thin single-source briefs)`
        : `thin material: ${chars} chars across ${sources.length} outlets < ${need} required`,
    };
  }
  return { ok: true, skip: false, chars, sources: sources.length, quotes, owners, need, reason: `sufficient material (${chars} chars, ${sources.length} src, ${quotes} quotes)` };
}

// Grounding-aware STRUCTURAL allowances. A genuinely shorter (but properly sourced) piece may carry
// fewer H2s/links than a 600-word feature — that was never the problem. What is NOT allowed any more
// is dropping below the word floor or shipping with no sourcing at all.
export function structuralFloors(base, assessment, cfg = CFG) {
  const lean = assessment && assessment.ok && assessment.chars > 0 && assessment.chars < cfg.MIN_CHARS_SINGLE;
  return {
    ...base,
    words: Math.max(cfg.MIN_WORDS, base.words),   // ⬅ never below the floor — the backwards branch is gone
    h2: lean ? Math.min(base.h2, 1) : base.h2,
    faq: lean ? Math.min(base.faq, 2) : base.faq,
    kt: lean ? 0 : base.kt,
    ext: lean ? 0 : base.ext,
    sources: lean ? false : base.sources,
  };
}
