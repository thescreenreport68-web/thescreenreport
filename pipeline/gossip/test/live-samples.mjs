// Generate one sample article per gossip TYPE with the upgraded writer (live), for scoring. Fictional names.
import { runGossip } from "../run.mjs";
import { detectGossipType } from "../writer.mjs";

const TOPICS = [
  {
    primaryEntity: "Ava Stone", subjectType: "celebrity",
    title: "Ava Stone and Liam Carter spark dating rumors after cozy dinner",
    claim: "Ava Stone and Liam Carter are dating",
    sources: [{ outlet: "People", text: "People reports that actors Ava Stone and Liam Carter were seen on a cozy dinner date in Los Angeles over the weekend. A source told the outlet, \"They couldn't stop laughing and looked totally smitten.\" The two were first linked at an awards afterparty earlier this year. Reps for both did not respond to requests for comment." }],
  },
  {
    primaryEntity: "Mara Vey", subjectType: "musician",
    title: "Mara Vey and Cleo Banks appear to trade shade on X",
    claim: "Mara Vey and Cleo Banks are feuding",
    sources: [{ outlet: "Pop Crave", text: "Pop Crave notes that pop stars Mara Vey and Cleo Banks appeared to trade jabs on X this week. After Banks tweeted about 'fake friends in this industry,' Vey replied with a single eye-roll emoji. Fans immediately connected it to their rumored fallout over a scrapped collaboration. Neither has addressed the speculation." }],
  },
  {
    primaryEntity: "Nina Roth", subjectType: "celebrity", confirmed: true,
    title: "Nina Roth and Jude Ellis split after three years",
    claim: "Nina Roth and Jude Ellis have broken up",
    sources: [{ outlet: "Page Six", text: "Page Six reports that actors Nina Roth and Jude Ellis have split after three years together. A source said the two 'have been growing apart for months' and that the breakup was amicable. The pair were first linked on the set of a 2023 thriller. Reps confirmed the split but declined further comment." }],
  },
  {
    primaryEntity: "Ivy Lane", subjectType: "musician",
    title: "Ivy Lane's cryptic post has fans speculating about a baby",
    claim: "Ivy Lane may be pregnant",
    sources: [{ outlet: "X", text: "Posts circulating on X show that singer Ivy Lane shared a cryptic Instagram photo of two coffee cups with a baby-bottle emoji in the caption. Fans are speculating she may be expecting her first child. Lane has not commented, and there is no official confirmation." }],
  },
];

for (const t of TOPICS) {
  console.log(`\n${"=".repeat(70)}\nTYPE: ${detectGossipType(t)}  |  entity: ${t.primaryEntity}`);
  const r = await runGossip(t);
  console.log(`STATUS: ${r.status}` + (r.blocks ? ` — ${r.blocks.join(" | ")}` : ""));
  if (r.article) {
    console.log(`LABEL: ${r.article.rumor?.statusLabel}`);
    console.log(`TITLE: ${r.article.title}`);
    console.log(`DEK: ${r.article.dek}`);
    console.log(`PULL: "${r.article.pullQuote || "—"}"`);
    console.log(`\n${r.article.body}\n`);
  }
}
console.log("(samples done)");
