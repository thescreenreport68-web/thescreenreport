// 2026-07-19 CRITICAL regression: the absence-claim cutter was deleting the legally-mandated
// non-confirmation disclaimer AFTER legalGate had approved the article, publishing unprotected.
//   node pipeline/gossip/test/legal-disclaimer-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cutAbsenceClaims, cutScaffolding } from "../proseGuards.mjs";
import { runGossip } from "../run.mjs";
import { frameTopic } from "../frame.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };
process.env.GOSSIP_STATS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gossip-stats-"));

console.log("\n=== LEGAL DISCLAIMER SURVIVAL ===\n");

// every disclaimerFor() variant, verbatim in shape
const DISCLAIMERS = [
  "This has not been confirmed by Sydney Sweeney, their representatives, or any official source — it is unverified and currently circulating as speculation.",
  "Page Six reported this; it has not been officially confirmed by Star A or their representatives, and The Screen Report has not independently verified it.",
  "Star A and their representatives have denied this, and The Screen Report has not independently verified it — it remains unconfirmed.",
];

// ── 1) protected disclaimers survive the cutters ──
DISCLAIMERS.forEach((d, i) => {
  const body = "A verified fact here. " + d + " Another verified fact.";
  check(`disclaimer variant ${i + 1} survives when protected`, cutAbsenceClaims(body, [d]).cut.length === 0 && cutAbsenceClaims(body, [d]).body.includes(d));
  // After Batch A every real disclaimer variant names a source ("their representatives", "Page Six
  // reported", "have denied this"), so the attribution exemption ALONE now protects them — strictly safer
  // than relying on the allowlist. The allowlist remains defence-in-depth for a future wording that
  // carries no attribution, and that mechanism is proven separately below.
  check(`disclaimer variant ${i + 1} survives even WITHOUT the allowlist (attribution exemption)`, cutAbsenceClaims(body).cut.length === 0);
});
// the allowlist MECHANISM itself: an unattributed sentence that WOULD be cut survives when protected
{
  const bare = "Nobody has commented on the matter.";
  check("allowlist protects an otherwise-cut sentence", cutAbsenceClaims("A fact. " + bare + " More.", [bare]).cut.length === 0);
  check("...and without the allowlist that same sentence IS cut", cutAbsenceClaims("A fact. " + bare + " More.").cut.length === 1);
}
// a non-disclaimer absence claim is still cut even while a disclaimer is protected
{
  const d = DISCLAIMERS[0];
  const body = "A fact. " + d + " Neither has commented on the treatment. Another fact.";
  const r = cutAbsenceClaims(body, [d]);
  check("protection is exact — other absence claims still cut", r.cut.length === 1 && r.body.includes(d) && !r.body.includes("Neither has commented"));
}
check("scaffolding cutter honours protection too", cutScaffolding("A fact. " + DISCLAIMERS[0] + " More.", [DISCLAIMERS[0]]).body.includes(DISCLAIMERS[0]));

// ── 2) end-to-end: an unconfirmed-tier story publishes WITH its disclaimer intact ──
{
  const SRC = "A source tells the outlet that Star A and Star B have been quietly dating for months. ".repeat(6);
  // A single-source / social-speculation rumour is the tier that legally REQUIRES the in-text
  // non-confirmation sentence (REPORTED_BY_MAJOR does not — verified against frameTopic).
  const topic = { primaryEntity: "Star A", title: "Star A dating rumour", claim: "Star A is dating Star B", subjectType: "actor", sources: [{ outlet: "SomeBlog", tier: 2, text: SRC }] };
  const frame = frameTopic(topic, { sources: [{ outlet: "SomeBlog", tier: 2 }], corroborationCount: 1 }, { confirmed: false, denied: false, official: false });
  const disclaimer = frame.disclaimerText;
  const r = await runGossip(topic, {
    writeImpl: async ({ priorArticle }) => ({
      title: "Star A and Star B Are Quietly Dating, Source Says",
      dek: "A source says the pair have been seeing each other for months now.",
      // the writer includes the mandated sentence; the cutter used to delete it right afterwards
      body: "Star A and Star B have been quietly dating for months, a source tells the outlet.\n\n" +
            ("More verified detail sentences follow here to give the piece real length and body. ".repeat(10)) +
            "\n\n" + (disclaimer || "This has not been confirmed."),
      keyTakeaways: ["k"], faq: [{ q: "Q?", a: "A real answer here." }], whatWeKnow: ["Star A and Star B are reportedly dating"], whatWeDont: [], claims: [],
    }),
    editorialImpl: async () => ({ isStory: true, category: "celebrity", primaryEntity: "Star A", confirmed: false, official: false, denied: false, angle: "dating" }),
    verify: false, judge: false, corroborate: false, craftFix: true,
  });
  check("unconfirmed story still PUBLISHES", r.status === "PUBLISH", r.status + " " + (r.reason || ""));
  if (r.status === "PUBLISH") {
    check("frame demanded a disclaimer (test is meaningful)", !!r.frame.needsDisclaimer, "needsDisclaimer=" + r.frame.needsDisclaimer);
    const has = /has not been (officially )?confirmed|have denied this|not independently verified|remains unconfirmed/i.test(r.article.body);
    check("🔴 the published body STILL CARRIES the legal disclaimer", has, r.article.body.slice(-160));
  }
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Legal disclaimer protected. ✅\n");
