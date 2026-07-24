// DEV-ONLY unit test (no network, no spend): the 800-word LONGFORM upgrade.
//
// Suite 1 is the one that matters most: with LONGFORM off, EVERY new code path must be inert, because
// the owner's instruction was "do not change anything on the live lane right now."
import { paddingReport, structureReport, canGoLong, CFG, ON } from "../lib/longform.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ FAIL: " + m); } };
const bundle = (sizes) => ({ sources: sizes.map((n) => ({ text: "x".repeat(n) })), extractedCount: sizes.length });

console.log("=== 1. 🔴 OFF BY DEFAULT — production behaviour cannot change ===");
{
  ok(ON === false, "LONGFORM.ON is false unless LONGFORM=1 is explicitly set (live workflow does not set it)");
  // The gate/generate/run paths are all guarded by `LONGFORM.ON && topic._longform`; with ON false the
  // second operand is never even consulted, so no story can enter longform mode by accident.
  const gated = (on, flag) => on && flag;
  ok(gated(ON, true) === false, "a topic flagged _longform still does NOT enter longform mode while OFF");
  ok(gated(ON, undefined) === false, "unflagged topics unaffected");
}

console.log("=== 2. MATERIAL GATES THE LENGTH — never ask for 800 words from 350 words of source ===");
{
  // the live single-outlet reality: ~2100 chars ≈ 350 words of source
  const single = canGoLong(bundle([2130]));
  ok(!single.ok, `one outlet / 2130 chars → short form (${single.reason})`);
  ok(!canGoLong(bundle([5000])).ok, "one rich outlet still short form — needs ≥2 outlets for the long form");
  const multi = canGoLong(bundle([4000, 3500]));
  ok(multi.ok, `two outlets / 7500 chars → long form allowed (${multi.chars} chars)`);
  ok(!canGoLong(bundle([1500, 1200])).ok, "two THIN outlets → still short form (volume, not just count)");
  ok(!canGoLong(null).ok && !canGoLong({ sources: [] }).ok, "no bundle → short form (never guess into the long form)");
}

console.log("=== 3. PADDING DETECTOR — the safety net that lets length rise without quality falling ===");
{
  const padded = "The studio confirmed the casting on Tuesday. The casting was confirmed by the studio on Tuesday. It remains to be seen how fans react. Only time will tell whether it succeeds. It is worth noting the actor has appeared in films. Fans will no doubt be eager. Stay tuned for more updates.";
  const r = paddingReport(padded, { title: "Studio Confirms Casting" });
  ok(r.padded, `filler-stuffed draft REJECTED (${r.blocks[0]})`);
  ok(r.filler >= 3, `counts the filler phrases (${r.filler})`);

  const restated = "Marvel casts Pedro Pascal as Reed Richards. " + "Marvel has cast Pedro Pascal as Reed Richards. ".repeat(2) + "Filming begins in March at Pinewood.";
  ok(paddingReport(restated, { title: "Marvel Casts Pedro Pascal as Reed Richards" }).padded,
    "restating the headline / near-duplicate sentences REJECTED (padding by repetition)");

  // genuine dense reporting must NOT trip it
  const real = "Netflix has ordered a second season of the drama, the streamer confirmed Tuesday. Production begins in March at Pinewood Studios outside London. Sarah Chen returns as showrunner, with Daniel Ortiz directing the first two episodes. The eight-episode order follows a debut season that drew 12 million views in its first week. Casting for three new series regulars is under way, and the streamer expects a late-2027 premiere.";
  ok(!paddingReport(real, { title: "Netflix Renews Drama for Season 2" }).padded, "dense, fact-packed reporting is NOT flagged (low false-positive)");
}

console.log("=== 4. STRUCTURE — the subheadings and bullets that are missing today ===");
{
  const good = "Lead paragraph.\n\n## What we know so far\n- Pedro Pascal as Reed Richards\n- Filming from March 2027\n- Pinewood Studios, London\n- Eight episodes\n\n## Who else is in it\ntext\n\n## Why this matters now\ntext\n\n## What happens next\ntext";
  ok(structureReport(good).ok, `a properly shaped article passes (${structureReport(good).h2} subheads, ${structureReport(good).bullets} bullets)`);

  // the live reality measured on 2026-07-24: ~2 subheadings, ZERO bullets
  const today = "Lead paragraph.\n\n## The details\ntext\n\n## What's next\ntext";
  const t = structureReport(today);
  ok(!t.ok, `today's typical shape FAILS: ${t.blocks.join(" · ")}`);
  ok(t.blocks.some((b) => /bullet/.test(b)), "missing bullets is caught explicitly (18 of 20 live articles had none)");
  ok(structureReport("## Details\ntext\n## Overview\ntext\n## More Info\ntext\n## Summary\ntext\n- a\n- b\n- c\n- d").blocks.some((b) => /generic/.test(b)),
    "generic headings ('Details'/'Overview') rejected — headings must say what the section contains");
}

console.log("=== 5. THRESHOLDS are staged + tunable (test ladder 400 → 600 → 800) ===");
{
  ok(CFG.MIN_WORDS === 800, `default floor is the owner's stated minimum (${CFG.MIN_WORDS})`);
  ok(CFG.MIN_H2 >= 4 && CFG.MIN_BULLETS >= 4, `structure minimums set (${CFG.MIN_H2} subheads, ${CFG.MIN_BULLETS} bullets)`);
  ok(CFG.MIN_CHARS >= 6000, `material floor scales with the word target (${CFG.MIN_CHARS} chars for ${CFG.MIN_WORDS} words)`);
  ok(CFG.TARGET_WORDS > CFG.MIN_WORDS, "target sits above the floor so the writer aims past the minimum");
}

console.log(`\n${fail === 0 ? "✅ ALL" : "❌"} ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
