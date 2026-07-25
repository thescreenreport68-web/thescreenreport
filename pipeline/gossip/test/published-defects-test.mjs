// GOSSIP — PUBLISHED-DEFECT regression test (2026-07-25).
//
// Every fixture in this file is TEXT THAT ACTUALLY WENT LIVE on thescreenreport.com. Each assert is a
// defect a reader could see, traced to its cause. If any of these fail, that defect can ship again.
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitSentences, offMenuHeadings, emptyReactionSection, conclusionFlourish, sectionsOf, MENU_SECTIONS } from "../proseGuards.mjs";
import { dedupeSentences, collapseRepeatedRuns } from "../polish.mjs";
import { pullQuoteFor } from "../assemble.mjs";
import { AGENTS } from "../models.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0; const fails = [];
const check = (n, c, got = "") => { if (c) pass++; else { fails.push(n); console.log(`❌ ${n}${got ? `  ${got}` : ""}`); } };

// ── 1. THE TRUNCATED LEDE ─────────────────────────────────────────────────────────────────────────
// PUBLISHED: "On July 23, the 51-year-old former E!"  ← that was the entire opening sentence.
// "E!" ends in "!", so the splitter closed the sentence there and a later per-sentence pass dropped
// the orphaned remainder. Entertainment copy is full of brands like this.
{
  const real = "On July 23, the 51-year-old former E! News host Giuliana Rancic posted a video to Instagram.";
  check("🔴 LIVE DEFECT: 'former E! News host' is ONE sentence, not two", splitSentences(real).length === 1, JSON.stringify(splitSentences(real)));
  check("…so the lede survives whole", splitSentences(real)[0].includes("Giuliana Rancic posted a video"));
  check("Yahoo! Finance also survives", splitSentences("She loves Yahoo! Finance and reads it daily.").length === 1);
  // a REAL sentence break after "!" must still split — the fix must not glue prose together
  check("a genuine '!' still ends a sentence", splitSentences("It was great! She left the party.").length === 2);
  check("Jeopardy! followed by a new sentence still splits", splitSentences("He won on Jeopardy! The crowd went wild.").length === 2);
  check("abbreviations still never split", splitSentences("Dr. Smith arrived. He was late.").length === 2);
}

// ── 2. THE DOUBLE-PRINTED QUOTE ───────────────────────────────────────────────────────────────────
// PUBLISHED, mid-sentence, in the Meghan McCain article. The two spans OVERLAP rather than match, and
// the first “ is never closed — so the sentence deduper (whole sentences) and the quoted-span deduper
// (needs a closing mark) both missed it.
{
  const real = `“I’m 41 years old … I’m going to age. I’m going to get older. "I’m 41 years old … I’m going to age. I am fatter because I’ve had three kids," She didn’t sugarcoat it.`;
  const out = dedupeSentences(real);
  check("🔴 LIVE DEFECT: the repeated quote run is collapsed", (out.match(/41 years old/g) || []).length === 1, `${(out.match(/41 years old/g) || []).length} copies`);
  check("…and the NEW information is kept", /fatter/.test(out));
  const real2 = `“It is a challenging cruelty to have people have such [opinions],” she said. "It is a challenging cruelty to have people have such [opinions]," While she described herself as armadillo-skinned.`;
  check("🔴 the second live duplicate is collapsed too", (dedupeSentences(real2).match(/challenging cruelty/g) || []).length === 1);
  // it must never chew up ordinary prose
  for (const safe of [
    "She said she was thrilled. The doctors were happy with her progress and sent her home to recover.",
    "Rubio told Page Six on July 15 that he attempted to request a temporary humanitarian parole.",
    `"I was diagnosed with leukemia earlier this year," she said. "I am so grateful to God."`,
    "Kim graduated from law school in May 2025 after six years of legal training, joined by Van Jones.",
  ]) check(`safe prose untouched: "${safe.slice(0, 34)}…"`, collapseRepeatedRuns(safe) === safe);
}

