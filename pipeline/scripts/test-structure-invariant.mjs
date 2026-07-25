// STRUCTURE INVARIANT — the permanent guard against the bug class that bit three times in one day.
//
// 🔴 THE PATTERN: `\s` MATCHES NEWLINES. Every time I wrote a "tidy the whitespace" regex and let it run
// over a markdown BODY, it silently destroyed the document:
//   1. fixInlineBullets' detector    — `\s` matched the newline, so a CORRECTLY formatted list looked
//                                       broken, and I reported a good live article as defective.
//   2. paddingReport's nearDup       — short sentences scored as duplicates, flagging good writing.
//   3. dropStubTitles' `\s{2,}`      — collapsed EVERY paragraph break and heading onto one line. An
//                                       article with 6 headings rendered as a wall of text with
//                                       "## Who is in the cast?" sitting mid-sentence. Caught in a dry
//                                       run; had it shipped, every article that day would have been broken.
//
// Rather than remember the rule, this test enforces it: a canonical article goes through EVERY function
// that touches body markdown, and the structure must survive each one. Any NEW transform added to the
// pipeline should be added to TRANSFORMS below — if it eats a newline, this fails immediately.
import { dedupeSentences, trimIncomplete, dropOrphanHeadings, fixInlineBullets, dropStubTitles } from "../lib/polish.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ FAIL: " + m); } };

// A realistic article: multiple paragraphs, several headings, a bullet list, a blockquote, a Sources block,
// an emphasised real title AND a stub title, plus spaced punctuation to repair.
const ARTICLE = [
  "Tony nominee Andrew Durand will star as Benjamin Button this fall at The Public Theater, according to Deadline.",
  "",
  "The production marks the show's first American presentation after a celebrated West End run.",
  "",
  "## Who Is in the Cast?",
  "",
  "The complete company includes performers doubling as actors and musicians.",
  "",
  "- **Andrew Durand** as Benjamin Button",
  "- **Kelsee Kimmel** as Elowen Keene",
  "- **Britney Coleman** as Gwyns",
  "",
  "## What the Musical Changes From the 2008 Film",
  "",
  "The stage version resets the story from New Orleans to a Cornish fishing village.",
  "",
  "> \"The chemistry was so strong, I had to fight for her.\"",
  "",
  "It premiered at Southwark Playhouse in 2019, with films titled *Hyperia* and *b* also in development .",
  "",
  "## Sources",
  "",
  "- [The Public Theater](https://publictheater.org/)",
].join("\n");

// Every function that is allowed to touch body markdown, in the order run.mjs applies them.
const TRANSFORMS = [
  ["dedupeSentences", dedupeSentences],
  ["trimIncomplete", trimIncomplete],
  ["dropOrphanHeadings", dropOrphanHeadings],
  ["fixInlineBullets", fixInlineBullets],
  ["dropStubTitles", dropStubTitles],
  // the body-safe punctuation fixer used in run.mjs (kept in sync deliberately — the OTHER one collapses
  // all whitespace and must only ever touch single-line meta fields)
  ["fixSpacedPunctuation2", (md) => String(md || "").replace(/[ \t]+([.,;:!?])/g, "$1")],
];

const structure = (md) => ({
  headings: (md.match(/^##\s+.+$/gm) || []).length,
  bullets: (md.match(/^\s*[-*]\s+\S/gm) || []).length,
  paraBreaks: (md.match(/\n\n/g) || []).length,
  quote: (md.match(/^>\s+\S/gm) || []).length,
});
const BASE = structure(ARTICLE);

console.log("=== 1. EACH transform preserves markdown structure, run alone ===");
for (const [name, fn] of TRANSFORMS) {
  let out;
  try { out = fn(ARTICLE); } catch (e) { ok(false, `${name} threw: ${e.message}`); continue; }
  const s = structure(out);
  ok(s.headings === BASE.headings, `${name}: ${s.headings}/${BASE.headings} headings survive`);
  ok(s.paraBreaks > 0, `${name}: paragraph breaks survive (${s.paraBreaks})`);
  ok(s.bullets >= BASE.bullets, `${name}: ${s.bullets}/${BASE.bullets} bullets survive`);
  ok(s.quote === BASE.quote, `${name}: blockquote survives`);
}

console.log("=== 2. The FULL chain, exactly as run.mjs composes it ===");
{
  let md = ARTICLE;
  for (const [, fn] of TRANSFORMS) md = fn(md);
  const s = structure(md);
  ok(s.headings === BASE.headings, `all ${BASE.headings} headings survive the whole chain`);
  ok(s.bullets >= BASE.bullets, `all ${BASE.bullets} bullets survive the whole chain`);
  ok(s.paraBreaks > 0, "paragraph breaks survive the whole chain");
  ok(/^## Who Is in the Cast\?$/m.test(md), "a heading is still ALONE on its line (never mid-sentence)");
  ok(!/\S ## /.test(md), "no heading was pulled into the middle of a paragraph");
  // and the repairs it is supposed to make DID happen
  ok(!/\*b\*/.test(md), "the 1-char stub title was dropped");
  ok(/\*Hyperia\*/.test(md), "the real emphasised title was kept");
  ok(!/development \./.test(md), "the spaced full stop was closed");
}

console.log("=== 3. Idempotence — re-running the chain must not degrade the article ===");
{
  let once = ARTICLE, twice = ARTICLE;
  for (const [, fn] of TRANSFORMS) once = fn(once);
  twice = once;
  for (const [, fn] of TRANSFORMS) twice = fn(twice);
  ok(structure(twice).headings === structure(once).headings, "headings stable on a second pass");
  ok(structure(twice).bullets === structure(once).bullets, "bullets stable on a second pass");
  ok(structure(twice).paraBreaks === structure(once).paraBreaks, "paragraph breaks stable on a second pass");
}

console.log("=== 4. THE RULE ITSELF — no body transform may use a newline-eating class ===");
{
  // Regression-proofs the source, not just the behaviour: a future edit that reintroduces \s{2,} or \s+
  // as a *replacement* over body text fails here even if no fixture happens to catch it.
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../lib/polish.mjs", import.meta.url), "utf8");
  const bodyFns = src.split(/\nexport function |\nexport const /).filter((b) => /dropStubTitles|fixInlineBullets|dropOrphanHeadings/.test(b.slice(0, 40)));
  const offenders = bodyFns.filter((b) => /replace\(\/\\s\{\d|replace\(\/\\s\+\/g/.test(b));
  ok(offenders.length === 0, `no body-level transform collapses \\s (found ${offenders.length}) — use [ \\t] so newlines survive`);
}

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
