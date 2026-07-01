// GOSSIP — BACKEND PIPELINE HARNESS (offline). Exercises discovery, categorize, assemble/publish, the monitor,
// the quality gate, and the full orchestrator with mocks — no network, no LLM. Run: node pipeline/gossip/test/pipeline.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const matter = require("gray-matter");

import { discoverGossip } from "../discover.mjs";
import { categorizeGossip } from "../categorize.mjs";
import { qualityCheck } from "../qualityGate.mjs";
import { buildGossipMarkdown, writeGossipArticle } from "../assemble.mjs";
import { decide, monitorGossip } from "../monitor.mjs";
import { frameTopic } from "../frame.mjs";
import { gossipRun } from "../gossiprun.mjs";
import { verifyQuotes } from "../quoteGuard.mjs";
import { legalGate } from "../legalGate.mjs";
import { severity } from "../policy.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (name, cond, detail = "") => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; fails.push(name); console.log(`  ❌ ${name}  ${detail}`); } };

console.log(`\n=== GOSSIP BACKEND HARNESS (offline) ===\n`);

// 1) DISCOVERY — parse a canned RSS feed, compute freshness from an injected clock.
{
  const NOW = Date.parse("2026-06-29T12:00:00Z");
  const pub = new Date(NOW - 30 * 60000).toUTCString();
  const xml = `<rss><channel><item><title>Ava Stone and Liam Carter spotted together</title><link>https://pagesix.com/x</link><description>The two were seen at dinner.</description><pubDate>${pub}</pubDate></item></channel></rss>`;
  const cands = await discoverGossip({ fetchImpl: async () => xml, feeds: [{ outlet: "Page Six", url: "u" }], nowMs: NOW });
  check("discovery parses an item", cands.length === 1 && cands[0].outlet === "Page Six" && cands[0].url === "https://pagesix.com/x");
  check("discovery computes ageMin", cands[0].ageMin === 30);
}

// 2) CATEGORIZE — mock classifier; in-scope built, out-of-scope dropped.
{
  const cands = [
    { outlet: "People", url: "u1", title: "Ava Stone dating rumor", summary: "x" },
    { outlet: "Politico", url: "u2", title: "Senator news", summary: "x" },
  ];
  const mock = async () => [
    { i: 0, inScope: true, primaryEntity: "Ava Stone", subjectType: "actor", claim: "Ava Stone is dating Liam Carter", confirmed: false, official: false, denied: false, angle: "spotted" },
    { i: 1, inScope: false, reason: "politics" },
  ];
  const topics = await categorizeGossip(cands, { classifyImpl: mock });
  check("categorize keeps in-scope only", topics.length === 1 && topics[0].primaryEntity === "Ava Stone");
  check("categorize attaches a tiered source", topics[0].sources[0].outlet === "People" && topics[0].sources[0].tier === 6);
}

// 3) QUALITY — thin fails, real passes.
{
  check("quality blocks thin body", qualityCheck({ title: "A reasonably long gossip title here", dek: "x standfirst", body: "Too short." }).pass === false);
  const good = { title: "Ava Stone and Liam Carter spark dating rumors", dek: "The two were spotted together this weekend.", body: ("According to People, Ava Stone and Liam Carter were seen together at a Los Angeles restaurant this past weekend, sparking a fresh round of dating speculation among fans.\n\nA source told the outlet the pair looked happy and relaxed. Reps for both stars did not immediately respond to requests for comment. " + "Nothing about the nature of their relationship has been confirmed, and the rumors remain unverified for now. ".repeat(18)) };
  check("quality passes a real article", qualityCheck(good).pass === true, JSON.stringify(qualityCheck(good).issues));
}