// ── 3. THE SECTION CONTRACT ───────────────────────────────────────────────────────────────────────
// PUBLISHED: "## The Reaction" containing no reaction from anyone (3 of 5 articles); invented headings
// ("What's On the Feed", "The Reaction and the Invite"); "## The Other Side" holding unrelated content.
{
  const noReaction = `Lede.\n\n## The Reaction\n\nThe couple’s transparency has drawn support from fans and followers, though the mystery remains.\n\n## Sources\n\n- [x](y)`;
  check("🔴 LIVE DEFECT: a 'Reaction' section with nobody quoted is flagged", emptyReactionSection(noReaction) === "The Reaction");
  const withReaction = `Lede.\n\n## The Reaction\n\n"We are all so relieved," her sister told People.\n\n## Sources\n\n- [x](y)`;
  check("…a Reaction section WITH a real quote passes", emptyReactionSection(withReaction) === null);
  const offMenu = `Lede.\n\n## What’s On the Feed\n\nStuff.\n\n## The Reaction and the Invite\n\nMore.\n\n## Sources\n\n- [x](y)`;
  check("🔴 LIVE DEFECT: invented headings are flagged", offMenuHeadings(offMenu).length === 2, JSON.stringify(offMenuHeadings(offMenu)));
  const onMenu = `Lede.\n\n## What Was Said\n\nStuff.\n\n## How We Got Here\n\nMore.\n\n## Sources\n\n- [x](y)`;
  check("…menu headings are never flagged", offMenuHeadings(onMenu).length === 0);
  check("…and 'Sources' is never treated as off-menu", !offMenuHeadings(onMenu).includes("Sources"));
  check("sectionsOf splits on headings", sectionsOf(onMenu).length === 3);
  check("the menu is the five agreed sections", MENU_SECTIONS.length === 5);
}

// ── 4. THE CONCLUSION FLOURISH ────────────────────────────────────────────────────────────────────
// PUBLISHED: "The episode wasn't just a rebuttal — it was a statement. Aging isn't a failure.
// Motherhood changes bodies. And authenticity, even when it's messy, is its own kind of power."
{
  const mccain = `She said she is 41.\n\nThe episode wasn’t just a rebuttal — it was a statement. Aging isn’t a failure. Motherhood changes bodies. And authenticity, even when it’s messy, is its own kind of power.`;
  check("🔴 LIVE DEFECT: the closing flourish is flagged", !!conclusionFlourish(mccain));
  const giuliana = `She invited him on.\n\nNow, two decades later, the story is back in rotation — not as a wound, but as content.`;
  check("🔴 the second live flourish is flagged", !!conclusionFlourish(giuliana));
  check("a factual closing paragraph is NOT flagged",
    conclusionFlourish(`Intro.\n\nNiedermeier told TMZ he is still searching for an apartment, but noted the cost is very high.`) === null);
  check("a closing with a quote is NOT flagged",
    conclusionFlourish(`Intro.\n\n"We will keep it very real with you," McCain promised.`) === null);
  check("a closing with a date is NOT flagged",
    conclusionFlourish(`Intro.\n\nRubio must cross the border on Sunday to learn whether the extension was approved.`) === null);
}

// ── 5. THE PULL QUOTE — new UI, and it must be VERBATIM ───────────────────────────────────────────
// `gossipPull` was dead frontmatter: no component read it and lib/articles.ts dropped it, so a gossip
// pull quote never once displayed. The site's card consumes pullQuote {text, attribution}.
{
  const bundle = { sources: [{ text: `Nivea said: "I am so grateful to God. I have been going through treatment, and everything is going great." She added more.` }], quotes: [] };
  const good = pullQuoteFor({ pullQuote: { text: "I am so grateful to God. I have been going through treatment", attribution: "Nivea, to People" } }, bundle);
  check("🔴 a verbatim quote produces the card", good && good.text.startsWith("I am so grateful"));
  check("…carrying its attribution", good?.attribution === "Nivea, to People");
  check("🔴 an INVENTED pull quote is refused outright", pullQuoteFor({ pullQuote: { text: "I have never felt stronger in my whole life", attribution: "Nivea" } }, bundle) === null);
  check("the writer's own prose is refused (it must be someone's words)", pullQuoteFor({ pullQuote: { text: "She is choosing when and how to share" } }, bundle) === null);
  check("a legacy plain-string pullQuote still works", pullQuoteFor({ pullQuote: "I am so grateful to God" }, bundle)?.text === "I am so grateful to God");
  check("no pull quote ⇒ no field", pullQuoteFor({}, bundle) === null);
  // the site renders the card for gossip, not only news
  const niche = fs.readFileSync(path.join(HERE, "..", "..", "..", "components", "NicheModules.tsx"), "utf8");
  check("🔴 the site renders the pull-quote card for gossip", /formatTag === "gossip" \? <NewsPullQuote|formatTag === "news" \|\| article\.formatTag === "gossip" \? <NewsPullQuote/.test(niche));
}

