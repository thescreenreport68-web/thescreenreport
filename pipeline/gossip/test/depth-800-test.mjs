// 800-WORD FLOOR (owner directive 2026-07-25) — reached by ENRICHING MATERIAL, never by padding.
// Covers: detailFinder, background agent, depth-scaled word target, the depth pass, and the hard floor.
//   node pipeline/gossip/test/depth-800-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findDetails, findBackground, materialDepth } from "../detailFinder.mjs";
import { wordRangeFor, buildGossipPrompt } from "../writer.mjs";
import { substanceCheck, SUBSTANCE_MIN_WORDS } from "../qualityGate.mjs";
import { AGENTS } from "../models.mjs";
import { runGossip } from "../run.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
process.env.GOSSIP_STATS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-stats-"));
console.log("\n=== 800-WORD FLOOR VIA ENRICHMENT ===\n");

// Real articles have varied sentences; dedupeSentences collapses near-identical ones by similarity, so
// fixtures must be genuinely distinct too. Combinatorial banks keep token overlap low.
const SUBJ = ["The promoter", "A tour manager", "His label", "The venue", "A support act", "Ticket holders",
  "The production crew", "A freight contractor", "Local police", "The insurer", "A festival organiser",
  "His publicist", "The rehearsal studio", "A merchandise supplier", "Two session players", "The lighting designer",
  "A travel agent", "The catering firm", "His booking agent", "A stage builder", "The sound engineer",
  "A regional radio host", "The box office", "A charity partner", "His touring drummer"];
const VERB = ["confirmed", "disputed", "documented", "scheduled", "cancelled", "renegotiated", "postponed",
  "invoiced", "audited", "announced", "withdrew from", "clarified", "revised", "approved", "questioned"];
const OBJ = ["the September dates", "the refund window", "the Berlin leg", "the freight manifest",
  "the insurance claim", "the rehearsal block", "the merchandise order", "the crew contracts",
  "the Manchester booking", "the support slot", "the shipping schedule", "the festival slot",
  "the studio hold", "the transport quote", "the security plan"];
const TAIL = ["on Friday afternoon", "before the public statement", "within the same hour", "late on Thursday",
  "ahead of the announcement", "over the weekend", "in a follow-up note", "during a call that evening",
  "after the post went live", "the following morning"];
let _v = 0;
const varied = (n) => Array.from({ length: n }, () => {
  const k = _v++;
  return `${SUBJ[k % SUBJ.length]} ${VERB[(k * 7) % VERB.length]} ${OBJ[(k * 11) % OBJ.length]} ${TAIL[(k * 3) % TAIL.length]}.`;
}).join(" ");

const SRC = `Ryan Adams cancelled his European tour on Friday, telling fans on Instagram that he had been
diagnosed with a heart condition. "I have to stop and take care of this," he wrote. The 51-year-old
musician had been due to play 14 dates across the UK and Germany beginning in September. Promoter
Live Nation confirmed refunds would be issued automatically within 30 days. Adams last toured Europe
in 2023. His representative said he expects to reschedule in 2027.`;
const BUNDLE = { sources: [{ outlet: "OK! Magazine", tier: 5, text: SRC }], quotes: ["I have to stop and take care of this"] };

