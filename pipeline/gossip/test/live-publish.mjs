// Generate ONE real gossip article through the live pipeline + write it, so we can confirm it renders.
// Fictional names only. The caller deletes the sample after the render check.
import { runGossip } from "../run.mjs";
import { writeGossipArticle } from "../assemble.mjs";

const topic = {
  primaryEntity: "Ava Stone", subjectType: "celebrity",
  title: "Ava Stone and Liam Carter spark dating rumors after dinner sighting",
  slug: "sample-ava-stone-liam-carter-dating-rumors",
  claim: "Ava Stone and Liam Carter are dating",
  sources: [{ outlet: "People", text: "Entertainment outlet People reports that actors Ava Stone and Liam Carter were seen together at a Los Angeles restaurant this past weekend. A source told the outlet, \"They were inseparable and looked very happy together all night.\" Representatives for both actors did not respond to requests for comment. The pair were first linked earlier this year after appearing at the same awards afterparty." }],
};

const r = await runGossip(topic);
console.log("status:", r.status);
if (r.status !== "PUBLISH") { console.log("NOT PUBLISHED:", JSON.stringify(r).slice(0, 300)); process.exit(1); }
const out = writeGossipArticle({ article: r.article, frame: r.frame, provenance: r.provenance, route: r.route, topic, dateISO: new Date(Date.parse("2026-06-29T12:00:00Z")).toISOString() });
console.log("wrote:", out.path);
console.log("slug:", out.slug, "| category:", out.frontmatter.category, "| status:", out.frontmatter.rumorStatus, "| storyStatus:", out.frontmatter.storyStatus);