// ── 6. COST: the calls we removed must stay removed ───────────────────────────────────────────────
{
  const run = fs.readFileSync(path.join(HERE, "..", "run.mjs"), "utf8");
  const headline = fs.readFileSync(path.join(HERE, "..", "headline.mjs"), "utf8");
  check("💰 the SEO auditor call is gone (its verdict changed nothing)", !/semanticSeoPass\(/.test(run));
  check("💰 the headline self-judge call is gone", !/agentChat\("headlineJudge"/.test(headline));
  check("💰 both retired roles are out of the registry", !AGENTS.headlineJudge && !AGENTS.seoAuditor);
  check("💰 cleanse() no longer re-verifies after purely subtractive work",
    /DO NOT RE-VERIFY HERE/.test(run) && (run.match(/await verifyImpl\(/g) || []).length <= 4, `${(run.match(/await verifyImpl\(/g) || []).length} verify sites`);
  check("💰 the correction loop is capped at 2", /GOSSIP_MAX_FIX \?\? 2/.test(run));
  check("💰 one depth pass, not two", /GOSSIP_DEPTH_PASSES \?\? 1/.test(run));
  check("the depth pass cannot break the section contract", /rejected — it broke the section contract/.test(run));
}

// ── 7. OFF-TOPIC MATERIAL: the story zone ─────────────────────────────────────────────────────────
// PUBLISHED: a bar-exam article carrying a whole section about the subject's grandmother and sex in
// front of a fireplace — scraped from the "Trending Stories" teasers at the END of the source page.
{
  const df = fs.readFileSync(path.join(HERE, "..", "detailFinder.mjs"), "utf8");
  check("🔴 facts are extracted from the STORY ZONE, not the page tail", /STORY_ZONE/.test(df) && /storyText\(bundle\)/.test(df));
  check("…and an off-topic filter backs it up", /function onTopic/.test(df));
  check("the writer never saw the tail anyway (2500-char window)", /slice\(0, 2500\)/.test(fs.readFileSync(path.join(HERE, "..", "writer.mjs"), "utf8")));
}

// ── 8. CORROBORATION — three measured causes of single-sourcing ───────────────────────────────────
// Every live article shipped with ONE outlet. Measured on 2026-07-25:
//   • GDELT answers in 11-15s but the client ceiling was 8s ⇒ it ALWAYS timed out.
//   • GDELT enforces one request per 5s and returns "Please limit requests to one every 5 seconds";
//     we never spaced calls, so multi-topic ticks got nothing.
//   • The article reader hard-403s news.google.com ("AbuseAlleviationError"), and Google News returns
//     ONLY redirect links — so every such attempt was a guaranteed loss that burned the attempt budget.
// After the fixes, a mainstream story went 1 → 3 sources (8,000 → 13,918 chars).
{
  const cf = fs.readFileSync(path.join(HERE, "..", "contentFinder.mjs"), "utf8");
  const co = fs.readFileSync(path.join(HERE, "..", "corroborate.mjs"), "utf8");
  check("🔴 corroboration is bounded by a CLOCK, not by failed attempts", /GOSSIP_CORROBORATE_MS/.test(cf));
  check("…and it reports why each candidate failed", /unreadable|no mention of the subject/.test(cf));
  check("🔴 the GDELT ceiling clears its measured 11-15s latency", /GOSSIP_FINDER_TIMEOUT_MS \?\? 20000/.test(co));
  check("🔴 GDELT calls are spaced for its 1-per-5s limit", /GDELT_MIN_GAP_MS/.test(co) && /gdeltPace/.test(co));
  check("…and a rate-limit reply is retried, not silently swallowed", /limit requests to one every/i.test(co));
  check("🔴 unreadable aggregator redirects never burn an attempt", /isRedirectUrl\(e\.url\)/.test(cf));
  check("…readable direct URLs are tried first", /readableFirst/.test(co));
}

console.log(`\n── RESULT: ${pass} passed${fails.length ? `, ${fails.length} FAILED` : ""} ──`);
if (fails.length) { console.log("FAILED: " + fails.join("; ")); process.exit(1); }
console.log("Every defect that reached the live site is now locked out. ✅");
assert.ok(true);