// 4) ASSEMBLE — frontmatter carries gossip fields + provenance; the md round-trips through gray-matter.
{
  const topic = { primaryEntity: "Ava Stone", subjectType: "celebrity", title: "Ava Stone dating rumor", slug: "ava-stone-dating-rumor", claim: "dating Liam Carter", sources: [{ outlet: "People" }] };
  const frame = frameTopic(topic);
  const article = { title: "Ava Stone and Liam Carter spark dating rumors", dek: "Spotted together.", body: "According to People, they were seen together. This is unconfirmed.", whatWeKnow: ["Spotted, per People"], whatWeDont: ["Officially together?"], denial: null, keyTakeaways: [], faq: [] };
  const provenance = { sensitivity: "normal", monitor: frame.monitor, attribution: "People", sources: [{ outlet: "People" }] };
  const { md, frontmatter, slug } = buildGossipMarkdown({ article, frame, provenance, route: { category: "celebrity", subcategory: "news" }, topic, dateISO: "2026-06-29T12:00:00.000Z" });
  const back = matter(md).data;
  check("assemble sets formatTag=gossip + Alicia byline", frontmatter.formatTag === "gossip" && frontmatter.author === "alicia-bernard");
  check("assemble sets rumorStatus + storyStatus badge", frontmatter.rumorStatus === "Reported by People" && frontmatter.storyStatus === "DEVELOPING");
  check("assemble writes provenance for the monitor", frontmatter.provenance.primaryEntity === "Ava Stone" && frontmatter.provenance.tier === "REPORTED_BY_MAJOR" && typeof frontmatter.provenance.monitor === "boolean");
  check("assemble md round-trips through gray-matter", back.slug === slug && back.formatTag === "gossip");
}

// 5) MONITOR decide() — denial → RETRACT; corroboration → PROMOTE; nothing → HOLD.
{
  const prov = { primaryEntity: "A Star", claim: "A Star has died", status: "RUMOR", sensitivity: "high" };
  check("monitor RETRACTs on a denial/debunk", decide(prov, [{ title: "A Star is alive and well; rep denies death hoax", source: "TMZ" }]).action === "RETRACT");
  check("monitor PROMOTEs on 2 corroborating outlets", decide(prov, [{ title: "A Star statement issued", source: "People" }, { title: "A Star confirmed", source: "Variety" }]).action === "PROMOTE");
  check("monitor HOLDs on no fresh coverage", decide(prov, []).action === "HOLD");
}

// 6) MONITOR end-to-end (dry) on a real written .md in a temp dir → finds + acts on the watched story.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-mon-"));
  const topic = { primaryEntity: "Mara Vey", subjectType: "musician", title: "Mara Vey hospital rumor", slug: "mara-vey-hospital-rumor", claim: "Mara Vey was hospitalized", sources: [{ outlet: "X" }] };
  const frame = frameTopic(topic); // HIGH severity, social → needsDisclaimer + monitor
  const article = { title: "Fans worried about Mara Vey", dek: "She canceled a gig.", body: "Fans are speculating Mara Vey was hospitalized. This has not been confirmed by any official source and is unverified.", whatWeKnow: [], whatWeDont: [], denial: null, keyTakeaways: [], faq: [] };
  writeGossipArticle({ article, frame, provenance: { sensitivity: "high", monitor: frame.monitor, attribution: "X", sources: [{ outlet: "X" }] }, route: { category: "music", subcategory: "news" }, topic, dateISO: new Date(Date.parse("2026-06-29T12:00:00Z")).toISOString(), dir });
  const res = await monitorGossip({ fetchNews: async () => [{ title: "Mara Vey is fine, denies hospitalization rumor", source: "People" }], dir, dryRun: true, nowMs: Date.parse("2026-06-29T18:00:00Z") });
  check("monitor watches the published gossip story", res.watched === 1);
  check("monitor acts (retract/correction) on the debunk", res.results[0] && (res.results[0].action === "RETRACT" || res.results[0].action === "CORRECTION"), JSON.stringify(res.results));
  fs.rmSync(dir, { recursive: true, force: true });
}

