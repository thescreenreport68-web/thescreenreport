// 2026-07-18 AUDIT GUARDS — every defect class found in the live-article audit must be structurally
// impossible now. Offline.  node pipeline/gossip/test/audit-guards-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { foldText, slugify, entityKey, shareEntityFold } from "../normalize.mjs";
import { cutScaffolding, cutAbsenceClaims, dropAbsenceFaq, relativeTimeUnanchored, splitSentences } from "../proseGuards.mjs";
import { dedupeSentences } from "../polish.mjs";
import { buildGossipMarkdown } from "../assemble.mjs";
import { runGossip } from "../run.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
process.env.GOSSIP_STATS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-stats-"));

console.log("\n=== 2026-07-18 AUDIT GUARDS ===\n");

// ── A. entity normalization ──
check("Beyoncé → beyonce (not beyonc)", slugify("Beyoncé") === "beyonce", slugify("Beyoncé"));
check("Marcello Hernández → marcello-hernandez", slugify("Marcello Hernández") === "marcello-hernandez");
check("Chloë Sevigny → chloe-sevigny", slugify("Chloë Sevigny") === "chloe-sevigny");
check("husband's → husbands (apostrophe stripped, not dashed)", slugify("husband's infidelity") === "husbands-infidelity");
check("José Andrés → jose-andres", slugify("José Andrés") === "jose-andres");
check("entityKey unifies accent variants", entityKey("Marcello Hernández") === entityKey("Marcello Hernandez"));
check("shareEntityFold matches across variants", shareEntityFold(["Marcello Hernández"], ["Marcello Hernandez"]) === true);
check("different people still differ", shareEntityFold(["Ana de Armas"], ["Marcello Hernandez"]) === false);

// ── A. dedup bucketing: accent variants share the entity part of the eventKey (via normalized slug) ──
check("dedup eventKey entity part unified", slugify("Marcello Hernández") === slugify("Marcello Hernandez"));

// ── B. scaffolding cut ──
{
  const body = "Marcello hosted the show on July 15. The performance was a confirmed event, covered by outlets including TMZ and Yahoo Sports. Every joke mentioned was part of the publicly broadcast monologue. His set ran 10 minutes.";
  const { body: out, cut } = cutScaffolding(body);
  check("scaffolding sentences cut", !/confirmed event|publicly broadcast/.test(out) && cut.length === 2, JSON.stringify(cut));
  check("real sentences survive", out.includes("July 15") && out.includes("10 minutes"));
}
// ── C. absence-claim cut + FAQ drop ──
{
  const body = "Gleb filed on July 14. Neither has commented on the twins' ongoing treatment. The hearing is set for August 18.";
  const { body: out } = cutAbsenceClaims(body);
  check("absence claim cut from prose", !/Neither has commented/.test(out) && out.includes("August 18"));
  const { faq, dropped } = dropAbsenceFaq([
    { q: "How old is Olivia?", a: "The legal documents mention Olivia but do not specify her age." },
    { q: "When is the hearing?", a: "The hearing is set for August 18." },
  ]);
  check("absence-asserting FAQ dropped, grounded FAQ kept", faq.length === 1 && faq[0].q.includes("hearing") && dropped.length === 1);
  const legit = cutAbsenceClaims("She said the wedding was private. Details are in the filing.");
  check("normal prose untouched", legit.cut.length === 0);
}
// ── splitter: abbreviation-safe (the David H. truncation) ──
{
  const parts = splitSentences("The show hit the stage at the David H. Koch Theater. It ran late.");
  check("no split after 'David H.'", parts.length === 2 && parts[0].includes("Koch Theater"), JSON.stringify(parts));
  const deduped = dedupeSentences("The spotlight hit the David H. Koch Theater in New York. Guests filled the David H. Koch Theater in New York for the show.");
  check("dedupe never truncates at an initial", !/David H\.$/m.test(deduped.split(". ")[0]) && deduped.includes("Koch Theater"));
}
// ── quote-fragment dedupe (the Kathie Lee duplication) ──
{
  const body = '"People call it an affair," Kathie Lee said about the scandal that made headlines. "People call it an affair," "No, an affair is not a tryst at a hotel one time. At all."';
  const out = dedupeSentences(body);
  const dups = (out.match(/People call it an affair/g) || []).length;
  check("repeated quote fragment removed", dups === 1, out);
}
// ── D. relative time detection ──
check("'that evening' w/o date detected", relativeTimeUnanchored("He hosted the awards that evening at the theater.") === "that evening");
check("anchored body passes", relativeTimeUnanchored("He hosted the awards that evening, Wednesday, July 15, at the theater.") === null);
check("no relative time passes", relativeTimeUnanchored("He hosted the awards on July 15.") === null);