// ── the sub-finder: exhaustive extraction, nothing invented ──
{
  const stub = async () => ({ data: {
    facts: ["Ryan Adams cancelled his European tour on Friday",
            "He had been due to play 14 dates across the UK and Germany",
            "Live Nation confirmed refunds would be issued automatically",
            "ADAMS SECRETLY MARRIED IN VEGAS LAST YEAR"],           // ← invented, must be dropped
    quotes: [{ speaker: "Ryan Adams", text: "I have to stop and take care of this" },
             { speaker: "Ryan Adams", text: "this tour was going to be my last anyway" }], // ← invented
    timeline: [{ when: "Friday", what: "cancelled the European tour" }, { when: "2023", what: "last toured Europe" }],
    people: [{ name: "Ryan Adams", role: "musician" }, { name: "Taylor Swift", role: "friend" }], // ← not in source
    numbers: ["14 dates", "30 days", "51-year-old", "$4 million payout"],  // ← last one invented
    openQuestions: [],
  }, usage: {} });
  const d = await findDetails({ bundle: BUNDLE, topic: { primaryEntity: "Ryan Adams" }, chatImpl: stub });
  check("extracts the real facts", d.facts.length === 3, JSON.stringify(d.facts.length));
  check("🔴 INVENTED fact dropped", !d.facts.some((f) => /VEGAS/i.test(f)));
  check("🔴 INVENTED quote dropped", d.quotes.length === 1 && /take care of this/.test(d.quotes[0].text));
  check("🔴 person not in the source dropped", !d.people.some((p) => /Taylor/i.test(p.name)));
  check("🔴 invented number dropped", !d.numbers.some((n) => /4 million/.test(n)));
  check("real timeline kept", d.timeline.length === 2);

  const dead = await findDetails({ bundle: BUNDLE, topic: {}, chatImpl: async () => { throw new Error("down"); } });
  check("detail finder fails soft", dead.facts.length === 0 && /unavailable/.test(dead.reason));
  const thin = await findDetails({ bundle: { sources: [{ text: "tiny" }] }, topic: {}, chatImpl: async () => { throw new Error("must not be called"); } });
  check("skips when there is nothing to mine", thin.facts.length === 0);
}
// ── the background agent ──
{
  const stub = async () => ({ data: {
    timeline: [{ when: "2023", what: "last toured Europe" }, { when: "2019", what: "was dropped by his label" }], // 2nd invented
    priorStatements: [{ who: "His representative", what: "he expects to reschedule in 2027", when: "Friday" }],
    whoTheyAre: ["Ryan Adams is a 51-year-old musician"],
    whatsNext: ["He expects to reschedule in 2027"],
  }, usage: {} });
  const b = await findBackground({ bundle: BUNDLE, topic: { primaryEntity: "Ryan Adams" }, chatImpl: stub });
  check("background keeps grounded timeline", b.timeline.some((t) => /2023/.test(t.when)));
  check("🔴 invented background dropped", !b.timeline.some((t) => /label/i.test(t.what)));
  check("prior statement kept", b.priorStatements.length === 1);
  const dead = await findBackground({ bundle: BUNDLE, topic: {}, chatImpl: async () => { throw new Error("x") } });
  check("background fails soft", dead.timeline.length === 0);
}
// ── the word target scales with real material, and ONLY with real material ──
{
  const bare = wordRangeFor(BUNDLE);
  const enriched = wordRangeFor({ ...BUNDLE, sources: [{ text: "x".repeat(9000) }],
    details: { facts: Array(25).fill("f"), timeline: Array(6).fill({}), quotes: Array(6).fill({}) },
    background: { timeline: Array(5).fill({}), priorStatements: Array(3).fill({}) } });
  check("thin bundle ⇒ modest target (never a blind 800)", bare.hi <= 700, bare.label);
  check("enriched bundle ⇒ 800–1000 target", enriched.lo === 800 && enriched.hi === 1000, enriched.label);
  const d = materialDepth({ ...BUNDLE, details: { facts: ["a", "b"], quotes: [], timeline: [] }, background: {} });
  check("materialDepth reports the real inputs", d.outlets === 1 && d.facts === 2 && d.chars > 300);
}
// ── the writer is NEVER handed a word floor ──
{
  const { user } = buildGossipPrompt(BUNDLE, { writerDirective: "d", uiLabel: "Reported" }, { primaryEntity: "Ryan Adams", title: "t" });
  check("🔴 no word-count floor reaches the writer", !/(at least|minimum of|no fewer than|must be)\s*\d{3,4}\s*words?/i.test(user));
  check("target is expressed as a bundle-derived range", /\d{3}–\d{3,4} words/.test(user));
  check("sections are a MENU, not a form", /MENU, NOT A FORM/.test(user) && /omitted section is correct/.test(user));
}
// ── the floor itself ──
{
  check("floor is 800", SUBSTANCE_MIN_WORDS === 800);
  const long = "Star A confirmed it on July 3, People reports. \"It was hard,\" she said. " + Array.from({ length: 90 }, (_, i) => `Distinct verified sentence ${i} carrying its own separate detail about the day.`).join(" ");
  const ok = substanceCheck({ body: long }, { sources: [{ outlet: "People" }], corroboratingOutlets: [{ outlet: "Page Six" }] });
  check("an 800+ multi-source piece passes", ok.pass, JSON.stringify(ok.reasons));
  const short = substanceCheck({ body: "Star A confirmed it on July 3. \"Hard,\" she said." }, { sources: [{ outlet: "People" }], corroboratingOutlets: [{ outlet: "Page Six" }] });
  check("a short piece is held", !short.pass && short.reasons.some((r) => /800w/.test(r)));
}
// ── DEPTH PASS: a short draft is rewritten using UNUSED material, not padded ──
{
  const details = {
    facts: ["He had been due to play 14 dates across the UK and Germany beginning in September",
            "Live Nation confirmed refunds would be issued automatically within 30 days",
            "Adams last toured Europe in 2023",
            "His representative said he expects to reschedule in 2027"],
    quotes: [{ speaker: "Ryan Adams", text: "I have to stop and take care of this" }],
    timeline: [{ when: "Friday", what: "cancelled the tour" }], people: [], numbers: [], openQuestions: [],
  };
  const background = { timeline: [{ when: "2023", what: "last European tour" }], priorStatements: [], whoTheyAre: ["Ryan Adams is a 51-year-old musician"], whatsNext: ["Reschedule expected 2027"] };
  let calls = 0, sawIssues = null;
  const shortBody = 'Ryan Adams cancelled his European tour on Friday, OK! Magazine reports. "I have to stop and take care of this," he wrote.\n\n' + varied(20);
  const longBody = 'Ryan Adams cancelled his European tour on Friday, OK! Magazine reports. "I have to stop and take care of this," he wrote.\n\n' + varied(75) + "\n\n" + varied(75);
  const r = await runGossip(
    { primaryEntity: "Ryan Adams", title: "t", claim: "tour cancelled", subjectType: "musician", sources: [{ outlet: "OK! Magazine", tier: 5, text: SRC.repeat(3) }, { outlet: "Page Six", tier: 6, text: SRC.repeat(3) }] },
    {
      writeImpl: async ({ priorArticle, issues }) => {
        calls++;
        if (priorArticle) { sawIssues = issues; return { ...priorArticle, body: longBody }; }
        return { title: "Ryan Adams Cancels European Tour", dek: "The musician cited a heart condition in a post to fans.", body: shortBody, keyTakeaways: ["k"], faq: [{ q: "Q?", a: "A real answer here." }], whatWeKnow: ["Tour cancelled"], whatWeDont: [], claims: [] };
      },
      editorialImpl: async () => ({ isStory: true, category: "celebrity", primaryEntity: "Ryan Adams", confirmed: true, official: false, denied: false, angle: "tour cancelled" }),
      enrich: true,
      detailImpl: async () => details,
      backgroundImpl: async () => background,
      verify: false, judge: false, corroborate: false, substance: true,
    });
  check("depth pass fired on the short draft", calls === 2, `writeImpl ran ${calls}x`);
  check("🔴 it was given UNUSED FACTS, not a word target", Array.isArray(sawIssues) && sawIssues.some((i) => /UNUSED FACT/.test(i)) && !sawIssues.some((i) => /\d{3,4}\s*words?/i.test(i)), JSON.stringify((sawIssues || []).slice(0, 2)));
  check("the enriched article PUBLISHES", r.status === "PUBLISH", `${r.status}${r.reason ? " — " + r.reason : ""}`);
  check("and it clears 800 words", (r.substance?.words || 0) >= 800, String(r.substance?.words));
}
// ── when material is genuinely exhausted, it HOLDS rather than padding ──
{
  const r = await runGossip(
    { primaryEntity: "Star Z", title: "t", claim: "c", subjectType: "actor", sources: [{ outlet: "People", tier: 6, text: "Star Z was seen leaving a restaurant on Tuesday. ".repeat(12) }] },
    {
      writeImpl: async () => ({ title: "Star Z Leaves a Restaurant", dek: "A brief sighting on Tuesday evening in the city.", body: "Star Z was seen leaving a restaurant on Tuesday, People reports.\n\n" + varied(14), keyTakeaways: ["k"], faq: [], whatWeKnow: ["seen leaving"], whatWeDont: [], claims: [] }),
      editorialImpl: async () => ({ isStory: true, category: "celebrity", primaryEntity: "Star Z", confirmed: true, official: false, denied: false, angle: "sighting" }),
      enrich: true,
      detailImpl: async () => ({ facts: [], quotes: [], timeline: [], people: [], numbers: [], openQuestions: [] }),
      backgroundImpl: async () => ({ timeline: [], priorStatements: [], whoTheyAre: [], whatsNext: [] }),
      verify: false, judge: false, corroborate: false, substance: true,
    });
  check("🔴 genuinely thin story is HELD, never padded to 800", r.status === "HELD" && r.stage === "thin", `${r.status}/${r.stage}`);
}
// ── the tested models are the ones in use ──
{
  check("writer = the bake-off winner (qwen3-235b)", /qwen3-235b/.test(AGENTS.writer.model), AGENTS.writer.model);
  check("detailFinder = qwen3.5-flash", /qwen3\.5-flash/.test(AGENTS.detailFinder.model), AGENTS.detailFinder.model);
  check("both new agents have a fallback", !!AGENTS.detailFinder.fallback && !!AGENTS.background.fallback);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("800 floor reached by enrichment, never padding. ✅\n");