// 7) ORCHESTRATOR — full run offline: 3 topics → 1 publish, 1 held, 1 blocked.
{
  const candidates = [{ outlet: "People" }, { outlet: "DeuxMoi" }, { outlet: "Pop Crave" }];
  const topics = [
    { id: "t1", title: "Star A dating", primaryEntity: "Star A", subjectType: "celebrity", slug: "star-a-dating", claim: "dating", sources: [{ outlet: "People" }] },
    { id: "t2", title: "Actor assault rumor", primaryEntity: "Actor B", subjectType: "celebrity", slug: "actor-b", claim: "accused of sexual assault", sources: [{ outlet: "DeuxMoi" }] },
    { id: "t3", title: "Star C health", primaryEntity: "Star C", subjectType: "celebrity", slug: "star-c", claim: "health rumor", sources: [{ outlet: "Pop Crave" }] },
  ];
  // mock runImpl: t1 publishes, t2 is EXTREME→HELD (real frame), t3 blocked by legal gate.
  const runImpl = async (t) => {
    const frame = frameTopic(t);
    if (frame.decision === "HOLD") return { status: "HELD", frame, reason: frame.reason };
    if (t.id === "t3") return { status: "BLOCKED_LEGAL", blocks: ["UNATTRIBUTED_DAMAGING: ..."], frame };
    return { status: "PUBLISH", article: { title: t.title }, frame, provenance: { sensitivity: "normal", monitor: frame.monitor, sources: t.sources }, route: { category: "celebrity", subcategory: "news" } };
  };
  let wrote = 0;
  const writeImpl = ({ topic }) => { wrote++; return { slug: topic.slug, written: false }; };
  const report = await gossipRun({ discoverImpl: async () => candidates, categorizeImpl: async () => topics, runImpl, writeImpl, dryRun: true, judge: false, dedup: false });
  check("orchestrator publishes the clean topic", report.published.length === 1 && report.published[0].id === "t1");
  check("orchestrator holds the EXTREME topic", report.held.length === 1 && report.held[0].id === "t2");
  check("orchestrator blocks the unsafe topic", report.blocked.length === 1 && report.blocked[0].id === "t3");
  check("orchestrator only writes published", wrote === 1);
}

// 8) QUOTE GUARD — deterministic verbatim-quote verification (the fabrication fix).
{
  const bundle = { sources: [{ text: "Allman, who has struggled with substance abuse, was arrested. His wife said she was emotionally exhausted." }] };
  check("quote guard FLAGS a misquote", verifyQuotes({ body: 'She says he "has a drug problem".' }, bundle).ok === false);
  check("quote guard FLAGS an invented quote", verifyQuotes({ body: 'She said "I never loved him anyway".' }, bundle).ok === false);
  check("quote guard PASSES a real verbatim quote", verifyQuotes({ body: 'He has "struggled with substance abuse".' }, bundle).ok === true);
}

// 9) AUDIT FIXES — the safety gaps the independent audit found, now closed.
{
  const fr = { needsDisclaimer: false, decision: "PUBLISH" };
  check("harass: unattributed → BLOCKED", legalGate({ title: "x", body: "She harassed her costar on set." }, fr).blocks.some((b) => b.includes("UNATTRIBUTED_DAMAGING")));
  check("harass: attributed → not blocked for that", legalGate({ title: "x", body: "According to Variety, she harassed her costar." }, fr).blocks.every((b) => !b.includes("UNATTRIBUTED_DAMAGING")));
  check("'sexually abused' → EXTREME severity", severity("He was sexually abused as a teen actor") === "EXTREME");
  check("'sexually assaulted' → EXTREME severity", severity("accused of having sexually assaulted a co-star") === "EXTREME");
  check("plural 'teenagers' + sexual → MINOR_ALLEGATION block", legalGate({ title: "x", body: "Police say he sexually assaulted the teenagers." }, fr).blocks.some((b) => b.includes("MINOR_ALLEGATION")));
  const denialBundle = { sources: [{ text: "A rep for the star denies he uses drugs regularly and calls the report completely false." }] };
  check("quote lifted from a denial → flagged", verifyQuotes({ body: 'Insiders claim he "uses drugs regularly".' }, denialBundle).ok === false);
  check("genuine verbatim quote still passes", verifyQuotes({ body: 'The rep said he "calls the report completely false".' }, denialBundle).ok === true);
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Backend pipeline green. ✅\n");
