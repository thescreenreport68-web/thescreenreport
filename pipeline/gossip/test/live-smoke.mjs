// GOSSIP — LIVE SMOKE TEST (real LLM writer). Proves Stage 5 actually generates compliant articles and that
// the legal gate accepts/blocks the live output. Uses FICTIONAL names (no real-person claims, even locally).
// Run: cd site-gossip && set -a; . "/Users/sivajithcu/Movie News site/.env"; set +a && node pipeline/gossip/test/live-smoke.mjs
import { runGossip } from "../run.mjs";
import { legalGate } from "../legalGate.mjs";
import { frameTopic } from "../frame.mjs";

const TOPICS = [
  {
    name: "Normal dating rumor, major outlet (should PUBLISH, attributed)",
    topic: {
      primaryEntity: "Ava Stone", subjectType: "celebrity",
      title: "Ava Stone and Liam Carter spark dating rumors",
      claim: "Ava Stone and Liam Carter are dating",
      sources: [{ outlet: "People", text: "Entertainment outlet People reports that actors Ava Stone and Liam Carter were seen together at a Los Angeles restaurant this past weekend. A source told the outlet, \"They were inseparable and looked very happy together all night.\" Representatives for both actors did not respond to requests for comment. The pair were first linked earlier this year after appearing at the same awards afterparty." }],
    },
  },
  {
    name: "Unconfirmed health rumor, social only (must carry the disclaimer to PUBLISH)",
    topic: {
      primaryEntity: "Mara Vey", subjectType: "musician",
      title: "Fans worried after Mara Vey cancels appearance",
      claim: "Mara Vey was hospitalized",
      sources: [{ outlet: "X", text: "Posts circulating on social media this week claim that singer Mara Vey was hospitalized. There has been no official statement from her team. Fans noted she abruptly canceled a scheduled festival appearance and pointed to a vague message she posted before going quiet." }],
    },
  },
];

for (const t of TOPICS) {
  console.log(`\n===== ${t.name} =====`);
  const frame = frameTopic(t.topic);
  console.log(`frame: tier=${frame.tier} severity=${frame.severity} decision=${frame.decision} needsDisclaimer=${frame.needsDisclaimer}`);
  const r = await runGossip(t.topic);
  console.log(`STATUS: ${r.status}` + (r.blocks ? ` — blocks: ${r.blocks.join(" | ")}` : "") + (r.reason ? ` — ${r.reason}` : ""));
  if (r.article) {
    console.log(`TITLE: ${r.article.title}`);
    console.log(`LABEL: ${r.article.rumor?.statusLabel || "(blocked before assemble)"}`);
    console.log(`BODY:\n${r.article.body}\n`);
    if (frame.needsDisclaimer) console.log(`disclaimer present in body: ${r.article.body?.includes(frame.disclaimerText) ? "YES ✅" : "NO ❌"}`);
    // independent re-check of the live output against the legal gate
    const g = legalGate(r.article, frame, t.topic);
    console.log(`legalGate on live output: ${g.pass ? "PASS ✅" : "BLOCK ❌ " + g.blocks.join(" | ")}`);
  }
}
console.log("\n(smoke test done)");
