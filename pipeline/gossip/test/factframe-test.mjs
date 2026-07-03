// "STATE FACTS AS FACTS" + IMAGE ROOT-CAUSE regression. Proves the run-6 fixes:
//   1) A story DISCOVERED via a tier-2 social aggregator (Pop Crave) but CORROBORATED by multiple tier-7 wires is
//      framed CONFIRMED — NOT "social speculation" — and carries NO "this has not been confirmed" disclaimer.
//   2) The frame reads the CORROBORATED bundle, not just the thin discovery source.
//   3) fetchOgImage picks the real og:image URL even when a Page Six-style page emits <meta og:image:width> first.
// Run: node pipeline/gossip/test/factframe-test.mjs
import { frameTopic } from "../frame.mjs";
import { confidenceTier, tierOfDomain, distinctOutletsAtTier } from "../policy.mjs";
import { fetchOgImage } from "../heroImage.mjs";

let pass = 0, fail = 0; const fails = [];
const check = (n, c, d = "") => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; fails.push(n); console.log("  ❌ " + n + "  " + d); } };

console.log("\n=== FACTS-AS-FACTS + IMAGE ROOT-CAUSE TEST ===\n");

// ── The $26M donation scenario: discovered via Pop Crave (tier 2), reported by CBS/NYT/AP (tier 7). ──
const donation = {
  primaryEntity: "Taylor Swift",
  title: "Taylor Swift and Travis Kelce donate $26 million to charities",
  claim: "Taylor Swift and Travis Kelce donated $26 million to charities.",
  sources: [{ outlet: "Pop Crave", url: "https://bsky.app/profile/popcrave/post/abc", tier: 2 }],
};

// BEFORE the fix (frame sees only the discovery source): social speculation.
check("thin discovery source alone tiers as SOCIAL_SPECULATION", confidenceTier(donation) === "SOCIAL_SPECULATION", confidenceTier(donation));

// AFTER: the corroborated bundle carries the wires that actually reported it.
const bundle = {
  sources: [], // (bodies may or may not extract; tiering must not depend on that)
  corroboratingOutlets: [
    { outlet: "CBS News", domain: "cbsnews.com", tier: tierOfDomain("cbsnews.com") },
    { outlet: "The New York Times", domain: "nytimes.com", tier: tierOfDomain("nytimes.com") },
    { outlet: "AP News", domain: "apnews.com", tier: tierOfDomain("apnews.com") },
  ],
};
check("cbsnews.com/nytimes.com/apnews.com all tier 7", [ "cbsnews.com", "nytimes.com", "apnews.com" ].every((d) => tierOfDomain(d) === 7));
check("≥2 distinct tier-7 outlets counted", distinctOutletsAtTier(bundle.corroboratingOutlets, 7) === 3, String(distinctOutletsAtTier(bundle.corroboratingOutlets, 7)));

const frame = frameTopic(donation, bundle);
check("corroborated NORMAL fact is framed CONFIRMED (not speculation)", frame.tier === "CONFIRMED", frame.tier);
check("NO 'not confirmed / speculation' disclaimer on a confirmed fact", frame.needsDisclaimer === false, `needsDisclaimer=${frame.needsDisclaimer}`);
check("writer is told to STATE IT PLAINLY (cite the source)", /state it plainly/i.test(frame.writerDirective));
check("attribution is a MAJOR outlet, not Pop Crave", frame.attribution && frame.attribution !== "Pop Crave", String(frame.attribution));

// Backward-compat: no bundle → old behavior unchanged.
check("frameTopic(topic) with no bundle still works", frameTopic(donation).tier === "SOCIAL_SPECULATION");

// A SENSITIVE (HIGH) claim must NOT be auto-confirmed by press coverage — it stays attributed.
const health = {
  primaryEntity: "Some Star", title: "Some Star hospitalized after collapse", claim: "Some Star was hospitalized.",
  sources: [{ outlet: "Pop Crave", url: "https://x.com/x/status/1", tier: 2 }],
};
check("a HIGH-severity claim is NOT auto-CONFIRMED by wires (stays attributed)", frameTopic(health, bundle).tier === "REPORTED_BY_MAJOR", frameTopic(health, bundle).tier);

// ── fetchOgImage: Page Six emits <meta property="og:image:width" content="1200"> BEFORE the real og:image. ──
{
  const REAL = "https://nypost.com/wp-content/uploads/dvd-walker.jpg";
  const html = `<html><head>
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="800">
    <meta property="og:image" content="${REAL}">
    <meta name="twitter:image" content="${REAL}">
  </head><body>x</body></html>`;
  const mockFetch = async (url) => url.endsWith(".jpg")
    ? { ok: true, headers: { get: () => "image/jpeg" } }               // the image validates
    : { ok: true, text: async () => html };                            // the article page
  const og = await fetchOgImage("https://pagesix.com/article", mockFetch);
  check("fetchOgImage skips the width tag and returns the real og:image URL", og === REAL, String(og));
  check("fetchOgImage never returns the bare width value '1200'", og !== "1200" && !/^\d+$/.test(String(og)));
}

console.log(`\n── RESULT: ${pass} passed${fail ? `, ${fail} FAILED` : ""} ──`);
if (fail) { console.log("FAILED:", fails.join("; ")); process.exit(1); }
console.log("Facts-as-facts + image root-cause green. ✅\n");
