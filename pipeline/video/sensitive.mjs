// PHASE 2 — SENSITIVITY DETECTOR (policy as code; FAILURE_MODES #death/legal criticals).
// Reads frontmatter + the article's opening text, not just the title (a death story titled
// "Hollywood Mourns a Legend" must still be caught). Pure + unit-testable.
const DEATH = /\b(dies?|died|dead|death|obituar\w*|passes away|passed away|mourns?|memorial|funeral|r\.?i\.?p\.?|gone at \d{2})\b/i;
const LEGAL = /\b(lawsuit|sues?|sued|indicted?|arrest\w*|charged|charges|convict\w*|sentenc\w*|trial|assault|abuse|harassment|rape|domestic violence|restraining order|fraud|felony)\b/i;
const MINOR = /\b(minor|underage|child(?!hood)|teenage victim)\b/i;
export function detectSensitive(fm = {}, bodyHead = "") {
  const hay = [fm?.provenance?.sensitivity, fm?.provenance?.eventType, fm?.title, fm?.dek, (fm?.tags || []).join(" "), bodyHead].filter(Boolean).join(" · ");
  return { death: DEATH.test(hay), legal: LEGAL.test(hay), minor: MINOR.test(hay) };
}