// ── E+F. assemble: sources block + slug from the WRITER's title ──
{
  const out = buildGossipMarkdown({
    article: { title: "Star Alpha's Quiet Malibu Ceremony Stuns Fans", dek: "A private wedding with only forty guests in attendance.", metaTitle: "Star Alpha weds Star Beta at private Malibu ceremony", metaDescription: "Star Alpha married Star Beta at a private Malibu estate on July 3 with 40 guests, People reports, keeping the location secret until the day itself.", body: "Star Alpha married Star Beta on July 3 at a Malibu estate with 40 guests, People reports.", keyTakeaways: ["Star Alpha married Star Beta on July 3"], faq: [], whatWeKnow: ["Star Alpha married Star Beta on July 3"] },
    frame: { tier: "CONFIRMED", severity: "NORMAL", uiLabel: "Confirmed", monitor: false },
    provenance: { sensitivity: "normal", attribution: "People", monitor: false, sources: [], corroborationCount: 1, publishedAt: "2026-07-18T00:00:00Z" },
    route: { category: "celebrity", subcategory: "news" },
    topic: { primaryEntity: "Star Alpha", id: "t1", slug: "star-alpha-and-star-beta-say-i-do-source-outlet-headline", title: "Star Alpha and Star Beta Say I Do (source outlet headline)" },
    dateISO: "2026-07-18T00:00:00.000Z",
    bundle: { sources: [ { outlet: "People", url: "https://people.com/star-alpha-wedding-123", title: "Star Alpha and Star Beta Are Married", text: "Star Alpha married Star Beta on July 3 at a Malibu estate with 40 guests." }, { outlet: "X", url: "https://x.com/pop/status/1", title: "amp", text: "" } ] },
  });
  check("slug from OUR headline, not the source's", out.slug === "star-alphas-quiet-malibu-ceremony-stuns-fans", out.slug);
  check("Sources block appended w/ outbound link", /## Sources/.test(out.md) && out.md.includes("people.com/star-alpha-wedding-123"));
  check("social/amplifier URLs excluded", !out.md.includes("x.com/pop"));
  check("anchor = source headline, outlet as plain text", out.md.includes("[Star Alpha and Star Beta Are Married](https://people.com/star-alpha-wedding-123) — People"));
  check("anchor is NEVER the generic 'Report'", !/\[Report\]/.test(out.md));
}
// ── G+F. runGossip surgical triggers: source-mirroring title + unanchored time + question lede ──
{
  let secondPassIssues = null, calls = 0;
  const SRC = "Star Alpha, 34, wed Star Beta on July 3 at a Malibu estate with 40 guests, People reports. ".repeat(8);
  const r = await runGossip({ primaryEntity: "Star Alpha", title: "Star Alpha and Star Beta Say I Do at Private Malibu Estate", claim: "wedding", subjectType: "actor", sources: [{ outlet: "People", text: SRC }] }, {
    writeImpl: async ({ priorArticle, issues }) => {
      calls++;
      if (priorArticle) { secondPassIssues = issues; return { ...priorArticle, title: "A Secret 'I Do': Inside Star Alpha's Hidden Malibu Wedding", body: priorArticle.body.replace("that evening", "on July 3") }; }
      return { title: "Star Alpha and Star Beta Say I Do at Private Malibu Estate", dek: "A wedding to remember for everyone who was there.", body: "Star Alpha wed Star Beta that evening at a Malibu estate with 40 guests, People reports.\n\n" + ("More verified detail sentences follow here for length purposes and even more extra detail. ".repeat(11) + "\n\n").repeat(3), keyTakeaways: ["k"], faq: [{ q: "Q?", a: "They wed at a Malibu estate with 40 guests." }], whatWeKnow: ["Star Alpha wed Star Beta"], whatWeDont: [], claims: [] };
    },
    editorialImpl: async () => ({ isStory: true, category: "celebrity", primaryEntity: "Star Alpha", confirmed: true, official: false, denied: false, angle: "wedding" }),
    verify: false, judge: false, corroborate: false, craftFix: true,
  });
  check("surgical pass triggered (title mirror + unanchored time)", r.status === "PUBLISH" && calls === 2 && Array.isArray(secondPassIssues) && secondPassIssues.length >= 2, JSON.stringify({ calls, secondPassIssues }));
  check("fixed title + anchored date shipped", r.article.title.includes("Hidden Malibu") && r.article.body.includes("on July 3"));
  check("surgicalFixes telemetry on the result", (r.surgicalFixes || []).length >= 2);
}
// ── B+C inside the pipeline: scaffolding/absence cut in Stage 6c ──
{
  const SRC = "Star Alpha, 34, wed Star Beta on July 3 at a Malibu estate with 40 guests, People reports. ".repeat(8);
  const r = await runGossip({ primaryEntity: "Star Alpha", title: "t", claim: "wedding", subjectType: "actor", sources: [{ outlet: "People", text: SRC }] }, {
    writeImpl: async () => ({ title: "Star Alpha Weds Star Beta in Malibu on July 3", dek: "The couple kept the location secret until the very day.", body: "Star Alpha wed Star Beta on July 3, People reports. The event was a confirmed event, covered by outlets including People. Neither has commented on the honeymoon plans. " + "More verified detail sentences follow here for length. ".repeat(12), keyTakeaways: ["k"], faq: [{ q: "Where?", a: "The documents do not specify the location." }], whatWeKnow: ["Star Alpha wed Star Beta July 3"], whatWeDont: [], claims: [] }),
    editorialImpl: async () => ({ isStory: true, category: "celebrity", primaryEntity: "Star Alpha", confirmed: true, official: false, denied: false, angle: "wedding" }),
    verify: false, judge: false, corroborate: false,
  });
  check("scaffolding + absence cut in-pipeline", r.status === "PUBLISH" && !/confirmed event|Neither has commented/.test(r.article.body), r.article.body.slice(0, 160));
  check("absence FAQ dropped in-pipeline", !(r.article.faq || []).some((f) => /do not specify/.test(f.a || "")));
  check("guardCuts telemetry present", (r.guardCuts || []).length >= 2, JSON.stringify(r.guardCuts));
}

// ── Sources anchor text (2026-07-19: 18/18 live links had shipped as generic "Report") ──
{
  const { sourceAnchor } = await import("../assemble.mjs");
  check("real headline wins", sourceAnchor({ title: "Paige DeSorbo Addresses Engagement Rumors", url: "https://x.com/a" }) === "Paige DeSorbo Addresses Engagement Rumors");
  check("outlet suffix stripped from headline", sourceAnchor({ title: "Kim Kardashian Shares Final Texts | Page Six", url: "https://p.com/x" }) === "Kim Kardashian Shares Final Texts");
  const fromUrl = sourceAnchor({ title: "", url: "https://www.usmagazine.com/celebrity-news/news/paige-desorbo-engagement-rumors/" });
  check("no title → humanized URL slug (the source's own headline)", fromUrl === "Paige Desorbo Engagement Rumors", fromUrl);
  check("never bare 'Report'", sourceAnchor({ title: "", url: "https://example.com/" }) === "Full report");
  check("outlet name never becomes the anchor", !/^(People|TMZ|Page Six|E! News)$/.test(sourceAnchor({ title: "", url: "https://people.com/" })));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Audit guards green. ✅\n");
