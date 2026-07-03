// DEV-ONLY (no network): prove the Phase C block classifier — a BLOCK (fabrication/grounding/must-have) never
// auto-publishes; a FIXABLE (quality/structure nit) is acceptable on the terminal attempt.
import { classifyBlocks } from "../stages/gate.mjs";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ FAIL: " + m); } };
const isBlock = (s) => classifyBlocks([s]).block.length === 1;
const isFixable = (s) => classifyBlocks([s]).fixable.length === 1;

console.log("=== fabrication / grounding / must-have → BLOCK (never auto-publish) ===");
for (const b of [
  'fabricated: The most recent film debuted in theaters in December 2025.',
  'CONTRADICTED [platform]: article says Nemesis streams on Netflix — TMDB shows Prime Video.',
  'verify-gate BLOCK: could not verify the article against the gathered sources',
  'verify-gate CUT: 2 claim(s) not in the gathered sources — X; Y',
  'fabricated/altered quote: "the greatest betrayal" — use the exact source words',
  '2 unverified claim(s) (need correction)',
  '1 ungrounded fact(s) (verify against the authoritative facts)',
  'no >=1200px image sourced',
  'trailer: no embedded video',
  'reaction: no embedded posts',
  'no title',
]) ok(isBlock(b), `BLOCK: ${b.slice(0, 52)}`);

// 2026-07-03 restructure: the judge is SCORE-ONLY — "accuracy N < 8" no longer exists as a gate block
// (fabrication enforcement = deterministic layers + web reality-check), so the string must NOT classify
// as a BLOCK if it ever appears in a legacy state file.
ok(!isBlock('accuracy 4 < 8'), "legacy 'accuracy 4 < 8' is no longer a BLOCK (judge is score-only)");

console.log("=== quality / structure nits → FIXABLE (acceptable on the terminal attempt) ===");
for (const b of [
  'body 243w < 300',
  'FAQ 2 < 3',
  'H2s 1 < 2',
  'external links 0 < 2',
  'no Sources section',
  'keyTakeaways 0 < 3',
  'primary keyword not in title',
  'humanVoice 6 < 7',
  'phrasing 6 < 7',
  'infoGain 6 < 7',
  'Flesch 38 < 40 (too dense to read comfortably)',
]) ok(isFixable(b), `FIXABLE: ${b.slice(0, 52)}`);

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
